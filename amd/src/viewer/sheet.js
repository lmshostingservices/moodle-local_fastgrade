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
        this.markType = 'cell';
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
     * Each sheet as text for the checks: one line per row, cells separated by " | ". Cell positions are kept so
     * evidence can be marked on the cell.
     *
     * @returns {Promise<Array>} [{page, text}]
     */
    async pagesText() {
        this.cellMap = [];
        return (this.data.sheets || []).map((sh, si) => {
            let text = '';
            const map = [];
            sh.rows.forEach((row, r) => {
                let line = '';
                (row || []).forEach((cell, c) => {
                    if (!cell || cell.v === null || cell.v === undefined || String(cell.v).trim() === '') {
                        return;
                    }
                    if (line) {
                        line += ' | ';
                    }
                    const val = String(cell.v);
                    map.push({start: text.length + line.length, end: text.length + line.length + val.length,
                        ref: colName(c) + (r + 1), v: val, f: cell.f || ''});
                    line += val;
                });
                if (line) {
                    text += line + '\n';
                }
            });
            this.cellMap[si] = map;
            return {page: si + 1, text};
        });
    }

    /**
     * Anchor (a cell) for a character range from pagesText().
     *
     * @param {number} page sheet number
     * @param {number} start
     * @param {number} end
     * @returns {Object|null}
     */
    anchorForPage(page, start, end) {
        const map = (this.cellMap || [])[page - 1] || [];
        const hit = map.find(m => m.end > start && m.start < end);
        if (!hit) {
            return null;
        }
        const sh = this.data.sheets[page - 1];
        return {page, anchor: {cell: hit.ref, sheet: sh ? sh.name : '', exact: hit.v, formula: hit.f}};
    }

    /**
     * Facts about the workbook for spreadsheet criteria: are totals calculated with formulas, and do they add up?
     *
     * @returns {Object} {totals, formulas, checked, wrong, wrongcells: [{page, ref}]}
     */
    sheetFacts() {
        const num = v => {
            if (typeof v === 'number') {
                return v;
            }
            const x = parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
            return /^[-$\s\d.,]+$/.test(String(v ?? '').trim()) && !isNaN(x) ? x : null;
        };
        const close = (a, b) => Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.005);
        const facts = {totals: 0, formulas: 0, checked: 0, wrong: 0, wrongcells: []};
        (this.data.sheets || []).forEach((sh, si) => {
            const rows = sh.rows || [];
            // Columns whose heading says total, and rows whose label says total.
            const totalcols = new Set();
            rows.slice(0, 8).forEach(row => (row || []).forEach((cell, c) => {
                if (cell && typeof cell.v === 'string' && /\b(total|subtotal|amount|cost \(\$\)|sum)\b/i.test(cell.v) &&
                        !/per\b/i.test(cell.v)) {
                    totalcols.add(c);
                }
            }));
            rows.forEach((row, r) => {
                row = row || [];
                const label = row.find(cell => cell && typeof cell.v === 'string' && num(cell.v) === null);
                const totalrow = label && /\b(total|grand total|subtotal|sum)\b/i.test(label.v);
                row.forEach((cell, c) => {
                    const v = cell ? num(cell.v) : null;
                    if (v === null || !(totalcols.has(c) || totalrow)) {
                        return;
                    }
                    // A cell in a total column with other numbers in its row, or a number in a total row.
                    const others = row.map((x, k) => (k !== c && x ? num(x.v) : null)).filter(x => x !== null);
                    if (!totalrow && !others.length) {
                        return;
                    }
                    facts.totals++;
                    if (cell.f) {
                        facts.formulas++;
                    }
                    let ok = null;
                    if (!totalrow && others.length >= 2) {
                        const prod = others.reduce((a, b) => a * b, 1);
                        const sum = others.reduce((a, b) => a + b, 0);
                        ok = close(v, prod) || close(v, sum) || others.some((a, i) => others.some((b, j) => i !== j &&
                            close(v, a * b)));
                    } else if (totalrow) {
                        // A total adds the numbers above it: either the block of item rows above (stopping at a gap or an
                        // earlier total), or everything since an earlier total, that total included (Total + Contingency).
                        const isTotal = k => {
                            const lab = (rows[k] || []).find(x => x && typeof x.v === 'string' && num(x.v) === null);
                            return lab && /\b(total|grand total|subtotal|sum)\b/i.test(lab.v);
                        };
                        let block = 0;
                        let n = 0;
                        let since = 0;
                        let m = 0;
                        let stopped = false;
                        for (let k = r - 1; k >= 0; k--) {
                            const x = rows[k] && rows[k][c] ? num(rows[k][c].v) : null;
                            if (x === null) {
                                if (n || m) {
                                    break;
                                }
                                continue;
                            }
                            if (isTotal(k)) {
                                since += x;
                                m++;
                                break;
                            }
                            if (!stopped) {
                                block += x;
                                n++;
                            }
                            since += x;
                            m++;
                        }
                        ok = n >= 2 || m >= 2 ? (close(v, block) && n >= 2) || (close(v, since) && m >= 2) : null;
                    }
                    if (ok !== null) {
                        facts.checked++;
                        if (!ok) {
                            facts.wrong++;
                            facts.wrongcells.push({page: si + 1, ref: colName(c) + (r + 1), v: cell.v});
                        }
                    }
                });
            });
        });
        return facts;
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
