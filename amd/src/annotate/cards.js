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
 * Margin comment cards beside the document, kept level with their marks.
 *
 * @module     local_fastgrade/annotate/cards
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon, replace, date} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import {tip} from 'local_fastgrade/ui/tooltip';
import * as Dictate from 'local_fastgrade/voice/dictate';

export const POL = {
    improvement: {icon: 'up', label: () => t('pol_improvement')},
    positive: {icon: 'check', label: () => t('pol_positive')},
    neutral: {icon: 'comment', label: () => t('pol_neutral')},
};

/**
 * Whether an annotation shows a card.
 *
 * @param {Object} a
 * @returns {boolean}
 */
export const hasCard = a => ['border', 'comment', 'highlight', 'underline', 'strike', 'squiggly', 'area', 'cell',
    'timecomment', 'linecomment'].includes(a.type) && (a.comment || a.status === 'suggested' || a.editing ||
    a.type === 'border' || a.type === 'comment');

export default class Cards {
    /**
     * Constructor.
     *
     * @param {Object} controller
     * @param {HTMLElement} margin
     */
    constructor(controller, margin) {
        this.c = controller;
        this.margin = margin;
        this.els = new Map();
        this.editing = null;
    }

    /**
     * Number labels in reading order.
     *
     * @param {Array} list
     * @returns {Map}
     */
    numbers(list) {
        const m = new Map();
        list.forEach((a, i) => m.set(a.clientid, i + 1));
        return m;
    }

    /**
     * Render all cards.
     */
    render() {
        const model = this.c.model;
        const viewer = this.c.viewer;
        const list = model.forDoc(viewer.docref).filter(a => hasCard(a) || a.clientid === this.editing)
            .map(a => ({a, y: viewer.cardTop(a)}))
            .filter(x => x.y !== null && x.y !== undefined)
            .sort((x, y) => x.y - y.y);
        this.nums = this.numbers(list.map(x => x.a));
        const keep = new Set();
        list.forEach(({a}) => {
            keep.add(a.clientid);
            const old = this.els.get(a.clientid);
            if (old && a.clientid === this.editing && old.classList.contains('is-editing') && old.isConnected) {
                // Never rebuild the card being typed or dictated into: keystrokes and dictation would be lost.
                const num = old.querySelector('.fg-card-n');
                if (num) {
                    num.textContent = String(this.nums.get(a.clientid));
                }
                return;
            }
            const el = this.card(a);
            if (old && old !== el) {
                old.replaceWith(el);
            } else if (!old) {
                this.margin.appendChild(el);
            }
            this.els.set(a.clientid, el);
        });
        [...this.els.keys()].forEach(id => {
            if (!keep.has(id)) {
                this.els.get(id).remove();
                this.els.delete(id);
            }
        });
        this.layout(list);
        this.applyFocus();
    }

    /**
     * Position cards, pushing down to avoid overlap.
     *
     * @param {Array} list [{a, y}]
     */
    layout(list) {
        let bottom = 0;
        list.forEach(({a, y}) => {
            const el = this.els.get(a.clientid);
            if (!el) {
                return;
            }
            const top = Math.max(y, bottom + 6);
            el.style.top = top + 'px';
            el.classList.toggle('is-shifted', top - y > 24);
            bottom = top + el.offsetHeight;
        });
        this.margin.style.minHeight = (bottom + 40) + 'px';
    }

    /**
     * Re-layout without rebuilding (after a resize or edit).
     */
    relayout() {
        const viewer = this.c.viewer;
        const list = [...this.els.keys()].map(id => this.c.model.get(id)).filter(Boolean)
            .map(a => ({a, y: viewer.cardTop(a)})).filter(x => x.y !== null && x.y !== undefined).sort((x, y) => x.y - y.y);
        this.layout(list);
    }

    /**
     * Build a card.
     *
     * @param {Object} a
     * @returns {HTMLElement}
     */
    card(a) {
        const c = this.c;
        const pol = POL[a.polarity] || POL.neutral;
        const ro = !!c.app.readonly;
        const editing = !ro && this.editing === a.clientid;
        const n = this.nums.get(a.clientid);
        const head = h('div.fg-card-head', null,
            h('span.fg-card-n', null, String(n)),
            h('span.fg-card-pol', null, icon(pol.icon, 'fg-i-sm'), pol.label()),
            a.source === 'voice' ? tip(h('span.fg-card-src', null, icon('mic', 'fg-i-xs')), t('src_voice')) : null,
            a.status === 'suggested' ? h('span.fg-chip.is-suggested', null, icon('wand', 'fg-i-xs'), t('suggested')) : null,
            h('span.fg-grow'),
            !ro && a.status !== 'suggested' && !editing ? tip(h('button.fg-icon-btn.is-xs', {type: 'button', onclick: e => {
                e.stopPropagation();
                c.cyclePolarity(a);
            }}, icon('rotate')), t('switchpolarity')) : null,
            !ro && !editing ? tip(h('button.fg-icon-btn.is-xs', {type: 'button', onclick: e => {
                e.stopPropagation();
                this.edit(a.clientid);
            }}, icon('edit')), t('edit'), 'E') : null,
            !ro ? tip(h('button.fg-icon-btn.is-xs', {type: 'button', onclick: e => {
                e.stopPropagation();
                c.remove(a);
            }}, icon('trash')), t('delete'), 'Del') : null);
        let body;
        if (editing) {
            const ta = h('textarea.fg-textarea.is-small.fg-card-input', {rows: 3, placeholder: t('card_placeholder'),
                'aria-label': t('comment')});
            ta.value = a.comment || '';
            const save = () => {
                const text = ta.value.trim();
                this.editing = null;
                if (!text && !['highlight', 'underline', 'strike', 'squiggly', 'area'].includes(a.type) &&
                        a.status !== 'suggested') {
                    c.model.remove(a.clientid);
                } else {
                    c.saveComment(a, text);
                }
                c.refresh();
            };
            ta.addEventListener('keydown', e => {
                if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    Dictate.stopAll();
                    save();
                } else if (e.key === 'Escape' && !Dictate.isActive()) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!a.comment && !ta.value.trim() && a.type === 'border') {
                        this.editing = null;
                        c.model.remove(a.clientid);
                        c.refresh();
                    } else {
                        this.editing = null;
                        c.refresh();
                    }
                }
            });
            // The box grows with the comment (up to about eight lines), so nothing is hidden while typing.
            // It is measured after the cards are laid out, because layout can change the card's width.
            const fit = () => {
                ta.style.height = 'auto';
                ta.style.height = Math.min(ta.scrollHeight + 2, 190) + 'px';
                if (ta.scrollHeight <= ta.clientHeight) {
                    ta.scrollTop = 0;
                }
            };
            ta.addEventListener('input', () => {
                fit();
                this.relayout();
                requestAnimationFrame(fit);
            });
            requestAnimationFrame(fit);
            const mic = Dictate.micButton(ta, {small: true, polarity: a.polarity,
                label: a.polarity === 'positive' ? t('voice_positive_tip') : (a.polarity === 'improvement' ?
                    t('voice_improvement_tip') : t('dictate_tip')),
                onStop: info => {
                    if (info.text) {
                        a.source = 'voice';
                        c.dictation[a.clientid] = {dictationsecs: info.seconds, provider: info.provider};
                    }
                    if (ta.value.trim() && info.reason === 'silence') {
                        save();
                    }
                }});
            this.input = ta;
            this.mic = mic;
            const bank = tip(h('button.fg-icon-btn.is-xs', {type: 'button', onmousedown: e => e.preventDefault(),
                onclick: () => c.app.panel.bank.popover(ta, text => {
                    ta.value = (ta.value ? ta.value.replace(/\s*$/, ' ') : '') + text;
                    a.source = a.source === 'voice' ? 'voice' : 'bank';
                    ta.dispatchEvent(new Event('input'));
                    ta.focus();
                }, {polarity: ''})}, icon('bank')), t('bank_insert_tip'), '#');
            const savebtn = h('button.fg-btn.is-small.is-primary', {type: 'button', onclick: save}, t('done'));
            const saveall = tip(h('button.fg-icon-btn.is-xs', {type: 'button', onclick: () => {
                if (ta.value.trim()) {
                    c.app.panel.bank.edit(null, {text: ta.value.trim(), polarity: a.polarity});
                }
            }}, icon('star')), t('savetobank'));
            body = h('div.fg-card-body.fg-dictate-host', null, ta,
                h('div.fg-card-tools', null, mic, bank, saveall, h('span.fg-grow'), h('span.fg-small.fg-muted', null, '↵'),
                    savebtn));
        } else {
            body = h('div.fg-card-body', null, a.comment ? h('div.fg-card-text', null, a.comment) :
                h('div.fg-card-text.fg-muted', null, t('nocomment')));
        }
        let foot = null;
        if (a.status === 'suggested' && !ro) {
            foot = h('div.fg-card-suggest', null,
                tip(h('button.fg-btn.is-small.is-primary', {type: 'button', onclick: e => {
                    e.stopPropagation();
                    c.accept(a);
                }}, icon('check', 'fg-i-sm'), t('accept')), t('accept_tip'), 'A'),
                tip(h('button.fg-btn.is-small', {type: 'button', onclick: e => {
                    e.stopPropagation();
                    this.edit(a.clientid);
                }}, t('edit')), t('edit_suggestion_tip'), 'E'),
                tip(h('button.fg-btn.is-small.is-ghost', {type: 'button', onclick: e => {
                    e.stopPropagation();
                    c.reject(a);
                }}, icon('x', 'fg-i-sm'), t('reject')), t('reject_tip'), 'X'));
        }
        const meta = h('div.fg-card-meta', null, date(a.timemodified));
        const el = h('article.fg-card', {"class": `is-${a.polarity} ${a.status === 'suggested' ? 'is-suggested' : ''} ` +
                `${editing ? 'is-editing' : ''}`, dataset: {cid: a.clientid}, tabindex: '0',
            'aria-label': `${t('comment')} ${n}: ${pol.label()}. ${a.comment || ''}`,
            onmouseenter: () => c.viewer.hoverMark(a.clientid, true),
            onmouseleave: () => c.viewer.hoverMark(a.clientid, false),
            onclick: () => {
                c.select(a.clientid);
                c.viewer.focusMark(a.clientid);
            },
            ondblclick: () => {
                if (!ro) {
                    this.edit(a.clientid);
                }
            },
        }, head, body, foot, editing ? null : meta);
        return el;
    }

    /**
     * Edit a card.
     *
     * @param {string} id
     * @param {boolean} dictate start dictation straight away
     */
    edit(id, dictate = false) {
        if (this.c.app.readonly) {
            return;
        }
        this.editing = id;
        this.pendingFocus = {id, dictate};
        this.render();
    }

    /**
     * Put the caret in the card being edited as soon as it exists, and start dictation if asked.
     */
    applyFocus() {
        const p = this.pendingFocus;
        const el = p ? this.els.get(p.id) : null;
        if (!el || !this.input || !el.contains(this.input)) {
            return;
        }
        this.pendingFocus = null;
        this.input.focus();
        this.input.setSelectionRange(this.input.value.length, this.input.value.length);
        if (p.dictate && this.mic) {
            this.mic.click();
        }
    }

    /**
     * Highlight one card.
     *
     * @param {string} id
     * @param {boolean} on
     */
    hover(id, on) {
        const el = this.els.get(id);
        if (el) {
            el.classList.toggle('is-hover', on);
        }
    }

    /**
     * Select a card.
     *
     * @param {string|null} id
     */
    select(id) {
        this.els.forEach((el, k) => el.classList.toggle('is-selected', k === id));
        const el = this.els.get(id);
        if (el) {
            el.scrollIntoView({block: 'nearest', behavior: 'smooth'});
        }
    }

    /**
     * Clear.
     */
    clear() {
        replace(this.margin);
        this.els.clear();
    }
}
