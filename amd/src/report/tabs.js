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
 * Report sections: overview, criteria, questions, markers, feedback, auto-marking, integrity, workload.
 *
 * @module     local_fastgrade/report/tabs
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import {tip} from 'local_fastgrade/ui/tooltip';
import * as S from 'local_fastgrade/report/stats';
import * as C from 'local_fastgrade/report/charts';
import * as Model from 'local_fastgrade/report/model';
import * as Insights from 'local_fastgrade/report/insights';

const DAY = 86400;

/* ---------- Building blocks ---------- */

/**
 * A titled section.
 *
 * @param {string} title
 * @param {string|null} sub
 * @param {...*} children
 * @returns {HTMLElement}
 */
export const section = (title, sub, ...children) => h('section.fg-rp-sec', null,
    h('header.fg-rp-sec-head', null, h('h2', null, title), sub ? h('p', null, sub) : null), ...children);

/**
 * A headline number.
 *
 * @param {string} label
 * @param {string} value
 * @param {Object} opts {sub, tone, spark, help, onClick}
 * @returns {HTMLElement}
 */
export const kpi = (label, value, opts = {}) => {
    const el = h(opts.onClick ? 'button.fg-rp-kpi' : 'div.fg-rp-kpi', {type: opts.onClick ? 'button' : null,
        "class": opts.tone ? 'is-' + opts.tone : '', onclick: opts.onClick || null},
    h('span.fg-rp-kpi-label', null, label),
    h('span.fg-rp-kpi-value', null, value),
    opts.sub ? h('span.fg-rp-kpi-sub', null, opts.sub) : null,
    opts.spark ? C.spark(opts.spark) : null);
    return opts.help ? tip(el, opts.help) : el;
};

/**
 * A simple sortable table.
 *
 * @param {Array} cols [{label, num, help}]
 * @param {Array} rows arrays of cells: string | {v, d, cls, onClick}
 * @param {Object} opts {caption, sort}
 * @returns {HTMLElement}
 */
export const table = (cols, rows, opts = {}) => {
    let sortcol = opts.sort ?? -1;
    let dir = -1;
    const tbody = h('tbody');
    const val = c => (c && typeof c === 'object' && !(c instanceof Node) ? c.v : c);
    const draw = () => {
        const list = rows.slice();
        if (sortcol >= 0) {
            list.sort((a, b) => {
                const x = val(a[sortcol]);
                const y = val(b[sortcol]);
                if (x === y) {
                    return 0;
                }
                if (x === null || x === undefined || x === '') {
                    return 1;
                }
                if (y === null || y === undefined || y === '') {
                    return -1;
                }
                return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir;
            });
        }
        tbody.replaceChildren(...list.map(r => h('tr', null, r.map((c, i) => {
            const o = c && typeof c === 'object' && !(c instanceof Node) ? c : {d: c};
            const content = o.d instanceof Node ? o.d : String(o.d ?? (o.v ?? ''));
            return h('td', {"class": (cols[i].num ? 'is-num ' : '') + (o.cls || '')},
                o.onClick ? h('button.fg-rp-link', {type: 'button', onclick: o.onClick}, content) : content);
        }))));
    };
    const ths = cols.map((c, i) => {
        const th = h('th', {scope: 'col', "class": c.num ? 'is-num' : '', 'aria-sort': 'none'},
            h('button.fg-rp-th', {type: 'button', onclick: () => {
                dir = sortcol === i ? -dir : (c.num ? -1 : 1);
                sortcol = i;
                ths.forEach(x => x.setAttribute('aria-sort', 'none'));
                th.setAttribute('aria-sort', dir > 0 ? 'ascending' : 'descending');
                draw();
            }}, c.label, icon('sort', 'fg-i-xs')));
        return c.help ? tip(th, c.help) : th;
    });
    draw();
    return h('div.fg-rp-tablewrap', null, h('table.fg-rp-table', null,
        opts.caption ? h('caption', null, opts.caption) : null, h('thead', null, h('tr', null, ths)), tbody));
};

/**
 * Note shown when a group is too small to compare fairly.
 *
 * @param {number} n
 * @param {number} min
 * @returns {HTMLElement|null}
 */
const small = (n, min) => (n < min ? tip(h('span.fg-rp-smalln', null, icon('info', 'fg-i-xs'), 'n=' + n), t('rp_smalln',
    min)) : null);

/**
 * Empty state.
 *
 * @param {string} text
 * @returns {HTMLElement}
 */
export const empty = text => h('div.fg-rp-empty', null, icon('sparkle', 'fg-i-xl'), h('p', null, text));

/**
 * Insight cards.
 *
 * @param {Object} ctx
 * @param {number} limit
 * @returns {HTMLElement}
 */
const notes = (ctx, limit = 8) => {
    const list = Insights.find(ctx);
    if (!list.length) {
        return h('div.fg-rp-notes', null, h('p.fg-rp-note-none', null, t('rp_noinsights')));
    }
    return h('div.fg-rp-notes', {role: 'list'}, list.slice(0, limit).map(n => h('article.fg-rp-note', {role: 'listitem',
        "class": 'is-' + n.tone},
    h('div.fg-rp-note-head', null, icon(n.tone === 'positive' ? 'check' : (n.tone === 'improvement' ? 'up' : 'info'), 'fg-i-sm'),
        h('strong', null, n.title)),
    h('p', null, n.text),
    n.action ? h('button.fg-btn.is-small.is-ghost', {type: 'button', onclick: () => ctx.app.act(n.action)}, n.action.label,
        icon('right', 'fg-i-xs')) : null)));
};

/**
 * A measure by key.
 *
 * @param {Object} ctx
 * @param {string} key
 * @param {Array} rows
 * @returns {{v: *, d: string}}
 */
const m = (ctx, key, rows) => {
    const def = ctx.F.measures.find(x => x.key === key);
    if (!def) {
        return {v: null, d: '–'};
    }
    const v = def.fn(rows);
    return {v, d: def.format(v)};
};

/**
 * Rows per marker.
 *
 * @param {Array} rows
 * @returns {Map}
 */
const byMarker = rows => {
    const out = new Map();
    rows.filter(r => r.graded && r.marker).forEach(r => out.set(r.marker, (out.get(r.marker) || []).concat([r])));
    return out;
};

/* ---------- Overview ---------- */

/**
 * The marking pipeline: everyone in the activity, by stage.
 *
 * @param {Object} ctx
 * @returns {HTMLElement}
 */
const pipeline = ctx => {
    const counts = Model.STAGES.map(s => ({s, n: ctx.rows.filter(r => Model.stage(r) === s).length})).filter(x => x.n);
    const total = counts.reduce((a, b) => a + b.n, 0) || 1;
    return h('div.fg-rp-pipe', {role: 'list', 'aria-label': t('rp_pipeline')}, counts.map(x => tip(h('button.fg-rp-pipe-seg', {
        type: 'button', role: 'listitem', "class": 'is-' + x.s, style: {flexGrow: Math.max(x.n, total * 0.08)},
        onclick: () => ctx.app.act({filters: {stage: [x.s]}, tab: 'students'})},
    h('span.fg-rp-pipe-n', null, String(x.n)), h('span.fg-rp-pipe-l', null, t('rp_stage_' + x.s))),
    t('rp_pipe_tip', {n: x.n, stage: t('rp_stage_' + x.s), pct: Math.round(100 * x.n / total)}))));
};

/**
 * Marked per day, last 30 days, for a sparkline.
 *
 * @param {Array} rows
 * @returns {number[]}
 */
const perDay = rows => {
    const now = Math.floor(Date.now() / 1000 / DAY);
    const out = new Array(30).fill(0);
    rows.forEach(r => {
        if (r.gradedat) {
            const d = now - Math.floor(r.gradedat / DAY);
            if (d >= 0 && d < 30) {
                out[29 - d]++;
            }
        }
    });
    return out;
};

/**
 * The pass mark as a percentage (the gradebook's grade to pass, or 50%).
 *
 * @param {Object} meta
 * @returns {number}
 */
export const passPct = meta => (meta.gradepass > 0 && meta.maxgrade > 0 ? 100 * meta.gradepass / meta.maxgrade : 50);

/**
 * Traffic-light class for a grade band: below the pass mark red, just above it amber, comfortably above green.
 *
 * @param {number} from
 * @param {number} to
 * @param {number} pass
 * @returns {string}
 */
export const band = (from, to, pass) => (to <= pass ? 'is-tl-red' : (from < pass + 15 ? 'is-tl-amber' : 'is-tl-green'));

/**
 * Grade histogram (10% bands), clickable.
 *
 * @param {Object} ctx
 * @param {Array} rows
 * @param {boolean|string} half true for a half-width chart, 'aside' beside the notes column
 * @returns {HTMLElement}
 */
const gradeChart = (ctx, rows, half = false) => {
    const size = half === 'aside' ? {aside: true} : {half};
    const g = rows.filter(r => r.graded && r.pct !== null);
    if (!g.length) {
        return empty(t('rp_nomarksyet'));
    }
    const b = S.bins(g.map(r => r.pct), 0, 100, 10);
    const pass = passPct(ctx.meta);
    return C.columns(b.map((x, i) => ({label: i === 9 ? '90+' : String(i * 10), value: x.count, cls: band(x.from, x.to, pass),
        tip: t('rp_band_tip', {from: Math.round(x.from), to: i === 9 ? 100 : Math.round(x.to) - 1, n: x.count}),
        onClick: () => {
            ctx.app.state.ranges.pct = [Math.round(x.from), i === 9 ? 100 : Math.round(x.to) - 0.01];
            ctx.app.act({tab: 'students'});
        }})), Object.assign({label: t('rp_gradedist')}, size));
};

/**
 * Overview.
 *
 * @param {Object} ctx
 * @returns {HTMLElement}
 */
const overview = ctx => {
    const {rows, meta} = ctx;
    const quiz = meta.kind === 'quiz';
    const graded = rows.filter(r => r.graded);
    const submitted = rows.filter(r => Model.stage(r) !== 'notsubmitted');
    const turn = m(ctx, 'turnmed', rows);
    const tiles = [
        kpi(t('rp_k_marked'), `${graded.length} / ${submitted.length}`, {sub: t('rp_k_marked_sub',
            rows.filter(r => Model.stage(r) === 'waiting').length), spark: perDay(rows), help: t('rp_k_marked_help'),
        onClick: () => ctx.app.act({filters: {stage: ['waiting']}, tab: 'students'})}),
        kpi(t('rp_k_turn'), turn.d, {sub: t('rp_k_turn_sub', meta.sla), tone: turn.v === null ? '' :
            (turn.v <= meta.sla ? 'good' : 'warn'), help: t('rp_k_turn_help')}),
        kpi(quiz ? t('rp_k_facility') : t('rp_k_mean'), m(ctx, 'meanpct', rows).d, {sub: t('rp_k_mean_sub',
            {median: m(ctx, 'medianpct', rows).d, sd: m(ctx, 'sdpct', rows).d}),
                help: t(quiz ? 'rp_k_facility_help' : 'rp_k_mean_help')}),
    ];
    if (!quiz && meta.gradepass > 0) {
        tiles.push(kpi(t('rp_k_pass'), m(ctx, 'passrate', rows).d, {sub: t('rp_k_pass_sub', meta.gradepass),
            help: t('rp_k_pass_help')}));
    } else if (!quiz) {
        tiles.push(kpi(t('rp_k_late'), m(ctx, 'latepct', rows).d, {sub: t('rp_k_late_sub',
            rows.filter(r => r.ext).length), help: t('rp_k_late_help')}));
    }
    const bal = m(ctx, 'posshare', rows);
    tiles.push(kpi(t('rp_k_balance'), bal.d, {sub: t('rp_k_balance_sub', m(ctx, 'annper', rows).d), tone: bal.v === null ? '' :
        (bal.v >= 0.3 ? 'good' : (bal.v < 0.2 ? 'warn' : '')), help: t('rp_k_balance_help')}));

    const main = h('div.fg-rp-grid-main', null,
        section(t('rp_gradedist'), t(quiz ? 'rp_gradedist_sub_quiz' : 'rp_gradedist_sub'), gradeChart(ctx, rows, 'aside'),
            attemptsNote(ctx)),
        quiz ? section(t('rp_tab_questions'), t('rp_questions_sub'), questionSummary(ctx)) :
            ((meta.criteria || []).length ? section(t('rp_tab_criteria'), t('rp_criteria_sub'), ladders(ctx, true)) : null));
    return h('div.fg-rp-overview', null,
        h('div.fg-rp-hero', null, pipeline(ctx)),
        h('div.fg-rp-kpis', null, tiles),
        h('div.fg-rp-split', null, main,
            h('aside.fg-rp-aside', {'aria-label': t('rp_insights')},
                h('h2.fg-rp-aside-title', null, t('rp_insights')),
                h('p.fg-rp-aside-sub', null, t('rp_insights_sub')),
                notes(ctx))));
};

/**
 * First attempt against latest, when students have resubmitted.
 *
 * @param {Object} ctx
 * @returns {HTMLElement|null}
 */
const attemptsNote = ctx => {
    const multi = ctx.all.filter(r => r.attempts > 1 && r.graded);
    if (!multi.length) {
        return null;
    }
    const first = S.mean(multi.filter(r => r.attempt === 1).map(r => r.pct));
    const last = S.mean(multi.filter(r => r.latest).map(r => r.pct));
    if (first === null || last === null) {
        return null;
    }
    return h('p.fg-rp-footnote', null, icon('rotate', 'fg-i-xs'), t('rp_resubmitted', {n: new Set(multi.map(r => r.uid)).size,
        first: S.fmt(first, 0), last: S.fmt(last, 0)}));
};

/* ---------- Criteria ---------- */

/**
 * Level legend for a criterion.
 *
 * @param {Object} c
 * @returns {HTMLElement}
 */
const legend = c => h('div.fg-rp-legend', null, c.levels.map((l, i) => h('span', null,
    h('i', {"class": 'fg-lv-' + C.step(i, c.levels.length)}),
        `${S.fmt(l.score)} · ${l.name.length > 32 ? l.name.slice(0, 30) + '…' :
        l.name}`)));

/**
 * One ladder per criterion.
 *
 * @param {Object} ctx
 * @param {boolean} compact
 * @returns {HTMLElement}
 */
const ladders = (ctx, compact = false) => {
    const {rows, meta} = ctx;
    const graded = rows.filter(r => r.graded);
    return h('div.fg-rp-ladders', null, (meta.criteria || []).map((c, ci) => {
        const name = t('rp_critn', {n: ci + 1, name: c.name});
        if (c.levels && c.levels.length) {
            const marked = graded.filter(r => r.levels[c.id] !== undefined);
            const segs = c.levels.map((l, li) => ({label: `${S.fmt(l.score)} · ${l.name}`,
                count: marked.filter(r => r.levels[c.id] === li).length,
                step: C.step(li, c.levels.length),
                onClick: () => ctx.app.act({filters: {['c' + c.id]: ['l' + li]}, tab: 'students'})}));
            const vals = marked.map(r => c.levels[r.levels[c.id]].score);
            const md = S.mode(marked.map(r => r.levels[c.id]));
            const r = marked.length >= 10 ? S.corr(marked.map(x => x.levels[c.id]), marked.map(x => x.pct)) : null;
            const flags = [];
            const low = S.share(marked, x => x.levels[c.id] === 0);
            const top = S.share(marked, x => x.levels[c.id] === c.levels.length - 1);
            if (marked.length >= 5 && low >= 0.4) {
                flags.push(tip(h('span.fg-rp-flag.is-improvement', null, icon('up', 'fg-i-xs'), t('rp_flag_low')),
                    t('rp_flag_low_tip')));
            }
            if (marked.length >= 5 && top >= 0.85) {
                flags.push(tip(h('span.fg-rp-flag.is-info', null, icon('info', 'fg-i-xs'), t('rp_flag_ceiling')),
                    t('rp_flag_ceiling_tip')));
            }
            if (r !== null && r < 0.2) {
                flags.push(tip(h('span.fg-rp-flag.is-info', null, icon('info', 'fg-i-xs'), t('rp_flag_corr')),
                    t('rp_flag_corr_tip')));
            }
            return h('div.fg-rp-crit', null,
                h('div.fg-rp-crit-head', null, h('h3', null, name), flags),
                marked.length ? C.ladder(segs, {label: name}) : h('p.fg-small.fg-muted', null, t('rp_nomarksyet')),
                compact ? null : h('div.fg-rp-crit-stats', null,
                    h('span', null, t('rp_cs_mean'), h('b', null, S.fmt(S.mean(vals), 1))),
                    h('span', null, t('rp_cs_mode'), h('b', null, md === null ? '–' : S.clip(c.levels[md].name, 42))),
                    h('span', null, t('rp_cs_sd'), h('b', null, S.fmt(S.sd(vals), 1))),
                    tip(h('span', null, t('rp_cs_corr'), h('b', null, r === null ? '–' : S.fmt(r, 2))), t('rp_cs_corr_help')),
                    h('span', null, t('rp_cs_n'), h('b', null, String(marked.length))),
                    legend(c)));
        }
        // Marking guide: score spread.
        const marked = graded.filter(r => r.scores[c.id] !== undefined);
        const vals = marked.map(r => r.scores[c.id]);
        const b = S.bins(vals, 0, c.max || 1, 4);
        const segs = b.map((x, i) => ({label: `${S.fmt(x.from)}–${S.fmt(x.to)}`, count: x.count, step: C.step(i, 4)}));
        return h('div.fg-rp-crit', null, h('div.fg-rp-crit-head', null, h('h3', null, name)),
            marked.length ? C.ladder(segs, {label: name}) : h('p.fg-small.fg-muted', null, t('rp_nomarksyet')),
            h('div.fg-rp-crit-stats', null,
                h('span', null, t('rp_cs_mean'), h('b', null, `${S.fmt(S.mean(vals), 1)} / ${S.fmt(c.max)}`)),
                h('span', null, t('rp_cs_sd'), h('b', null, S.fmt(S.sd(vals), 1))),
                h('span', null, t('rp_cs_n'), h('b', null, String(marked.length)))));
    }));
};

/**
 * Criterion by marker: how far each marker's average level sits from everyone's.
 *
 * @param {Object} ctx
 * @returns {HTMLElement|null}
 */
const critByMarker = ctx => {
    const {meta} = ctx;
    const crits = (meta.criteria || []).filter(c => c.levels && c.levels.length);
    const bym = byMarker(ctx.rows);
    if (bym.size < 2 || !crits.length) {
        return null;
    }
    const all = ctx.rows.filter(r => r.graded);
    const cohort = crits.map(c => S.mean(all.map(r => r.levels[c.id] === undefined ? null :
        r.levels[c.id] / (c.levels.length - 1))));
    const head = h('tr', null, h('th', {scope: 'col'}, t('rp_d_marker')), crits.map((c, i) => tip(h('th', {scope: 'col',
        "class": 'is-num'}, 'C' + (i + 1)), c.name)), h('th', {scope: 'col', "class": 'is-num'}, 'n'));
    const body = [...bym.entries()].map(([id, mine]) => h('tr', null,
        h('th', {scope: 'row'}, (meta.markers || {})[id] || t('rp_unknown')),
        crits.map((c, i) => {
            const v = S.mean(mine.map(r => r.levels[c.id] === undefined ? null : r.levels[c.id] / (c.levels.length - 1)));
            const d = v === null || cohort[i] === null ? null : v - cohort[i];
            const cls = d === null ? '' : (d > 0.12 ? 'is-up2' : d > 0.05 ? 'is-up1' : d < -0.12 ? 'is-down2' : d < -0.05 ?
                'is-down1' : 'is-even');
            return tip(h('td', {"class": 'is-num fg-rp-heat ' + cls}, d === null ? '–' : (d > 0 ? '+' : '') + Math.round(d * 100)),
                t('rp_heat_tip', {name: c.name, pts: d === null ? '–' : Math.round(d * 100)}));
        }),
        h('td', {"class": 'is-num'}, String(mine.length), small(mine.length, ctx.boot.minmarkern))));
    return section(t('rp_heat_title'), t('rp_heat_sub'), h('div.fg-rp-tablewrap', null,
        h('table.fg-rp-table.fg-rp-heattable', null, h('thead', null, head), h('tbody', null, body))),
    h('div.fg-rp-heat-legend', null, h('span.is-down2', null, t('rp_heat_lower')), h('span.is-even', null, t('rp_heat_even')),
        h('span.is-up2', null, t('rp_heat_higher'))));
};

/**
 * Criteria tab.
 *
 * @param {Object} ctx
 * @returns {HTMLElement}
 */
const criteria = ctx => h('div.fg-rp-stack', null,
    section(t('rp_tab_criteria'), t('rp_criteria_long'), ladders(ctx)),
    critByMarker(ctx));

/* ---------- Quiz questions ---------- */

/**
 * Key points the auto-marker looked for, with how often each was found.
 *
 * @param {Array} rows
 * @returns {Array} [{point, covered, partial, missing, n}]
 */
const pointCoverage = rows => {
    const map = new Map();
    rows.forEach(r => ((r.auto && r.auto.points) || []).forEach(p => {
        const k = p.point;
        if (!map.has(k)) {
            map.set(k, {point: k, covered: 0, partial: 0, missing: 0, n: 0});
        }
        const e = map.get(k);
        e[p.status] = (e[p.status] || 0) + 1;
        e.n++;
    }));
    return [...map.values()].sort((a, b) => (a.covered / a.n) - (b.covered / b.n));
};

/**
 * Key point coverage block.
 *
 * @param {Array} rows
 * @returns {HTMLElement|null}
 */
const coverageBlock = rows => {
    const cov = pointCoverage(rows);
    if (!cov.length) {
        return null;
    }
    return h('div.fg-rp-cover', null, h('h3', null, t('rp_cov_title')), h('p.fg-small.fg-muted', null, t('rp_cov_sub')),
        cov.slice(0, 12).map(p => h('div.fg-rp-cover-row', null,
            h('span.fg-rp-cover-point', null, p.point),
            C.ladder([{label: t('cov_missing'), count: p.missing, step: 0, cls: 'is-miss'},
                {label: t('cov_partial'), count: p.partial, step: 2}, {label: t('cov_covered'), count: p.covered, step: 5}],
            {label: p.point}))));
};

/**
 * Compact per-question summary for the overview.
 *
 * @param {Object} ctx
 * @returns {HTMLElement}
 */
const questionSummary = ctx => {
    const {rows, meta} = ctx;
    return table([{label: t('rp_d_question')}, {label: t('rp_q_marked'), num: true}, {label: t('rp_q_waiting'), num: true},
        {label: t('rp_q_facility'), num: true, help: t('rp_q_facility_help')},
        {label: t('rp_q_disc'), num: true, help: t('rp_q_disc_help')}],
    (meta.slots || []).map(sl => {
        const mine = rows.filter(r => r.slot === sl.slot);
        const g = mine.filter(r => r.graded);
        const fac = S.mean(g.map(r => r.pct));
        const disc = g.length >= 5 ? S.corr(g.map(r => r.grade), g.map(r => r.rest)) : null;
        return [{v: sl.slot, d: t('rp_qlabel', {n: sl.slot, name: sl.name}), onClick: () => ctx.app.act({filters:
            {question: [String(sl.slot)]}, tab: 'questions'})}, {v: g.length, d: String(g.length)},
        {v: mine.length - g.length, d: String(mine.length - g.length)}, {v: fac, d: fac === null ? '–' : S.fmt(fac, 0) + '%'},
        {v: disc, d: disc === null ? '–' : S.fmt(disc, 2), cls: disc === null ? '' : (disc < 0.1 ? 'is-warn' : disc >= 0.3 ?
            'is-good' : '')}];
    }), {sort: 0});
};

/**
 * Questions tab (quiz).
 *
 * @param {Object} ctx
 * @returns {HTMLElement}
 */
const questions = ctx => {
    const {rows, meta} = ctx;
    return h('div.fg-rp-stack', null, (meta.slots || []).map(sl => {
        const mine = rows.filter(r => r.slot === sl.slot);
        if (!mine.length) {
            return null;
        }
        const g = mine.filter(r => r.graded);
        const fac = S.mean(g.map(r => r.pct));
        const disc = g.length >= 5 ? S.corr(g.map(r => r.grade), g.map(r => r.rest)) : null;
        const variants = new Map();
        g.forEach(r => variants.set(r.questionid, (variants.get(r.questionid) || []).concat([r])));
        return section(t('rp_qlabel', {n: sl.slot, name: sl.name}), t('rp_q_sub', {max: S.fmt(sl.maxmark)}),
            h('div.fg-rp-kpis.is-small', null,
                kpi(t('rp_q_marked'), `${g.length} / ${mine.length}`),
                kpi(t('rp_q_facility'), fac === null ? '–' : S.fmt(fac, 0) + '%', {help: t('rp_q_facility_help'),
                    tone: fac === null ? '' : (fac < 30 || fac > 90 ? 'warn' : '')}),
                kpi(t('rp_q_sd'), S.fmt(S.sd(g.map(r => r.pct)), 0) + '%'),
                kpi(t('rp_q_disc'), disc === null ? '–' : S.fmt(disc, 2), {help: t('rp_q_disc_help'),
                    tone: disc === null ? '' : (disc < 0.1 ? 'warn' : disc >= 0.3 ? 'good' : '')}),
                kpi(t('rp_q_words'), S.fmt(S.median(mine.map(r => r.words)), 0), {help: t('rp_q_words_help')}),
                kpi(t('rp_q_wait'), m(ctx, 'turnmed', mine).d)),
            h('div.fg-rp-two', null, h('div', null, h('h3', null, t('rp_gradedist')), gradeChart(ctx, mine, true)),
                h('div', null, coverageBlock(mine) || h('p.fg-small.fg-muted', null, t('rp_cov_none')))),
            variants.size > 1 ? h('div', null, h('h3', null, t('rp_variants')), C.hbars([...variants.entries()].map(([qid, vr]) =>
                ({label: vr[0].question || String(qid), value: S.mean(vr.map(r => r.pct)) || 0,
                    display: S.fmt(S.mean(vr.map(r => r.pct)), 0) + '%', sub: 'n=' + vr.length})), {max: 100})) : null);
    }));
};

/* ---------- Markers ---------- */

/**
 * Markers tab.
 *
 * @param {Object} ctx
 * @returns {HTMLElement}
 */
const markers = ctx => {
    const {rows, meta, boot} = ctx;
    const bym = byMarker(rows);
    if (!bym.size) {
        return empty(t('rp_nomarksyet'));
    }
    const all = rows.filter(r => r.graded);
    const ids = [...bym.keys()].sort((a, b) => bym.get(b).length - bym.get(a).length);
    const name = id => (meta.markers || {})[id] || t('rp_unknown');
    const groups = ids.map(id => ({label: name(id), values: bym.get(id).map(r => r.pct), sub: 'n=' + bym.get(id).length}));
    groups.unshift({label: t('rp_everyone'), values: all.map(r => r.pct), cls: 'is-all', sub: 'n=' + all.length});
    const cols = [{label: t('rp_d_marker')}, {label: t('rp_mk_n'), num: true}, {label: t('rp_m_meanpct'), num: true},
        {label: t('rp_mk_diff'), num: true, help: t('rp_mk_diff_help')}, {label: t('rp_m_sdpct'), num: true,
            help: t('rp_mk_sd_help')},
        {label: t('rp_m_turnmed'), num: true}, {label: t('rp_m_activemin'), num: true}, {label: t('rp_m_annper'), num: true},
        {label: t('rp_m_posshare'), num: true}, {label: t('rp_m_voiceshare'), num: true}, {label: t('rp_m_autoaccept'), num: true}];
    if (meta.gradepass > 0) {
        cols.splice(3, 0, {label: t('rp_m_passrate'), num: true});
    }
    const trs = ids.map(id => {
        const mine = bym.get(id);
        const others = all.filter(r => r.marker !== id);
        const diff = others.length ? S.mean(mine.map(r => r.pct)) - S.mean(others.map(r => r.pct)) : null;
        const cells = [{v: name(id), d: h('span', null, name(id), ' ', small(mine.length, boot.minmarkern)),
            onClick: () => ctx.app.act({filters: {marker: [String(id)]}, tab: 'students'})},
        {v: mine.length, d: String(mine.length)}, m(ctx, 'meanpct', mine),
        {v: diff, d: diff === null ? '–' : (diff > 0 ? '+' : '') + S.fmt(diff, 1), cls: diff !== null && Math.abs(diff) >= 10 &&
            mine.length >= boot.minmarkern ? 'is-warn' : ''},
        m(ctx, 'sdpct', mine), m(ctx, 'turnmed', mine), m(ctx, 'activemin', mine), m(ctx, 'annper', mine),
        m(ctx, 'posshare', mine), m(ctx, 'voiceshare', mine), m(ctx, 'autoaccept', mine)];
        if (meta.gradepass > 0) {
            cells.splice(3, 0, m(ctx, 'passrate', mine));
        }
        return cells;
    });
    // Drift: average of the last five marks, in the order each marker marked.
    const series = ids.filter(id => bym.get(id).length >= 6).map(id => {
        const list = bym.get(id).slice().sort((a, b) => a.gradedat - b.gradedat);
        return {label: name(id), points: list.map((r, i) => ({x: i + 1, y: S.mean(list.slice(Math.max(0, i - 4), i + 1).map(x =>
            x.pct))}))};
    });
    return h('div.fg-rp-stack', null,
        section(t('rp_mk_spread'), t('rp_mk_spread_sub'), C.boxes(groups, {lo: 0, hi: 100, fmt: v => S.fmt(v, 0) + '%',
            ref: S.median(all.map(r => r.pct)), reflabel: t('rp_mk_medianall'), label: t('rp_mk_spread')}),
        h('p.fg-rp-footnote', null, icon('info', 'fg-i-xs'), t('rp_mk_caveat', boot.minmarkern))),
        section(t('rp_mk_table'), t('rp_mk_table_sub'), table(cols, trs, {sort: 1})),
        critByMarker(ctx),
        series.length ? section(t('rp_mk_drift'), t('rp_mk_drift_sub'), C.lines(series, {ylo: 0, yhi: 100,
            yfmt: v => S.fmt(v, 0) + '%', xfmt: v => t('rp_nth', S.fmt(v, 0)), label: t('rp_mk_drift')})) : null);
};

/* ---------- Feedback ---------- */

/**
 * Feedback tab.
 *
 * @param {Object} ctx
 * @returns {HTMLElement}
 */
const feedback = ctx => {
    const {rows} = ctx;
    const g = rows.filter(r => r.graded);
    if (!g.length) {
        return empty(t('rp_nomarksyet'));
    }
    const tot = k => S.sum(g.map(r => r.ann[k]));
    const sources = [['typed', 'rp_src_typed'], ['voice', 'rp_src_voice'], ['bank', 'rp_src_bank']].map(([k, l]) =>
        ({label: t(l), value: tot(k), display: String(tot(k))}));
    sources.push({label: t('rp_src_auto'), value: tot('autoaccepted') + tot('autoedited'),
        display: String(tot('autoaccepted') + tot('autoedited'))});
    const dist = [[0, 0], [1, 2], [3, 5], [6, 10], [11, 1e9]].map(([a, b]) => ({label: b > 1e8 ? '11+' : (a === b ? String(a) :
        `${a}–${b}`), value: g.filter(r => r.ann.total >= a && r.ann.total <= b).length}));
    const bym = byMarker(rows);
    return h('div.fg-rp-stack', null,
        h('div.fg-rp-kpis', null,
            kpi(t('rp_m_annper'), m(ctx, 'annper', g).d, {help: t('rp_fb_annper_help')}),
            kpi(t('rp_m_posshare'), m(ctx, 'posshare', g).d, {help: t('rp_k_balance_help')}),
            kpi(t('rp_m_bothshare'), m(ctx, 'bothshare', g).d, {help: t('rp_fb_both_help')}),
            kpi(t('rp_m_linkedshare'), m(ctx, 'linkedshare', g).d, {help: t('rp_fb_linked_help')}),
            kpi(t('rp_m_nofeedback'), m(ctx, 'nofeedback', g).d, {tone: (m(ctx, 'nofeedback', g).v || 0) > 0.1 ? 'warn' : '',
                onClick: () => ctx.app.act({filters: {feedback: ['no']}, tab: 'students'}), help: t('rp_fb_none_help')}),
            kpi(t('rp_m_fbwords'), m(ctx, 'fbwords', g).d, {help: t('rp_fb_words_help')})),
        h('div.fg-rp-two', null,
            section(t('rp_fb_balance'), t('rp_fb_balance_sub'), C.ladder([
                {label: t('pol_improvement'), count: tot('improvement'), step: 0, cls: 'is-imp'},
                {label: t('pol_neutral'), count: tot('neutral'), step: 2, cls: 'is-neutral'},
                {label: t('pol_positive'), count: tot('positive'), step: 5, cls: 'is-pos'}], {label: t('rp_fb_balance')}),
            h('div.fg-rp-legend', null, h('span', null, h('i.is-imp'), t('pol_improvement') + ' ' + tot('improvement')),
                h('span', null, h('i.is-neutral'), t('pol_neutral') + ' ' + tot('neutral')),
                h('span', null, h('i.is-pos'), t('pol_positive') + ' ' + tot('positive')))),
            section(t('rp_fb_sources'), t('rp_fb_sources_sub'), C.hbars(sources))),
        h('div.fg-rp-two', null,
            section(t('rp_fb_dist'), t('rp_fb_dist_sub'), C.columns(dist, {height: 200, half: true, label: t('rp_fb_dist')})),
            section(t('rp_fb_bymarker'), t('rp_fb_bymarker_sub'), C.hbars([...bym.entries()].map(([id, mine]) => {
                const v = m(ctx, 'posshare', mine);
                return {label: (ctx.meta.markers || {})[id] || t('rp_unknown'), value: v.v || 0, display: v.d,
                    sub: t('rp_nper', m(ctx, 'annper', mine).d)};
            }), {max: 1}))));
};

/* ---------- Auto-marking ---------- */

/**
 * Auto-marking tab.
 *
 * @param {Object} ctx
 * @returns {HTMLElement}
 */
const auto = ctx => {
    const {rows, meta} = ctx;
    const g = rows.filter(r => r.graded);
    const am = g.filter(r => r.auto);
    if (!am.length && !S.sum(g.map(r => r.ann.autosuggested))) {
        return empty(t('rp_auto_none'));
    }
    const acc = S.sum(g.map(r => r.ann.autoaccepted));
    const ed = S.sum(g.map(r => r.ann.autoedited));
    const rej = S.sum(g.map(r => r.ann.autorejected));
    const gaps = g.map(r => {
        const a = Model.autoPct(r, meta);
        return a === null || r.pct === null ? null : r.pct - a;
    });
    const gb = S.bins(S.nums(gaps), -50, 50, 10);
    const bym = byMarker(rows);
    return h('div.fg-rp-stack', null,
        h('div.fg-rp-kpis', null,
            kpi(t('rp_auto_k_used'), S.pct(g.length ? am.length / g.length : null), {sub: t('rp_auto_k_used_sub', am.length)}),
            kpi(t('rp_auto_k_accepted'), S.pct(acc + ed + rej ? acc / (acc + ed + rej) : null), {sub: t('rp_auto_k_counts',
                {acc, ed, rej}), help: t('rp_auto_k_accepted_help')}),
            kpi(t('rp_m_autogap'), m(ctx, 'autogap', g).d, {help: t('rp_auto_gap_help')}),
            kpi(t('rp_auto_k_exact'), S.pct(S.share(S.nums(gaps), x => Math.abs(x) < 0.5)), {help: t('rp_auto_k_exact_help')})),
        h('div.fg-rp-two', null,
            section(t('rp_auto_decisions'), t('rp_auto_decisions_sub'), C.ladder([
                {label: t('rp_auto_rejected'), count: rej, step: 0, cls: 'is-imp'},
                {label: t('rp_auto_edited'), count: ed, step: 2, cls: 'is-neutral'},
                {label: t('rp_auto_accepted'), count: acc, step: 5}], {label: t('rp_auto_decisions')}),
            h('div.fg-rp-legend', null, h('span', null, h('i.is-imp'), t('rp_auto_rejected') + ' ' + rej),
                h('span', null, h('i.is-neutral'), t('rp_auto_edited') + ' ' + ed),
                h('span', null, h('i.fg-lv-5'), t('rp_auto_accepted') + ' ' + acc))),
            section(t('rp_auto_gapdist'), t('rp_auto_gapdist_sub'), S.nums(gaps).length ? C.columns(gb.map(x => ({
                label: (x.from > 0 ? '+' : '') + Math.round(x.from), value: x.count})), {height: 200, half: true}) :
                h('p.fg-small.fg-muted', null, t('rp_auto_nogaps')))),
        section(t('rp_auto_bymarker'), t('rp_auto_bymarker_sub'), table([{label: t('rp_d_marker')},
            {label: t('rp_auto_accepted'), num: true}, {label: t('rp_auto_edited'), num: true},
            {label: t('rp_auto_rejected'), num: true}, {label: t('rp_m_autoaccept'), num: true}, {label: t('rp_m_autogap'),
                num: true}],
        [...bym.entries()].map(([id, mine]) => [(meta.markers || {})[id] || t('rp_unknown'),
            {v: S.sum(mine.map(r => r.ann.autoaccepted)), d: String(S.sum(mine.map(r => r.ann.autoaccepted)))},
            {v: S.sum(mine.map(r => r.ann.autoedited)), d: String(S.sum(mine.map(r => r.ann.autoedited)))},
            {v: S.sum(mine.map(r => r.ann.autorejected)), d: String(S.sum(mine.map(r => r.ann.autorejected)))},
            m(ctx, 'autoaccept', mine), m(ctx, 'autogap', mine)]))),
        coverageBlock(g) ? section(t('rp_cov_title'), t('rp_cov_sub_long'), coverageBlock(g)) : null);
};

/* ---------- Integrity ---------- */

/**
 * Integrity tab.
 *
 * @param {Object} ctx
 * @returns {HTMLElement}
 */
const integrity = ctx => {
    const {rows, meta} = ctx;
    const lev = ['high', 'medium', 'low'];
    const ladderFor = key => C.ladder(lev.map((l, i) => ({label: t('rp_risk_' + l), count: rows.filter(r => r[key] === l).length,
        step: [0, 2, 5][i], cls: 'is-risk-' + l, onClick: () => ctx.app.act({filters: {[key]: [l]}, tab: 'students'})})));
    const flagged = rows.filter(r => r.eg === 'high' || r.eg === 'medium' || r.dg === 'high' || r.dg === 'medium');
    return h('div.fg-rp-stack', null,
        h('div.fg-rp-two', null,
            meta.hasEg ? section(t('rp_int_eg'), t('rp_int_eg_sub'), ladderFor('eg'), h('div.fg-rp-legend', null,
                lev.map(l => h('span', null, h('i', {"class": 'is-risk-' + l}), t('rp_risk_' + l))))) : null,
            meta.hasDg ? section(t('rp_int_dg'), t('rp_int_dg_sub'), ladderFor('dg')) : null),
        section(t('rp_int_flagged', flagged.length), t('rp_int_flagged_sub'), flagged.length ? table([{label: t('rp_col_name')},
            {label: t('rp_d_eg')}, {label: t('rp_d_dg')}, {label: t('rp_d_stage')}, {label: t('rp_col_grade'), num: true},
            {label: t('rp_d_marker')}],
        flagged.map(r => [{v: r.sort, d: r.name,
            onClick: ctx.boot.cangrade ? () => window.open(meta.graderurl + '&userid=' + r.uid +
            (r.slot ? '&slot=' + r.slot : ''), '_blank') : null},
        {v: r.egscore, d: r.eg ? h('span', {"class": 'fg-rp-risk is-' + r.eg}, t('rp_risk_' + r.eg) + (r.egscore !== null ?
            ' · ' + r.egscore : '')) : '–'},
        {v: r.dgscore, d: r.dg ? h('span', {"class": 'fg-rp-risk is-' + r.dg}, t('rp_risk_' + r.dg) + (r.dgscore !== null ?
            ' · ' + r.dgscore : '')) : '–'},
        t('rp_stage_' + Model.stage(r)), {v: r.pct, d: r.pct === null ? '–' : S.fmt(r.pct, 0) + '%'},
        r.marker ? (meta.markers || {})[r.marker] || '' : '–']), {sort: 1}) : h('p.fg-small.fg-muted', null, t('rp_int_none'))));
};

/* ---------- Workload ---------- */

/**
 * Workload tab.
 *
 * @param {Object} ctx
 * @returns {HTMLElement}
 */
const workload = ctx => {
    const {rows, meta} = ctx;
    const g = rows.filter(r => r.graded);
    if (!g.length) {
        return empty(t('rp_nomarksyet'));
    }
    const times = g.map(r => r.gradedat).filter(Boolean);
    const lo = Math.floor(Math.min(...times) / DAY);
    const hi = Math.floor(Math.max(...times) / DAY);
    const span = hi - lo + 1;
    const weekly = span > 45;
    const unit = weekly ? 7 : 1;
    const buckets = new Array(Math.ceil(span / unit)).fill(0);
    times.forEach(ts => {
        buckets[Math.floor((Math.floor(ts / DAY) - lo) / unit)]++;
    });
    const fmtday = i => new Date((lo + i * unit) * DAY * 1000).toLocaleDateString(undefined, {day: 'numeric', month: 'short'});
    const bym = byMarker(rows);
    const act = g.filter(r => r.active > 0);
    const wait = rows.filter(r => Model.stage(r) === 'waiting');
    const now = Date.now() / 1000;
    const ages = wait.map(r => (now - r.submitted) / DAY);
    const ageb = [[0, 2], [2, 7], [7, meta.sla], [meta.sla, 1e9]].map(([a, b], i) => ({label: t('rp_turn_t' + i, meta.sla),
        value: ages.filter(x => x >= a && x < b).length, cls: i === 3 ? 'is-warn' : ''}));
    return h('div.fg-rp-stack', null,
        h('div.fg-rp-kpis', null,
            kpi(t('rp_m_activehours'), m(ctx, 'activehours', g).d, {help: t('rp_wl_hours_help')}),
            kpi(t('rp_m_activemin'), m(ctx, 'activemin', g).d, {help: t('rp_wl_min_help'),
                sub: act.length < g.length ? t('rp_wl_tracked', {n: act.length, total: g.length}) : null}),
            kpi(t('rp_m_turnmed'), m(ctx, 'turnmed', g).d, {sub: t('rp_k_turn_sub', meta.sla)}),
            kpi(t('rp_m_oversla'), m(ctx, 'oversla', g).d, {tone: (m(ctx, 'oversla', g).v || 0) > 0.1 ? 'warn' : ''}),
            kpi(t('rp_m_waiting'), String(wait.length), {sub: ages.length ? t('rp_wl_oldest', S.fmt(Math.max(...ages), 0)) : null,
                onClick: () => ctx.app.act({filters: {stage: ['waiting']}, tab: 'students'})})),
        section(t(weekly ? 'rp_wl_perweek' : 'rp_wl_perday'), t('rp_wl_per_sub'), C.columns(buckets.map((v,
            i) => ({label: fmtday(i),
            value: v})), {height: 200})),
        h('div.fg-rp-two', null,
            section(t('rp_wl_waiting'), t('rp_wl_waiting_sub'), wait.length ? C.columns(ageb, {height: 200, half: true}) :
                h('p.fg-small.fg-muted', null, t('rp_wl_nowaiting'))),
            section(t('rp_wl_time'), t('rp_wl_time_sub'), act.length ? C.boxes([...bym.entries()].map(([id, mine]) => ({
                label: (meta.markers || {})[id] || t('rp_unknown'), values: mine.filter(r => r.active > 0).map(r => r.active / 60),
                sub: 'n=' + mine.length})), {half: true, lo: 0, hi: Math.max(5, S.quantile(act.map(r => r.active / 60),
                    0.95) * 1.1),
                fmt: v => t('rp_nmin', S.fmt(v, 0))}) : h('p.fg-small.fg-muted', null, t('rp_wl_notime')))));
};

/**
 * Render a tab.
 *
 * @param {string} tab
 * @param {Object} ctx
 * @returns {HTMLElement}
 */
export const render = (tab, ctx) => {
    if (!ctx.all.length) {
        return empty(t('rp_nodata'));
    }
    const fn = {overview, criteria, questions, markers, feedback, auto, integrity, workload}[tab] || overview;
    if (!ctx.rows.length) {
        return h('div.fg-rp-stack', null, empty(t('rp_nomatch')), h('div.fg-rp-center', null,
            h('button.fg-btn', {type: 'button', onclick: () => ctx.app.set({filters: {}, ranges: {}, search: ''})},
                t('rp_clearall'))));
    }
    return fn(ctx);
};

export {questionSummary, ladders, gradeChart, notes, pipeline};
