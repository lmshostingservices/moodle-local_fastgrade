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
 * The student table: every filtered row, with columns you can choose, sort and export.
 *
 * @module     local_fastgrade/report/table
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon, replace} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import {tip} from 'local_fastgrade/ui/tooltip';
import * as S from 'local_fastgrade/report/stats';
import * as C from 'local_fastgrade/report/charts';
import * as Model from 'local_fastgrade/report/model';
import {band, passPct} from 'local_fastgrade/report/tabs';

const PAGE = 100;
const DAY = 86400;

/**
 * Date and time, short.
 *
 * @param {number} ts
 * @returns {string}
 */
const when = ts => (ts ? new Date(ts * 1000).toLocaleString(undefined, {day: 'numeric', month: 'short', hour: 'numeric',
    minute: '2-digit'}) : '');

/**
 * Seconds as a short duration.
 *
 * @param {number|null} secs
 * @returns {string}
 */
const dur = secs => {
    if (secs === null || secs === undefined) {
        return '';
    }
    const d = secs / DAY;
    if (d >= 1) {
        return t('rp_ndays', S.fmt(d, 1));
    }
    return t('rp_nhours', S.fmt(secs / 3600, 1));
};

/**
 * All available columns.
 *
 * @param {Object} app
 * @returns {Array} [{key, label, value(r), text(r), node(r), num}]
 */
export const columns = app => {
    const meta = app.meta;
    const quiz = meta.kind === 'quiz';
    const markers = meta.markers || {};
    const groups = meta.groups || {};
    const cols = [];
    const col = (key, label, value, text = null, node = null, num = false) =>
        cols.push({key, label, value, text: text || (r => {
            const v = value(r);
            return v === null || v === undefined ? '' : String(v);
        }), node, num});
    col('name', t('rp_col_name'), r => r.sort, r => r.name);
    if (quiz) {
        col('question', t('rp_d_question'), r => r.slot, r => t('rp_qlabel', {n: r.slot, name: r.question}));
    }
    if (Object.keys(groups).length) {
        col('groups', t('rp_d_group'), r => r.groups.map(g => groups[g]).filter(Boolean).join(', '));
    }
    col('attempt', t('rp_d_attempt'), r => r.attempt, null, null, true);
    col('stage', t('rp_d_stage'), r => Model.STAGES.indexOf(Model.stage(r)), r => t('rp_stage_' + Model.stage(r)),
        r => h('span.fg-rp-stage', {"class": 'is-' + Model.stage(r)}, t('rp_stage_' + Model.stage(r))));
    col('submitted', quiz ? t('rp_col_finished') : t('rp_col_submitted'), r => r.submitted || null, r => when(r.submitted));
    if (!quiz) {
        col('late', t('rp_col_late'), r => r.late || 0, r => (r.late ? dur(r.late) : (r.ext ? t('rp_extension') : '')),
            r => (r.late ? h('span.fg-rp-late', null, dur(r.late)) : (r.ext ? h('span.fg-muted', null,
                t('rp_extension')) : '')), true);
    }
    col('marker', t('rp_d_marker'), r => (r.marker ? markers[r.marker] || '' : ''));
    col('grade', t('rp_col_grade'), r => r.grade, r => {
        if (r.grade === null) {
            return '';
        }
        if (!quiz && meta.scale && meta.scale.length) {
            return meta.scale[r.grade - 1] || String(r.grade);
        }
        return S.fmt(r.grade, 2) + ' / ' + S.fmt(quiz ? r.max : meta.maxgrade, 2);
    }, null, true);
    col('pct', t('rp_col_pct'), r => r.pct, r => (r.pct === null ? '' : S.fmt(r.pct, 1) + '%'), r => (r.pct === null ? '' :
        h('span.fg-rp-pctcell', null, h('i', {"class": band(r.pct, r.pct, passPct(meta)), style: {width: Math.max(0,
            Math.min(100, r.pct)) + '%'}}), S.fmt(r.pct, 0) + '%')),
    true);
    if (!quiz && (meta.gradepass > 0 || (meta.scale && meta.scale.length))) {
        col('outcome', t('rp_d_outcome'), r => {
            const [pf, label] = String(r.outcome || '').split('|');
            return label || (pf ? t('rp_outcome_' + pf) : '');
        });
    }
    col('gradedat', t('rp_col_gradedat'), r => r.gradedat || null, r => when(r.gradedat));
    col('turnaround', t('rp_col_turnaround'), r => r.turnaround, r => dur(r.turnaround), r => (r.turnaround === null ? '' :
        h('span', {"class": r.turnaround > meta.sla * DAY ? 'fg-rp-over' : ''}, dur(r.turnaround))), true);
    col('active', t('rp_col_active'), r => (r.active ? Math.round(r.active / 6) / 10 : null), r => (r.active ?
        t('rp_nmin', S.fmt(r.active / 60, 1)) : ''), null, true);
    col('ann', t('rp_col_ann'), r => r.ann.total, null, null, true);
    col('pos', t('pol_positive'), r => r.ann.positive, null, r => (r.ann.positive ? h('span.fg-rp-pos', null,
        String(r.ann.positive)) : '0'), true);
    col('imp', t('pol_improvement'), r => r.ann.improvement, null, r => (r.ann.improvement ? h('span.fg-rp-imp', null,
        String(r.ann.improvement)) : '0'), true);
    col('voice', t('rp_src_voice'), r => r.ann.voice, null, null, true);
    col('fbwords', t('rp_col_fbwords'), r => r.fbwords, null, null, true);
    if (quiz) {
        col('words', t('rp_col_words'), r => r.words, null, null, true);
    }
    (quiz ? [] : meta.criteria || []).forEach((c, i) => {
        const lab = 'C' + (i + 1);
        if (c.levels && c.levels.length) {
            col('c' + c.id, lab, r => (r.levels[c.id] === undefined ? null : r.levels[c.id]), r => {
                const li = r.levels[c.id];
                return li === undefined ? '' : `${S.fmt(c.levels[li].score)} ${c.levels[li].name}`;
            }, r => {
                const li = r.levels[c.id];
                return li === undefined ? '' : tip(h('span.fg-rp-lvcell', {"class": 'fg-lv-' + C.step(li, c.levels.length)},
                    S.fmt(c.levels[li].score)), c.levels[li].name);
            }, true);
        } else {
            col('c' + c.id, lab, r => (r.scores[c.id] === undefined ? null : r.scores[c.id]), null, null, true);
        }
        cols[cols.length - 1].help = c.name;
    });
    col('autogap', t('rp_col_autogap'), r => {
        const a = Model.autoPct(r, meta);
        return a === null || r.pct === null ? null : Math.round((r.pct - a) * 10) / 10;
    }, r => {
        const a = Model.autoPct(r, meta);
        return a === null || r.pct === null ? '' : ((r.pct - a > 0 ? '+' : '') + S.fmt(r.pct - a, 1));
    }, null, true);
    if (meta.hasEg) {
        col('eg', t('rp_d_eg'), r => ({high: 3, medium: 2, low: 1}[r.eg] || 0), r => (r.eg ? t('rp_risk_' + r.eg) +
            (r.egscore !== null ? ' ' + r.egscore : '') : ''), r => (r.eg ? h('span', {"class": 'fg-rp-risk is-' + r.eg},
            t('rp_risk_' + r.eg)) : ''));
    }
    if (meta.hasDg) {
        col('dg', t('rp_d_dg'), r => ({high: 3, medium: 2, low: 1}[r.dg] || 0), r => (r.dg ? t('rp_risk_' + r.dg) +
            (r.dgscore !== null ? ' ' + r.dgscore : '') : ''), r => (r.dg ? h('span', {"class": 'fg-rp-risk is-' + r.dg},
            t('rp_risk_' + r.dg)) : ''));
    }
    return cols;
};

/**
 * Columns shown when no view says otherwise.
 *
 * @param {Object} app
 * @returns {string[]}
 */
export const defaultColumns = app => {
    const want = ['name', 'question', 'stage', 'submitted', 'late', 'marker', 'pct', 'outcome', 'turnaround', 'ann', 'pos', 'imp',
        'eg', 'dg'];
    const crit = app.meta.kind === 'quiz' ? [] : (app.meta.criteria || []).slice(0, 6).map(c => 'c' + c.id);
    const have = columns(app).map(c => c.key);
    return want.concat(crit).filter(k => have.includes(k));
};

/**
 * Sorted rows.
 *
 * @param {Object} app
 * @param {Array} rows
 * @param {Array} cols
 * @returns {Array}
 */
export const sorted = (app, rows, cols) => {
    const sort = app.state.sort || {key: 'name', dir: 1};
    const c = cols.find(x => x.key === sort.key) || cols[0];
    return rows.slice().sort((a, b) => {
        const x = c.value(a);
        const y = c.value(b);
        if (x === y) {
            return 0;
        }
        if (x === null || x === undefined || x === '') {
            return 1;
        }
        if (y === null || y === undefined || y === '') {
            return -1;
        }
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined,
            {numeric: true})) * sort.dir;
    });
};

/**
 * The visible table as plain data (for exports).
 *
 * @param {Object} app
 * @returns {{columns: string[], rows: Array}}
 */
export const data = app => {
    const all = columns(app);
    const cols = (app.state.columns || defaultColumns(app)).map(k => all.find(c => c.key === k)).filter(Boolean);
    return {
        columns: cols.map(c => (c.help ? `${c.label} ${c.help}` : c.label)),
        rows: sorted(app, app.current, all).map(r => cols.map(c => {
            const v = c.num ? c.value(r) : null;
            const raw = c.num && typeof v === 'number' && !['grade', 'turnaround', 'late'].includes(c.key);
            return raw ? v : c.text(r);
        })),
    };
};

/**
 * Pick columns.
 *
 * @param {Object} app
 * @param {HTMLElement} anchor
 */
const chooser = (app, anchor) => {
    const all = columns(app);
    const chosen = new Set(app.state.columns || defaultColumns(app));
    const boxes = all.map(c => h('label.fg-rp-check', null, h('input', {type: 'checkbox', value: c.key, checked: chosen.has(c.key),
        disabled: c.key === 'name'}), h('span', null, c.label, c.help ? h('small', null, ' ' + c.help.slice(0, 40)) : null)));
    app.popover(anchor, h('div.fg-rp-pop-in', null, h('div.fg-rp-pop-title', null, t('rp_columns')),
        h('div.fg-rp-checks.is-tall', null, boxes),
        h('div.fg-rp-pop-foot', null,
            h('button.fg-btn.is-ghost.is-small', {type: 'button', onclick: () => {
                app.state.columns = defaultColumns(app);
                app.closePopover();
                app.refresh();
            }}, t('rp_resetcolumns')),
            h('span.fg-grow'),
            h('button.fg-btn.is-primary.is-small', {type: 'button', onclick: () => {
                const keys = [...app.closestPop().querySelectorAll('input:checked')].map(i => i.value);
                app.state.columns = all.map(c => c.key).filter(k => k === 'name' || keys.includes(k));
                app.closePopover();
                app.refresh();
            }}, t('rp_apply')))));
};

/**
 * Render the table.
 *
 * @param {Object} ctx
 * @returns {HTMLElement}
 */
export const render = ctx => {
    const app = ctx.app;
    const all = columns(app);
    const cols = (app.state.columns || defaultColumns(app)).map(k => all.find(c => c.key === k)).filter(Boolean);
    const rows = sorted(app, ctx.rows, all);
    let page = 0;
    const tbody = h('tbody');
    const pager = h('div.fg-rp-pager');
    const open = r => {
        if (app.boot.cangrade) {
            window.open(app.meta.graderurl + '&userid=' + r.uid + (r.slot ? '&slot=' + r.slot : ''), '_blank');
        }
    };
    const draw = () => {
        const slice = rows.slice(page * PAGE, (page + 1) * PAGE);
        tbody.replaceChildren(...slice.map(r => h('tr', {"class": app.boot.cangrade ? 'is-click' : '', tabindex: app.boot.cangrade ?
            0 : null, onclick: () => open(r), onkeydown: e => (e.key === 'Enter' ? open(r) : null)},
        cols.map(c => h('td', {"class": c.num ? 'is-num' : ''}, c.node ? c.node(r) : c.text(r))))));
        const pages = Math.ceil(rows.length / PAGE);
        replace(pager, pages > 1 ? [
            h('button.fg-btn.is-small.is-ghost', {type: 'button', disabled: page === 0, onclick: () => {
                page--;
                draw();
            }}, icon('left', 'fg-i-sm')),
            h('span', null, t('rp_page', {page: page + 1, pages})),
            h('button.fg-btn.is-small.is-ghost', {type: 'button', disabled: page >= pages - 1, onclick: () => {
                page++;
                draw();
            }}, icon('right', 'fg-i-sm'))] : null);
    };
    const sort = app.state.sort || {key: 'name', dir: 1};
    const head = h('tr', null, cols.map(c => {
        const on = sort.key === c.key;
        const th = h('th', {scope: 'col', "class": c.num ? 'is-num' : '', 'aria-sort': on ? (sort.dir > 0 ? 'ascending' :
            'descending') : 'none'}, h('button.fg-rp-th', {type: 'button', onclick: () => {
            app.state.sort = {key: c.key, dir: on ? -sort.dir : (c.num ? -1 : 1)};
            app.refresh();
        }}, c.label, icon(on ? (sort.dir > 0 ? 'up' : 'down') : 'sort', 'fg-i-xs')));
        return c.help ? tip(th, c.help) : th;
    }));
    draw();
    return h('div.fg-rp-stack', null,
        h('div.fg-rp-tabletools', null,
            h('p.fg-small.fg-muted', null, app.boot.cangrade ? t('rp_table_hint') : t('rp_table_hint_ro')),
            h('span.fg-grow'),
            tip(h('button.fg-btn.is-small.is-ghost', {type: 'button', onclick: e => chooser(app, e.currentTarget)},
                icon('list', 'fg-i-sm'), h('span', null, t('rp_columns'))), t('rp_columns_tip'))),
        h('div.fg-rp-tablewrap.is-main', null, h('table.fg-rp-table.is-students', null,
            h('thead', null, head), tbody)),
        pager);
};
