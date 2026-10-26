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
 * Keyboard shortcuts. Single-key shortcuts only fire outside text fields and can be switched off by
 * the marker (WCAG 2.1.4); shortcuts with Ctrl, Cmd or Alt always work.
 *
 * @module     local_fastgrade/ui/shortcuts
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, isTyping} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import * as Dialog from 'local_fastgrade/ui/dialog';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const registry = [];
let singleKeysOn = true;

/**
 * Normalise a key event to a combo string such as "mod+enter", "shift+\\", "j".
 *
 * @param {KeyboardEvent} e
 * @returns {string}
 */
const comboOf = e => {
    const parts = [];
    if (e.ctrlKey || e.metaKey) {
        parts.push('mod');
    }
    if (e.altKey) {
        parts.push('alt');
    }
    let key = (e.key || '').toLowerCase();
    let shift = e.shiftKey && (key.length > 1 || /^[a-z]$/.test(key));
    const code = e.code || '';
    if (code === 'Backslash') {
        key = '\\';
        shift = e.shiftKey;
    } else if (code.startsWith('Digit')) {
        key = code.slice(5);
        shift = e.shiftKey;
    } else if (code === 'BracketLeft' && !e.shiftKey) {
        key = '[';
    } else if (code === 'BracketRight' && !e.shiftKey) {
        key = ']';
    } else if ((code === 'KeyZ' || code === 'KeyY') && (e.ctrlKey || e.metaKey)) {
        key = code === 'KeyZ' ? 'z' : 'y';
        shift = e.shiftKey;
    }
    if (shift) {
        parts.push('shift');
    }
    parts.push(key);
    return parts.join('+');
};

/**
 * Show a combo for people.
 *
 * @param {string} combo
 * @returns {string}
 */
export const label = combo => combo.split('+').map(p => ({
    mod: isMac ? '⌘' : 'Ctrl', alt: isMac ? '⌥' : 'Alt', shift: '⇧', enter: '↵', escape: 'Esc',
    arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', ' ': 'Space',
}[p] || p.toUpperCase())).join(' ');

/**
 * Register a shortcut.
 *
 * @param {string} combo e.g. "j", "mod+enter", "shift+\\"
 * @param {Function} handler gets the event; return false to let the key through
 * @param {Object} meta {group, label, when: () => boolean, hidden}
 */
export const add = (combo, handler, meta = {}) => {
    registry.push({combo, handler, ...meta});
};

/**
 * Switch single-key shortcuts on or off.
 *
 * @param {boolean} on
 */
export const setSingleKeys = on => {
    singleKeysOn = on;
};

/**
 * Start listening.
 */
export const init = () => {
    document.addEventListener('keydown', e => {
        if (e.isComposing || e.defaultPrevented) {
            return;
        }
        const combo = comboOf(e);
        const hasmod = combo.includes('mod+') || combo.includes('alt+');
        const typing = isTyping(e.target);
        if (!hasmod && combo !== 'escape') {
            if (typing || !singleKeysOn) {
                return;
            }
            if (document.querySelector('.fg-backdrop')) {
                return;
            }
        }
        for (const r of registry) {
            if (r.combo !== combo) {
                continue;
            }
            if (r.when && !r.when(e)) {
                continue;
            }
            if (r.handler(e) !== false) {
                e.preventDefault();
                e.stopPropagation();
            }
            return;
        }
    });
};

/**
 * The shortcut help dialog.
 */
export const showHelp = () => {
    const groups = new Map();
    registry.filter(r => !r.hidden && r.label).forEach(r => {
        const g = r.group || t('sc_general');
        if (!groups.has(g)) {
            groups.set(g, new Map());
        }
        const m = groups.get(g);
        m.set(r.label, [...(m.get(r.label) || []), r.combo]);
    });
    const body = h('div.fg-shortcuts', null,
        singleKeysOn ? null : h('p.fg-muted', null, t('singlekeysoff')),
        [...groups.entries()].map(([g, items]) => h('section.fg-shortcuts-group', null,
            h('h3', null, g),
            h('dl', null, [...items.entries()].map(([lbl, combos]) => [
                h('dt', null, combos.map(c => h('kbd', null, label(c)))),
                h('dd', null, lbl),
            ])))));
    Dialog.open({title: t('keyboardshortcuts'), body, wide: true});
};
