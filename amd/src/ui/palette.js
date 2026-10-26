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
 * Command palette (Ctrl/Cmd+K): jump to any student, run any action.
 *
 * @module     local_fastgrade/ui/palette
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon, replace} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import * as Shortcuts from 'local_fastgrade/ui/shortcuts';
import * as Settings from 'local_fastgrade/ui/settings';

export default class Palette {
    /**
     * Constructor.
     *
     * @param {Object} app
     */
    constructor(app) {
        this.app = app;
        this.el = null;
    }

    /**
     * Actions offered.
     *
     * @returns {Array}
     */
    actions() {
        const app = this.app;
        const p = () => app.store.get('prefs');
        return [
            {label: t('savenext'), icon: 'send', key: 'mod+enter', run: () => app.commit(true)},
            {label: t('nextneeds'), icon: 'bolt', key: 'n', run: () => app.next(true, 1)},
            {label: t('sc_dictate'), icon: 'mic', key: 'v', run: () => {
                app.panel.focusFeedback();
                if (app.panel.feedbackMic) {
                    app.panel.feedbackMic.click();
                }
            }},
            {label: t('sc_focus'), icon: 'focus', key: '\\', run: () => app.savePrefs({focus: !p().focus})},
            {label: t('sc_zen'), icon: 'zen', key: 'shift+\\', run: () => app.savePrefs({zen: !p().zen})},
            {label: t('theme_toggle'), icon: 'moon', run: () => app.savePrefs({theme: app.root.dataset.theme === 'dark' ?
                'light' : 'dark'})},
            {label: t('density_toggle'), icon: 'list', run: () => app.savePrefs({density: p().density === 'compact' ?
                'comfortable' : 'compact'})},
            {label: t('layoutsettings'), icon: 'settings', run: () => Settings.open(app)},
            {label: t('keyboardshortcuts'), icon: 'keyboard', key: '?', run: () => Shortcuts.showHelp()},
            {label: t('classicgrader'), icon: 'external', run: () => {
                window.location.href = app.store.get('info').classicurl;
            }},
            ...['needsgrading', 'all', 'graded', 'late', 'draft'].map(f => ({label: t('filterby', t('filter_' + f)), icon: 'filter',
                run: () => {
                    app.savePrefs({filter: f});
                    app.rail.render();
                }})),
        ];
    }

    /**
     * Open it.
     *
     * @param {string} only "students" to list students only
     */
    open(only = '') {
        if (this.el) {
            this.close();
            return;
        }
        const app = this.app;
        let index = 0;
        let results = [];
        const input = h('input.fg-palette-input', {type: 'text', placeholder: only === 'students' ? t('palette_students') :
            t('palette_placeholder'), 'aria-label': t('palette_placeholder'), autocomplete: 'off'});
        const list = h('div.fg-palette-list', {role: 'listbox'});
        const draw = () => {
            const q = input.value.trim().toLowerCase();
            const people = app.store.get('participants').filter(p => !q || p.person.fullname.toLowerCase().includes(q))
                .slice(0, 12).map(p => ({label: p.person.fullname, sub: p.needsgrading ? t('state_needs') :
                    (p.graded ? (p.grade || t('state_done')) : t('state_nosubmission')), icon: 'user', run: () => app.open(p)}));
            const acts = only === 'students' ? [] : this.actions().filter(a => !q || a.label.toLowerCase().includes(q));
            results = q ? [...people, ...acts] : [...acts.slice(0, 6), ...people];
            index = Math.min(index, Math.max(0, results.length - 1));
            replace(list, results.map((r, i) => h('button.fg-palette-item', {type: 'button', role: 'option',
                'aria-selected': String(i === index), onmousemove: () => {
                    if (index !== i) {
                        index = i;
                        draw();
                    }
                }, onclick: () => {
                    this.close();
                    r.run();
                }}, icon(r.icon, 'fg-i-sm'), h('span.fg-palette-label', null, r.label),
            r.sub ? h('span.fg-palette-sub', null, r.sub) : null,
            r.key ? h('kbd', null, Shortcuts.label(r.key)) : null)));
            const sel = list.querySelector('[aria-selected="true"]');
            if (sel) {
                sel.scrollIntoView({block: 'nearest'});
            }
        };
        input.addEventListener('input', () => {
            index = 0;
            draw();
        });
        input.addEventListener('keydown', e => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                index = Math.max(0, Math.min(results.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)));
                draw();
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const r = results[index];
                this.close();
                if (r) {
                    r.run();
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.close();
            }
        });
        this.el = h('div.fg-backdrop.is-palette', {onmousedown: e => {
            if (e.target === this.el) {
                this.close();
            }
        }}, h('div.fg-palette', {role: 'dialog', 'aria-modal': 'true', 'aria-label': t('palette_title')},
            h('div.fg-palette-head', null, icon('search'), input), list,
            h('div.fg-palette-foot', null, h('span', null, h('kbd', null, '↑↓'), ' ', t('palette_move')),
                h('span', null, h('kbd', null, '↵'), ' ', t('palette_run')), h('span', null, h('kbd', null, 'Esc'), ' ',
                    t('close')))));
        app.root.appendChild(this.el);
        draw();
        input.focus();
    }

    /**
     * Close it.
     */
    close() {
        if (this.el) {
            this.el.remove();
            this.el = null;
        }
    }
}
