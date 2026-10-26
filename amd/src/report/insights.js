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
 * Plain-English findings about the filtered data, each with a next step. Written as Improvement and
 * Positive notes, the same language Fast Grade uses for feedback on students' work.
 *
 * @module     local_fastgrade/report/insights
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {t} from 'local_fastgrade/lib/str';
import * as S from 'local_fastgrade/report/stats';
import {stage, autoPct} from 'local_fastgrade/report/model';

const DAY = 86400;

/**
 * Work out the findings.
 *
 * @param {Object} ctx {meta, rows (filtered), all (unfiltered), boot}
 * @returns {Array} [{tone, title, text, action: {label, filters, tab}}]
 */
export const find = ctx => {
    const {meta, rows, boot} = ctx;
    const out = [];
    const minn = boot.minmarkern || 10;
    const graded = rows.filter(r => r.graded);
    const now = Date.now() / 1000;
    const add = (tone, title, text, action = null, weight = 1) => out.push({tone, title, text, action, weight});

    // Backlog.
    const waiting = rows.filter(r => stage(r) === 'waiting');
    if (waiting.length) {
        const oldest = Math.max(...waiting.map(r => now - (r.submitted || now)));
        const over = oldest > meta.sla * DAY;
        add(over ? 'improvement' : 'info', t('rp_i_backlog_t', waiting.length),
            t(over ? 'rp_i_backlog_over' : 'rp_i_backlog', {days: S.fmt(oldest / DAY, 0), sla: meta.sla}),
            {label: t('rp_i_showthem'), filters: {stage: ['waiting']}, tab: 'students'}, over ? 5 : 2);
    }
    // Turnaround.
    const turn = S.days(S.median(graded.map(r => r.turnaround)));
    if (turn !== null && graded.length >= 3) {
        if (turn <= meta.sla) {
            add('positive', t('rp_i_turn_ok_t'), t('rp_i_turn_ok', {days: S.fmt(turn, 1), sla: meta.sla}), null, 1);
        } else {
            add('improvement', t('rp_i_turn_slow_t'), t('rp_i_turn_slow', {days: S.fmt(turn, 1), sla: meta.sla}),
                {label: t('rp_i_seeworkload'), tab: 'workload'}, 4);
        }
    }
    // Criteria.
    (meta.kind === 'quiz' ? [] : meta.criteria || []).forEach((c, ci) => {
        if (!c.levels || c.levels.length < 2) {
            return;
        }
        const marked = graded.filter(r => r.levels[c.id] !== undefined && r.levels[c.id] !== null);
        if (marked.length < 5) {
            return;
        }
        const low = S.share(marked, r => r.levels[c.id] === 0);
        const top = S.share(marked, r => r.levels[c.id] === c.levels.length - 1);
        const name = t('rp_critn', {n: ci + 1, name: c.name});
        if (low >= 0.4) {
            add('improvement', t('rp_i_crit_low_t', name), t('rp_i_crit_low', {pct: S.pct(low)}),
                {label: t('rp_i_showthem'), filters: {['c' + c.id]: ['l0']}, tab: 'students'}, 4);
        } else if (top >= 0.85) {
            add('info', t('rp_i_crit_top_t', name), t('rp_i_crit_top', {pct: S.pct(top)}),
                {label: t('rp_i_seecriteria'), tab: 'criteria'}, 2);
        }
        if (marked.length >= minn) {
            const r = S.corr(marked.map(x => x.levels[c.id]), marked.map(x => x.pct));
            if (r !== null && r < 0.2) {
                add('info', t('rp_i_crit_corr_t', name), t('rp_i_crit_corr', S.fmt(r, 2)),
                    {label: t('rp_i_seecriteria'), tab: 'criteria'}, 2);
            }
        }
    });
    // Markers.
    const bym = new Map();
    graded.forEach(r => {
        if (r.marker) {
            bym.set(r.marker, (bym.get(r.marker) || []).concat([r]));
        }
    });
    if (bym.size >= 2) {
        bym.forEach((mine, id) => {
            if (mine.length < minn) {
                return;
            }
            const others = graded.filter(r => r.marker && r.marker !== id);
            if (others.length < minn) {
                return;
            }
            const diff = S.mean(mine.map(r => r.pct)) - S.mean(others.map(r => r.pct));
            const name = (meta.markers || {})[id] || t('rp_unknown');
            if (Math.abs(diff) >= 10) {
                add('improvement', t(diff > 0 ? 'rp_i_marker_high_t' : 'rp_i_marker_low_t', name),
                    t('rp_i_marker_diff', {pts: S.fmt(Math.abs(diff), 0), n: mine.length,
                        dir: t(diff > 0 ? 'rp_above' : 'rp_below')}),
                    {label: t('rp_i_seemarkers'), filters: {marker: [String(id)]}, tab: 'markers'}, 4);
            }
            const sd = S.sd(mine.map(r => r.pct));
            if (sd !== null && sd < 5) {
                add('info', t('rp_i_marker_narrow_t', name), t('rp_i_marker_narrow', S.fmt(sd, 1)),
                    {label: t('rp_i_seemarkers'), tab: 'markers'}, 2);
            }
        });
    }
    // Feedback.
    const nofb = graded.filter(r => !r.ann.total && !r.fbwords && !r.remarks);
    if (nofb.length && graded.length) {
        add(nofb.length / graded.length >= 0.2 ? 'improvement' : 'info', t('rp_i_nofb_t', nofb.length),
            t('rp_i_nofb'), {label: t('rp_i_showthem'), filters: {feedback: ['no']}, tab: 'students'},
            nofb.length / graded.length >= 0.2 ? 4 : 1);
    }
    const pos = S.sum(rows.map(r => r.ann.positive));
    const imp = S.sum(rows.map(r => r.ann.improvement));
    if (pos + imp >= 20) {
        const ps = pos / (pos + imp);
        if (ps < 0.2) {
            add('improvement', t('rp_i_balance_low_t'), t('rp_i_balance_low', S.pct(ps)), {label: t('rp_i_seefeedback'),
                tab: 'feedback'}, 3);
        } else if (ps >= 0.35) {
            add('positive', t('rp_i_balance_ok_t'), t('rp_i_balance_ok', S.pct(ps)), null, 1);
        }
    }
    // Auto-marking oversight.
    bym.forEach((mine, id) => {
        const acc = S.sum(mine.map(r => r.ann.autoaccepted));
        const all = acc + S.sum(mine.map(r => r.ann.autoedited + r.ann.autorejected));
        if (all >= 20 && acc / all >= 0.97) {
            add('info', t('rp_i_auto_rubber_t', (meta.markers || {})[id] || ''), t('rp_i_auto_rubber', S.pct(acc / all)),
                {label: t('rp_i_seeauto'), tab: 'auto'}, 3);
        }
    });
    const gaps = graded.map(r => {
        const a = autoPct(r, meta);
        return a === null || r.pct === null ? null : r.pct - a;
    });
    const gap = S.mean(gaps);
    if (gap !== null && S.nums(gaps).length >= 5 && Math.abs(gap) >= 10) {
        add('info', t('rp_i_auto_gap_t'), t('rp_i_auto_gap', {pts: S.fmt(Math.abs(gap), 0),
            dir: t(gap > 0 ? 'rp_higher' : 'rp_lower')}), {label: t('rp_i_seeauto'), tab: 'auto'}, 2);
    }
    // Integrity.
    const risky = graded.filter(r => r.eg === 'high' || r.dg === 'high');
    if (risky.length) {
        add('improvement', t('rp_i_risk_t', risky.length), t('rp_i_risk'), {label: t('rp_i_showthem'),
            filters: risky.some(r => r.eg === 'high') ? {eg: ['high']} : {dg: ['high']}, tab: 'students'}, 4);
    }
    // Lateness.
    if (meta.kind !== 'quiz') {
        const sub = rows.filter(r => stage(r) !== 'notsubmitted');
        const late = S.share(sub, r => r.late > 0);
        if (sub.length >= 5 && late >= 0.3) {
            add('info', t('rp_i_late_t'), t('rp_i_late', S.pct(late)), {label: t('rp_i_showthem'),
                filters: {timeliness: ['late']}, tab: 'students'}, 2);
        }
    }
    // Quiz questions: how hard, and whether they separate stronger and weaker students.
    if (meta.kind === 'quiz') {
        (meta.slots || []).forEach(sl => {
            const mine = graded.filter(r => r.slot === sl.slot);
            if (mine.length < 5) {
                return;
            }
            const facility = S.mean(mine.map(r => r.pct));
            const label = t('rp_qlabel', {n: sl.slot, name: sl.name});
            if (facility < 30 || facility > 90) {
                add('info', t(facility < 30 ? 'rp_i_q_hard_t' : 'rp_i_q_easy_t', label), t('rp_i_q_facility', S.fmt(facility, 0)),
                    {label: t('rp_i_seequestions'), tab: 'questions'}, 2);
            }
            if (mine.length >= minn) {
                const r = S.corr(mine.map(x => x.grade), mine.map(x => x.rest));
                if (r !== null && r < 0.1) {
                    add('improvement', t('rp_i_q_disc_t', label), t('rp_i_q_disc', S.fmt(r, 2)),
                        {label: t('rp_i_seequestions'), tab: 'questions'}, 3);
                } else if (r !== null && r >= 0.3) {
                    add('positive', t('rp_i_q_disc_ok_t', label), t('rp_i_q_disc_ok', S.fmt(r, 2)), null, 1);
                }
            }
        });
    }
    // Very quick marking with no comments.
    const act = graded.filter(r => r.active > 0);
    const med = S.median(act.map(r => r.active));
    if (act.length >= 8 && med) {
        const quick = act.filter(r => r.active < med * 0.25 && !r.ann.total);
        if (quick.length) {
            add('info', t('rp_i_quick_t', quick.length), t('rp_i_quick', S.fmt(med * 0.25 / 60, 1)),
                {label: t('rp_i_seeworkload'), tab: 'workload'}, 2);
        }
    }
    const order = {improvement: 0, info: 1, positive: 2};
    return out.sort((a, b) => order[a.tone] - order[b.tone] || b.weight - a.weight);
};
