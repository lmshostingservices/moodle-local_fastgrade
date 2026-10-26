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
 * Annotation controller for one document: the selection pill (Improvement, Positive, comment,
 * highlight...), margin cards, suggestions and undo.
 *
 * @module     local_fastgrade/annotate/controller
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import {tip} from 'local_fastgrade/ui/tooltip';
import {toast} from 'local_fastgrade/ui/toast';
import Cards from 'local_fastgrade/annotate/cards';
import * as Speech from 'local_fastgrade/voice/speech';

const MARKUP = ['highlight', 'underline', 'strike'];

export default class Annotator {
    /**
     * Constructor.
     *
     * @param {Object} app
     * @param {Object} viewer must provide docref, marginEl, renderMarks(), cardTop(a), focusMark(id), hoverMark(id,on)
     */
    constructor(app, viewer) {
        this.app = app;
        this.viewer = viewer;
        this.model = app.annotations;
        this.cards = new Cards(this, viewer.marginEl);
        this.dictation = {};
        this.pill = null;
        this.desc = null;
        this.selected = null;
        this.off = this.model.on((reason, a) => {
            if (!a || a.docref === viewer.docref) {
                this.refresh();
            }
        });
    }

    /**
     * Redraw marks and cards.
     */
    refresh() {
        this.viewer.renderMarks();
        this.cards.render();
    }

    /**
     * Stop listening.
     */
    destroy() {
        this.off();
        this.hidePill();
        this.cards.clear();
    }

    /**
     * Show the selection pill.
     *
     * @param {Object} desc {anchor, page, rect: DOMRect, docref}
     */
    showPill(desc) {
        this.hidePill();
        if (this.app.readonly) {
            return;
        }
        this.desc = desc;
        const btn = (cls, ic, label, tiptext, key, kind) => tip(h('button.fg-pill-btn', {type: 'button', "class": cls,
            onmousedown: e => e.preventDefault(), onclick: () => this.fromSelection(kind)},
        icon(ic, 'fg-i-sm'), label ? h('span', null, label) : null), tiptext, key);
        const voice = Speech.present();
        this.pill = h('div.fg-pill', {role: 'toolbar', 'aria-label': t('selectiontools')},
            voice ? btn('is-improvement', 'mic', t('pol_improvement'), t('pill_improvement_tip'), 'I', 'improvement') :
                btn('is-improvement', 'up', t('pol_improvement'), t('pill_improvement_typed_tip'), 'I', 'improvement'),
            voice ? btn('is-positive', 'mic', t('pol_positive'), t('pill_positive_tip'), 'P', 'positive') :
                btn('is-positive', 'check', t('pol_positive'), t('pill_positive_typed_tip'), 'P', 'positive'),
            h('span.fg-pill-sep'),
            btn('', 'comment', '', t('pill_comment_tip'), 'C', 'comment'),
            btn('', 'highlight', '', t('pill_highlight_tip'), 'H', 'highlight'),
            btn('', 'underline', '', t('pill_underline_tip'), 'U', 'underline'),
            btn('', 'strike', '', t('pill_strike_tip'), 'S', 'strike'),
            btn('', 'bank', '', t('pill_bank_tip'), '#', 'bank'));
        const host = this.app.root;
        host.appendChild(this.pill);
        const r = desc.rect;
        const pr = this.pill.getBoundingClientRect();
        let top = r.top - pr.height - 10;
        if (top < 60) {
            top = r.bottom + 10;
        }
        let left = r.left + r.width / 2 - pr.width / 2;
        left = Math.max(8, Math.min(left, window.innerWidth - pr.width - 8));
        this.pill.style.top = top + 'px';
        this.pill.style.left = left + 'px';
    }

    /**
     * Hide the pill.
     */
    hidePill() {
        if (this.pill) {
            this.pill.remove();
            this.pill = null;
        }
    }

    /**
     * The current selection: from the pill, or ask the viewer.
     *
     * @returns {Object|null}
     */
    currentSelection() {
        return this.desc || (this.viewer.selectionInfo ? this.viewer.selectionInfo() : null);
    }

    /**
     * Act on the selection.
     *
     * @param {string} kind improvement, positive, comment, highlight, underline, strike, bank
     * @returns {boolean}
     */
    fromSelection(kind) {
        if (this.app.readonly) {
            return false;
        }
        const desc = this.currentSelection();
        if (!desc) {
            toast(t('selectfirst'), {type: 'info'});
            return false;
        }
        this.hidePill();
        window.getSelection().removeAllRanges();
        this.desc = null;
        const base = {docref: this.viewer.docref, page: desc.page || 0, anchor: desc.anchor};
        if (kind === 'bank') {
            this.app.panel.bank.popover(this.viewer.el, (text, b) => {
                const a = this.model.create(Object.assign({}, base, {type: 'border', polarity: b.polarity,
                    source: 'bank', comment: text}));
                this.select(a.clientid);
            }, {rect: desc.rect});
            return true;
        }
        if (MARKUP.includes(kind)) {
            const a = this.model.create(Object.assign({}, base, {type: kind, polarity: 'neutral'}));
            this.select(a.clientid);
            return true;
        }
        const polarity = kind === 'comment' ? 'neutral' : kind;
        // Counted as voice only once words actually come from dictation (the card updates it).
        const a = this.model.create(Object.assign({}, base, {type: 'border', polarity, source: 'typed'}));
        this.cards.edit(a.clientid, kind !== 'comment' && Speech.present());
        return true;
    }

    /**
     * Save a card's text.
     *
     * @param {Object} a
     * @param {string} text
     */
    saveComment(a, text) {
        const meta = this.dictation[a.clientid] || null;
        delete this.dictation[a.clientid];
        const changes = {comment: text};
        if (a.source) {
            changes.source = a.source;
        }
        this.model.update(a.clientid, changes, meta);
    }

    /**
     * Cycle Improvement → Positive → Neutral.
     *
     * @param {Object} a
     */
    cyclePolarity(a) {
        const order = ['improvement', 'positive', 'neutral'];
        const next = order[(order.indexOf(a.polarity) + 1) % order.length];
        this.model.update(a.clientid, {polarity: next});
    }

    /**
     * Delete with undo.
     *
     * @param {Object} a
     */
    remove(a) {
        this.model.remove(a.clientid);
        toast(t('deleted'), {type: 'info', undo: () => this.model.undo()});
    }

    /**
     * Accept a suggestion.
     *
     * @param {Object} a
     */
    accept(a) {
        this.model.update(a.clientid, {status: 'active'});
    }

    /**
     * Reject a suggestion.
     *
     * @param {Object} a
     */
    reject(a) {
        this.model.update(a.clientid, {status: 'rejected'});
        toast(t('suggestionrejected'), {type: 'info', undo: () => this.model.undo()});
    }

    /**
     * Select an annotation.
     *
     * @param {string|null} id
     */
    select(id) {
        this.selected = id;
        this.cards.select(id);
        if (this.viewer.selectMark) {
            this.viewer.selectMark(id);
        }
    }

    /**
     * The selected annotation.
     *
     * @returns {Object|null}
     */
    selectedAnnotation() {
        return this.selected ? this.model.get(this.selected) : null;
    }
}
