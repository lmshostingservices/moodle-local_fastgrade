// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Layout preferences: theme, density, focus and zen modes, panel widths.
 *
 * @module     local_fastgrade/ui/layout
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
let lastPrefs = null;
let lastRoot = null;

/**
 * Apply preferences to the app root.
 *
 * @param {HTMLElement} root
 * @param {Object} prefs
 */
export const applyPrefs = (root, prefs) => {
    lastPrefs = prefs;
    lastRoot = root;
    const theme = prefs.theme === 'system' ? (media && media.matches ? 'dark' : 'light') : prefs.theme;
    root.dataset.theme = theme;
    root.dataset.density = prefs.density;
    root.dataset.rail = prefs.rail;
    root.dataset.panel = prefs.panel;
    root.dataset.margin = prefs.margin;
    root.dataset.toolbar = prefs.toolbar;
    root.classList.toggle('is-focus', !!prefs.focus);
    root.classList.toggle('is-zen', !!prefs.zen);
    root.classList.toggle('hide-status', !prefs.showstatus);
    root.classList.toggle('hide-progress', !prefs.showprogress);
    root.classList.toggle('hide-integrity', !prefs.showintegrity);
    root.classList.toggle('hide-notes', !prefs.shownotes);
    root.classList.toggle('hide-bank', !prefs.showbank);
    root.style.setProperty('--fg-rail-w', `${Math.max(200, Math.min(480, prefs.railwidth || 260))}px`);
    root.style.setProperty('--fg-panel-w', `${Math.max(320, Math.min(720, prefs.panelwidth || 400))}px`);
    document.body.classList.toggle('fg-focus', !!prefs.focus || !!prefs.zen);
    if (prefs.focus || prefs.zen) {
        if (document.documentElement.requestFullscreen && !document.fullscreenElement && prefs.zen) {
            document.documentElement.requestFullscreen().catch(() => null);
        }
    } else if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen().catch(() => null);
    }
};

if (media && media.addEventListener) {
    media.addEventListener('change', () => {
        if (lastRoot && lastPrefs && lastPrefs.theme === 'system') {
            applyPrefs(lastRoot, lastPrefs);
        }
    });
}

/**
 * Make the dividers draggable (and keyboard adjustable).
 *
 * @param {HTMLElement} root
 * @param {Function} save (key, value)
 */
export const initResizers = (root, save) => {
    root.querySelectorAll('.fg-resizer').forEach(r => {
        const side = r.dataset.side;
        const prop = side === 'rail' ? '--fg-rail-w' : '--fg-panel-w';
        const key = side === 'rail' ? 'railwidth' : 'panelwidth';
        const min = side === 'rail' ? 200 : 320;
        const max = side === 'rail' ? 480 : 720;
        const current = () => parseInt(getComputedStyle(root).getPropertyValue(prop), 10) || (side === 'rail' ? 260 : 400);
        const set = w => {
            w = Math.max(min, Math.min(max, Math.round(w)));
            root.style.setProperty(prop, w + 'px');
            r.setAttribute('aria-valuenow', w);
            return w;
        };
        r.setAttribute('aria-valuemin', min);
        r.setAttribute('aria-valuemax', max);
        r.addEventListener('pointerdown', e => {
            e.preventDefault();
            r.setPointerCapture(e.pointerId);
            const startx = e.clientX;
            const startw = current();
            root.classList.add('is-resizing');
            const move = ev => {
                const dx = ev.clientX - startx;
                set(side === 'rail' ? startw + dx : startw - dx);
            };
            const up = () => {
                r.removeEventListener('pointermove', move);
                root.classList.remove('is-resizing');
                save(key, current());
            };
            r.addEventListener('pointermove', move);
            r.addEventListener('pointerup', up, {once: true});
        });
        r.addEventListener('keydown', e => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                const dir = e.key === 'ArrowRight' ? 1 : -1;
                const w = set(current() + (side === 'rail' ? dir : -dir) * 24);
                save(key, w);
            }
        });
    });
};
