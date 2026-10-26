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
 * Comment bank: the Bank tab, the quick picker, and "#" to search while typing.
 *
 * @module     local_fastgrade/ui/bankpicker
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon, replace} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import {tip} from 'local_fastgrade/ui/tooltip';
import * as Api from 'local_fastgrade/lib/api';
import {toast} from 'local_fastgrade/ui/toast';
import * as Dialog from 'local_fastgrade/ui/dialog';
import * as Dictate from 'local_fastgrade/voice/dictate';

const POLICON = {improvement: 'up', positive: 'check', neutral: 'comment'};

export default class BankPicker {
    /**
     * Constructor.
     *
     * @param {Object} app
     */
    constructor(app) {
        this.app = app;
        this.query = '';
        this.polarity = '';
        this.pop = null;
    }

    /**
     * Entries matching a search.
     *
     * @param {string} q
     * @param {string} polarity
     * @returns {Array}
     */
    filter(q, polarity = '') {
        const words = q.toLowerCase().split(/\s+/).filter(Boolean);
        return this.app.store.get('bank').filter(b => {
            if (polarity && b.polarity !== polarity) {
                return false;
            }
            const hay = (b.title + ' ' + b.text).toLowerCase();
            return words.every(w => hay.includes(w));
        });
    }

    /**
     * Count a use.
     *
     * @param {Object} b
     */
    used(b) {
        b.usagecount++;
        this.app.annotationsBankUsed = this.app.annotationsBankUsed || new Set();
        this.app.annotationsBankUsed.add(b.id);
    }

    /**
     * The Bank tab.
     *
     * @param {Object} opts {onInsert(text)}
     * @returns {HTMLElement}
     */
    render(opts) {
        const list = h('div.fg-bank-list');
        const draw = () => {
            const items = this.filter(this.query, this.polarity);
            replace(list, items.length ? items.map(b => this.item(b, () => {
                this.used(b);
                opts.onInsert(b.text);
            })) : h('div.fg-empty-small', null, this.app.store.get('bank').length ? t('nomatches') : t('bank_empty')));
        };
        const search = h('input.fg-input', {type: 'search', placeholder: t('bank_search'), value: this.query,
            'aria-label': t('bank_search'), oninput: e => {
                this.query = e.target.value;
                draw();
            }});
        const pol = h('div.fg-seg.is-small', {role: 'group', 'aria-label': t('polarity')},
            ['', 'improvement', 'positive', 'neutral'].map(p => tip(h('button.fg-seg-btn', {type: 'button',
                'aria-pressed': String(this.polarity === p), "class": p ? 'is-' + p : '', onclick: e => {
                    this.polarity = p;
                    e.target.closest('.fg-seg').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed',
                        String(b === e.target.closest('button'))));
                    draw();
                }}, p ? icon(POLICON[p], 'fg-i-sm') : t('all')), p ? t('pol_' + p) : t('all'))));
        draw();
        return h('section.fg-bank', null,
            h('div.fg-bank-head', null, search, pol,
                tip(h('button.fg-btn.is-small.is-primary', {type: 'button', onclick: () => this.edit(null)}, icon('plus',
                    'fg-i-sm'),
                    t('bank_add')), t('bank_add_tip'))),
            h('p.fg-small.fg-muted', null, t('bank_help')),
            list);
    }

    /**
     * One entry.
     *
     * @param {Object} b
     * @param {Function} onpick
     * @returns {HTMLElement}
     */
    item(b, onpick) {
        return h('div.fg-bank-item', {"class": 'is-' + b.polarity},
            tip(h('button.fg-bank-main', {type: 'button', onclick: onpick},
                icon(POLICON[b.polarity] || 'comment', 'fg-i-sm fg-pol-icon'),
                h('span.fg-bank-text', null, b.title ? h('strong', null, b.title + ' — ') : null, b.text),
                h('span.fg-bank-scope', null, t('scope_' + b.scope))), t('bank_insert_item_tip')),
            b.canedit ? h('span.fg-bank-actions', null,
                tip(h('button.fg-icon-btn.is-small', {type: 'button', onclick: () => this.edit(b)}, icon('edit')), t('edit')),
                tip(h('button.fg-icon-btn.is-small', {type: 'button', onclick: () => this.remove(b)}, icon('trash')), t('delete')))
                : null);
    }

    /**
     * Add or edit an entry.
     *
     * @param {Object|null} b
     * @param {Object} preset {text, polarity}
     */
    edit(b, preset = {}) {
        const ta = h('textarea.fg-textarea', {rows: 4, 'aria-label': t('bank_text')});
        ta.value = b ? b.text : (preset.text || '');
        const title = h('input.fg-input', {type: 'text', 'aria-label': t('bank_title'), placeholder: t('bank_title_placeholder'),
            value: b ? b.title : ''});
        const pol = h('select.fg-select', {'aria-label': t('polarity')}, ['improvement', 'positive', 'neutral'].map(p =>
            h('option', {value: p, selected: (b ? b.polarity : (preset.polarity || 'neutral')) === p}, t('pol_' + p))));
        const scope = h('select.fg-select', {'aria-label': t('bank_scope')}, ['personal', 'course', 'site'].map(s =>
            h('option', {value: s, selected: (b ? b.scope : 'personal') === s}, t('scope_' + s))));
        const mic = Dictate.micButton(ta, {label: t('dictate_bank_tip')});
        Dialog.open({
            title: b ? t('bank_edit') : t('bank_add'),
            body: h('div.fg-form', null,
                h('label.fg-field', null, h('span', null, t('bank_text')), h('div.fg-dictate-host.fg-remark', null, ta, mic)),
                h('label.fg-field', null, h('span', null, t('bank_title')), title),
                h('div.fg-field-row', null,
                    h('label.fg-field', null, h('span', null, t('polarity')), pol),
                    h('label.fg-field', null, h('span', null, t('bank_scope')), scope)),
                h('p.fg-small.fg-muted', null, t('bank_scope_help'))),
            actions: [
                {label: t('cancel')},
                {label: t('save'), primary: true, onclick: () => {
                    if (!ta.value.trim()) {
                        ta.focus();
                        return false;
                    }
                    this.save('save', {id: b ? b.id : 0, text: ta.value, title: title.value, polarity: pol.value,
                        scope: scope.value});
                    return true;
                }},
            ],
        });
    }

    /**
     * Delete an entry.
     *
     * @param {Object} b
     */
    async remove(b) {
        const ok = await Dialog.confirm(t('bank_delete_title'), b.text, t('delete'));
        if (ok) {
            this.save('delete', {id: b.id});
        }
    }

    /**
     * Send a change.
     *
     * @param {string} action
     * @param {Object} data
     */
    async save(action, data) {
        try {
            const r = await Api.call('bank', {cmid: this.app.cmid, action, data});
            this.app.store.set({bank: r.bank});
            toast(action === 'delete' ? t('bank_deleted') : t('bank_saved'), {type: 'ok'});
        } catch (e) {
            toast(Api.message(e), {type: 'error'});
        }
    }

    /**
     * Close the popover.
     */
    closePop() {
        if (this.pop) {
            this.pop.remove();
            document.removeEventListener('keydown', this.popKeys, true);
            document.removeEventListener('mousedown', this.popOutside, true);
            this.pop = null;
        }
    }

    /**
     * A searchable list near an element.
     *
     * @param {HTMLElement} anchor
     * @param {Function} onpick (text, entry)
     * @param {Object} opts {query, polarity, rect}
     */
    popover(anchor, onpick, opts = {}) {
        this.closePop();
        let q = opts.query || '';
        let index = 0;
        const list = h('div.fg-pop-list', {role: 'listbox'});
        const input = opts.inline ? null : h('input.fg-input', {type: 'search', placeholder: t('bank_search'),
            'aria-label': t('bank_search'), value: q, oninput: e => {
                q = e.target.value;
                index = 0;
                draw();
            }});
        let items = [];
        const draw = () => {
            items = this.filter(q, opts.polarity || '').slice(0, 30);
            replace(list, items.length ? items.map((b, i) => h('button.fg-pop-item', {type: 'button', role: 'option',
                'aria-selected': String(i === index), "class": 'is-' + b.polarity,
                onmousedown: e => e.preventDefault(), onclick: () => pick(b)},
            icon(POLICON[b.polarity] || 'comment', 'fg-i-sm fg-pol-icon'), h('span', null, b.title || b.text),
            i < 9 ? h('kbd', null, String(i + 1)) : null)) : h('div.fg-empty-small', null, t('nomatches')));
        };
        const pick = b => {
            this.used(b);
            this.closePop();
            onpick(b.text, b);
        };
        this.updateQuery = nq => {
            q = nq;
            index = 0;
            draw();
        };
        this.popKeys = e => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.closePop();
            } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                index = Math.max(0, Math.min(items.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)));
                draw();
            } else if (e.key === 'Enter' && items[index]) {
                e.preventDefault();
                e.stopPropagation();
                pick(items[index]);
            } else if (!opts.inline && /^[1-9]$/.test(e.key) && document.activeElement !== input) {
                const b = items[parseInt(e.key, 10) - 1];
                if (b) {
                    e.preventDefault();
                    pick(b);
                }
            }
        };
        this.popOutside = e => {
            if (this.pop && !this.pop.contains(e.target)) {
                this.closePop();
            }
        };
        this.pop = h('div.fg-pop', {role: 'dialog', 'aria-label': t('tab_bank')}, input, list,
            h('div.fg-pop-foot', null, t('bank_pop_help')));
        (anchor.closest('.fg-app') || document.body).appendChild(this.pop);
        const r = opts.rect || anchor.getBoundingClientRect();
        const pr = this.pop.getBoundingClientRect();
        let top = r.bottom + 6;
        if (top + pr.height > window.innerHeight - 8) {
            top = Math.max(8, r.top - pr.height - 6);
        }
        this.pop.style.top = top + 'px';
        this.pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - pr.width - 8)) + 'px';
        draw();
        document.addEventListener('keydown', this.popKeys, true);
        document.addEventListener('mousedown', this.popOutside, true);
        if (input) {
            input.focus();
        }
    }

    /**
     * Typing "#words" in an editor opens the picker; picking replaces "#words".
     *
     * @param {HTMLElement} ed contenteditable
     * @param {Function} after called after insertion
     */
    checkTrigger(ed, after) {
        const sel = window.getSelection();
        if (!sel.rangeCount) {
            return;
        }
        const range = sel.getRangeAt(0);
        const node = range.startContainer;
        if (node.nodeType !== Node.TEXT_NODE) {
            this.closePop();
            return;
        }
        const before = node.textContent.slice(0, range.startOffset);
        const m = before.match(/(^|\s)#([\p{L}\p{N} ]{0,30})$/u);
        if (!m) {
            if (this.pop && this.pop.dataset.inline) {
                this.closePop();
            }
            return;
        }
        const query = m[2];
        if (this.pop && this.pop.dataset.inline) {
            this.updateQuery(query);
            return;
        }
        const rect = range.getBoundingClientRect();
        this.popover(ed, text => {
            const s2 = window.getSelection();
            const r2 = s2.getRangeAt(0);
            const n2 = r2.startContainer;
            const b2 = n2.textContent.slice(0, r2.startOffset);
            const m2 = b2.match(/#([\p{L}\p{N} ]{0,30})$/u);
            if (m2) {
                const del = document.createRange();
                del.setStart(n2, r2.startOffset - m2[0].length);
                del.setEnd(n2, r2.startOffset);
                s2.removeAllRanges();
                s2.addRange(del);
            }
            document.execCommand('insertText', false, text);
            after(text);
        }, {query, inline: true, rect});
        if (this.pop) {
            this.pop.dataset.inline = '1';
        }
    }
}
