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
 * Pivot table: any field down the side, any field across the top, any measure in the cells.
 *
 * @module     local_fastgrade/report/pivot
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import {tip} from 'local_fastgrade/ui/tooltip';
import * as Model from 'local_fastgrade/report/model';
import * as C from 'local_fastgrade/report/charts';

/**
 * Work out the pivot.
 *
 * @param {Object} app
 * @returns {Object|null} {rdim, cdim, meas, rgroups, cgroups, cell(ri, ci), rtotal(ri), ctotal(ci), total}
 */
export const compute = app => {
    const p = app.state.pivot;
    const rdim = app.F.dims.find(d => d.key === p.rows) || app.F.dims[0];
    const cdim = p.cols ? app.F.dims.find(d => d.key === p.cols && d.key !== rdim.key) : null;
    const meas = app.F.measures.find(x => x.key === p.measure) || app.F.measures[0];
    const rows = app.current;
    const rgroups = Model.group(rows, rdim);
    const cgroups = cdim ? Model.group(rows, cdim) : [];
    const csets = cgroups.map(g => new Set(g.rows));
    return {
        rdim, cdim, meas, rgroups, cgroups,
        cell: (ri, ci) => meas.fn(rgroups[ri].rows.filter(r => csets[ci].has(r))),
        rtotal: ri => meas.fn(rgroups[ri].rows),
        ctotal: ci => meas.fn(cgroups[ci].rows),
        total: meas.fn(rows),
    };
};

/**
 * Plain data for exports.
 *
 * @param {Object} app
 * @returns {{columns: string[], rows: Array}}
 */
export const data = app => {
    const pv = compute(app);
    const f = v => (typeof v === 'number' && isFinite(v) ? Math.round(v * 1000) / 1000 : '');
    const columns = [pv.rdim.label + (pv.cdim ? ' / ' + pv.cdim.label : '')].concat(pv.cgroups.map(g => g.label), [t('rp_total')]);
    const rows = pv.rgroups.map((g, ri) => [g.label].concat(pv.cgroups.map((c, ci) => f(pv.cell(ri, ci))), [f(pv.rtotal(ri))]));
    rows.push([t('rp_total')].concat(pv.cgroups.map((c, ci) => f(pv.ctotal(ci))), [f(pv.total)]));
    return {columns, rows};
};

/**
 * A select.
 *
 * @param {string} label
 * @param {Array} options [[value, label]]
 * @param {string} value
 * @param {Function} onchange
 * @returns {HTMLElement}
 */
const select = (label, options, value, onchange) => h('label.fg-rp-pv-field', null, h('span', null, label),
    h('select.fg-select.is-small', {onchange: e => onchange(e.target.value)}, options.map(([v, l]) =>
        h('option', {value: v, selected: v === value}, l))));

/**
 * Render.
 *
 * @param {Object} ctx
 * @returns {HTMLElement}
 */
export const render = ctx => {
    const app = ctx.app;
    const p = app.state.pivot;
    const setp = changes => {
        app.state.pivot = Object.assign({}, p, changes);
        app.refresh();
    };
    const dims = app.F.dims.map(d => [d.key, d.label]);
    const controls = h('div.fg-rp-pv-controls', null,
        select(t('rp_pv_rows'), dims, p.rows, v => setp({rows: v})),
        tip(h('button.fg-icon-btn', {type: 'button', 'aria-label': t('rp_pv_swap'), disabled: !p.cols,
            onclick: () => setp({rows: p.cols, cols: p.rows})}, icon('rotate')), t('rp_pv_swap')),
        select(t('rp_pv_cols'), [['', t('rp_pv_none')]].concat(dims.filter(d => d[0] !== p.rows)), p.cols || '',
            v => setp({cols: v})),
        select(t('rp_pv_value'), app.F.measures.map(x => [x.key, x.label]), p.measure, v => setp({measure: v})),
        h('label.fg-check.fg-rp-pv-heat', null, h('input', {type: 'checkbox', checked: p.heat !== false,
            onchange: e => setp({heat: e.target.checked})}), h('span', null, t('rp_pv_heat'))));
    if (!ctx.rows.length) {
        return h('div.fg-rp-stack', null, controls, h('p.fg-muted', null, t('rp_nomatch')));
    }
    const pv = compute(app);
    const values = [];
    pv.rgroups.forEach((g, ri) => (pv.cdim ? pv.cgroups.map((c, ci) => pv.cell(ri, ci)) : [pv.rtotal(ri)])
        .forEach(v => (typeof v === 'number' ? values.push(v) : null)));
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const heat = v => {
        if (p.heat === false || typeof v !== 'number' || hi === lo) {
            return {};
        }
        let k = (v - lo) / (hi - lo);
        if (pv.meas.better === 'lower') {
            k = 1 - k;
        }
        return {"class": 'fg-rp-pv-h' + Math.round(k * 5)};
    };
    const drill = (rv, cv) => {
        const filters = {[pv.rdim.key]: [rv]};
        if (pv.cdim && cv !== undefined) {
            filters[pv.cdim.key] = [cv];
        }
        app.act({filters, tab: 'students'});
    };
    const cellEl = (v, rv, cv, extra = {}) => {
        const hc = heat(v);
        return h('td', Object.assign({"class": 'is-num ' + (hc.class || '') + (extra.total ? ' is-total' : '')}),
            rv === null ? pv.meas.format(v) : h('button.fg-rp-link', {type: 'button', onclick: () => drill(rv, cv)},
                pv.meas.format(v)));
    };
    const head = h('tr', null, h('th', {scope: 'col'}, pv.rdim.label + (pv.cdim ? ' ↓  ' + pv.cdim.label + ' →' : '')),
        pv.cgroups.map(c => h('th', {scope: 'col', "class": 'is-num'}, c.label)), h('th', {scope: 'col',
            "class": 'is-num is-total'},
            pv.cdim ? t('rp_total') : pv.meas.label));
    const body = pv.rgroups.map((g, ri) => h('tr', null, h('th', {scope: 'row'}, g.label),
        pv.cgroups.map((c, ci) => cellEl(pv.cell(ri, ci), g.value, c.value)),
        cellEl(pv.rtotal(ri), g.value, undefined, {total: !!pv.cdim})));
    const foot = h('tr.is-total', null, h('th', {scope: 'row'}, t('rp_total')),
        pv.cgroups.map((c, ci) => h('td', {"class": 'is-num is-total'}, pv.meas.format(pv.ctotal(ci)))),
        h('td', {"class": 'is-num is-total'}, pv.meas.format(pv.total)));
    const chart = !pv.cdim && pv.rgroups.length > 1 ? C.hbars(pv.rgroups.map((g, ri) => {
        const v = pv.rtotal(ri);
        return {label: g.label, value: typeof v === 'number' ? v : 0, display: pv.meas.format(v), sub: 'n=' + g.rows.length,
            onClick: () => drill(g.value)};
    }), {max: pv.meas.format(1) === '100%' ? 1 : undefined}) : null;
    return h('div.fg-rp-stack', null,
        h('section.fg-rp-sec', null,
            h('header.fg-rp-sec-head', null, h('h2', null, t('rp_tab_pivot')), h('p', null, t('rp_pv_sub'))),
            controls,
            h('div.fg-rp-tablewrap', null, h('table.fg-rp-table.fg-rp-pivot', null, h('thead', null, head), h('tbody', null, body,
                foot)))),
        chart ? h('section.fg-rp-sec', null, h('header.fg-rp-sec-head', null, h('h2', null, pv.meas.label + ' · ' + pv.rdim.label)),
            chart) : null);
};
