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
 * The Auto tab: rule-based checks (no AI) that put suggestions on the document for the marker to
 * accept or reject, key-point coverage, compliance checks, the rule test bench and answer grouping.
 *
 * @module     local_fastgrade/autograde/tab
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon, replace, textOf, esc} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import {tip} from 'local_fastgrade/ui/tooltip';
import {toast} from 'local_fastgrade/ui/toast';
import * as Api from 'local_fastgrade/lib/api';
import * as Engine from 'local_fastgrade/autograde/engine';
import * as Editor from 'local_fastgrade/autograde/editor';
import * as Bench from 'local_fastgrade/autograde/bench';

// "Identifies the Act" (rubric wording) becomes "Identify the Act" (advice to the student).
const VERBS = new RegExp('^(identifies|describes|explains|applies|discusses|outlines|demonstrates|uses|provides|lists|' +
    'compares|evaluates|analyses|analyzes|justifies|includes|selects|develops|recommends|states|defines|summarises|' +
    'summarizes)\\b', 'i');

/**
 * Rubric wording as advice: "Identifies the Act" becomes "Identify the Act".
 *
 * @param {string} p
 * @returns {string}
 */
const advise = p => {
    const m = p.match(VERBS);
    if (!m) {
        return p;
    }
    const w = m[1];
    const base = /ies$/i.test(w) ? w.slice(0, -3) + 'y' : (/(sses|shes|ches|xes)$/i.test(w) ? w.slice(0, -2) : w.slice(0, -1));
    return base + p.slice(w.length);
};

/**
 * Lower-case the first letter.
 *
 * @param {string} p
 * @returns {string}
 */
const lower = p => p.charAt(0).toLowerCase() + p.slice(1);

/**
 * Rubric wording as praise: "Identifies the Act" becomes "You identify the Act".
 *
 * @param {string} p
 * @returns {string}
 */
const praise = p => (VERBS.test(p) ? 'You ' + lower(advise(p)) : p).replace(/[.\s]+$/, '');

export default class AutoTab {
    /**
     * Constructor.
     *
     * @param {Object} app
     */
    constructor(app) {
        this.app = app;
        this.results = null;
        this.corpusCache = new Map();
    }

    /**
     * Answers for this activity, fetched once per session.
     *
     * @param {number} slot
     * @param {boolean} all
     * @returns {Promise<Object>}
     */
    corpus(slot, all) {
        const key = slot + ':' + (all ? 1 : 0);
        const hit = this.corpusCache.get(key);
        if (hit && Date.now() - hit.time < 300000) {
            return hit.promise;
        }
        const promise = Api.call('corpus', {cmid: this.app.cmid, slot, all});
        promise.catch(() => this.corpusCache.delete(key));
        this.corpusCache.set(key, {promise, time: Date.now()});
        return promise;
    }

    /**
     * Criteria this activity is marked against.
     *
     * @param {Object} item
     * @returns {Array} [{key, label, text, benchmark, levels, maxscore}]
     */
    criteria(item) {
        const info = this.app.store.get('info');
        if (item.question) {
            const q = item.question;
            const base = {key: 'q' + q.questionid, label: t('questionn', q.number) + ' · ' + q.name,
                text: textOf(q.text), benchmark: textOf(q.graderinfo), question: textOf(q.text)};
            return [base];
        }
        const def = info.definition || {};
        const intro = textOf(info.intro || '');
        if (info.method === 'rubric') {
            return def.criteria.map((c, i) => ({key: 'c' + c.id, id: c.id,
                label: (i + 1) + '. ' + textOf(c.description).slice(0, 80),
                text: textOf(c.description), benchmark: textOf(c.description) + '\n' +
                    ([...c.levels].sort((x, y) => x.score - y.score).map(l => textOf(l.definition)).slice(-1)[0] || ''),
                levels: c.levels, question: intro}));
        }
        if (info.method === 'guide') {
            return def.criteria.map((c, i) => ({key: 'c' + c.id, id: c.id, label: (i + 1) + '. ' + textOf(c.shortname),
                text: textOf(c.description), benchmark: textOf(c.descriptionmarkers) || textOf(c.description),
                maxscore: c.maxscore, question: intro}));
        }
        return [{key: 'all', label: t('wholesubmission'), text: intro, benchmark: '', question: intro}];
    }

    /**
     * Rules to run: the ones set up for this activity, plus ready-made ones worked out from the rubric,
     * marking guide or grader information for any criterion nobody has set up. This is what lets
     * auto-marking work the moment it is switched on.
     *
     * @param {Object} item
     * @returns {Object} key => rules
     */
    lookfors(item) {
        const saved = this.app.store.get('lookfors') || {};
        const out = Object.assign({}, saved);
        this.criteria(item).forEach(c => {
            if ((out[c.key] || []).length || !c.benchmark.trim()) {
                return;
            }
            out[c.key] = [{kind: 'keypoints', config: {terms: Engine.splitPoints(c.benchmark)}, auto: true},
                {kind: 'threshold', config: {}, auto: true}];
        });
        if (!item.question && !(out.all || []).length) {
            out.all = [{kind: 'compliance', config: {}, auto: true}];
        }
        return out;
    }

    /**
     * Whether there is anything to run for this item.
     *
     * @param {Object} item
     * @returns {boolean}
     */
    hasRules(item) {
        return Object.values(this.lookfors(item)).some(r => r.length);
    }

    /**
     * Render the tab.
     *
     * @param {Object} item
     * @returns {HTMLElement}
     */
    render(item) {
        this.item = item;
        const lookfors = this.lookfors(item);
        const crit = this.criteria(item);
        const configured = crit.filter(c => (lookfors[c.key] || []).length);
        const can = this.app.canmanagecriteria;
        this.out = h('div.fg-auto-results');
        const head = h('div.fg-auto-head', null,
            h('p.fg-small', null, icon('shield', 'fg-i-xs'), ' ', t('auto_noai')),
            h('div.fg-row-actions', null,
                tip(h('button.fg-btn.is-primary.is-small', {type: 'button', disabled: !configured.length && !this.hasCompliance(),
                    onclick: () => this.run()}, icon('wand', 'fg-i-sm'), t('auto_run')), t('auto_run_tip')),
                can ? tip(h('button.fg-btn.is-small', {type: 'button', onclick: () => Editor.open(this.app, crit, () => {
                    this.app.panel.renderBody();
                })}, icon('list', 'fg-i-sm'), t('auto_setup')), t('auto_setup_tip')) : null,
                can && configured.length ? tip(h('button.fg-btn.is-small.is-ghost', {type: 'button',
                    onclick: () => this.testBench()},
                    icon('check', 'fg-i-sm'), t('auto_testbench')), t('auto_testbench_tip')) : null,
                item.question ? tip(h('button.fg-btn.is-small.is-ghost', {type: 'button', onclick: () => this.groups()},
                    icon('users', 'fg-i-sm'), t('auto_groups')), t('auto_groups_tip')) : null,
                this.app.boot.precedents ? tip(h('button.fg-btn.is-small.is-ghost', {type: 'button', onclick: async() => {
                    const pages = await this.texts();
                    const block = await Bench.precedentsBlock(this.app, pages.map(p => p.text).join('\n'));
                    this.out.prepend(block);
                }}, icon('users', 'fg-i-sm'), t('prec_title')), t('prec_help')) : null));
        const status = h('ul.fg-auto-crit', null, crit.map(c => {
            const rules = lookfors[c.key] || [];
            const n = rules.length;
            const auto = n && rules.every(r => r.auto);
            return h('li', null, h('span', null, c.label), tip(h('span.fg-chip', {"class": n ? 'is-ok' : 'is-muted'},
                auto ? t('auto_fromrubric') : (n ? t('auto_nrules', n) : t('auto_norules'))),
                    auto ? t('auto_fromrubric_tip') : ''));
        }));
        if (this.results && this.results.itemkey === this.app.store.get('current').key) {
            this.renderResults();
        } else if (!configured.length) {
            replace(this.out, h('div.fg-empty-small', null, can ? t('auto_empty_can') : t('auto_empty')));
        }
        return h('section.fg-auto', null, head, status, this.out);
    }

    /**
     * Whether whole-document checks are on.
     *
     * @returns {boolean}
     */
    hasCompliance() {
        const lf = this.lookfors(this.item || this.app.store.get('item'));
        return (lf.all || []).some(r => r.kind === 'compliance') || Object.values(lf).some(rules => rules.some(r =>
            r.kind === 'compliance'));
    }

    /**
     * Text of the open document.
     *
     * @returns {Promise<Array>} [{page, text}]
     */
    async texts() {
        const v = this.app.viewer.viewer;
        if (!v) {
            return [];
        }
        if (v.pagesText) {
            return v.pagesText();
        }
        if (v.plainText) {
            return [{page: 0, text: v.plainText()}];
        }
        return [];
    }

    /**
     * Anchor for a character range.
     *
     * @param {number} page
     * @param {number} start
     * @param {number} end
     * @returns {Object|null}
     */
    anchor(page, start, end) {
        const v = this.app.viewer.viewer;
        if (v.anchorForPage && page) {
            return v.anchorForPage(page, start, end);
        }
        if (v.anchorFor) {
            return v.anchorFor(start, end);
        }
        return null;
    }

    /**
     * Run all checks on the open document and place suggestions.
     *
     * @param {boolean} quiet run in the background without a toast
     */
    async run(quiet = false) {
        const app = this.app;
        const v = app.viewer.viewer;
        if (!v || !v.supportsMarks || (!v.plainText && !v.pagesText)) {
            if (!quiet) {
                toast(t('auto_cannotrun'), {type: 'info'});
            }
            return;
        }
        if (!this.item || this.item !== app.store.get('item')) {
            this.item = app.store.get('item');
        }
        const started = performance.now();
        const model = app.annotations;
        // Clear earlier suggestions on this document.
        model.forDoc(v.docref).filter(a => a.source === 'auto' && a.status === 'suggested').forEach(a => model.remove(a.clientid));
        const pages = await this.texts();
        const lookfors = this.lookfors(this.item);
        const crit = this.criteria(this.item);
        const results = [];
        let made = 0;
        const lawWarns = [];
        if (this.hasCompliance()) {
            pages.forEach(pg => Engine.lawCheck(pg.text).filter(l => l.level === 'warn').forEach(l =>
                lawWarns.push(Object.assign({page: pg.page}, l))));
        }
        const suggest = (page, start, end, polarity, comment, criterionid) => {
            if (start < 0) {
                return;
            }
            const an = this.anchor(page, start, end);
            if (!an) {
                return;
            }
            model.create({docref: v.docref, page: an.page, anchor: an.anchor, type: 'border', polarity, comment,
                source: 'auto', status: 'suggested', criterionid: criterionid || 0});
            made++;
        };
        crit.forEach(c => {
            const rules = lookfors[c.key] || [];
            if (!rules.length) {
                return;
            }
            const res = {crit: c, notes: [], points: [], parts: [], met: 0, total: 0};
            const checkrules = rules.filter(r => ['term', 'anyof', 'pattern', 'mustnot', 'length', 'structure'].includes(r.kind));
            const seen = new Set();
            pages.forEach(pg => {
                const ev = Engine.evaluate(pg.text, checkrules);
                ev.hits.forEach(hh => {
                    const k = pg.page + ':' + hh.start;
                    if (seen.has(k)) {
                        return;
                    }
                    seen.add(k);
                    suggest(pg.page, hh.start, hh.end, hh.positive ? 'positive' : 'improvement',
                        hh.positive ? t('auto_evidence', {crit: c.label, what: hh.rulelabel || hh.label}) :
                            (hh.comment || t('auto_avoid', hh.label)), c.id);
                });
                res.notes.push(...ev.notes.map(n => Object.assign({page: pg.page}, n)));
            });
            // Merge notes across pages: a rule passes if it passes on any page (words counted across all).
            const merged = new Map();
            res.notes.forEach(n => {
                const k = n.kind + '|' + n.label;
                const e = merged.get(k);
                if (!e) {
                    merged.set(k, Object.assign({}, n));
                } else {
                    e.ok = n.kind === 'mustnot' ? (e.ok && n.ok) : (e.ok || n.ok);
                }
            });
            if (pages.length > 1) {
                const all = pages.map(p => p.text).join('\n');
                const lenrule = checkrules.find(r => r.kind === 'length');
                if (lenrule) {
                    const ev = Engine.evaluate(all, [lenrule]);
                    merged.set('length|' + (lenrule.config.label || ''), ev.notes[0]);
                }
            }
            res.notes = [...merged.values()];
            res.total = res.notes.length;
            res.met = res.notes.filter(n => n.ok).length;
            // Key points.
            rules.filter(r => r.kind === 'keypoints').forEach(r => {
                const points = (r.config.terms || []).length ? r.config.terms : Engine.splitPoints(c.benchmark);
                const best = new Map();
                pages.forEach(pg => Engine.coverage(pg.text, points, c.question).forEach(cv => {
                    const prev = best.get(cv.point);
                    if (!prev || cv.score > prev.score) {
                        best.set(cv.point, Object.assign({page: pg.page}, cv));
                    }
                }));
                best.forEach(cv => {
                    // Evidence that leans on out-of-date legislation is only part-way there.
                    if (cv.status === 'covered' && lawWarns.some(w => w.page === cv.page && w.start < cv.end && w.end > cv.start)) {
                        cv.status = 'partial';
                    }
                    res.points.push(cv);
                    // Only clear evidence is marked in the document; part-way points go in the criterion comment.
                    if (cv.status === 'covered') {
                        const what = praise(cv.point);
                        suggest(cv.page, cv.start, cv.end, 'positive', t('auto_covers', what.length > 110 ?
                            what.slice(0, 108) + '…' : what), c.id);
                    }
                });
                res.total += points.length;
                res.met += res.points.filter(p => p.status === 'covered').length;
            });
            // Parts.
            rules.filter(r => r.kind === 'parts').forEach(r => {
                const all = pages.map(p => p.text).join('\n');
                res.parts = Engine.partsCheck(all, r.config.terms || []);
                res.total += res.parts.length;
                res.met += res.parts.filter(p => p.ok).length;
            });
            res.threshold = rules.find(r => r.kind === 'threshold');
            results.push(res);
        });
        // Whole-document compliance checks.
        const compliance = {laws: [], citations: null};
        if (this.hasCompliance()) {
            pages.forEach(pg => {
                Engine.lawCheck(pg.text).forEach(l => {
                    compliance.laws.push(Object.assign({page: pg.page}, l));
                    if (l.level === 'warn') {
                        suggest(pg.page, l.start, l.end, 'improvement', t('auto_law', l.message), 0);
                    }
                });
            });
            const all = pages.map(p => p.text).join('\n');
            compliance.citations = Engine.citationCheck(all);
            compliance.citations.missing.forEach(m => {
                const pg = pages.find(p => p.text.includes(m.label)) || pages[0];
                const at = pg.text.indexOf(m.label);
                suggest(pg.page, at, at + m.label.length, 'improvement', t('auto_citemissing', m.label), 0);
            });
        }
        this.results = {itemkey: app.store.get('current').key, results, compliance, made,
            ms: Math.round(performance.now() - started)};
        if (this.out && this.out.isConnected) {
            this.renderResults();
        }
        app.panel.markAutoReady(made);
        const filled = this.prefill(results, compliance);
        if (!quiet) {
            toast(t('auto_done', made), {type: 'ok'});
        } else if (made || filled) {
            toast(t('auto_ready', made + filled), {type: 'info'});
        }
    }

    /**
     * How much of a criterion was met, 0 to 1.
     *
     * @param {Object} r
     * @returns {number}
     */
    share(r) {
        if (!r.total) {
            return 0;
        }
        const partial = r.points.filter(p => p.status === 'partial').length;
        return Math.min(1, (r.met + partial * 0.5) / r.total);
    }

    /**
     * Fill in the marks, criterion comments and overall feedback the auto-marker suggests, but only
     * where the marker has not entered anything. Everything filled is flagged for the marker to check;
     * nothing reaches the gradebook until they save.
     *
     * @param {Array} results
     * @param {Object} compliance
     * @returns {number} fields filled
     */
    prefill(results, compliance) {
        const app = this.app;
        const panel = app.panel;
        const st = panel.state;
        const item = this.item;
        if (!st || !item || app.readonly || item !== app.store.get('item')) {
            return 0;
        }
        const gs = item.gradestate || {};
        if (gs.grade !== null && gs.grade !== undefined && gs.grade !== '') {
            // Already marked by a person: leave it alone.
            return 0;
        }
        const info = app.store.get('info');
        const auto = st.auto;
        let filled = 0;
        const clean = l => l.replace(/^\d+\.\s*/, '');
        const short = p => (p.length > 90 ? p.slice(0, 88) + '…' : p).replace(/[.\s]+$/, '');
        const list = a => a.map(short).join('; ');

        const strengths = [];
        const improve = [];
        let total = 0;
        let count = 0;
        results.forEach(r => {
            const share = this.share(r);
            total += share;
            count++;
            const good = r.points.filter(p => p.status === 'covered').map(p => p.point)
                .concat(r.parts.filter(p => p.ok).map(p => p.label));
            const miss = r.points.filter(p => p.status !== 'covered').map(p => p.point)
                .concat(r.parts.filter(p => !p.ok).map(p => p.label))
                .concat(r.notes.filter(n => !n.ok).map(n => n.detail || n.label).filter(Boolean));
            if (good.length) {
                strengths.push(...good.slice(0, item.question ? 4 : 2).map(praise));
            } else if (share >= 0.75) {
                strengths.push(clean(r.crit.label));
            }
            if (share < 0.75 && miss.length) {
                improve.push(...miss.slice(0, 2).map(p => short(advise(p))));
            }
            const id = r.crit.id;
            if (!id) {
                return;
            }
            const f = st.filling.get(id) || {criterionid: id, remark: ''};
            st.filling.set(id, f);
            let set = false;
            if (info.method === 'rubric' && !item.question && r.crit.levels && !f.levelid) {
                const levels = [...r.crit.levels].sort((a, b) => a.score - b.score);
                const lvl = levels[Math.round(share * (levels.length - 1))];
                if (lvl) {
                    f.levelid = lvl.id;
                    set = true;
                }
            } else if (r.crit.maxscore && (f.score === '' || f.score === null || f.score === undefined)) {
                f.score = Math.round(share * r.crit.maxscore * 2) / 2;
                set = true;
            }
            if (set && !auto.levels.includes(id)) {
                auto.levels.push(id);
                filled++;
            }
            if (!(f.remark || '').trim()) {
                const tips = list(miss.slice(0, 3).map(p => lower(advise(p))));
                f.remark = share >= 0.75 ? t('auto_r_all') :
                    (good.length ? t('auto_r_some', {good: list(good.slice(0, 2).map(lower)), miss: tips}) :
                        (share > 0 ? t('auto_r_partial', tips) : t('auto_r_none', tips || lower(advise(clean(r.crit.label))))));
                if (!auto.remarks.includes(id)) {
                    auto.remarks.push(id);
                    filled++;
                }
            }
        });
        // Quiz criteria come in as one criterion: spread the share across the quiz's own criteria.
        const q = item.question;
        if (q && count) {
            const share = total / count;
            if (q.criteria && q.criteria.length) {
                q.criteria.forEach(c => {
                    const f = st.filling.get(c.id) || {criterionid: c.id, remark: ''};
                    st.filling.set(c.id, f);
                    if (f.score === '' || f.score === null || f.score === undefined) {
                        f.score = Math.round(share * c.maxscore * 2) / 2;
                        auto.levels.push(c.id);
                        filled++;
                    }
                });
            } else if (q.maxmark > 0 && (st.grade === '' || st.grade === null)) {
                st.grade = String(Math.round(share * q.maxmark * 2) / 2);
                auto.grade = true;
                filled++;
            }
        } else if (!q && info.method !== 'rubric' && info.method !== 'guide' && info.gradetype === 'point' && count &&
                (st.grade === '' || st.grade === null)) {
            st.grade = String(Math.round(total / count * info.maxgrade));
            auto.grade = true;
            filled++;
        }
        if (compliance) {
            compliance.laws.filter(l => l.level === 'warn').forEach(l => improve.push(l.message));
            if (compliance.citations && compliance.citations.missing.length) {
                improve.push(t('auto_fb_cites', compliance.citations.missing.map(m => m.label).slice(0, 3).join(', ')));
            }
        }
        const plain = textOf(st.feedback || '').trim();
        if (!plain && (strengths.length || improve.length) && (info.feedbackcomments || q)) {
            const ul = a => '<ul>' + [...new Set(a)].slice(0, 6).map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
            st.feedback = (strengths.length ? '<p><strong>' + esc(t('auto_fb_strengths')) + '</strong></p>' + ul(strengths) : '') +
                (improve.length ? '<p><strong>' + esc(t('auto_fb_improve')) + '</strong></p>' + ul(improve) : '');
            auto.feedback = true;
            filled++;
        }
        if (filled) {
            if (panel.tab === 'mark') {
                panel.renderBody();
            }
            panel.changed();
        } else {
            panel.refreshApproval();
        }
        this.remember(results);
        return filled;
    }

    /**
     * Keep what the auto-marker suggested for this student, so the report can compare it with the final mark.
     *
     * @param {Array} results
     */
    remember(results) {
        const app = this.app;
        const panel = app.panel;
        const st = panel.state;
        const info = app.store.get('info');
        const cur = app.store.get('current');
        if (!st || !cur) {
            return;
        }
        const levels = {};
        st.auto.levels.forEach(id => {
            const f = st.filling.get(id);
            if (f && f.levelid) {
                levels[id] = f.levelid;
            }
        });
        let grade = null;
        const q = this.item.question;
        if (q) {
            grade = q.criteria && q.criteria.length ?
                panel.criteriaTotal(q.criteria.map(c => ({id: c.id, maxscore: c.maxscore})), q.maxmark) :
                (st.auto.grade ? parseFloat(st.grade) : null);
        } else if (info.method === 'rubric' && st.auto.levels.length) {
            grade = panel.rubricGrade();
        } else if (info.method === 'guide' && st.auto.levels.length) {
            grade = panel.criteriaTotal(info.definition.criteria, info.maxgrade);
        } else if (st.auto.grade) {
            grade = parseFloat(st.grade);
        }
        const points = [];
        results.forEach(r => r.points.forEach(p => points.push({crit: r.crit.key, point: p.point, status: p.status})));
        this.summary = {itemkey: cur.key, made: this.results ? this.results.made : 0, levels,
            grade: grade === null || isNaN(grade) ? null : grade, points};
    }

    /**
     * The remembered summary for a student, if it is theirs.
     *
     * @param {string} itemkey
     * @returns {Object|null}
     */
    summaryFor(itemkey) {
        if (!this.summary || this.summary.itemkey !== itemkey) {
            return null;
        }
        const s = Object.assign({}, this.summary);
        delete s.itemkey;
        return s;
    }

    /**
     * Results summary.
     */
    renderResults() {
        const {results, compliance, made} = this.results;
        if (!this.out) {
            return;
        }
        const info = this.app.store.get('info');
        const blocks = results.map(r => {
            const pct = r.total ? r.met / r.total : 0;
            const state = r.total && r.met === r.total ? 'met' : (r.met > 0 ? 'partial' : 'none');
            let apply = null;
            if (r.threshold && r.crit.id && !this.item.question) {
                const cfg = r.threshold.config;
                const levelid = state === 'met' ? cfg.levelid : (state === 'partial' ? cfg.partiallevelid : 0);
                if (info.method === 'rubric' && levelid) {
                    const lvl = r.crit.levels.find(l => l.id === levelid);
                    apply = lvl ? tip(h('button.fg-btn.is-small', {type: 'button', onclick: () => this.applyLevel(r.crit, levelid)},
                        t('auto_applylevel', textOf(lvl.definition).slice(0, 30))), t('auto_applylevel_tip')) : null;
                } else if (info.method === 'guide' && r.crit.maxscore) {
                    const score = state === 'met' ? r.crit.maxscore : Math.round(pct * r.crit.maxscore * 2) / 2;
                    apply = tip(h('button.fg-btn.is-small', {type: 'button', onclick: () => this.applyScore(r.crit, score)},
                        t('auto_applyscore', score)), t('auto_applylevel_tip'));
                }
            }
            return h('section.fg-auto-card', {"class": 'is-' + state},
                h('div.fg-auto-card-head', null, h('strong', null, r.crit.label),
                    h('span.fg-chip', {"class": state === 'met' ? 'is-ok' : (state === 'partial' ? 'is-amber' : 'is-muted')},
                        t('auto_state_' + state, {met: r.met, total: r.total}))),
                r.notes.length ? h('ul.fg-auto-list', null, r.notes.map(n => h('li', {"class": n.ok ? 'is-ok' : 'is-miss'},
                    icon(n.ok ? 'check' : 'x', 'fg-i-xs'), h('span', null, t('rule_' + n.kind) + (n.label ? ': ' + n.label : '')),
                    n.detail ? h('small', null, n.detail) : null))) : null,
                r.points.length ? h('div.fg-auto-points', null, h('div.fg-small.fg-muted', null, t('auto_keypoints')),
                    h('ul.fg-auto-list', null, r.points.map(p => h('li', {"class": 'is-' + p.status},
                        icon(p.status === 'covered' ? 'check' : (p.status === 'partial' ? 'up' : 'x'), 'fg-i-xs'),
                        h('span', null, p.point), h('small', null, t('cov_' + p.status)))))) : null,
                r.parts.length ? h('div.fg-auto-points', null, h('div.fg-small.fg-muted', null, t('auto_parts')),
                    h('ul.fg-auto-list', null, r.parts.map(p => h('li', {"class": p.ok ? 'is-ok' : 'is-miss'},
                        icon(p.ok ? 'check' : 'x', 'fg-i-xs'), h('span', null, p.label),
                        h('small', null, p.ok ? t('answered') : t('notanswered')))))) : null,
                h('div.fg-row-actions', null, apply, tip(h('button.fg-btn.is-small.is-ghost', {type: 'button',
                    onclick: () => this.acceptAll(r.crit.id)}, icon('check', 'fg-i-sm'), t('auto_acceptall')),
                        t('auto_acceptall_tip'))));
        });
        if (compliance && (compliance.laws.length || compliance.citations)) {
            const c = compliance.citations;
            blocks.push(h('section.fg-auto-card', null, h('div.fg-auto-card-head', null, h('strong', null, t('auto_compliance'))),
                h('ul.fg-auto-list', null,
                    compliance.laws.map(l => h('li', {"class": l.level === 'warn' ? 'is-miss' : 'is-ok'},
                        icon(l.level === 'warn' ? 'warning' : 'info', 'fg-i-xs'), h('span', null, l.label),
                        h('small', null, l.message))),
                    c ? h('li', {"class": c.missing.length || c.uncited.length ? 'is-miss' : 'is-ok'},
                        icon(c.missing.length || c.uncited.length ? 'warning' : 'check', 'fg-i-xs'),
                        h('span', null, c.haslist ? t('auto_cites', {n: c.cites, missing: c.missing.length,
                            uncited: c.uncited.length}) : t('auto_noreflist'))) : null)));
        }
        replace(this.out, h('p.fg-small.fg-muted', null, t('auto_made', {n: made, ms: this.results.ms})), blocks);
    }

    /**
     * Accept all suggestions (optionally for one criterion).
     *
     * @param {number} criterionid
     */
    acceptAll(criterionid) {
        const model = this.app.annotations;
        let n = 0;
        model.all().filter(a => a.status === 'suggested' && (!criterionid || a.criterionid === criterionid)).forEach(a => {
            model.update(a.clientid, {status: 'active'});
            n++;
        });
        toast(t('auto_accepted', n), {type: 'ok'});
    }

    /**
     * Fill a rubric level.
     *
     * @param {Object} crit
     * @param {number} levelid
     */
    applyLevel(crit, levelid) {
        const panel = this.app.panel;
        const f = panel.state.filling.get(crit.id) || {criterionid: crit.id, remark: ''};
        f.levelid = levelid;
        panel.state.filling.set(crit.id, f);
        panel.changed();
        toast(t('auto_levelapplied'), {type: 'ok'});
    }

    /**
     * Fill a guide score.
     *
     * @param {Object} crit
     * @param {number} score
     */
    applyScore(crit, score) {
        const panel = this.app.panel;
        const f = panel.state.filling.get(crit.id) || {criterionid: crit.id, remark: ''};
        f.score = score;
        panel.state.filling.set(crit.id, f);
        panel.changed();
        toast(t('auto_levelapplied'), {type: 'ok'});
    }

    /**
     * Test the rules on answers already marked.
     */
    async testBench() {
        const app = this.app;
        const item = this.item;
        let corpus;
        try {
            corpus = await this.corpus(item.question ? item.question.slot : 0, false);
        } catch (e) {
            toast(Api.message(e), {type: 'error'});
            return;
        }
        Bench.open(app, this.criteria(item), corpus.items);
    }

    /**
     * Group similar answers to this question.
     */
    async groups() {
        const app = this.app;
        let corpus;
        try {
            corpus = await this.corpus(this.item.question.slot, true);
        } catch (e) {
            toast(Api.message(e), {type: 'error'});
            return;
        }
        Bench.groups(app, corpus.items);
    }
}
