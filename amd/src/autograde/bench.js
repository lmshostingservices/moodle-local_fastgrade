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
 * Rule test bench (how often the rules agree with marks already given), phrase suggestions,
 * answer grouping, and similar answers already marked.
 *
 * @module     local_fastgrade/autograde/bench
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon, replace} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import {tip} from 'local_fastgrade/ui/tooltip';
import * as Dialog from 'local_fastgrade/ui/dialog';
import * as Api from 'local_fastgrade/lib/api';
import {toast} from 'local_fastgrade/ui/toast';
import * as Engine from 'local_fastgrade/autograde/engine';

/**
 * Predicted state of one criterion for a text.
 *
 * @param {string} text
 * @param {Array} rules
 * @param {Object} crit
 * @returns {string} met, partial or none
 */
export const predict = (text, rules, crit) => {
    const checks = rules.filter(r => ['term', 'anyof', 'pattern', 'mustnot', 'length', 'structure'].includes(r.kind));
    const ev = Engine.evaluate(text, checks);
    let met = ev.met;
    let total = ev.total;
    rules.filter(r => r.kind === 'keypoints').forEach(r => {
        const points = (r.config.terms || []).length ? r.config.terms : Engine.splitPoints(crit.benchmark);
        const cov = Engine.coverage(text, points, crit.question);
        total += cov.length;
        met += cov.filter(c => c.status === 'covered').length;
    });
    rules.filter(r => r.kind === 'parts').forEach(r => {
        const parts = Engine.partsCheck(text, r.config.terms || []);
        total += parts.length;
        met += parts.filter(p => p.ok).length;
    });
    if (!total) {
        return 'none';
    }
    return met === total ? 'met' : (met / total >= 0.5 ? 'partial' : 'none');
};

/**
 * What the human decided for a criterion: did it meet it?
 *
 * @param {Object} item corpus item
 * @param {Object} crit
 * @param {Array} rules
 * @param {Object} info
 * @returns {boolean|null}
 */
const humanMet = (item, crit, rules, info) => {
    if (crit.id && info.method === 'rubric') {
        const f = (item.filling || []).find(x => x.criterionid === crit.id);
        if (!f || !f.levelid) {
            return null;
        }
        const th = rules.find(r => r.kind === 'threshold');
        const scores = crit.levels.map(l => l.score);
        const chosen = crit.levels.find(l => l.id === f.levelid);
        const target = th && th.config.levelid ? crit.levels.find(l => l.id === th.config.levelid) : null;
        const bar = target ? target.score : (Math.max(...scores) + Math.min(...scores)) / 2;
        return chosen ? chosen.score >= bar : null;
    }
    if (crit.id && info.method === 'guide') {
        const f = (item.filling || []).find(x => x.criterionid === crit.id);
        return f && f.score !== null && f.score !== undefined ? f.score / (crit.maxscore || 1) >= 0.75 : null;
    }
    return item.fraction === null || item.fraction === undefined ? null : item.fraction >= 0.5;
};

/**
 * Open the test bench.
 *
 * @param {Object} app
 * @param {Array} criteria
 * @param {Array} items marked answers
 */
export const open = (app, criteria, items) => {
    const info = app.store.get('info');
    const lookfors = app.store.get('lookfors') || {};
    const marked = items.filter(i => i.graded && i.text && i.text.trim());
    if (marked.length < 3) {
        Dialog.open({title: t('auto_testbench'), body: h('p', null, t('bench_toofew', marked.length)),
            actions: [{label: t('ok'), primary: true}]});
        return;
    }
    const sections = criteria.filter(c => (lookfors[c.key] || []).length).map(c => {
        const rules = lookfors[c.key];
        const rows = [];
        let agree = 0;
        let n = 0;
        const good = [];
        const weak = [];
        marked.forEach(it => {
            const hm = humanMet(it, c, rules, info);
            if (hm === null) {
                return;
            }
            (hm ? good : weak).push(it.text);
            const p = predict(it.text, rules, c);
            const pm = p === 'met';
            n++;
            if (pm === hm) {
                agree++;
            } else {
                rows.push({it, hm, p});
            }
        });
        const pct = n ? Math.round(agree / n * 100) : 0;
        const phrases = good.length >= 2 && weak.length >= 1 ? Engine.discriminating(good, weak) : [];
        const chips = phrases.map(p => h('label.fg-check.is-chip', null, h('input', {type: 'checkbox', value: p}), p));
        return h('section.fg-bench', null,
            h('div.fg-auto-card-head', null, h('strong', null, c.label),
                h('span.fg-chip', {"class": pct >= 90 ? 'is-ok' : (pct >= 70 ? 'is-amber' : 'is-muted')},
                    t('bench_agree', {pct, n}))),
            rows.length ? h('details', null, h('summary', null, t('bench_disagree', rows.length)),
                h('ul.fg-auto-list', null, rows.slice(0, 30).map(r => h('li.is-miss', null,
                    h('button.fg-link-btn', {type: 'button', onclick: () => openItem(app, r.it)}, r.it.name),
                    h('small', null, t('bench_row', {human: r.hm ? t('bench_met') : t('bench_notmet'), rule: t('cov_' +
                        (r.p === 'met' ? 'covered' : (r.p === 'partial' ? 'partial' : 'missing')))})))))) :
                h('p.fg-small', null, t('bench_alldone')),
            phrases.length ? h('div.fg-bench-phrases', null, h('p.fg-small.fg-muted', null, t('bench_phrases')),
                h('div.fg-syn-boxes', null, chips),
                h('button.fg-btn.is-small', {type: 'button', onclick: async() => {
                    const picked = chips.map(ch => ch.querySelector('input')).filter(i => i.checked).map(i => i.value);
                    if (!picked.length) {
                        return;
                    }
                    const newrules = [...rules, {kind: 'anyof', config: {label: t('bench_newrule'), terms: picked,
                        min: Math.min(2, picked.length)}}];
                    try {
                        const r = await Api.call('save_criteria', {cmid: app.cmid, kind: 'lookfors',
                            data: {criterionkey: c.key, rules: newrules}});
                        app.store.set({lookfors: r.lookfors});
                        toast(t('lf_saved'), {type: 'ok'});
                    } catch (e) {
                        toast(Api.message(e), {type: 'error'});
                    }
                }}, icon('plus', 'fg-i-sm'), t('bench_addphrases'))) : null);
    });
    Dialog.open({title: t('auto_testbench'), wide: true, body: h('div', null,
        h('p.fg-small.fg-muted', null, t('bench_intro', marked.length)), sections),
    actions: [{label: t('done'), primary: true}]});
};

/**
 * Open a corpus item in the grader.
 *
 * @param {Object} app
 * @param {Object} it
 */
const openItem = (app, it) => {
    const entry = app.store.get('participants').find(p => p.person.id === it.userid && p.attempt === it.attempt &&
        (p.slot || 0) === (it.slot || 0)) || {person: {id: it.userid, fullname: it.name, initials: '', picture: ''},
        attempt: it.attempt, slot: it.slot || 0, key: `${it.userid}:${it.attempt}:${it.slot || 0}`};
    document.querySelectorAll('.fg-backdrop').forEach(b => b.remove());
    app.open(entry);
};

/**
 * Group similar answers.
 *
 * @param {Object} app
 * @param {Array} items
 */
export const groups = (app, items) => {
    const withtext = items.filter(i => i.text && i.text.trim());
    const gs = Engine.groupSimilar(withtext.map(i => ({key: i.key, text: i.text})), 0.8);
    const bykey = new Map(withtext.map(i => [i.key, i]));
    const cur = app.store.get('current');
    const body = h('div', null, h('p.fg-small.fg-muted', null, t('groups_intro', {groups: gs.length, n: withtext.length})),
        gs.length ? gs.map((g, gi) => {
            const members = g.map(k => bykey.get(k));
            const first = members[0];
            const incl = cur && g.includes(cur.key);
            return h('section.fg-group', null,
                h('div.fg-auto-card-head', null, h('strong', null, t('groupn', {n: gi + 1, count: g.length})),
                    incl ? h('span.fg-chip.is-ok', null, t('groups_current')) : null),
                h('blockquote.fg-group-sample', null, first.text.slice(0, 300) + (first.text.length > 300 ? '…' : '')),
                h('div.fg-group-members', null, members.map(m => h('button.fg-chip-btn', {type: 'button',
                    "class": m.graded ? 'is-done' : '', onclick: () => openItem(app, m)}, m.name, m.graded && m.gradedisplay ?
                    ' · ' + m.gradedisplay : ''))),
                incl ? tip(h('button.fg-btn.is-small.is-primary', {type: 'button', onclick: () => applyToGroup(app, members)},
                    icon('send', 'fg-i-sm'), t('groups_apply')), t('groups_apply_tip')) : null);
        }) : h('p', null, t('groups_none')));
    Dialog.open({title: t('auto_groups'), wide: true, body, actions: [{label: t('done'), primary: true}]});
};

/**
 * Give every answer in a group the current mark and comment.
 *
 * @param {Object} app
 * @param {Array} members
 */
const applyToGroup = async(app, members) => {
    const cur = app.store.get('current');
    const data = app.panel.collect();
    if (!app.panel.isComplete(data)) {
        toast(t('groups_needmark'), {type: 'info'});
        return;
    }
    const others = members.filter(m => m.key !== cur.key);
    const ok = await Dialog.confirm(t('groups_apply'), t('groups_apply_confirm', others.length), t('groups_apply'));
    if (!ok) {
        return;
    }
    await app.commit(false);
    let n = 0;
    for (const m of others) {
        try {
            await Api.call('save_grade', {cmid: app.cmid, userid: m.userid, attempt: m.attempt, slot: m.slot || 0,
                data: {grade: data.grade, filling: data.filling, feedback: data.feedback}});
            n++;
            const p = app.store.get('participants').find(x => x.key === m.key);
            if (p) {
                p.graded = true;
                p.needsgrading = false;
                app.rail.refreshEntry(p);
            }
        } catch (e) {
            toast(m.name + ': ' + Api.message(e), {type: 'error'});
        }
    }
    document.querySelectorAll('.fg-backdrop').forEach(b => b.remove());
    app.topbar.updateProgress();
    toast(t('groups_applied', n), {type: 'ok'});
};

/**
 * Similar answers already marked (TF-IDF cosine), shown as precedents, never as a predicted grade.
 *
 * @param {string} text
 * @param {Array} items
 * @param {string} selfkey
 * @returns {Array} [{item, score}]
 */
export const precedents = (text, items, selfkey) => {
    const marked = items.filter(i => i.graded && i.text && i.key !== selfkey);
    const stems = s => Engine.tokens(s).filter(x => !Engine.STOP.has(x.w)).map(x => x.s);
    const docs = [stems(text), ...marked.map(i => stems(i.text))];
    const df = new Map();
    docs.forEach(d => new Set(d).forEach(w => df.set(w, (df.get(w) || 0) + 1)));
    const vec = d => {
        const tf = new Map();
        d.forEach(w => tf.set(w, (tf.get(w) || 0) + 1));
        const v = new Map();
        let n = 0;
        tf.forEach((c, w) => {
            const x = (1 + Math.log(c)) * Math.log(1 + docs.length / df.get(w));
            v.set(w, x);
            n += x * x;
        });
        return {v, n: Math.sqrt(n) || 1};
    };
    const q = vec(docs[0]);
    return marked.map((it, i) => {
        const d = vec(docs[i + 1]);
        let dot = 0;
        q.v.forEach((x, w) => {
            dot += x * (d.v.get(w) || 0);
        });
        return {item: it, score: dot / (q.n * d.n)};
    }).filter(x => x.score >= 0.35).sort((a, b) => b.score - a.score).slice(0, 3);
};

/**
 * Precedents block for the Auto tab.
 *
 * @param {Object} app
 * @param {string} text
 * @returns {Promise<HTMLElement>}
 */
export const precedentsBlock = async(app, text) => {
    const cur = app.store.get('current');
    const box = h('section.fg-auto-card', null, h('div.fg-auto-card-head', null, h('strong', null, t('prec_title'))),
        h('div.fg-small.fg-muted', null, t('loading')));
    try {
        const corpus = await Api.call('corpus', {cmid: app.cmid, slot: cur.slot || 0});
        const list = precedents(text, corpus.items, cur.key);
        replace(box, h('div.fg-auto-card-head', null, h('strong', null, t('prec_title'))),
            h('p.fg-small.fg-muted', null, t('prec_help')),
            list.length ? h('ul.fg-auto-list', null, list.map(p => h('li', null,
                h('button.fg-link-btn', {type: 'button', onclick: () => openItem(app, p.item)}, p.item.name),
                h('small', null, `${p.item.gradedisplay || ''} · ${t('prec_similar', Math.round(p.score * 100))}`)))) :
                h('p.fg-small', null, t('prec_none')));
    } catch (e) {
        replace(box, h('p.fg-small', null, Api.message(e)));
    }
    return box;
};
