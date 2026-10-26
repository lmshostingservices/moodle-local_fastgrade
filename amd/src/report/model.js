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
 * The report's fields: every way to slice the data (dimensions) and every number to show (measures).
 * Filters, the pivot table, charts, the student table and exports all use the same fields, so a
 * number means the same thing everywhere.
 *
 * @module     local_fastgrade/report/model
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {t} from 'local_fastgrade/lib/str';
import * as S from 'local_fastgrade/report/stats';

const DAY = 86400;

/**
 * Week (Monday) a timestamp falls in, as a sortable key and label.
 *
 * @param {number} ts
 * @returns {Object|null}
 */
const week = ts => {
    if (!ts) {
        return null;
    }
    const d = new Date(ts * 1000);
    const day = (d.getDay() + 6) % 7;
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - day);
    return {value: d.toISOString().slice(0, 10), label: t('rp_weekof', d.toLocaleDateString(undefined,
        {day: 'numeric', month: 'short'}))};
};

/**
 * The marking stage of a row.
 *
 * @param {Object} r
 * @returns {string}
 */
export const stage = r => {
    if (r.status === 'notsubmitted' || r.status === 'new') {
        return 'notsubmitted';
    }
    if (!r.graded) {
        return r.status === 'draft' ? 'draft' : 'waiting';
    }
    return r.released ? 'released' : 'marked';
};

export const STAGES = ['notsubmitted', 'draft', 'waiting', 'marked', 'released'];

/**
 * Grade as a percentage the auto-marker suggested.
 *
 * @param {Object} r
 * @param {Object} meta
 * @returns {number|null}
 */
export const autoPct = (r, meta) => {
    if (!r.auto || r.auto.grade === null || r.auto.grade === undefined) {
        return null;
    }
    const max = meta.kind === 'quiz' ? r.max : meta.maxgrade;
    return max > 0 ? 100 * r.auto.grade / max : null;
};

/**
 * Build the dimensions and measures for a dataset.
 *
 * @param {Object} meta
 * @returns {{dims: Array, measures: Array}}
 */
export const build = meta => {
    const quiz = meta.kind === 'quiz';
    const markers = meta.markers || {};
    const groups = meta.groups || {};
    const dims = [];
    const dim = (key, label, values, order = null, opts = {}) => dims.push(Object.assign({key, label, values, order}, opts));

    dim('stage', t('rp_d_stage'), r => [{value: stage(r), label: t('rp_stage_' + stage(r))}], STAGES);
    if (quiz) {
        const slots = meta.slots || [];
        dim('question', t('rp_d_question'), r => [{value: String(r.slot), label: t('rp_qlabel', {n: r.slot, name: r.question})}],
            slots.map(s => String(s.slot)));
    }
    if (Object.keys(groups).length) {
        dim('group', t('rp_d_group'), r => (r.groups && r.groups.length ? r.groups.filter(g => groups[g]).map(g =>
            ({value: String(g), label: groups[g]})) : [{value: '0', label: t('rp_nogroup')}]));
    }
    dim('marker', t('rp_d_marker'), r => [r.marker ? {value: String(r.marker), label: markers[r.marker] || t('rp_unknown')} :
        {value: '0', label: t('rp_notmarked')}]);
    dim('gradeband', t('rp_d_gradeband'), r => {
        if (r.pct === null || r.pct === undefined) {
            return [{value: 'none', label: t('rp_notmarked')}];
        }
        const b = Math.min(9, Math.floor(r.pct / 10));
        return [{value: 'b' + b, label: b === 9 ? '90–100%' : `${b * 10}–${b * 10 + 9}%`}];
    }, ['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'none']);
    if (!quiz && (meta.gradepass > 0 || (meta.scale && meta.scale.length))) {
        dim('outcome', t('rp_d_outcome'), r => {
            if (!r.graded) {
                return [{value: 'none', label: t('rp_notmarked')}];
            }
            const [pf, label] = String(r.outcome || '').split('|');
            if (meta.scale && meta.scale.length) {
                const name = label || pf;
                return [{value: name || 'none', label: name || t('rp_notmarked')}];
            }
            return [{value: pf, label: t('rp_outcome_' + pf)}];
        }, meta.scale && meta.scale.length ? meta.scale.concat(['none']) : ['pass', 'fail', 'none']);
    }
    dim('timeliness', t('rp_d_timeliness'), r => {
        if (stage(r) === 'notsubmitted') {
            return [{value: 'none', label: t('rp_stage_notsubmitted')}];
        }
        if (quiz) {
            return [{value: 'ontime', label: t('rp_ontime')}];
        }
        return [r.late > 0 ? {value: 'late', label: t('rp_late')} : (r.ext ? {value: 'ext', label: t('rp_extension')} :
            {value: 'ontime', label: t('rp_ontime')})];
    }, ['ontime', 'ext', 'late', 'none']);
    dim('turnband', t('rp_d_turnband'), r => {
        if (r.turnaround === null || r.turnaround === undefined) {
            return [{value: 'none', label: t('rp_notmarked')}];
        }
        const d = r.turnaround / DAY;
        const v = d < 2 ? 't0' : (d < 7 ? 't1' : (d <= meta.sla ? 't2' : 't3'));
        return [{value: v, label: t('rp_turn_' + v, meta.sla)}];
    }, ['t0', 't1', 't2', 't3', 'none']);
    dim('attempt', t('rp_d_attempt'), r => [{value: String(r.attempt), label: t('rp_attemptn', r.attempt)}]);
    dim('latest', t('rp_d_latest'), r => [r.latest ? {value: 'latest', label: t('rp_latestonly')} :
        {value: 'earlier', label: t('rp_earlier')}], ['latest', 'earlier']);
    dim('feedback', t('rp_d_feedback'), r => {
        if (!r.graded) {
            return [{value: 'none', label: t('rp_notmarked')}];
        }
        return [r.ann.total || r.fbwords || r.remarks ? {value: 'yes', label: t('rp_hasfeedback')} :
            {value: 'no', label: t('rp_nofeedback')}];
    }, ['yes', 'no', 'none']);
    dim('balance', t('rp_d_balance'), r => {
        if (!r.graded) {
            return [{value: 'none', label: t('rp_notmarked')}];
        }
        const p = r.ann.positive > 0;
        const i = r.ann.improvement > 0;
        const v = p && i ? 'both' : (p ? 'pos' : (i ? 'imp' : 'neither'));
        return [{value: v, label: t('rp_bal_' + v)}];
    }, ['both', 'pos', 'imp', 'neither', 'none']);
    dim('automarked', t('rp_d_automarked'), r => [r.auto ? {value: 'yes', label: t('rp_automarked')} :
        {value: 'no', label: t('rp_handmarked')}], ['yes', 'no']);
    const integ = key => r => [r[key] ? {value: r[key], label: t('rp_risk_' + r[key])} : {value: 'none', label: t('rp_noresult')}];
    if (meta.hasEg) {
        dim('eg', t('rp_d_eg'), integ('eg'), ['high', 'medium', 'low', 'none']);
    }
    if (meta.hasDg) {
        dim('dg', t('rp_d_dg'), integ('dg'), ['high', 'medium', 'low', 'none']);
    }
    dim('subweek', t('rp_d_subweek'), r => {
        const w = week(r.submitted);
        return [w || {value: 'none', label: t('rp_stage_notsubmitted')}];
    }, null, {sortvalue: true});
    dim('gradeweek', t('rp_d_gradeweek'), r => {
        const w = week(r.gradedat);
        return [w || {value: 'none', label: t('rp_notmarked')}];
    }, null, {sortvalue: true});
    // One dimension per rubric criterion (its level) or marking-guide criterion (its score).
    const crits = quiz ? [] : (meta.criteria || []);
    crits.forEach((c, i) => {
        const label = t('rp_critn', {n: i + 1, name: c.name.length > 40 ? c.name.slice(0, 38) + '…' : c.name});
        if (c.levels && c.levels.length) {
            dim('c' + c.id, label, r => {
                const li = r.levels[c.id];
                if (li === undefined || li === null) {
                    return [{value: 'none', label: t('rp_notmarked')}];
                }
                const l = c.levels[li];
                return [{value: 'l' + li, label: `${S.fmt(l.score)} · ${l.name.length > 40 ? l.name.slice(0, 38) + '…' : l.name}`}];
            }, c.levels.map((l, li) => 'l' + li).concat(['none']), {criterion: c});
        } else {
            dim('c' + c.id, label, r => {
                const v = r.scores[c.id];
                return [v === undefined ? {value: 'none', label: t('rp_notmarked')} :
                    {value: 's' + v, label: `${S.fmt(v)} / ${S.fmt(c.max)}`}];
            }, null, {criterion: c, sortvalue: true});
        }
    });

    const graded = rows => rows.filter(r => r.graded);
    const measures = [];
    const measure = (key, label, fn, format, opts = {}) => measures.push(Object.assign({key, label, fn, format}, opts));
    const pctf = v => S.pct(v);
    const pts = v => (v === null ? '–' : S.fmt(v, 1) + '%');
    const dayf = v => (v === null ? '–' : t('rp_ndays', S.fmt(v, 1)));
    measure('count', t('rp_m_count'), rows => rows.length, v => S.fmt(v, 0));
    measure('submitted', t('rp_m_submitted'), rows => rows.filter(r => stage(r) !== 'notsubmitted').length, v => S.fmt(v, 0));
    measure('marked', t('rp_m_marked'), rows => graded(rows).length, v => S.fmt(v, 0));
    measure('waiting', t('rp_m_waiting'), rows => rows.filter(r => stage(r) === 'waiting').length, v => S.fmt(v, 0),
        {better: 'lower'});
    measure('meanpct', t('rp_m_meanpct'), rows => S.mean(graded(rows).map(r => r.pct)), pts, {better: 'higher'});
    measure('medianpct', t('rp_m_medianpct'), rows => S.median(graded(rows).map(r => r.pct)), pts, {better: 'higher'});
    measure('sdpct', t('rp_m_sdpct'), rows => S.sd(graded(rows).map(r => r.pct)), pts);
    if (!quiz && meta.gradepass > 0) {
        measure('passrate', t('rp_m_passrate'), rows => S.share(graded(rows), r => String(r.outcome).startsWith('pass')),
            pctf, {better: 'higher'});
    }
    measure('turnmed', t('rp_m_turnmed'), rows => S.days(S.median(graded(rows).map(r => r.turnaround))), dayf,
        {better: 'lower'});
    measure('turnmean', t('rp_m_turnmean'), rows => S.days(S.mean(graded(rows).map(r => r.turnaround))), dayf,
        {better: 'lower'});
    measure('oversla', t('rp_m_oversla'), rows => S.share(graded(rows).filter(r => r.turnaround !== null),
        r => r.turnaround > meta.sla * DAY), pctf, {better: 'lower'});
    if (!quiz) {
        measure('latepct', t('rp_m_latepct'), rows => S.share(rows.filter(r => stage(r) !== 'notsubmitted'), r => r.late > 0),
            pctf, {better: 'lower'});
    }
    measure('annper', t('rp_m_annper'), rows => S.mean(graded(rows).map(r => r.ann.total)), v => S.fmt(v, 1));
    measure('posshare', t('rp_m_posshare'), rows => {
        const p = S.sum(rows.map(r => r.ann.positive));
        const i = S.sum(rows.map(r => r.ann.improvement));
        return p + i ? p / (p + i) : null;
    }, pctf);
    measure('bothshare', t('rp_m_bothshare'), rows => S.share(graded(rows), r => r.ann.positive > 0 && r.ann.improvement > 0),
        pctf, {better: 'higher'});
    measure('linkedshare', t('rp_m_linkedshare'), rows => {
        const n = S.sum(rows.map(r => r.ann.total));
        return n ? S.sum(rows.map(r => r.ann.linked)) / n : null;
    }, pctf);
    measure('voiceshare', t('rp_m_voiceshare'), rows => {
        const n = S.sum(rows.map(r => r.ann.total));
        return n ? S.sum(rows.map(r => r.ann.voice)) / n : null;
    }, pctf);
    measure('fbwords', t('rp_m_fbwords'), rows => S.median(graded(rows).map(r => r.fbwords)), v => S.fmt(v, 0));
    measure('nofeedback', t('rp_m_nofeedback'), rows => S.share(graded(rows), r => !r.ann.total && !r.fbwords && !r.remarks),
        pctf, {better: 'lower'});
    measure('activemin', t('rp_m_activemin'), rows => {
        const m = S.median(graded(rows).filter(r => r.active > 0).map(r => r.active / 60));
        return m;
    }, v => (v === null ? '–' : t('rp_nmin', S.fmt(v, 1))));
    measure('activehours', t('rp_m_activehours'), rows => S.sum(rows.map(r => r.active)) / 3600,
        v => t('rp_nhours', S.fmt(v, 1)));
    measure('autogap', t('rp_m_autogap'), rows => S.mean(graded(rows).map(r => {
        const a = autoPct(r, meta);
        return a === null || r.pct === null ? null : r.pct - a;
    })), v => (v === null ? '–' : (v > 0 ? '+' : '') + S.fmt(v, 1) + ' ' + t('rp_points')));
    measure('autoaccept', t('rp_m_autoaccept'), rows => {
        const a = S.sum(rows.map(r => r.ann.autoaccepted));
        const all = a + S.sum(rows.map(r => r.ann.autoedited + r.ann.autorejected));
        return all ? a / all : null;
    }, pctf);
    if (quiz) {
        measure('words', t('rp_m_words'), rows => S.median(rows.map(r => r.words)), v => S.fmt(v, 0));
    }
    if (meta.hasEg || meta.hasDg) {
        measure('highrisk', t('rp_m_highrisk'), rows => rows.filter(r => r.eg === 'high' || r.dg === 'high').length,
            v => S.fmt(v, 0), {better: 'lower'});
    }
    return {dims, measures};
};

/**
 * Apply the filters.
 *
 * @param {Array} rows
 * @param {Object} state {versions, filters: {dim: [values]}, ranges: {pct: [lo, hi], turn: [lo, hi]}, search}
 * @param {Array} dims
 * @returns {Array}
 */
export const filter = (rows, state, dims) => {
    const byKey = new Map(dims.map(d => [d.key, d]));
    const active = Object.entries(state.filters || {}).filter(([k, v]) => v && v.length && byKey.has(k));
    const q = (state.search || '').trim().toLowerCase();
    const r1 = (state.ranges || {}).pct;
    const r2 = (state.ranges || {}).turn;
    return rows.filter(r => {
        if (state.versions !== 'all' && !r.latest) {
            return false;
        }
        if (q && !String(r.name).toLowerCase().includes(q)) {
            return false;
        }
        if (r1 && (r.pct === null || r.pct < r1[0] || r.pct > r1[1])) {
            return false;
        }
        if (r2 && (r.turnaround === null || r.turnaround / DAY < r2[0] || r.turnaround / DAY > r2[1])) {
            return false;
        }
        return active.every(([k, vals]) => byKey.get(k).values(r).some(v => vals.includes(v.value)));
    });
};

/**
 * Group rows by a dimension.
 *
 * @param {Array} rows
 * @param {Object} dim
 * @returns {Array} [{value, label, rows}] in the dimension's order
 */
export const group = (rows, dim) => {
    const m = new Map();
    rows.forEach(r => dim.values(r).forEach(v => {
        if (!m.has(v.value)) {
            m.set(v.value, {value: v.value, label: v.label, rows: []});
        }
        m.get(v.value).rows.push(r);
    }));
    const out = [...m.values()];
    if (dim.order) {
        const idx = v => {
            const i = dim.order.indexOf(v);
            return i < 0 ? 999 : i;
        };
        out.sort((a, b) => idx(a.value) - idx(b.value) || a.label.localeCompare(b.label));
    } else if (dim.sortvalue) {
        out.sort((a, b) => (a.value === 'none') - (b.value === 'none') || String(a.value).localeCompare(String(b.value),
            undefined, {numeric: true}));
    } else {
        out.sort((a, b) => (a.value === '0') - (b.value === '0') || a.label.localeCompare(b.label));
    }
    return out;
};
