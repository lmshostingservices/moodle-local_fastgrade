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
 * PDF (and converted Word/PowerPoint, and images) with a text layer for one-click word and
 * two-click paragraph selection, and an SVG layer for marks and drawing. Pages render lazily.
 * Marks are stored in page units (PDF points at 100%), independent of zoom.
 *
 * @module     local_fastgrade/viewer/pdf
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, s, icon, replace} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import * as Loader from 'local_fastgrade/lib/loader';
import * as TA from 'local_fastgrade/annotate/textanchor';
import Annotator from 'local_fastgrade/annotate/controller';
import * as Api from 'local_fastgrade/lib/api';

const COLOURS = {amber: '#d97706', green: '#22c65e', blue: '#0e88ff', ink: '#1f2937'};
const POLCOLOUR = {improvement: '#d97706', positive: '#22c65e', neutral: '#0e88ff'};
const STAMPS = {
    tick: 'M-7 0l5 5 10-11',
    cross: 'M-6-6l12 12M6-6l-12 12',
    query: 'M-4-5a4.5 4.5 0 1 1 6 4c-1.3.6-2 1.4-2 2.6v.8M0 7.5v.5',
};
const DPR = () => Math.min(window.devicePixelRatio || 1, 2);

export default class PdfViewer {
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
        this.supportsDrawing = true;
        this.pages = [];
        this.scale = 1;
        this.fit = true;
        this.tool = host.tool || 'select';
        this.pagesEl = h('div.fg-pages');
        this.marginEl = h('div.fg-margin', {'aria-label': t('comments')});
        this.paper = h('div.fg-paper.is-pdf', null, this.pagesEl, this.marginEl);
        this.notes = h('div.fg-slide-notes');
        this.scroll = h('div.fg-doc-scroll', null, this.paper);
        this.el = h('div.fg-viewer.is-pdf', {dataset: {tool: this.tool}}, this.scroll, this.notes);
        this.zoomLabel = h('span.fg-zoom-label', null, '100%');
        this.destroyed = false;
    }

    /**
     * Load the document.
     */
    async load() {
        if (this.doc.kind === 'image') {
            await this.loadImage();
        } else {
            await this.loadPdf();
        }
        this.annotator = new Annotator(this.app, this);
        this.bind();
        this.computeFit();
        this.layoutPages();
        this.observe();
        this.annotator.refresh();
        this.resizeObs = new ResizeObserver(() => {
            if (this.fit) {
                const before = this.scale;
                this.computeFit();
                if (Math.abs(before - this.scale) > 0.01) {
                    this.layoutPages();
                }
            }
        });
        this.resizeObs.observe(this.scroll);
        if (this.doc.kind === 'slides') {
            this.notesReady = this.loadNotes();
        }
    }

    /**
     * Load a PDF with PDF.js.
     */
    async loadPdf() {
        const libs = this.app.boot.libs;
        const pdfjs = await Loader.pdfjs(libs);
        this.pdfjs = pdfjs;
        const task = pdfjs.getDocument({
            url: this.doc.pdfurl,
            withCredentials: true,
            cMapUrl: libs.cmaps,
            cMapPacked: true,
            standardFontDataUrl: libs.fonts,
            wasmUrl: libs.wasm,
            iccUrl: libs.iccs,
            isEvalSupported: false,
            enableXfa: false,
        });
        this.task = task;
        this.pdf = await task.promise;
        for (let i = 1; i <= this.pdf.numPages; i++) {
            const page = await this.pdf.getPage(i);
            const vp = page.getViewport({scale: 1});
            this.pages.push(this.makePage(i, vp.width, vp.height, page));
        }
    }

    /**
     * Load an image as a single page.
     */
    async loadImage() {
        const img = new Image();
        img.decoding = 'async';
        img.src = this.doc.url;
        await img.decode();
        const max = 1200;
        const ratio = Math.min(1, max / img.naturalWidth);
        const w = img.naturalWidth * ratio;
        const hgt = img.naturalHeight * ratio;
        this.image = img;
        this.pages.push(this.makePage(1, w, hgt, null));
    }

    /**
     * Build a page shell.
     *
     * @param {number} n
     * @param {number} w base width
     * @param {number} hgt base height
     * @param {Object|null} page PDF.js page
     * @returns {Object}
     */
    makePage(n, w, hgt, page) {
        const el = h('div.fg-page', {dataset: {page: n}, 'aria-label': t('pagen', n)});
        const canvas = h('canvas.fg-page-canvas', {'aria-hidden': 'true'});
        const text = h('div.textLayer');
        const svg = s('svg', {"class": 'fg-page-svg', viewBox: `0 0 ${w} ${hgt}`, preserveAspectRatio: 'none'});
        const draw = s('svg', {"class": 'fg-page-draw', viewBox: `0 0 ${w} ${hgt}`, preserveAspectRatio: 'none'});
        el.append(canvas, text, svg, draw, h('span.fg-page-num', {'aria-hidden': 'true'}, String(n)));
        return {n, w, h: hgt, page, el, canvas, text, svg, draw, rendered: 0, task: null, textReady: false};
    }

    /**
     * Fit-to-width scale.
     */
    computeFit() {
        if (!this.pages.length) {
            return;
        }
        const margin = this.app.root.dataset.margin === 'cards' ? 280 : 24;
        const avail = Math.max(320, this.scroll.clientWidth - margin - 48);
        const widest = Math.max(...this.pages.map(p => p.w));
        if (this.fit) {
            this.scale = Math.min(2.5, avail / widest);
        }
        this.zoomLabel.textContent = Math.round(this.scale * 100) + '%';
    }

    /**
     * Size the page shells for the current scale.
     */
    layoutPages() {
        if (!this.pagesEl.childNodes.length) {
            this.pages.forEach(p => this.pagesEl.appendChild(p.el));
        }
        this.pages.forEach(p => {
            p.el.style.width = Math.round(p.w * this.scale) + 'px';
            p.el.style.height = Math.round(p.h * this.scale) + 'px';
            p.el.style.setProperty('--scale-factor', this.scale);
            p.el.style.setProperty('--total-scale-factor', this.scale);
            if (p.rendered && p.rendered !== this.scale) {
                p.stale = true;
            }
        });
        this.zoomLabel.textContent = Math.round(this.scale * 100) + '%';
        this.visible().forEach(p => this.renderPage(p));
        if (this.annotator) {
            this.annotator.cards.relayout();
        }
    }

    /**
     * Pages near the viewport.
     *
     * @returns {Array}
     */
    visible() {
        const r = this.scroll.getBoundingClientRect();
        return this.pages.filter(p => {
            const pr = p.el.getBoundingClientRect();
            return pr.bottom > r.top - r.height && pr.top < r.bottom + r.height;
        });
    }

    /**
     * Render pages as they come into view.
     */
    observe() {
        this.io = new IntersectionObserver(entries => {
            entries.forEach(e => {
                const p = this.pages[parseInt(e.target.dataset.page, 10) - 1];
                if (e.isIntersecting) {
                    this.renderPage(p);
                } else if (p.rendered && this.pages.length > 6) {
                    this.releasePage(p);
                }
            });
        }, {root: this.scroll, rootMargin: '150% 0px'});
        this.pages.forEach(p => this.io.observe(p.el));
    }

    /**
     * Render one page (canvas + text layer).
     *
     * @param {Object} p
     */
    async renderPage(p) {
        if (this.destroyed || (p.rendered === this.scale && !p.stale) || p.busy) {
            return;
        }
        p.busy = true;
        const dpr = DPR();
        const w = Math.round(p.w * this.scale);
        const hh = Math.round(p.h * this.scale);
        try {
            if (this.image) {
                p.canvas.width = Math.round(w * dpr);
                p.canvas.height = Math.round(hh * dpr);
                const ctx = p.canvas.getContext('2d');
                ctx.drawImage(this.image, 0, 0, p.canvas.width, p.canvas.height);
            } else {
                if (p.task) {
                    p.task.cancel();
                }
                const vp = p.page.getViewport({scale: this.scale * dpr});
                const off = document.createElement('canvas');
                off.width = Math.round(vp.width);
                off.height = Math.round(vp.height);
                p.task = p.page.render({canvasContext: off.getContext('2d'), viewport: vp, canvas: off});
                await p.task.promise;
                p.canvas.width = off.width;
                p.canvas.height = off.height;
                p.canvas.getContext('2d').drawImage(off, 0, 0);
                off.width = 0;
                off.height = 0;
                await this.buildText(p);
            }
            p.canvas.style.width = w + 'px';
            p.canvas.style.height = hh + 'px';
            p.rendered = this.scale;
            p.stale = false;
            if (this.annotator && this.annotator.cards) {
                this.annotator.cards.drawLinks();
            }
        } catch (e) {
            if (!e || e.name !== 'RenderingCancelledException') {
                window.console.warn(e);
            }
        } finally {
            p.busy = false;
            p.task = null;
        }
        if (p.rendered !== this.scale && !this.destroyed) {
            this.renderPage(p);
        }
    }

    /**
     * Free a far-away page's canvas to save memory.
     *
     * @param {Object} p
     */
    releasePage(p) {
        if (p.task) {
            p.task.cancel();
        }
        p.canvas.width = 0;
        p.canvas.height = 0;
        p.rendered = 0;
    }

    /**
     * Page text (from its text layer).
     *
     * @param {Object} p
     * @returns {string}
     */
    pageText(p) {
        if (!p.textReady) {
            return '';
        }
        if (p.textString === null || p.textString === undefined) {
            p.textString = TA.fullText(p.text);
        }
        return p.textString;
    }

    /**
     * Page under a node.
     *
     * @param {Node} node
     * @returns {Object|null}
     */
    pageOf(node) {
        const el = node.nodeType === Node.ELEMENT_NODE ? node.closest('.fg-page') : node.parentElement &&
            node.parentElement.closest('.fg-page');
        return el ? this.pages[parseInt(el.dataset.page, 10) - 1] : null;
    }

    /**
     * Convert a client point to page units.
     *
     * @param {Object} p
     * @param {number} x
     * @param {number} y
     * @returns {[number, number]}
     */
    toPage(p, x, y) {
        const r = p.el.getBoundingClientRect();
        return [(x - r.left) / this.scale, (y - r.top) / this.scale];
    }

    /**
     * Rectangles of a range in page units.
     *
     * @param {Object} p
     * @param {Range} range
     * @returns {Array}
     */
    rangeRects(p, range) {
        const pr = p.el.getBoundingClientRect();
        const rects = [...range.getClientRects()].filter(r => r.width > 0.5 && r.height > 0.5)
            .map(r => [(r.left - pr.left) / this.scale, (r.top - pr.top) / this.scale, r.width / this.scale,
                r.height / this.scale]);
        // Merge rectangles on the same line.
        rects.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
        const out = [];
        rects.forEach(r => {
            const last = out[out.length - 1];
            if (last && Math.abs(last[1] - r[1]) < r[3] * 0.5 && r[0] <= last[0] + last[2] + 6) {
                const right = Math.max(last[0] + last[2], r[0] + r[2]);
                last[1] = Math.min(last[1], r[1]);
                last[3] = Math.max(last[3], r[3]);
                last[2] = right - last[0];
            } else {
                out.push(r.slice());
            }
        });
        return out.map(r => r.map(v => Math.round(v * 10) / 10));
    }

    /**
     * Interaction wiring.
     */
    bind() {
        let downAt = null;
        // While dragging a selection, a guard covers the empty parts of the text layer so a drag that
        // ends between lines does not jump to the end of the page (the same fix pdf.js uses).
        this.pagesEl.addEventListener('pointerdown', e => {
            const layer = e.target.closest('.textLayer');
            if (layer && this.tool === 'select') {
                layer.classList.add('selecting');
                const done = () => {
                    layer.classList.remove('selecting');
                    document.removeEventListener('pointerup', done);
                };
                document.addEventListener('pointerup', done);
            }
        });
        this.pagesEl.addEventListener('pointerdown', e => {
            this.annotator.hidePill();
            if (this.tool !== 'select' && !this.app.readonly) {
                this.startDraw(e);
                return;
            }
            downAt = {x: e.clientX, y: e.clientY};
            const shape = e.target.closest('[data-cid]');
            if (shape && e.target.closest('.fg-page-svg')) {
                this.annotator.select(shape.dataset.cid);
                this.startMove(e, shape.dataset.cid);
            }
        });
        this.pagesEl.addEventListener('mouseup', e => {
            if (this.tool !== 'select' || e.button !== 0) {
                return;
            }
            const moved = downAt && (Math.abs(e.clientX - downAt.x) > 4 || Math.abs(e.clientY - downAt.y) > 4);
            const onText = e.target.closest('.textLayer');
            setTimeout(() => {
                const sel = window.getSelection();
                const inside = sel.rangeCount && this.pagesEl.contains(sel.getRangeAt(0).commonAncestorContainer);
                if (moved && inside && !sel.isCollapsed) {
                    this.offerRange(sel.getRangeAt(0));
                    return;
                }
                if (!onText || moved) {
                    return;
                }
                const hit = this.markAt(e.clientX, e.clientY);
                if (hit && e.detail === 1) {
                    this.annotator.select(hit);
                    return;
                }
                if (e.detail >= 2) {
                    this.selectParagraph(e);
                } else if (e.detail === 1) {
                    this.selectWord(e);
                }
            }, 0);
        });
        this.pagesEl.addEventListener('dblclick', e => e.preventDefault());
    }

    /**
     * The text mark under a point, if any.
     *
     * @param {number} x
     * @param {number} y
     * @returns {string|null}
     */
    markAt(x, y) {
        const el = document.elementsFromPoint(x, y).find(n => n.closest && n.closest('.fg-page-svg [data-cid]'));
        return el ? el.closest('[data-cid]').dataset.cid : null;
    }

    /**
     * One click: select the word.
     *
     * @param {MouseEvent} e
     */
    selectWord(e) {
        const p = this.pageOf(e.target);
        if (!p || !p.textReady) {
            return;
        }
        const off = TA.wordOffsetsAt(p.text, e.clientX, e.clientY);
        if (!off) {
            return;
        }
        const r = TA.rangeFromOffsets(p.text, off.start, off.end);
        if (r) {
            TA.selectRange(r);
            this.offerRange(r);
        }
    }

    /**
     * Two clicks: select the paragraph (lines close together around the clicked one).
     *
     * @param {MouseEvent} e
     */
    selectParagraph(e) {
        const p = this.pageOf(e.target);
        if (!p || !p.textReady) {
            return;
        }
        const spans = [...p.text.querySelectorAll('span')].filter(sp => sp.textContent.trim() && !sp.closest('.markedContent') ||
            (sp.textContent.trim() && !sp.querySelector('span')));
        if (!spans.length) {
            return;
        }
        const rects = spans.map(sp => sp.getBoundingClientRect());
        // Group into lines.
        const lines = [];
        spans.forEach((sp, i) => {
            const r = rects[i];
            const mid = r.top + r.height / 2;
            let line = lines.find(l => Math.abs(l.mid - mid) < Math.max(3, r.height * 0.45));
            if (!line) {
                line = {mid, top: r.top, bottom: r.bottom, spans: [], left: r.left, height: r.height};
                lines.push(line);
            }
            line.spans.push(sp);
            line.top = Math.min(line.top, r.top);
            line.bottom = Math.max(line.bottom, r.bottom);
            line.left = Math.min(line.left, r.left);
        });
        lines.sort((a, b) => a.top - b.top);
        let li = lines.findIndex(l => e.clientY >= l.top - 2 && e.clientY <= l.bottom + 2);
        if (li < 0) {
            return;
        }
        const heights = lines.map(l => l.bottom - l.top).sort((a, b) => a - b);
        const typical = heights[Math.floor(heights.length / 2)] || 12;
        const gapOk = (a, b) => (b.top - a.bottom) < typical * 0.9;
        let first = li;
        let last = li;
        while (first > 0 && gapOk(lines[first - 1], lines[first])) {
            first--;
        }
        while (last < lines.length - 1 && gapOk(lines[last], lines[last + 1])) {
            last++;
        }
        const startSpan = lines[first].spans.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left)[0];
        const endLine = lines[last].spans.sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
        const endSpan = endLine[endLine.length - 1];
        const r = document.createRange();
        r.setStart(startSpan.firstChild || startSpan, 0);
        const endNode = endSpan.lastChild || endSpan;
        r.setEnd(endNode, endNode.nodeType === Node.TEXT_NODE ? endNode.data.length : endNode.childNodes.length);
        TA.selectRange(r);
        this.offerRange(r);
    }

    /**
     * Describe a range for annotation.
     *
     * @param {Range} range
     * @returns {Object|null}
     */
    describe(range) {
        const p = this.pageOf(range.startContainer);
        if (!p) {
            return null;
        }
        // Keep to one page.
        const endp = this.pageOf(range.endContainer);
        if (endp !== p) {
            const last = p.text.lastChild;
            if (last) {
                range.setEndAfter(last);
            }
        }
        const off = TA.offsetsFromRange(p.text, range);
        const text = this.pageText(p);
        if (off.end <= off.start || !text.slice(off.start, off.end).trim()) {
            return null;
        }
        const anchor = TA.makeAnchor(text, off.start, off.end);
        anchor.rects = this.rangeRects(p, range);
        return {anchor, page: p.n, rect: range.getBoundingClientRect()};
    }

    /**
     * Offer the pill.
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
     * Current selection.
     *
     * @returns {Object|null}
     */
    selectionInfo() {
        const sel = window.getSelection();
        if (!sel.rangeCount || sel.isCollapsed) {
            return null;
        }
        const r = sel.getRangeAt(0);
        if (!this.pagesEl.contains(r.commonAncestorContainer)) {
            return null;
        }
        return this.describe(r);
    }

    /* ---------- Drawing ---------- */

    /**
     * Choose a tool.
     *
     * @param {string} tool
     */
    setTool(tool) {
        this.tool = tool;
        this.el.dataset.tool = tool;
        window.getSelection().removeAllRanges();
    }

    /**
     * Current colour.
     *
     * @returns {string}
     */
    colour() {
        return COLOURS[this.host.colour] || COLOURS.amber;
    }

    /**
     * Polarity from the colour (amber = improvement, green = positive).
     *
     * @returns {string}
     */
    polarityFromColour() {
        return {amber: 'improvement', green: 'positive'}[this.host.colour] || 'neutral';
    }

    /**
     * Start a drawing gesture.
     *
     * @param {PointerEvent} e
     */
    startDraw(e) {
        const p = this.pageOf(e.target);
        if (!p) {
            return;
        }
        e.preventDefault();
        const tool = this.tool;
        const [x0, y0] = this.toPage(p, e.clientX, e.clientY);
        if (tool === 'eraser') {
            const hit = this.markAt(e.clientX, e.clientY);
            if (hit) {
                this.annotator.remove(this.app.annotations.get(hit));
            }
            return;
        }
        if (['tick', 'cross', 'query'].includes(tool)) {
            const pol = tool === 'tick' ? 'positive' : (tool === 'cross' ? 'improvement' : 'neutral');
            this.app.annotations.create({docref: this.docref, page: p.n, type: 'stamp', polarity: pol,
                anchor: {x: x0, y: y0}, style: {stamp: tool, colour: tool === 'tick' ? COLOURS.green :
                    (tool === 'cross' ? COLOURS.amber : COLOURS.blue)}});
            return;
        }
        if (tool === 'text') {
            const a = this.app.annotations.create({docref: this.docref, page: p.n, type: 'text',
                polarity: this.polarityFromColour(),
                anchor: {x: x0, y: y0}, style: {colour: this.colour(), size: 12}, comment: ''});
            this.editText(a, p);
            return;
        }
        const pointer = e.pointerId;
        p.draw.setPointerCapture(pointer);
        const colour = this.colour();
        let el = null;
        const points = [[x0, y0, e.pressure || 0.5]];
        let x1 = x0;
        let y1 = y0;
        const move = ev => {
            const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
            evs.forEach(ce => {
                [x1, y1] = this.toPage(p, ce.clientX, ce.clientY);
                if (tool === 'pen') {
                    points.push([x1, y1, ce.pressure || 0.5]);
                }
            });
            if (el) {
                el.remove();
            }
            el = this.shapeEl({type: tool === 'area' ? 'area' : tool, anchor: tool === 'pen' ? {points} :
                {rect: norm(x0, y0, x1, y1), from: [x0, y0], to: [x1, y1]}, style: {colour, width: 2}});
            p.draw.appendChild(el);
        };
        const up = () => {
            p.draw.removeEventListener('pointermove', move);
            if (el) {
                el.remove();
            }
            const tiny = Math.abs(x1 - x0) < 3 && Math.abs(y1 - y0) < 3;
            if (tool === 'pen') {
                if (points.length > 2) {
                    this.app.annotations.create({docref: this.docref, page: p.n, type: 'ink', polarity: this.polarityFromColour(),
                        anchor: {points: simplify(points)}, style: {colour, width: 2}});
                }
                return;
            }
            if (tiny) {
                return;
            }
            if (tool === 'area') {
                const rect = norm(x0, y0, x1, y1);
                const pr = p.el.getBoundingClientRect();
                this.annotator.showPill({page: p.n, anchor: {rect, exact: ''}, rect: new DOMRect(pr.left + rect[0] * this.scale,
                    pr.top + rect[1] * this.scale, rect[2] * this.scale, rect[3] * this.scale)});
                return;
            }
            const type = tool === 'arrow' ? 'arrow' : tool;
            this.app.annotations.create({docref: this.docref, page: p.n, type, polarity: this.polarityFromColour(),
                anchor: {rect: norm(x0, y0, x1, y1), from: [x0, y0], to: [x1, y1]}, style: {colour, width: 2}});
        };
        p.draw.addEventListener('pointermove', move);
        p.draw.addEventListener('pointerup', up, {once: true});
        p.draw.addEventListener('pointercancel', up, {once: true});
    }

    /**
     * Move a selected shape by dragging.
     *
     * @param {PointerEvent} e
     * @param {string} id
     */
    startMove(e, id) {
        const a = this.app.annotations.get(id);
        if (!a || !['rect', 'ellipse', 'arrow', 'stamp', 'text', 'ink', 'area'].includes(a.type)) {
            return;
        }
        const p = this.pages[a.page - 1];
        const [sx, sy] = this.toPage(p, e.clientX, e.clientY);
        const target = e.target.closest('[data-cid]');
        let dx = 0;
        let dy = 0;
        e.preventDefault();
        const move = ev => {
            const [x, y] = this.toPage(p, ev.clientX, ev.clientY);
            dx = x - sx;
            dy = y - sy;
            target.setAttribute('transform', `translate(${dx} ${dy})`);
        };
        const up = () => {
            document.removeEventListener('pointermove', move);
            if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
                target.removeAttribute('transform');
                return;
            }
            const an = JSON.parse(JSON.stringify(a.anchor));
            if (an.rect) {
                an.rect[0] += dx;
                an.rect[1] += dy;
            }
            if (an.from) {
                an.from = [an.from[0] + dx, an.from[1] + dy];
                an.to = [an.to[0] + dx, an.to[1] + dy];
            }
            if (an.points) {
                an.points = an.points.map(pt => [pt[0] + dx, pt[1] + dy, pt[2]]);
            }
            if (an.x !== undefined) {
                an.x += dx;
                an.y += dy;
            }
            this.app.annotations.update(id, {anchor: an});
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', up, {once: true});
    }

    /**
     * Edit a text box in place.
     *
     * @param {Object} a
     * @param {Object} p
     */
    editText(a, p) {
        const box = h('textarea.fg-textbox-edit', {rows: 2, style: {
            left: (a.anchor.x * this.scale) + 'px', top: (a.anchor.y * this.scale) + 'px',
            color: (a.style && a.style.colour) || COLOURS.ink, fontSize: (12 * this.scale) + 'px'}});
        box.value = a.comment || '';
        p.el.appendChild(box);
        box.focus();
        const done = () => {
            box.remove();
            const v = box.value.trim();
            if (!v) {
                this.app.annotations.remove(a.clientid);
            } else {
                this.app.annotations.update(a.clientid, {comment: v});
            }
        };
        box.addEventListener('blur', done, {once: true});
        box.addEventListener('keydown', e => {
            if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
                e.preventDefault();
                box.blur();
            }
        });
    }

    /* ---------- Rendering marks ---------- */

    /**
     * SVG for one annotation.
     *
     * @param {Object} a
     * @returns {SVGElement|null}
     */
    shapeEl(a) {
        const an = a.anchor || {};
        const st = a.style || {};
        const pcol = POLCOLOUR[a.polarity] || POLCOLOUR.neutral;
        const col = st.colour || pcol;
        const sug = a.status === 'suggested';
        const g = s('g', {'data-cid': a.clientid || '',
            "class": `fg-shape is-${a.type} is-${a.polarity}${sug ? ' is-suggested' : ''}`});
        const rects = an.rects || (an.rect ? [an.rect] : []);
        switch (a.type) {
            case 'border':
            case 'comment':
                rects.forEach(r => g.appendChild(s('rect', {x: r[0] - 1.5, y: r[1] - 1, width: r[2] + 3, height: r[3] + 2, rx: 2.5,
                    fill: pcol, 'fill-opacity': 0.07, stroke: pcol, 'stroke-width': 1.2,
                    'stroke-dasharray': sug ? '3 2' : null})));
                break;
            case 'highlight':
                rects.forEach(r => g.appendChild(s('rect', {x: r[0], y: r[1], width: r[2], height: r[3], fill: '#facc15',
                    'fill-opacity': 0.35, rx: 1})));
                break;
            case 'underline':
            case 'squiggly':
                rects.forEach(r => g.appendChild(s('line', {x1: r[0], x2: r[0] + r[2], y1: r[1] + r[3] - 0.5, y2: r[1] + r[3] - 0.5,
                    stroke: pcol, 'stroke-width': 1.3})));
                break;
            case 'strike':
                rects.forEach(r => g.appendChild(s('line', {x1: r[0], x2: r[0] + r[2], y1: r[1] + r[3] / 2, y2: r[1] + r[3] / 2,
                    stroke: COLOURS.amber, 'stroke-width': 1.3})));
                break;
            case 'area':
                rects.forEach(r => g.appendChild(s('rect', {x: r[0], y: r[1], width: r[2], height: r[3], fill: pcol,
                    'fill-opacity': 0.08, stroke: pcol, 'stroke-width': 1.2, 'stroke-dasharray': sug ? '3 2' : null, rx: 3})));
                break;
            case 'rect':
                if (an.rect) {
                    g.appendChild(s('rect', {x: an.rect[0], y: an.rect[1], width: an.rect[2], height: an.rect[3], fill: 'none',
                        stroke: col, 'stroke-width': st.width || 2, rx: 2}));
                }
                break;
            case 'ellipse':
                if (an.rect) {
                    g.appendChild(s('ellipse', {cx: an.rect[0] + an.rect[2] / 2, cy: an.rect[1] + an.rect[3] / 2,
                        rx: an.rect[2] / 2,
                        ry: an.rect[3] / 2, fill: 'none', stroke: col, 'stroke-width': st.width || 2}));
                }
                break;
            case 'arrow':
            case 'line':
                if (an.from) {
                    const [x1, y1] = an.from;
                    const [x2, y2] = an.to;
                    const ang = Math.atan2(y2 - y1, x2 - x1);
                    const len = 9;
                    const head = `M${x2} ${y2}L${x2 - len * Math.cos(ang - 0.45)} ${y2 - len * Math.sin(ang - 0.45)}` +
                        `M${x2} ${y2}L${x2 - len * Math.cos(ang + 0.45)} ${y2 - len * Math.sin(ang + 0.45)}`;
                    g.appendChild(s('path', {d: `M${x1} ${y1}L${x2} ${y2}` + (a.type === 'arrow' ? head : ''), stroke: col,
                        'stroke-width': st.width || 2, fill: 'none', 'stroke-linecap': 'round'}));
                }
                break;
            case 'ink':
                if (an.points && an.points.length) {
                    g.appendChild(s('path', {d: smoothPath(an.points), stroke: col, 'stroke-width': st.width || 2, fill: 'none',
                        'stroke-linecap': 'round', 'stroke-linejoin': 'round'}));
                }
                break;
            case 'stamp':
                g.appendChild(s('circle', {cx: an.x, cy: an.y, r: 11, fill: '#fff', 'fill-opacity': 0.85, stroke: col,
                    'stroke-width': 1.2}));
                g.appendChild(s('path', {d: STAMPS[st.stamp] || STAMPS.tick, transform: `translate(${an.x} ${an.y})`, stroke: col,
                    'stroke-width': 2.2, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round'}));
                break;
            case 'text': {
                const lines = String(a.comment || '').split('\n');
                const txt = s('text', {x: an.x, y: an.y + 12, fill: col, 'font-size': 12, 'font-family': 'system-ui, sans-serif'});
                lines.forEach((ln, i) => txt.appendChild(s('tspan', {x: an.x, dy: i ? 14 : 0}, ln)));
                g.appendChild(txt);
                break;
            }
            default:
                return null;
        }
        // A wide, invisible hit area for thin shapes.
        if (['ink', 'arrow', 'line', 'underline', 'strike'].includes(a.type)) {
            const hit = g.firstChild && g.firstChild.cloneNode();
            if (hit) {
                hit.setAttribute('stroke', 'transparent');
                hit.setAttribute('stroke-width', 10);
                hit.setAttribute('class', 'fg-hit');
                g.appendChild(hit);
            }
        }
        return g;
    }

    /**
     * Draw all annotations.
     */
    renderMarks() {
        this.pages.forEach(p => replace(p.svg));
        this.app.annotations.forDoc(this.docref).forEach(a => {
            const p = this.pages[(a.page || 1) - 1];
            if (!p) {
                return;
            }
            const el = this.shapeEl(a);
            if (el) {
                const label = (a.comment || '').slice(0, 120);
                el.setAttribute('role', 'img');
                el.setAttribute('aria-label', t('mark_' + a.type) + (label ? ': ' + label : ''));
                p.svg.appendChild(el);
            }
        });
        if (this.annotator && this.annotator.selected) {
            this.selectMark(this.annotator.selected);
        }
    }

    /**
     * Vertical position for a card, in paper coordinates.
     *
     * @param {Object} a
     * @returns {number|null}
     */
    cardTop(a) {
        const p = this.pages[(a.page || 1) - 1];
        if (!p) {
            return null;
        }
        const an = a.anchor || {};
        let y = 0;
        if (an.rects && an.rects.length) {
            y = an.rects[0][1];
        } else if (an.rect) {
            y = an.rect[1];
        } else if (an.y !== undefined) {
            y = an.y - 10;
        } else if (an.points && an.points.length) {
            y = Math.min(...an.points.map(pt => pt[1]));
        } else if (an.from) {
            y = Math.min(an.from[1], an.to[1]);
        }
        if (['ink', 'rect', 'ellipse', 'arrow', 'stamp', 'text'].includes(a.type) && !a.comment && a.status !== 'suggested') {
            return null;
        }
        return p.el.offsetTop + y * this.scale - 6;
    }

    /**
     * Hover link.
     *
     * @param {string} id
     * @param {boolean} on
     */
    hoverMark(id, on) {
        this.pagesEl.querySelectorAll(`[data-cid="${CSS.escape(id)}"]`).forEach(el => el.classList.toggle('is-hover', on));
    }

    /**
     * Selected look.
     *
     * @param {string|null} id
     */
    selectMark(id) {
        this.pagesEl.querySelectorAll('.fg-shape.is-selected').forEach(el => el.classList.remove('is-selected'));
        if (id) {
            this.pagesEl.querySelectorAll(`.fg-shape[data-cid="${CSS.escape(id)}"]`).forEach(el => el.classList.add('is-selected'));
        }
    }

    /**
     * Scroll to a mark.
     *
     * @param {string} id
     */
    focusMark(id) {
        const a = this.app.annotations.get(id);
        if (!a) {
            return;
        }
        const top = this.cardTop(a);
        const p = this.pages[(a.page || 1) - 1];
        const y = top !== null ? top : (p ? p.el.offsetTop : 0);
        this.scroll.scrollTo({top: Math.max(0, y - this.scroll.clientHeight / 3), behavior: 'smooth'});
        this.hoverMark(id, true);
        setTimeout(() => this.hoverMark(id, false), 900);
    }

    /**
     * Build a page's text layer for the current scale. The layer is built off to the side and swapped in only if it is
     * still the latest build, so overlapping renders (zooming, searching) never leave two layers on top of each other.
     *
     * @param {Object} p page
     * @returns {Promise}
     */
    buildText(p) {
        const scale = this.scale;
        if (p.textReady && p.textScale === scale) {
            return Promise.resolve();
        }
        if (p.textJob && p.textJob.scale === scale) {
            return p.textJob.promise;
        }
        const job = {scale};
        p.textJob = job;
        job.promise = (async() => {
            const div = h('div.textLayer');
            const tl = new this.pdfjs.TextLayer({textContentSource: p.page.streamTextContent(), container: div,
                viewport: p.page.getViewport({scale})});
            await tl.render();
            if (p.textJob !== job || this.destroyed) {
                return;
            }
            div.append(h('div.endOfContent'));
            p.text.replaceWith(div);
            p.text = div;
            p.textReady = true;
            p.textScale = scale;
            p.textString = null;
            p.textJob = null;
        })();
        return job.promise;
    }

    /* ---------- Zoom, search, notes ---------- */

    /**
     * Zoom.
     *
     * @param {number} dir 1, -1, or 0 for fit width
     */
    zoom(dir) {
        const anchor = this.scroll.scrollTop / Math.max(1, this.scroll.scrollHeight);
        if (dir === 0) {
            this.fit = true;
            this.computeFit();
        } else {
            this.fit = false;
            const steps = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
            const cur = this.scale;
            const up = steps.find(s2 => s2 > cur + 0.01) || 3;
            const down = [...steps].reverse().find(s2 => s2 < cur - 0.01) || 0.5;
            this.scale = dir > 0 ? up : down;
        }
        this.layoutPages();
        this.scroll.scrollTop = anchor * this.scroll.scrollHeight;
    }

    /**
     * Make sure every page has its text layer (for searching).
     */
    async ensureAllText() {
        for (const p of this.pages) {
            if (!p.textReady && p.page) {
                await this.buildText(p);
            }
        }
    }

    /**
     * Find words and select them.
     *
     * @param {string} words
     * @param {number} from page index to start from
     * @returns {Promise<boolean>}
     */
    async findText(words, from = 0) {
        await this.ensureAllText();
        for (let i = 0; i < this.pages.length; i++) {
            const p = this.pages[(i + from) % this.pages.length];
            const pos = TA.resolve(this.pageText(p), {exact: words, start: 0, end: 0});
            if (pos) {
                const r = TA.rangeFromOffsets(p.text, pos.start, pos.end);
                if (r) {
                    const rects = this.rangeRects(p, r);
                    this.scroll.scrollTo({top: Math.max(0, p.el.offsetTop + (rects[0] ? rects[0][1] : 0) * this.scale -
                        this.scroll.clientHeight / 3), behavior: 'smooth'});
                    TA.selectRange(r);
                    setTimeout(() => this.offerRange(r), 350);
                    this.lastFind = {words, page: p.n};
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Plain text of all pages (auto-marking).
     *
     * @returns {Promise<Array>} [{page, text}]
     */
    async pagesText() {
        await this.ensureAllText();
        return this.pages.map(p => ({page: p.n, text: this.engineText(p)}));
    }

    /**
     * Page text for auto-marking: a line break wherever the PDF ends a line, so words at line ends
     * do not run together. The added breaks are remembered to map offsets back.
     *
     * @param {Object} p
     * @returns {string}
     */
    engineText(p) {
        if (!p.textReady) {
            return '';
        }
        let out = '';
        p.inserted = [];
        TA.textNodes(p.text).forEach(n => {
            out += n.data;
            const host = n.parentElement && n.parentElement !== p.text ? n.parentElement : n;
            const next = host.nextSibling;
            if (next && next.nodeName === 'BR' && !/\s$/.test(n.data)) {
                p.inserted.push(out.length);
                out += '\n';
            }
        });
        return out;
    }

    /**
     * An engine offset as a page text offset.
     *
     * @param {Object} p
     * @param {number} pos
     * @returns {number}
     */
    rawOffset(p, pos) {
        return pos - (p.inserted || []).filter(i => i < pos).length;
    }

    /**
     * Anchor for offsets on a page (auto-marking).
     *
     * @param {number} page
     * @param {number} start
     * @param {number} end
     * @returns {Object|null}
     */
    anchorForPage(page, start, end) {
        const p = this.pages[page - 1];
        if (p && !p.inserted) {
            this.engineText(p);
        }
        if (p) {
            start = this.rawOffset(p, start);
            end = this.rawOffset(p, end);
        }
        const r = p && TA.rangeFromOffsets(p.text, start, end);
        if (!r) {
            return null;
        }
        const anchor = TA.makeAnchor(this.pageText(p), start, end);
        anchor.rects = this.rangeRects(p, r);
        return {page, anchor};
    }

    /**
     * Search box.
     */
    search() {
        if (this.host.openFind) {
            this.host.openFind();
        }
    }

    /**
     * Slide notes for PowerPoint files.
     */
    async loadNotes() {
        if (!this.doc.dataurl) {
            return;
        }
        try {
            const res = await fetch(this.doc.dataurl + '&type=notes', {credentials: 'same-origin'});
            const data = await res.json();
            this.slideNotes = (data.notes || []).map(n => String(n || ''));
            if (!data.notes || !data.notes.some(n => n && n.trim())) {
                return;
            }
            this.el.classList.add('has-notes');
            replace(this.notes, h('h3.fg-section-title', null, icon('slides', 'fg-i-sm'), t('speakernotes')),
                data.notes.map((n, i) => h('div.fg-note-slide', {dataset: {page: i + 1}},
                    h('div.fg-note-n', null, t('slide', i + 1)),
                    h('div.fg-note-text', null, n && n.trim() ? n : h('span.fg-muted', null, t('nonotes'))))));
        } catch (e) {
            window.console.warn(Api.message(e));
        }
    }

    /**
     * Clean up.
     */
    destroy() {
        this.destroyed = true;
        if (this.io) {
            this.io.disconnect();
        }
        if (this.resizeObs) {
            this.resizeObs.disconnect();
        }
        this.pages.forEach(p => {
            if (p.task) {
                p.task.cancel();
            }
            p.canvas.width = 0;
            p.canvas.height = 0;
        });
        if (this.annotator) {
            this.annotator.destroy();
        }
        // Free the worker's copy of the document (the loading task owns it in current PDF.js).
        try {
            if (this.task && typeof this.task.destroy === 'function') {
                this.task.destroy();
            } else if (this.pdf && typeof this.pdf.destroy === 'function') {
                this.pdf.destroy();
            }
        } catch (e) {
            // Already gone.
        }
    }
}

/**
 * Rectangle from two corners.
 *
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @returns {Array}
 */
const norm = (x0, y0, x1, y1) => [Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)];

/**
 * Drop points closer than 1 unit.
 *
 * @param {Array} pts
 * @returns {Array}
 */
const simplify = pts => {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
        const [x, y] = pts[i];
        const [px, py] = out[out.length - 1];
        if (Math.hypot(x - px, y - py) >= 1) {
            out.push(pts[i].map(v => Math.round(v * 10) / 10));
        }
    }
    return out;
};

/**
 * A smooth path through points (quadratic midpoints).
 *
 * @param {Array} pts
 * @returns {string}
 */
const smoothPath = pts => {
    if (pts.length < 3) {
        return `M${pts[0][0]} ${pts[0][1]}` + pts.slice(1).map(p => `L${p[0]} ${p[1]}`).join('');
    }
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i][0] + pts[i + 1][0]) / 2;
        const my = (pts[i][1] + pts[i + 1][1]) / 2;
        d += `Q${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
    }
    const l = pts[pts.length - 1];
    return d + `L${l[0]} ${l[1]}`;
};


