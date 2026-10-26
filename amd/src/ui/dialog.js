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
 * Lightweight dialogs that stay inside the app's theme.
 *
 * @module     local_fastgrade/ui/dialog
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';

/**
 * Open a dialog.
 *
 * @param {Object} opts {title, body: Node, actions: [{label, primary, onclick}], wide, onclose}
 * @returns {{close: Function, el: HTMLElement}}
 */
export const open = opts => {
    const app = document.querySelector('.fg-app') || document.body;
    const previous = document.activeElement;
    const titleid = 'fg-dlg-' + Math.random().toString(36).slice(2, 8);
    const close = () => {
        backdrop.remove();
        document.removeEventListener('keydown', onkey, true);
        if (opts.onclose) {
            opts.onclose();
        }
        if (previous && previous.focus) {
            previous.focus();
        }
    };
    const onkey = e => {
        if (e.key === 'Escape') {
            e.stopPropagation();
            e.preventDefault();
            close();
        } else if (e.key === 'Tab') {
            const f = [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
                .filter(x => !x.disabled && x.offsetParent !== null);
            if (!f.length) {
                return;
            }
            if (e.shiftKey && document.activeElement === f[0]) {
                e.preventDefault();
                f[f.length - 1].focus();
            } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
                e.preventDefault();
                f[0].focus();
            }
        }
    };
    const actions = (opts.actions || []).map(a => h('button.fg-btn', {
        type: 'button', "class": a.primary ? 'is-primary' : (a.danger ? 'is-danger' : ''),
        onclick: () => {
            const r = a.onclick ? a.onclick() : true;
            if (r !== false) {
                close();
            }
        },
    }, a.label));
    const dialog = h('div.fg-dialog', {role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleid,
            "class": opts.wide ? 'is-wide' : ''},
        h('div.fg-dialog-head', null,
            h('h2.fg-dialog-title', {id: titleid}, opts.title),
            h('button.fg-icon-btn', {type: 'button', 'aria-label': t('close'), onclick: close}, icon('x'))),
        h('div.fg-dialog-body', null, opts.body),
        actions.length ? h('div.fg-dialog-foot', null, actions) : null);
    const backdrop = h('div.fg-backdrop', {onmousedown: e => {
        if (e.target === backdrop) {
            close();
        }
    }}, dialog);
    app.appendChild(backdrop);
    document.addEventListener('keydown', onkey, true);
    setTimeout(() => {
        const first = dialog.querySelector('[autofocus], input, textarea, select, .fg-dialog-body button, ' +
            '.fg-dialog-foot .is-primary');
        (first || dialog.querySelector('button')).focus();
    }, 20);
    return {close, el: dialog};
};

/**
 * Ask for confirmation.
 *
 * @param {string} title
 * @param {string} text
 * @param {string} oklabel
 * @returns {Promise<boolean>}
 */
export const confirm = (title, text, oklabel) => new Promise(resolve => {
    let done = false;
    open({
        title,
        body: h('p', null, text),
        actions: [
            {label: t('cancel'), onclick: () => {
                done = true;
                resolve(false);
            }},
            {label: oklabel || t('ok'), primary: true, onclick: () => {
                done = true;
                resolve(true);
            }},
        ],
        onclose: () => {
            if (!done) {
                resolve(false);
            }
        },
    });
});
