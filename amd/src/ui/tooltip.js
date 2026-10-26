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
 * Hover and focus help on every control. Any element with data-fg-tip gets a tooltip; data-fg-key adds
 * its shortcut. Tooltips show on hover, keyboard focus and long-press, and close with Escape.
 *
 * @module     local_fastgrade/ui/tooltip
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

let tipEl = null;
let current = null;
let showTimer = null;
let enabled = true;
let counter = 0;

/**
 * Turn tooltips on or off.
 *
 * @param {boolean} on
 */
export const setEnabled = on => {
    enabled = on;
    if (!on) {
        hide();
    }
};

/**
 * Add tooltip attributes to an element.
 *
 * @param {HTMLElement} el
 * @param {string} text
 * @param {string} key shortcut label
 * @returns {HTMLElement}
 */
export const tip = (el, text, key = '') => {
    el.dataset.fgTip = text;
    if (key) {
        el.dataset.fgKey = key;
    }
    if (!el.getAttribute('aria-label') && !el.textContent.trim()) {
        el.setAttribute('aria-label', text + (key ? ` (${key})` : ''));
    }
    return el;
};

const ensure = () => {
    if (!tipEl) {
        tipEl = document.createElement('div');
        tipEl.className = 'fg-tooltip';
        tipEl.setAttribute('role', 'tooltip');
        tipEl.id = 'fg-tooltip';
        document.body.appendChild(tipEl);
    }
    return tipEl;
};

const hide = () => {
    clearTimeout(showTimer);
    if (tipEl) {
        tipEl.classList.remove('is-visible');
    }
    if (current) {
        current.removeAttribute('aria-describedby');
    }
    current = null;
};

const show = el => {
    if (!enabled || !el.isConnected) {
        return;
    }
    const t = ensure();
    t.textContent = '';
    const parts = el.dataset.fgTip.split('\n');
    const title = document.createElement('div');
    title.className = 'fg-tooltip-title';
    title.textContent = parts[0];
    t.appendChild(title);
    parts.slice(1).forEach(p => {
        const d = document.createElement('div');
        d.className = 'fg-tooltip-line';
        d.textContent = p;
        t.appendChild(d);
    });
    if (el.dataset.fgKey) {
        const k = document.createElement('div');
        k.className = 'fg-tooltip-keys';
        el.dataset.fgKey.split(' ').forEach(part => {
            const kbd = document.createElement('kbd');
            kbd.textContent = part;
            k.appendChild(kbd);
        });
        t.appendChild(k);
    }
    // Keep inside the theme container so colours match.
    const host = el.closest('.fg-app') || document.body;
    if (t.parentNode !== host) {
        host.appendChild(t);
    }
    t.classList.add('is-visible');
    const r = el.getBoundingClientRect();
    const tr = t.getBoundingClientRect();
    let top = r.bottom + 8;
    let placement = 'below';
    if (top + tr.height > window.innerHeight - 8) {
        top = r.top - tr.height - 8;
        placement = 'above';
    }
    let left = r.left + r.width / 2 - tr.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));
    t.style.top = `${Math.round(top)}px`;
    t.style.left = `${Math.round(left)}px`;
    t.dataset.placement = placement;
    if (!t.id) {
        t.id = 'fg-tooltip-' + (++counter);
    }
    el.setAttribute('aria-describedby', t.id);
    current = el;
};

/**
 * Start listening (once per page).
 *
 * @param {HTMLElement} root
 */
export const init = root => {
    const target = e => e.target.closest && e.target.closest('[data-fg-tip]');
    root.addEventListener('pointerover', e => {
        const el = target(e);
        if (!el || el === current) {
            return;
        }
        hide();
        clearTimeout(showTimer);
        showTimer = setTimeout(() => show(el), e.pointerType === 'touch' ? 450 : 350);
    });
    root.addEventListener('pointerout', e => {
        const el = target(e);
        if (el && (!e.relatedTarget || !el.contains(e.relatedTarget))) {
            hide();
        }
    });
    root.addEventListener('focusin', e => {
        const el = target(e);
        if (el && el.matches(':focus-visible')) {
            hide();
            show(el);
        }
    });
    root.addEventListener('focusout', hide);
    root.addEventListener('pointerdown', hide);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && current) {
            hide();
        }
    }, true);
    window.addEventListener('scroll', hide, true);
};

export {hide};
