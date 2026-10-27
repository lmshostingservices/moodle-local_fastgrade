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
import * as Dialog from 'local_fastgrade/ui/dialog';
import * as Loader from 'local_fastgrade/lib/loader';

const SOURCES = ['instructions', 'attachments', 'grading', 'otherforms', 'graderinfo', 'question', 'template', 'wordlimit'];

// "Identifies the Act" (rubric wording) becomes "Identify the Act" (advice to the student).
const VERBS = new RegExp('^(identifies|describes|explains|applies|discusses|outlines|demonstrates|uses|provides|lists|' +
    'compares|evaluates|analyses|analyzes|justifies|includes|selects|develops|recommends|states|defines|summarises|' +
    'summarizes)\\b', 'i');


/**
 * Plain text with one line per block (paragraph, list item, heading), so list steps stay apart.
 *
 * @param {string} html
 * @returns {string}
 */
const linesOf = html => textOf(String(html || '').replace(/<\/(p|li|h[1-6]|div|tr)>|<br\s*\/?>/gi, '$&\n')
    .replace(/<li[^>]*>/gi, '$&- ')).replace(/\n\s*\n+/g, '\n').trim();

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

/**
 * What a check that was not met asks the student to do, in plain words.
 *
 * @param {Object} n note from the engine
 * @returns {string}
 */
const needText = n => {
    if (n.kind === 'length') {
        return t('auto_m_length', {want: n.label || (n.max ? n.min + '–' + n.max : n.min) + ' words', n: n.detail});
    }
    if (n.kind === 'ideas') {
        return n.missing && n.missing.length ? t('auto_m_ideas', n.missing.join(', ')) : '';
    }
    if (n.kind === 'structure') {
        if (n.label === t('auto_notesmeasure')) {
            return t('auto_m_notes', n.detail);
        }
        if (n.label === t('auto_formulameasure')) {
            return t('auto_m_formulas', n.detail);
        }
        if (n.label === t('auto_calcmeasure')) {
            return t('auto_m_calc');
        }
        return /reference/.test(n.label || '') ? t('auto_m_reflist') : t('auto_m_headings');
    }
    if (n.kind === 'pattern') {
        return /citation/.test(n.label || '') ? t('auto_m_cite') : (/legislation/.test(n.label || '') ? t('auto_m_law') :
            n.label || n.detail);
    }
    return n.label || n.detail;
};

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
        const src = this.sources();
        const on = k => src.includes(k);
        if (item.question) {
            const q = item.question;
            const qtext = textOf(q.text);
            const base = {key: 'q' + q.questionid, label: t('questionn', q.number) + ' · ' + q.name,
                text: qtext, benchmark: on('graderinfo') ? linesOf(q.graderinfo) : '', question: qtext};
            // Without grader information the question itself says what to look for.
            const whole = {key: 'qall' + q.questionid, label: t('src_wholeanswer'), whole: true, question: qtext,
                text: [on('question') && !base.benchmark.trim() ? linesOf(q.text) : '',
                    on('template') ? linesOf(q.template) : ''].filter(Boolean).join('\n'), benchmark: '',
                minwords: on('wordlimit') ? q.minwords : 0, maxwords: on('wordlimit') ? q.maxwords : 0};
            return [base, whole];
        }
        const def = info.definition || {};
        const intro = [on('instructions') ? linesOf(info.intro || '') : '',
            on('instructions') ? linesOf(info.instructions || '') : '',
            on('attachments') ? (this.briefText || '') : ''].filter(x => x.trim()).join('\n');
        const steps = Engine.instructionSteps(intro);
        // The instruction step a criterion is about sharpens its key points (shared content words, no AI).
        const withStep = (c, text) => {
            const step = Engine.matchStep(text, steps);
            return step ? Object.assign(c, {step, benchmark: c.benchmark + '\n' + step}) : c;
        };
        const whole = {key: 'all', label: t('wholesubmission'), text: intro, benchmark: '', question: intro, whole: true,
            maxwords: on('wordlimit') ? info.wordlimit || 0 : 0};
        const out = [];
        if (on('grading') && info.method === 'rubric') {
            def.criteria.forEach((c, i) => out.push(withStep({key: 'c' + c.id, id: c.id,
                label: (i + 1) + '. ' + textOf(c.description).slice(0, 80),
                text: textOf(c.description), benchmark: textOf(c.description) + '\n' +
                    ([...c.levels].sort((x, y) => x.score - y.score).map(l => textOf(l.definition)).slice(-1)[0] || ''),
                levels: c.levels, question: intro,
                top: textOf(([...c.levels].sort((x, y) => x.score - y.score).slice(-1)[0] || {}).definition || '')},
            textOf(c.description))));
        } else if (on('grading') && info.method === 'guide') {
            def.criteria.forEach((c, i) => out.push(withStep({key: 'c' + c.id, id: c.id,
                label: (i + 1) + '. ' + textOf(c.shortname),
                text: textOf(c.description), benchmark: textOf(c.descriptionmarkers) || textOf(c.description),
                maxscore: c.maxscore, question: intro, top: textOf(c.descriptionmarkers)},
            textOf(c.shortname) + ' ' + textOf(c.description))));
        }
        const other = info.otherform || {};
        if (on('otherforms') && other.text) {
            // Another grading form (for example Assignment Benchmarks): its wording becomes key points.
            out.push({key: 'form', label: other.name, text: '', question: intro,
                benchmark: other.text.split('\n').map(l => l.trim()).filter(l => l.split(/\s+/).length >= 4).join('\n')});
        }
        return out.concat([whole]);
    }

    /**
     * Where checks may come from: this activity's choice, else the site default.
     *
     * @returns {string[]}
     */
    sources() {
        const saved = (this.app.store.get('lookfors') || {}).sources;
        if (saved && saved[0] && saved[0].config && Array.isArray(saved[0].config.terms)) {
            return saved[0].config.terms;
        }
        return this.app.boot.checksources || SOURCES;
    }

    /**
     * Read the text of PDF and text files attached to the assignment (an assessment brief), once.
     *
     * @returns {Promise<string>}
     */
    async loadBrief() {
        const info = this.app.store.get('info');
        if (this.briefText !== undefined || !info || !(info.introfiles || []).length || !this.sources().includes('attachments')) {
            return this.briefText || '';
        }
        const parts = [];
        for (const f of info.introfiles) {
            try {
                if (f.mimetype === 'application/pdf') {
                    const pdfjs = await Loader.pdfjs(this.app.boot.libs);
                    const doc = await pdfjs.getDocument({url: f.url, withCredentials: true}).promise;
                    for (let i = 1; i <= Math.min(doc.numPages, 20); i++) {
                        const page = await doc.getPage(i);
                        const tc = await page.getTextContent();
                        let line = '';
                        let lastY = null;
                        tc.items.forEach(it => {
                            const y = it.transform ? Math.round(it.transform[5]) : lastY;
                            if (lastY !== null && y !== lastY && line.trim()) {
                                parts.push(line.trim());
                                line = '';
                            }
                            line += it.str + (it.hasEOL ? '\n' : '');
                            lastY = y;
                        });
                        if (line.trim()) {
                            parts.push(line.trim());
                        }
                    }
                } else if (/^text\//.test(f.mimetype)) {
                    const r = await fetch(f.url, {credentials: 'same-origin'});
                    parts.push(f.mimetype === 'text/html' ? linesOf(await r.text()) : await r.text());
                }
            } catch (e) {
                // A brief that cannot be read is skipped; the other sources still work.
            }
        }
        this.briefText = parts.join('\n').slice(0, 40000);
        return this.briefText;
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
            if ((out[c.key] || []).length) {
                return;
            }
            if (c.whole) {
                // Whole submission or answer: what the instructions or question ask for, the word limits, and
                // (for assignments) legislation and reference checks.
                const rules = Engine.fromInstructions(c.text).map(r => Object.assign(r, {auto: true}));
                if ((c.minwords || c.maxwords) && !rules.some(r => r.kind === 'length')) {
                    rules.push({kind: 'length', auto: true, config: {min: c.minwords || 0, max: c.maxwords || 0,
                        label: c.minwords && c.maxwords ? `${c.minwords}–${c.maxwords} words` :
                            (c.minwords ? `at least ${c.minwords} words` : `at most ${c.maxwords} words`)}});
                }
                if (!item.question) {
                    rules.push({kind: 'compliance', config: {}, auto: true});
                }
                out[c.key] = rules;
                return;
            }
            if (!c.benchmark.trim()) {
                return;
            }
            const levels = c.levels ? [...c.levels].sort((x, y) => x.score - y.score) : [];
            // Key ideas come from rubric or guide wording; an essay's grader information is already its key points.
            const ideas = item.question ? [] : Engine.keyIdeas(c.text + ' ' + (c.top || ''));
            out[c.key] = [{kind: 'keypoints', config: {terms: Engine.splitPoints(c.benchmark)}, auto: true},
                ...(ideas.length >= 2 ? [{kind: 'ideas', config: {terms: ideas, min: 0, label: ''}, auto: true}] : []),
                {kind: 'threshold', config: levels.length ? {levelid: levels[levels.length - 1].id,
                    partiallevelid: levels[Math.floor((levels.length - 1) / 2)].id} : {}, auto: true}];
        });
        return out;
    }

    /**
     * Whether there is anything to run for this item.
     *
     * @param {Object} item
     * @returns {boolean}
     */
    hasRules(item) {
        const lf = this.lookfors(item);
        return Object.keys(lf).some(k => k !== 'sources' && lf[k].length);
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
                !this.app.readonly && configured.length ? tip(h('button.fg-btn.is-small',
                    {type: 'button', onclick: () => this.markAll()},
                    icon('users', 'fg-i-sm'), t('auto_all')), t('auto_all_tip')) : null,
                can ? tip(h('button.fg-btn.is-small', {type: 'button', onclick: async() => {
                    await this.loadBrief();
                    const fresh = this.criteria(item);
                    Editor.open(this.app, fresh, () => {
                        this.app.panel.renderBody();
                    }, this.lookfors(item), {sources: this.sources(), quiz: !!item.question, info: this.app.store.get('info')});
                }}, icon('list', 'fg-i-sm'), t('auto_setup')), t('auto_setup_tip')) : null,
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
            const pages = await v.pagesText();
            // Speaker notes count as evidence too (they cannot be highlighted on the slide, so page is a negative number).
            if (v.notesReady) {
                await v.notesReady;
            }
            (v.slideNotes || []).forEach((n, i) => {
                if (n.trim()) {
                    pages.push({page: -(i + 1), text: n, notes: true});
                }
            });
            return pages;
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
        if (page < 0) {
            return null;
        }
        if (v.anchorForPage && page) {
            return v.anchorForPage(page, start, end);
        }
        if (v.anchorFor) {
            return v.anchorFor(start, end);
        }
        return null;
    }

    /**
     * Auto-mark every submission still waiting: open each one in turn, run the checks on every document and
     * keep the result as a draft. Nothing is released and nothing a person has started is touched.
     */
    async markAll() {
        const app = this.app;
        if (this.batch) {
            return;
        }
        const st = app.store;
        const queue = st.get('participants').filter(p => p.submitted !== false && p.needsgrading && !p.hasdraft);
        if (!queue.length) {
            toast(t('auto_all_none'), {type: 'info'});
            return;
        }
        const ok = await Dialog.confirm(t('auto_all'), t('auto_all_confirm', queue.length), t('auto_all_go'));
        if (!ok) {
            return;
        }
        const startEntry = st.get('current');
        const bar = h('span.fg-batch-fill');
        const label = h('span.fg-batch-label');
        const count = h('span.fg-batch-count');
        const stop = h('button.fg-btn.is-small', {type: 'button', onclick: () => {
            job.stopped = true;
            stop.disabled = true;
            label.textContent = t('auto_all_stopping');
        }}, t('auto_all_stop'));
        const card = h('div.fg-batch', {role: 'status', 'aria-live': 'polite'}, icon('wand', 'fg-i-sm'),
            h('div.fg-batch-main', null, h('div.fg-batch-row', null, label, count), h('span.fg-batch-track', null, bar)), stop);
        (app.root || document.body).appendChild(card);
        const job = {stopped: false, done: 0, marked: 0, suggestions: 0, skipped: 0, failed: []};
        this.batch = job;
        app.batch = true;
        const started = Date.now();
        try {
            for (const entry of queue) {
                if (job.stopped) {
                    break;
                }
                label.textContent = t('auto_all_now', entry.person.fullname);
                count.textContent = `${job.done + 1} / ${queue.length}`;
                bar.style.width = Math.round(job.done / queue.length * 100) + '%';
                await app.open(entry);
                const item = st.get('item');
                if (!item || st.get('current') !== entry || !(item.docs || []).length) {
                    job.skipped++;
                    job.done++;
                    continue;
                }
                let made = 0;
                let read = 0;
                for (const doc of item.docs) {
                    if (job.stopped) {
                        break;
                    }
                    const already = app.annotations.forDoc(doc.docref).some(a => a.source === 'auto');
                    if (already) {
                        read++;
                        continue;
                    }
                    let ready = false;
                    try {
                        ready = await app.viewer.openAndWait(doc);
                    } catch (e) {
                        ready = false;
                    }
                    if (!ready || !this.hasRules(item)) {
                        continue;
                    }
                    read++;
                    await this.run(true);
                    made += (this.results && this.results.made) || 0;
                }
                if (read) {
                    job.marked++;
                    job.suggestions += made;
                    await app.annotations.flush();
                    if (st.get('dirty')) {
                        app.draftQueue.cancel();
                        await app.saveDraft();
                    }
                } else {
                    job.failed.push(entry.person.fullname);
                }
                job.done++;
            }
        } finally {
            this.batch = null;
            app.batch = false;
            card.remove();
        }
        await app.loadParticipants();
        const secs = Math.max(1, Math.round((Date.now() - started) / 1000));
        toast(t('auto_all_done', {n: job.marked, s: job.suggestions, secs}) +
            (job.failed.length ? ' ' + t('auto_all_failed', job.failed.slice(0, 3).join(', ')) : ''), {type: 'ok', timeout: 9000});
        const first = st.get('participants').find(p => queue.some(q => q.key === p.key)) || startEntry;
        if (first) {
            await app.open(first, {force: true});
        }
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
        await this.loadBrief();
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
            model.create({docref: v.docref, page: an.page, anchor: an.anchor, type: v.markType || 'border', polarity, comment,
                source: 'auto', status: 'suggested', criterionid: criterionid || 0});
            made++;
        };
        crit.forEach(c => {
            const rules = lookfors[c.key] || [];
            if (!rules.length) {
                return;
            }
            // Slides and spreadsheets say things in a few words, so ideas found anywhere count for more there.
            const res = {crit: c, notes: [], points: [], parts: [], met: 0, total: 0,
                terse: !!(app.viewer.doc && ['slides', 'sheet'].includes(app.viewer.doc.kind))};
            const checkrules = rules.filter(r => ['term', 'anyof', 'pattern', 'mustnot', 'length', 'structure', 'ideas']
                .includes(r.kind));
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
                checkrules.filter(r => r.kind === 'ideas').forEach(r => {
                    const ev = Engine.evaluate(all, [r]);
                    merged.set('ideas|' + (r.config.label || ''), ev.notes[0]);
                });
                const lenrule = checkrules.find(r => r.kind === 'length');
                if (lenrule) {
                    const ev = Engine.evaluate(all, [lenrule]);
                    merged.set('length|' + (lenrule.config.label || ''), ev.notes[0]);
                }
            }
            res.notes = [...merged.values()];
            // Slides: a criterion about speaker notes is measured by how many slides have them.
            const v2 = app.viewer.viewer;
            if (!c.whole && v2 && v2.slideNotes && v2.slideNotes.length && /\bnotes\b/i.test(c.text + ' ' + c.benchmark)) {
                const words = v2.slideNotes.map(n => n.trim() ? n.trim().split(/\s+/).length : 0);
                const withnotes = words.filter(w => w >= 4).length;
                // How many slides have notes, and whether they are enough to deliver from (about 12 words or more).
                const cover = withnotes / v2.slideNotes.length;
                const depth = withnotes ? Math.min(1, words.filter(w => w >= 4).reduce((a, b) => a + b, 0) / withnotes / 12) : 0;
                const ratio = cover * (0.6 + 0.4 * depth);
                res.notes.push({kind: 'structure', ok: ratio >= 0.85, label: t('auto_notesmeasure'),
                    detail: `${withnotes}/${v2.slideNotes.length}`, ratio, measure: true});
            }
            // Spreadsheets: criteria about formulas or calculations are measured directly on the cells.
            if (!c.whole && v2 && v2.sheetFacts) {
                const facts = v2.sheetFacts();
                const words = c.text + ' ' + c.benchmark + ' ' + (c.top || '');
                if (/\bformula/i.test(c.text + ' ' + (c.label || '')) && facts.totals) {
                    const ratio = facts.formulas / facts.totals;
                    res.notes.push({kind: 'structure', ok: ratio >= 0.9, label: t('auto_formulameasure'),
                        detail: `${facts.formulas}/${facts.totals}`, ratio, measure: true});
                } else if (/\b(calculat|total|correct|accura|add up|arithmetic)/i.test(words) && facts.checked) {
                    const ratio = (facts.checked - facts.wrong) / facts.checked;
                    res.notes.push({kind: 'structure', ok: !facts.wrong, label: t('auto_calcmeasure'),
                        detail: `${facts.checked - facts.wrong}/${facts.checked}`, ratio: facts.wrong ? Math.min(ratio, 0.3) : 1,
                        measure: true});
                    facts.wrongcells.forEach(w => {
                        const sh = v2.data.sheets[w.page - 1];
                        const ann = {page: w.page,
                            anchor: {cell: w.ref, sheet: sh ? sh.name : '', exact: String(w.v), formula: ''}};
                        {
                            model.create({docref: v2.docref, page: ann.page, anchor: ann.anchor, type: 'cell',
                                polarity: 'improvement',
                                comment: t('auto_calcwrong', w.ref), source: 'auto', status: 'suggested', criterionid: c.id || 0});
                            made++;
                        }
                    });
                }
            }
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
                // Each part: the first page with a sentence that answers it, marked as evidence.
                const perpage = pages.map(pg => Engine.partsCheck(pg.text, r.config.terms || []));
                res.parts = (r.config.terms || []).map((x, i) => {
                    const pi = perpage.findIndex(list => list[i] && list[i].ok);
                    return pi >= 0 ? Object.assign({page: pages[pi].page}, perpage[pi][i]) : (perpage[0] || [])[i] ||
                        {label: x, ok: false, start: -1, end: -1};
                });
                res.parts.filter(p => p.ok).forEach(p => {
                    const k = p.page + ':' + p.start;
                    if (!seen.has(k)) {
                        seen.add(k);
                        suggest(p.page, p.start, p.end, 'positive', t('auto_partok', p.label.replace(/…$/, '')), c.id);
                    }
                });
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
        } else if ((made || filled) && !app.batch) {
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
        // A direct measure (speaker notes on slides) decides its criterion on its own.
        const measure = r.notes.find(n => n.measure);
        if (measure) {
            return Math.min(1, measure.ratio || 0);
        }
        let got = 0;
        let total = 0;
        let ideas = null;
        r.notes.forEach(n => {
            if (n.kind === 'ideas') {
                ideas = n.ok ? 1 : (n.ratio || 0);
                return;
            }
            total++;
            got += n.ok ? 1 : (n.ratio || 0) * 0.9;
        });
        r.points.forEach(p => {
            total++;
            got += p.status === 'covered' ? 1 : (p.status === 'partial' ? 0.5 : 0);
        });
        r.parts.forEach(p => {
            total++;
            got += p.ok ? 1 : 0;
        });
        const rest = total ? got / total : 0;
        // Key ideas found anywhere and the stricter sentence-level checks share the weight.
        const w = r.terse ? 0.55 : 0.25;
        const share = ideas === null ? rest : (total ? w * ideas + (1 - w) * rest : ideas);
        return Math.min(1, share);
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
            // Word limits and layout matter less than whether the content is there.
            const weight = r.crit.whole && results.length > 1 ? 0.25 : 1;
            total += share * weight;
            count += weight;
            const good = r.points.filter(p => p.status === 'covered').map(p => p.point)
                .concat(r.parts.filter(p => p.ok).map(p => p.label));
            const miss = r.points.filter(p => p.status !== 'covered').map(p => p.point)
                .concat(r.parts.filter(p => !p.ok).map(p => (/^(what|how|why|who|when|where|which)\b/i.test(p.label) ?
                    t('auto_m_answer', lower(p.label.replace(/[…?]+$/, ''))) : p.label)))
                .concat(r.notes.filter(n => !n.ok).map(needText).filter(Boolean));
            const key = x => String(x).toLowerCase().replace(/[^a-z0-9 ]/g, '').split(' ').filter(w => w.length > 3)
                .slice(0, 5).join(' ');
            const uniq = list => list.filter((x, i) => list.findIndex(y => key(y) === key(x)) === i);
            good.splice(0, good.length, ...uniq(good));
            miss.splice(0, miss.length, ...uniq(miss).filter(x => !good.some(g => key(g) === key(x))));
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
        Bench.open(app, this.criteria(item), corpus.items, this.lookfors(item));
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
