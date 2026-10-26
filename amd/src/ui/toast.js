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
 * Toasts with optional Undo, announced to screen readers.
 *
 * @module     local_fastgrade/ui/toast
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';

let host = null;

/**
 * Set the container.
 *
 * @param {HTMLElement} el
 */
export const mount = el => {
    host = h('div.fg-toasts', {'aria-live': 'polite', 'role': 'status'});
    el.appendChild(host);
};

/**
 * Show a toast.
 *
 * @param {string} text
 * @param {Object} opts {type: 'ok'|'warn'|'error'|'info', undo: Function, ms: number}
 */
export const toast = (text, opts = {}) => {
    if (!host) {
        return;
    }
    const type = opts.type || 'ok';
    const iconname = {ok: 'check', warn: 'warning', error: 'warning', info: 'info'}[type] || 'info';
    const el = h('div.fg-toast', {"class": 'is-' + type}, icon(iconname), h('span.fg-toast-text', null, text));
    let timer = null;
    const close = () => {
        clearTimeout(timer);
        el.classList.add('is-leaving');
        setTimeout(() => el.remove(), 200);
    };
    if (opts.undo) {
        el.appendChild(h('button.fg-toast-undo', {type: 'button', onclick: () => {
            close();
            opts.undo();
        }}, t('undo')));
    }
    el.appendChild(h('button.fg-toast-close', {type: 'button', 'aria-label': t('close'), onclick: close}, icon('x')));
    host.appendChild(el);
    timer = setTimeout(close, opts.ms || (opts.undo ? 8000 : (type === 'error' ? 9000 : 3500)));
};
