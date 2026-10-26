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
 * Online text and quiz essay responses, marked directly (never converted). One click selects a
 * word, two clicks the paragraph.
 *
 * @module     local_fastgrade/viewer/text
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon, replace} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import * as TA from 'local_fastgrade/annotate/textanchor';
import Annotator from 'local_fastgrade/annotate/controller';
import {POL} from 'local_fastgrade/annotate/cards';
import {tip} from 'local_fastgrade/ui/tooltip';

const BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, td, th, dd, dt, figcaption, div';

export default class TextViewer {
    /**
     * Constructor.
     *
     * @param {Object} app
     * @param {Object} doc
     * @param {Object} host
     */
    constructor(app, doc, host) {
        this.app = app;
        this.doc = doc;
        this.host = host;
        this.docref = doc.docref;
        this.supportsMarks = true;
        this.supportsDrawing = false;
        this.content = h('div.fg-textdoc', {lang: '', 'aria-label': doc.filename});
        this.marginEl = h('div.fg-margin', {'aria-label': t('comments')});
        this.unplaced = h('div.fg-unplaced');
        // A quiz answer is shown under its question, so the marker never has to switch tabs to see it.
        const item = app.store.get('item');
        const q = item && item.question;
        this.qcard = q && q.text ? h('details.fg-qcard', {open: true},
            tip(h('summary', null, icon('question', 'fg-i-sm'), h('span', null, t('questionn', q.number) + ' · ' + q.name)),
                t('qcard_tip')),
            h('div.fg-qtext', {html: q.text})) : null;
        this.paper = h('div.fg-paper.is-text', null, h('div.fg-textmain', null, this.qcard, this.content), this.marginEl);
        this.scroll = h('div.fg-doc-scroll', null, this.unplaced, this.paper,
            h('div.fg-doc-foot', null, t('nwords', doc.wordcount || 0)));
        this.el = h('div.fg-viewer.is-text', null, this.scroll);
        this.marks = new Map();
        this.scale = 1;
        this.zoomLabel = h('span.fg-zoom-label', null, '100%');
    }

    /**
     * Load.
     */
    async load() {
        this.html = this.doc.html;
        this.annotator = new Annotator(this.app, this);
        this.bind();
        this.annotator.refresh();
        this.resizeObs = new ResizeObserver(() => this.annotator.cards.relayout());
        this.resizeObs.observe(this.content);
    }

    /**
     * Event wiring for selection.
     */
    bind() {
        const c = this.content;
        let downAt = null;
        c.addEventListener('pointerdown', e => {
            downAt = {x: e.clientX, y: e.clientY, t: Date.now()};
            this.annotator.hidePill();
        });
        c.addEventListener('mouseup', e => {
            if (e.button !== 0) {
                return;
            }
            const moved = downAt && (Math.abs(e.clientX - downAt.x) > 4 || Math.abs(e.clientY - downAt.y) > 4);
            const mark = e.target.closest('.fg-m');
            setTimeout(() => {
                const sel = window.getSelection();
                if (moved && sel.rangeCount && !sel.isCollapsed && c.contains(sel.getRangeAt(0).commonAncestorContainer)) {
                    this.offerRange(sel.getRangeAt(0));
                    return;
                }
                if (e.detail >= 2) {
                    this.selectParagraph(e);
                    return;
                }
                if (mark && !moved) {
                    this.annotator.select(mark.dataset.cid);
                    this.focusMark(mark.dataset.cid, false);
                    return;
                }
                if (!moved && e.detail === 1) {
                    this.selectWord(e);
                }
            }, 0);
        });
        c.addEventListener('dblclick', e => e.preventDefault());
    }

    /**
     * One click: the word under the pointer.
     *
     * @param {MouseEvent} e
     */
    selectWord(e) {
        const off = TA.wordOffsetsAt(this.content, e.clientX, e.clientY);
        if (!off) {
            return;
        }
        const r = TA.rangeFromOffsets(this.content, off.start, off.end);
        if (r) {
            TA.selectRange(r);
            this.offerRange(r);
        }
    }

    /**
     * Two clicks: the whole paragraph.
     *
     * @param {MouseEvent} e
     */
    selectParagraph(e) {
        let block = e.target.closest(BLOCKS);
        if (!block || !this.content.contains(block) || block === this.content) {
            block = this.content;
        }
        // Prefer the innermost block that has text.
        const r = document.createRange();
        r.selectNodeContents(block);
        const off = TA.offsetsFromRange(this.content, r);
        const text = TA.fullText(this.content);
        let {start, end} = off;
        while (start < end && /\s/.test(text[start])) {
            start++;
        }
        while (end > start && /\s/.test(text[end - 1])) {
            end--;
        }
        const rr = TA.rangeFromOffsets(this.content, start, end);
        if (rr) {
            TA.selectRange(rr);
            this.offerRange(rr);
        }
    }

    /**
     * Offer the pill for a range.
     *
     * @param {Range} range
     */
    offerRange(range) {
        const desc = this.describe(range);
        if (desc) {
            this.annotator.showPill(desc);
        }
    }

    /**
     * Describe a range for annotation.
     *
     * @param {Range} range
     * @returns {Object|null}
     */
    describe(range) {
        const off = TA.offsetsFromRange(this.content, range);
        if (off.end <= off.start) {
            return null;
        }
        const text = TA.fullText(this.content);
        if (!text.slice(off.start, off.end).trim()) {
            return null;
        }
        return {anchor: TA.makeAnchor(text, off.start, off.end), page: 0, rect: range.getBoundingClientRect()};
    }

    /**
     * The current page selection, if inside this document.
     *
     * @returns {Object|null}
     */
    selectionInfo() {
        const sel = window.getSelection();
        if (!sel.rangeCount || sel.isCollapsed) {
            return null;
        }
        const r = sel.getRangeAt(0);
        if (!this.content.contains(r.commonAncestorContainer)) {
            return null;
        }
        return this.describe(r);
    }

    /**
     * Plain text for auto-marking.
     *
     * @returns {string}
     */
    plainText() {
        // A line break between blocks (paragraphs, list items, cells) so sentences and headings stay
        // apart. The positions of the added breaks are kept to map offsets back for anchoring.
        const BLOCK = 'p,div,li,h1,h2,h3,h4,h5,h6,td,th,pre,blockquote,dt,dd,caption,figcaption';
        let out = '';
        let prev = null;
        this.inserted = [];
        TA.textNodes(this.content).forEach(n => {
            const b = n.parentElement ? n.parentElement.closest(BLOCK) : null;
            if (out && b !== prev) {
                this.inserted.push(out.length);
                out += '\n';
            }
            prev = b;
            out += n.data;
        });
        return out;
    }

    /**
     * An offset in plainText() as an offset in the document text.
     *
     * @param {number} pos
     * @returns {number}
     */
    rawOffset(pos) {
        let n = 0;
        (this.inserted || []).forEach(i => {
            if (i < pos) {
                n++;
            }
        });
        return pos - n;
    }

    /**
     * Anchor for offsets (auto-marking).
     *
     * @param {number} start
     * @param {number} end
     * @returns {Object}
     */
    anchorFor(start, end) {
        if (!this.inserted) {
            this.plainText();
        }
        return {page: 0, anchor: TA.makeAnchor(TA.fullText(this.content), this.rawOffset(start), this.rawOffset(end))};
    }

    /**
     * Draw all marks.
     */
    renderMarks() {
        const sel = this.annotator ? this.annotator.selected : null;
        this.content.innerHTML = this.html;
        this.marks.clear();
        const text = TA.fullText(this.content);
        const list = this.app.annotations.forDoc(this.docref);
        const placed = [];
        const unplaced = [];
        list.forEach(a => {
            const pos = TA.resolve(text, a.anchor);
            if (pos) {
                placed.push({a, pos});
            } else {
                unplaced.push(a);
            }
        });
        // Wrap longer ranges first so nested marks sit inside.
        placed.sort((x, y) => (y.pos.end - y.pos.start) - (x.pos.end - x.pos.start));
        placed.forEach(({a, pos}) => {
            const els = TA.wrap(this.content, pos.start, pos.end, () => h('span.fg-m', {
                "class": `is-${a.type} is-${a.polarity}${a.status === 'suggested' ? ' is-suggested' : ''}`,
                dataset: {cid: a.clientid},
            }));
            this.marks.set(a.clientid, els);
            if (els.length) {
                els[0].classList.add('is-first');
                els[els.length - 1].classList.add('is-last');
                const pol = POL[a.polarity] || POL.neutral;
                els[0].setAttribute('aria-label', `${pol.label()}: ${a.comment || ''}`);
            }
        });
        replace(this.unplaced, unplaced.length ? h('div.fg-notice', null, icon('info', 'fg-i-sm'),
            t('unplaced', unplaced.length)) : null);
        this.unplacedList = unplaced;
        if (sel) {
            this.selectMark(sel);
        }
    }

    /**
     * Vertical position for a card.
     *
     * @param {Object} a
     * @returns {number|null}
     */
    cardTop(a) {
        const els = this.marks.get(a.clientid);
        if (!els || !els.length) {
            return this.unplacedList && this.unplacedList.includes(a) ? 0 : null;
        }
        const pr = this.paper.getBoundingClientRect();
        return els[0].getBoundingClientRect().top - pr.top - 4;
    }

    /**
     * Hover link between card and mark.
     *
     * @param {string} id
     * @param {boolean} on
     */
    hoverMark(id, on) {
        (this.marks.get(id) || []).forEach(el => el.classList.toggle('is-hover', on));
    }

    /**
     * Show a mark as selected.
     *
     * @param {string|null} id
     */
    selectMark(id) {
        this.content.querySelectorAll('.fg-m.is-selected').forEach(el => el.classList.remove('is-selected'));
        (this.marks.get(id) || []).forEach(el => el.classList.add('is-selected'));
    }

    /**
     * Scroll to a mark and flash it.
     *
     * @param {string} id
     * @param {boolean} scroll
     */
    focusMark(id, scroll = true) {
        const els = this.marks.get(id) || [];
        if (els.length && scroll) {
            els[0].scrollIntoView({block: 'center', behavior: 'smooth'});
        }
        els.forEach(el => {
            el.classList.remove('is-flash');
            void el.offsetWidth;
            el.classList.add('is-flash');
        });
        this.annotator.cards.hover(id, true);
        setTimeout(() => this.annotator.cards.hover(id, false), 900);
    }

    /**
     * Find and select words.
     *
     * @param {string} words
     * @returns {boolean}
     */
    findText(words) {
        const text = TA.fullText(this.content);
        const pos = TA.resolve(text, {exact: words, start: 0, end: 0});
        if (!pos) {
            return false;
        }
        const r = TA.rangeFromOffsets(this.content, pos.start, pos.end);
        if (r) {
            TA.selectRange(r);
            r.startContainer.parentElement.scrollIntoView({block: 'center', behavior: 'smooth'});
            this.offerRange(r);
        }
        return true;
    }

    /**
     * Zoom the text.
     *
     * @param {number} dir 1, -1 or 0
     */
    zoom(dir) {
        this.scale = dir === 0 ? 1 : Math.max(0.7, Math.min(1.8, this.scale + dir * 0.1));
        this.content.style.fontSize = (this.scale * 100) + '%';
        this.zoomLabel.textContent = Math.round(this.scale * 100) + '%';
        this.annotator.cards.relayout();
    }

    /**
     * Find bar.
     */
    search() {
        this.host.openFind();
    }

    /**
     * Clean up.
     */
    destroy() {
        if (this.resizeObs) {
            this.resizeObs.disconnect();
        }
        if (this.annotator) {
            this.annotator.destroy();
        }
    }
}
