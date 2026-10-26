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
 * Spreadsheets as a live grid: sheet tabs, formula bar, show-formulas, comments on cells.
 *
 * @module     local_fastgrade/viewer/sheet
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon, replace} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import {tip} from 'local_fastgrade/ui/tooltip';
import Annotator from 'local_fastgrade/annotate/controller';

const colName = n => {
    let s = '';
    n++;
    while (n > 0) {
        const m = (n - 1) % 26;
        s = String.fromCharCode(65 + m) + s;
        n = Math.floor((n - 1) / 26);
    }
    return s;
};

export default class SheetViewer {
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
        this.sheet = 0;
        this.formulas = false;
        this.fx = h('div.fg-fx', null, h('span.fg-fx-ref', null, ''), h('span.fg-fx-val', null, ''));
        this.tabs = h('div.fg-sheet-tabs', {role: 'tablist'});
        this.grid = h('div.fg-sheet-grid');
        this.marginEl = h('div.fg-margin', {'aria-label': t('comments')});
        this.paper = h('div.fg-paper.is-sheet', null, this.grid, this.marginEl);
        this.scroll = h('div.fg-doc-scroll', null, this.paper);
        const toggle = tip(h('button.fg-btn.is-small.is-ghost', {type: 'button', onclick: () => {
            this.formulas = !this.formulas;
            toggle.setAttribute('aria-pressed', String(this.formulas));
            this.renderGrid();
        }, 'aria-pressed': 'false'}, icon('code', 'fg-i-sm'), t('showformulas')), t('showformulas_tip'));
        this.el = h('div.fg-viewer.is-sheet', null, h('div.fg-sheet-bar', null, this.fx, toggle), this.scroll, this.tabs);
    }

    /**
     * Load.
     */
    async load() {
        const res = await fetch(this.doc.dataurl + '&type=sheet', {credentials: 'same-origin'});
        if (!res.ok) {
            throw new Error(t('loadfailed'));
        }
        this.data = await res.json();
        if (this.data.error) {
            throw new Error(this.data.error);
        }
        this.annotator = new Annotator(this.app, this);
        this.renderTabs();
        this.renderGrid();
    }

    /**
     * Sheet tabs.
     */
    renderTabs() {
        replace(this.tabs, this.data.sheets.map((sh, i) => {
            const n = this.app.annotations.forDoc(this.docref).filter(a => a.page === i + 1).length;
            return h('button.fg-sheet-tab', {type: 'button', role: 'tab', 'aria-selected': String(i === this.sheet),
                onclick: () => {
                    this.sheet = i;
                    this.renderTabs();
                    this.renderGrid();
                }}, sh.name, n ? h('span.fg-count', null, String(n)) : null);
        }));
    }

    /**
     * Draw the grid.
     */
    renderGrid() {
        const sh = this.data.sheets[this.sheet];
        if (!sh) {
            replace(this.grid, h('div.fg-empty-small', null, t('emptysheet')));
            return;
        }
        const cols = sh.cols;
        const table = h('table.fg-sheet', {role: 'grid', 'aria-label': sh.name});
        table.appendChild(h('thead', null, h('tr', null, h('th.fg-corner'), Array.from({length: cols}, (_, c) => h('th', null,
            colName(c))))));
        const body = h('tbody');
        sh.rows.forEach((row, r) => {
            const tr = h('tr', null, h('th', null, String(r + 1)));
            for (let c = 0; c < cols; c++) {
                const cell = row[c] || null;
                const ref = colName(c) + (r + 1);
                const shown = cell ? (this.formulas && cell.f ? '=' + cell.f : (cell.v ?? '')) : '';
                const td = h('td', {dataset: {ref}, "class": (cell && cell.f ? 'has-formula ' : '') +
                    (cell && typeof cell.v === 'number' ? 'is-num' : ''), tabindex: '-1'}, String(shown));
                td.addEventListener('click', () => this.pick(td, cell, ref));
                tr.appendChild(td);
            }
            body.appendChild(tr);
        });
        table.appendChild(body);
        if (sh.truncated) {
            replace(this.grid, table, h('div.fg-notice', null, t('sheettruncated')));
        } else {
            replace(this.grid, table);
        }
        this.annotator.refresh();
    }

    /**
     * Select a cell.
     *
     * @param {HTMLElement} td
     * @param {Object|null} cell
     * @param {string} ref
     */
    pick(td, cell, ref) {
        this.grid.querySelectorAll('td.is-picked').forEach(x => x.classList.remove('is-picked'));
        td.classList.add('is-picked');
        this.fx.querySelector('.fg-fx-ref').textContent = ref;
        this.fx.querySelector('.fg-fx-val').textContent = cell ? (cell.f ? '=' + cell.f + '   →   ' + (cell.v ?? '') :
            String(cell.v ?? '')) : '';
        const existing = this.app.annotations.forDoc(this.docref).find(a => a.page === this.sheet + 1 && a.anchor &&
            a.anchor.cell === ref);
        if (existing) {
            this.annotator.select(existing.clientid);
            return;
        }
        this.current = {anchor: {cell: ref, sheet: this.data.sheets[this.sheet].name, exact: cell ? String(cell.v ?? '') : '',
            formula: cell && cell.f ? cell.f : ''}, page: this.sheet + 1, rect: td.getBoundingClientRect()};
        this.annotator.showPill(this.current);
    }

    /**
     * Selected cell.
     *
     * @returns {Object|null}
     */
    selectionInfo() {
        return this.current || null;
    }

    /**
     * Cell element for an annotation.
     *
     * @param {Object} a
     * @returns {HTMLElement|null}
     */
    cellOf(a) {
        if (a.page !== this.sheet + 1 || !a.anchor || !a.anchor.cell) {
            return null;
        }
        return this.grid.querySelector(`td[data-ref="${a.anchor.cell}"]`);
    }

    /**
     * Draw marks on cells.
     */
    renderMarks() {
        this.grid.querySelectorAll('td[data-cid]').forEach(td => {
            td.removeAttribute('data-cid');
            td.className = td.className.replace(/\bfg-cm-\S+/g, '').trim();
        });
        this.app.annotations.forDoc(this.docref).forEach(a => {
            const td = this.cellOf(a);
            if (td) {
                td.dataset.cid = a.clientid;
                td.classList.add('fg-cm-' + a.polarity);
                if (a.status === 'suggested') {
                    td.classList.add('fg-cm-suggested');
                }
            }
        });
    }

    /**
     * Card position.
     *
     * @param {Object} a
     * @returns {number|null}
     */
    cardTop(a) {
        const td = this.cellOf(a);
        return td ? td.offsetTop + td.closest('table').offsetTop : null;
    }

    /**
     * Hover.
     *
     * @param {string} id
     * @param {boolean} on
     */
    hoverMark(id, on) {
        const td = this.grid.querySelector(`td[data-cid="${CSS.escape(id)}"]`);
        if (td) {
            td.classList.toggle('is-hover', on);
        }
    }

    /**
     * Focus.
     *
     * @param {string} id
     */
    focusMark(id) {
        const a = this.app.annotations.get(id);
        if (a && a.page !== this.sheet + 1) {
            this.sheet = a.page - 1;
            this.renderTabs();
            this.renderGrid();
        }
        const td = this.grid.querySelector(`td[data-cid="${CSS.escape(id)}"]`);
        if (td) {
            td.scrollIntoView({block: 'center', inline: 'center', behavior: 'smooth'});
        }
    }

    /**
     * Clean up.
     */
    destroy() {
        if (this.annotator) {
            this.annotator.destroy();
        }
    }
}
