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
 * Marking panel: grade, rubric or marking guide, overall feedback, comment bank, notes, question
 * details, integrity results and auto-marking suggestions.
 *
 * @module     local_fastgrade/ui/panel
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon, replace, textOf, words, debounce, date} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import {tip} from 'local_fastgrade/ui/tooltip';
import * as Shortcuts from 'local_fastgrade/ui/shortcuts';
import * as Dictate from 'local_fastgrade/voice/dictate';
import * as Api from 'local_fastgrade/lib/api';
import {toast} from 'local_fastgrade/ui/toast';
import BankPicker from 'local_fastgrade/ui/bankpicker';
import * as Criteria from 'local_fastgrade/ui/criteria';
import AutoTab from 'local_fastgrade/autograde/tab';

const fmt = n => {
    if (n === null || n === undefined || n === '' || isNaN(n)) {
        return '';
    }
    return String(Math.round(Number(n) * 100) / 100);
};

/**
 * What the auto-marker filled in and the marker has not yet checked.
 *
 * @param {Object|null} a
 * @returns {Object}
 */
const normaliseAuto = a => ({levels: (a && a.levels) || [], remarks: (a && a.remarks) || [], feedback: !!(a && a.feedback),
    grade: !!(a && a.grade)});

export default class Panel {
    /**
     * Constructor.
     *
     * @param {Object} app
     */
    constructor(app) {
        this.app = app;
        this.state = null;
        this.dictlog = [];
        this.activeCriterion = 0;
        this.tabs = h('div.fg-tabs', {role: 'tablist', 'aria-label': t('panel')});
        this.body = h('div.fg-panel-body');
        this.footer = h('div.fg-panel-foot');
        this.el = h('aside.fg-panel', {'aria-label': t('panel')}, this.tabs, this.body, this.footer);
        this.tab = 'mark';
        this.bank = new BankPicker(app);
        this.auto = new AutoTab(app);
        app.store.on('bank', () => {
            if (this.tab === 'bank') {
                this.renderBody();
            }
        });
    }

    /**
     * Loading state.
     */
    loading() {
        replace(this.body, h('div.fg-skeleton', null, h('i'), h('i'), h('i'), h('i')));
        replace(this.footer);
    }

    /**
     * Nothing to mark.
     */
    empty() {
        replace(this.body, h('div.fg-empty-small', null, t('nothingtomark')));
        replace(this.footer);
    }

    /**
     * Show an item.
     *
     * @param {Object} item
     * @param {boolean} keepTab
     */
    show(item, keepTab = false) {
        this.item = item;
        const gs = item.gradestate;
        const draft = item.draft;
        this.state = {
            grade: draft && draft.grade !== undefined ? draft.grade : (gs.grade === null ? '' : fmt(gs.grade)),
            filling: new Map(),
            feedback: draft && draft.feedback !== undefined ? draft.feedback : (gs.feedback || ''),
            workflowstate: draft && draft.workflowstate ? draft.workflowstate : (gs.workflowstate || ''),
            notify: draft && draft.notify !== undefined ? draft.notify : this.app.store.get('info').sendnotifications,
        };
        this.state.auto = normaliseAuto(draft && draft.auto);
        const filling = draft && draft.filling ? draft.filling : (gs.filling || []);
        filling.forEach(f => this.state.filling.set(f.criterionid, Object.assign({}, f)));
        this.dictlog = [];
        this.activeCriterion = 0;
        if (draft) {
            this.app.store.set({dirty: true, savestate: 'draft'});
        }
        if (!keepTab) {
            this.tab = 'mark';
        }
        this.renderTabs();
        this.renderBody();
        this.renderFooter();
    }

    /**
     * The tabs available.
     *
     * @returns {Array}
     */
    tabList() {
        const item = this.item;
        const app = this.app;
        const list = [['mark', t('tab_mark'), 'check']];
        if (item.question) {
            list.push(['question', t('tab_question'), 'question']);
        }
        list.push(['bank', t('tab_bank'), 'bank']);
        if (app.boot.autograde) {
            list.push(['auto', t('tab_auto'), 'wand']);
        }
        const integ = item.integrations || {};
        if ((integ.docguard && Object.keys(integ.docguard).length) || (integ.essayguard && integ.essayguard.overall)) {
            list.push(['integrity', t('tab_integrity'), 'shield']);
        }
        list.push(['notes', t('tab_notes'), 'note']);
        return list;
    }

    /**
     * Render tabs.
     */
    renderTabs() {
        replace(this.tabs, this.tabList().map(([id, label, ic]) => {
            const b = h('button.fg-tab', {type: 'button', role: 'tab', 'aria-selected': String(this.tab === id),
                "class": 'fg-tab-' + id + (id === 'integrity' ? ' fg-integrity' : (id === 'notes' ? ' fg-notes-tab' :
                    (id === 'bank' ? ' fg-bank-tab' : ''))),
                onclick: () => {
                    this.tab = id;
                    this.renderTabs();
                    this.renderBody();
                }}, icon(ic, 'fg-i-sm'), h('span', null, label));
            return tip(b, t('tab_' + id + '_tip'));
        }));
    }

    /**
     * Render the active tab.
     */
    renderBody() {
        if (!this.item) {
            return;
        }
        let content;
        switch (this.tab) {
            case 'question': content = this.questionTab(); break;
            case 'bank': content = this.bank.render({onInsert: text => this.insertFeedback(text)}); break;
            case 'auto': content = this.auto.render(this.item); break;
            case 'integrity': content = this.integrityTab(); break;
            case 'notes': content = this.notesTab(); break;
            default: content = this.markTab();
        }
        replace(this.body, content);
    }

    /**
     * Show a count on the Auto tab when suggestions are waiting.
     *
     * @param {number} n
     */
    markAutoReady(n) {
        const tab = this.tabs.querySelector('.fg-tab-auto');
        if (tab) {
            const old = tab.querySelector('.fg-count');
            if (old) {
                old.remove();
            }
            if (n) {
                tab.appendChild(h('span.fg-count', null, String(n)));
            }
        }
    }

    /**
     * Mark changed.
     */
    changed() {
        this.app.changed();
        this.updateSummary();
        this.refreshApproval();
    }

    /* ---------- Auto-marked: review and approve ---------- */

    /**
     * Number of auto-marked things still waiting for the marker.
     *
     * @returns {number}
     */
    pending() {
        const a = this.state && this.state.auto;
        if (!a) {
            return 0;
        }
        const anns = this.app.annotations ? this.app.annotations.all().filter(x => x.status === 'suggested').length : 0;
        return a.levels.length + a.remarks.length + (a.feedback ? 1 : 0) + (a.grade ? 1 : 0) + anns;
    }

    /**
     * The marker has checked one auto-filled field.
     *
     * @param {string} kind levels, remarks, feedback, grade
     * @param {number} id criterion id
     */
    reviewed(kind, id) {
        const a = this.state && this.state.auto;
        if (!a) {
            return;
        }
        if (kind === 'feedback' || kind === 'grade') {
            a[kind] = false;
        } else {
            a[kind] = a[kind].filter(x => x !== id);
        }
    }

    /**
     * Approve everything the auto-marker suggested for this student.
     *
     * @param {boolean} quiet
     * @returns {number} how many were approved
     */
    approveAll(quiet = false) {
        const n = this.pending();
        if (!n) {
            return 0;
        }
        this.state.auto = normaliseAuto(null);
        if (this.app.annotations) {
            this.app.annotations.all().filter(x => x.status === 'suggested').forEach(x =>
                this.app.annotations.update(x.clientid, {status: 'active'}));
        }
        if (!quiet) {
            this.renderBody();
            this.changed();
            toast(t('auto_approved', n), {type: 'ok'});
        }
        return n;
    }

    /**
     * Update the banner and footer after a change.
     */
    refreshApproval() {
        const n = this.pending();
        if (this.banner) {
            this.banner.hidden = !n;
            const c = this.banner.querySelector('.fg-autobanner-n');
            if (c) {
                c.textContent = t('auto_pending', n);
            }
        }
        const label = this.footer.querySelector('.fg-savenext > span');
        if (label) {
            label.textContent = n ? t('approvenext') : t('savenext');
        }
    }

    /**
     * Small "Suggested" label.
     *
     * @returns {HTMLElement}
     */
    suggestedChip() {
        return tip(h('span.fg-chip.is-suggested', null, icon('wand', 'fg-i-xs'), t('suggested')), t('suggested_level_tip'));
    }

    /**
     * Banner on the mark tab while auto-marked items wait.
     *
     * @returns {HTMLElement}
     */
    autoBanner() {
        this.banner = h('div.fg-autobanner', {role: 'status'},
            icon('wand', 'fg-i-sm'),
            h('div.fg-autobanner-text', null, h('strong', null, t('auto_banner_title')),
                h('span.fg-autobanner-n', null, t('auto_pending', this.pending()))),
            tip(h('button.fg-btn.is-small.is-primary', {type: 'button', onclick: () => this.approveAll()},
                icon('check', 'fg-i-sm'), t('auto_approveall')), t('auto_approveall_tip'), 'Shift+A'));
        this.banner.hidden = !this.pending();
        return this.banner;
    }

    /* ---------- Mark tab ---------- */

    /**
     * The mark tab.
     *
     * @returns {Array}
     */
    markTab() {
        const info = this.app.store.get('info');
        const item = this.item;
        const parts = [this.autoBanner()];
        this.summary = h('div.fg-grade-summary');
        parts.push(this.summary);
        if (item.question && item.question.criteria && item.question.criteria.length) {
            parts.push(this.guideSection(item.question.criteria.map(c => ({id: c.id, shortname: c.description,
                description: '', maxscore: c.maxscore})), true));
        } else if (info.method === 'rubric') {
            parts.push(this.rubricSection());
        } else if (info.method === 'guide') {
            parts.push(this.guideSection(info.definition.criteria, false));
        }
        if (item.question && this.app.canmanagecriteria) {
            parts.push(h('div.fg-row-actions', null, tip(h('button.fg-btn.is-ghost.is-small', {type: 'button',
                onclick: () => Criteria.editQuiz(this.app, item)}, icon('list'),
                item.question.criteria && item.question.criteria.length ? t('editcriteria') : t('addcriteria')),
                t('criteria_tip'))));
        }
        parts.push(this.feedbackSection());
        if (info.markingworkflow && info.workflowstates.length) {
            parts.push(this.workflowSection());
        }
        this.updateSummary();
        return parts;
    }

    /**
     * Grade box and computed total.
     */
    updateSummary() {
        if (!this.summary) {
            return;
        }
        const info = this.app.store.get('info');
        const item = this.item;
        const st = this.state;
        const bits = [];
        if (item.question) {
            const q = item.question;
            const max = q.maxmark;
            const crit = q.criteria && q.criteria.length;
            if (crit) {
                const v = this.criteriaTotal(q.criteria.map(c => ({id: c.id, maxscore: c.maxscore})), max);
                bits.push(h('div.fg-grade-big', null, h('span', null, v === null ? '–' : fmt(v)), h('small', null,
                    ' / ' + fmt(max))));
            } else if (max > 0) {
                bits.push(this.pointInput(max, q.minfraction * max, q.maxfraction * max));
                bits.push(h('div.fg-quick', null, [0, max / 2, max].map(v => tip(h('button.fg-chip-btn', {type: 'button',
                    onclick: () => {
                        st.grade = fmt(v);
                        this.reviewed('grade');
                        this.changed();
                        this.renderBody();
                    }}, fmt(v)), t('quickmark_tip', fmt(v))))));
            } else {
                bits.push(h('div.fg-muted', null, t('commentonly')));
            }
            if (q.state === 'needsgrading') {
                bits.push(h('span.fg-chip.is-amber', null, t('state_needs')));
            }
        } else if (info.method === 'rubric' || info.method === 'guide') {
            const v = info.method === 'rubric' ? this.rubricGrade() : this.criteriaTotal(info.definition.criteria, info.maxgrade);
            bits.push(h('div.fg-grade-big', null, h('span', null, v === null ? '–' : fmt(v)),
                h('small', null, info.gradetype === 'point' ? ' / ' + fmt(info.maxgrade) : '')));
            bits.push(h('div.fg-muted.fg-small', null, info.method === 'rubric' ? t('rubricgrade_note') : t('guidegrade_note')));
        } else if (info.gradetype === 'point') {
            bits.push(this.pointInput(info.maxgrade, 0, info.maxgrade));
        } else if (info.gradetype === 'scale') {
            bits.push(h('div.fg-scale', {role: 'radiogroup', 'aria-label': t('grade')}, info.scaleitems.map((s, i) => {
                const on = String(st.grade) === String(s.value);
                return tip(h('button.fg-scale-btn', {type: 'button', role: 'radio', 'aria-checked': String(on),
                    onclick: () => {
                        st.grade = on ? '' : String(s.value);
                        this.changed();
                        this.updateSummary();
                    }}, s.label), s.label, String(i + 1));
            })));
        } else {
            bits.push(h('div.fg-muted', null, t('nograde')));
        }
        if (item.gradestate && item.gradestate.gradedisplay) {
            bits.push(h('div.fg-small.fg-muted', null, t('ingradebook', item.gradestate.gradedisplay) +
                (item.gradestate.grader ? ' · ' + item.gradestate.grader : '')));
        }
        replace(this.summary, bits);
    }

    /**
     * Number box for a points grade.
     *
     * @param {number} max
     * @param {number} min
     * @param {number} hardmax
     * @returns {HTMLElement}
     */
    pointInput(max, min, hardmax) {
        const st = this.state;
        const input = h('input.fg-grade-input', {type: 'text', inputmode: 'decimal', value: st.grade, autocomplete: 'off',
            'aria-label': t('grade_out_of', fmt(max)), id: 'fg-grade-input', "class": st.auto.grade ? 'is-suggested' : '',
            oninput: e => {
                st.grade = e.target.value.trim();
                this.reviewed('grade');
                e.target.classList.remove('is-suggested');
                this.refreshApproval();
                const n = parseFloat(st.grade.replace(',', '.'));
                const bad = st.grade !== '' && (isNaN(n) || n < min || n > hardmax);
                e.target.classList.toggle('is-invalid', bad);
                e.target.setAttribute('aria-invalid', bad ? 'true' : 'false');
                this.app.changed();
            },
            onkeydown: e => {
                if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    this.focusFeedback();
                }
            }});
        return tip(h('label.fg-grade-box', null, input, h('span.fg-grade-max', null, '/ ' + fmt(max))),
            t('grade_tip', fmt(max)), 'G');
    }

    /**
     * Rubric grade estimate, as Moodle calculates it.
     *
     * @returns {number|null}
     */
    rubricGrade() {
        const info = this.app.store.get('info');
        const crit = info.definition.criteria;
        let minsum = 0;
        let maxsum = 0;
        let cur = 0;
        let complete = true;
        crit.forEach(c => {
            const scores = c.levels.map(l => l.score);
            minsum += Math.min(...scores);
            maxsum += Math.max(...scores);
            const f = this.state.filling.get(c.id);
            const lvl = f && c.levels.find(l => l.id === f.levelid);
            if (lvl) {
                cur += lvl.score;
            } else {
                complete = false;
            }
        });
        if (!complete || maxsum <= minsum) {
            return null;
        }
        const max = info.gradetype === 'point' ? info.maxgrade : 100;
        return (cur - minsum) / (maxsum - minsum) * max;
    }

    /**
     * Total for guide-style criteria scaled to a maximum.
     *
     * @param {Array} criteria
     * @param {number} max
     * @returns {number|null}
     */
    criteriaTotal(criteria, max) {
        let sum = 0;
        let maxsum = 0;
        for (const c of criteria) {
            const f = this.state.filling.get(c.id);
            maxsum += c.maxscore;
            if (!f || f.score === null || f.score === undefined || f.score === '') {
                return null;
            }
            sum += Number(f.score);
        }
        return maxsum ? sum / maxsum * max : null;
    }

    /**
     * Rubric.
     *
     * @returns {HTMLElement}
     */
    rubricSection() {
        const info = this.app.store.get('info');
        const crit = info.definition.criteria;
        const firstopen = crit.findIndex(c => !(this.state.filling.get(c.id) || {}).levelid);
        this.activeCriterion = firstopen >= 0 ? firstopen : 0;
        this.critEls = crit.map((c, ci) => {
            const f = this.state.filling.get(c.id) || {criterionid: c.id, levelid: 0, remark: ''};
            this.state.filling.set(c.id, f);
            const levels = h('div.fg-levels', {role: 'radiogroup', 'aria-label': textOf(c.description)},
                c.levels.map((l, li) => {
                    const on = f.levelid === l.id;
                    const b = h('button.fg-level', {type: 'button', role: 'radio', 'aria-checked': String(on),
                        "class": on && this.state.auto.levels.includes(c.id) ? 'is-suggested' : '',
                        onclick: () => this.pickLevel(ci, li)},
                        h('span.fg-level-score', null, fmt(l.score)),
                        h('span.fg-level-def', {html: l.definition}));
                    return tip(b, `${textOf(l.definition)}\n${t('points', fmt(l.score))}`, String(li + 1));
                }));
            const remark = this.remarkBox(f, 'criterion', c.id);
            const el = h('section.fg-crit', {"class": ci === this.activeCriterion ? 'is-active' : '', dataset: {ci},
                    onfocusin: () => this.setActive(ci)},
                h('div.fg-crit-head', null, h('span.fg-crit-n', null, String(ci + 1)), h('div.fg-crit-desc', {html: c.description}),
                    this.state.auto.levels.includes(c.id) ? this.suggestedChip() : null,
                    f.levelid ? icon('check', 'fg-i-sm fg-crit-done') : null),
                levels, remark);
            return el;
        });
        return h('div.fg-rubric', null, h('h3.fg-section-title', null, info.definition.name || t('rubric'),
            h('span.fg-hint', null, t('rubric_hint'))), this.critEls);
    }

    /**
     * Pick a rubric level.
     *
     * @param {number} ci criterion index
     * @param {number} li level index
     */
    pickLevel(ci, li) {
        const info = this.app.store.get('info');
        const c = info.definition.criteria[ci];
        const l = c && c.levels[li];
        if (!l) {
            return;
        }
        const f = this.state.filling.get(c.id);
        const wasSuggested = this.state.auto.levels.includes(c.id) && f.levelid === l.id;
        // Clicking the suggested level confirms it rather than clearing it.
        f.levelid = f.levelid === l.id && !wasSuggested ? 0 : l.id;
        this.reviewed('levels', c.id);
        const el = this.critEls[ci];
        el.querySelectorAll('.fg-level.is-suggested').forEach(b => b.classList.remove('is-suggested'));
        const chip = el.querySelector('.fg-chip.is-suggested');
        if (chip) {
            chip.remove();
        }
        el.querySelectorAll('.fg-level').forEach((b, i) => b.setAttribute('aria-checked', String(f.levelid && i === li)));
        const done = el.querySelector('.fg-crit-done');
        if (f.levelid && !done) {
            el.querySelector('.fg-crit-head').appendChild(icon('check', 'fg-i-sm fg-crit-done'));
        } else if (!f.levelid && done) {
            done.remove();
        }
        this.changed();
        if (f.levelid && ci < this.critEls.length - 1) {
            this.setActive(ci + 1, true);
        }
    }

    /**
     * Make a criterion active (number keys pick its level).
     *
     * @param {number} ci
     * @param {boolean} scroll
     */
    setActive(ci, scroll = false) {
        this.activeCriterion = ci;
        (this.critEls || []).forEach((el, i) => el.classList.toggle('is-active', i === ci));
        if (scroll && this.critEls[ci]) {
            this.critEls[ci].scrollIntoView({block: 'nearest', behavior: 'smooth'});
        }
    }

    /**
     * Marking guide (also used for the quiz criteria panel).
     *
     * @param {Array} criteria
     * @param {boolean} quiz
     * @returns {HTMLElement}
     */
    guideSection(criteria, quiz) {
        const info = this.app.store.get('info');
        const comments = quiz ? [] : (info.definition.comments || []);
        this.activeCriterion = 0;
        this.critEls = criteria.map((c, ci) => {
            const f = this.state.filling.get(c.id) || {criterionid: c.id, score: '', remark: ''};
            this.state.filling.set(c.id, f);
            const input = h('input.fg-score-input', {type: 'text', inputmode: 'decimal', value: f.score ?? '',
                "class": this.state.auto.levels.includes(c.id) ? 'is-suggested' : '',
                'aria-label': t('score_for', textOf(c.shortname)), oninput: e => {
                    const v = e.target.value.trim();
                    const n = parseFloat(v.replace(',', '.'));
                    const bad = v !== '' && (isNaN(n) || n < 0 || n > c.maxscore);
                    e.target.classList.toggle('is-invalid', bad);
                    f.score = v === '' || bad ? '' : n;
                    this.reviewed('levels', c.id);
                    e.target.classList.remove('is-suggested');
                    this.changed();
                }});
            const quick = h('div.fg-quick', null, [0, c.maxscore / 2, c.maxscore].map(v => h('button.fg-chip-btn', {type: 'button',
                onclick: () => {
                    f.score = v;
                    input.value = fmt(v);
                    input.classList.remove('is-invalid', 'is-suggested');
                    this.reviewed('levels', c.id);
                    this.changed();
                    if (ci < this.critEls.length - 1) {
                        this.setActive(ci + 1, true);
                    }
                }}, fmt(v))));
            const remark = this.remarkBox(f, 'criterion', c.id);
            const chips = comments.length ? h('div.fg-guide-comments', null, comments.slice(0, 12).map(cm => tip(
                h('button.fg-chip-btn.is-text', {type: 'button', onclick: () => {
                    const ta = remark.querySelector('textarea');
                    ta.value = (ta.value ? ta.value.replace(/\s*$/, ' ') : '') + cm.text;
                    ta.dispatchEvent(new Event('input', {bubbles: true}));
                }}, cm.text.length > 40 ? cm.text.slice(0, 38) + '…' : cm.text), cm.text))) : null;
            return h('section.fg-crit', {"class": ci === 0 ? 'is-active' : '', onfocusin: () => this.setActive(ci)},
                h('div.fg-crit-head', null, h('span.fg-crit-n', null, String(ci + 1)),
                    this.state.auto.levels.includes(c.id) ? this.suggestedChip() : null,
                    h('div.fg-crit-desc', null, h('strong', {html: c.shortname}), c.description ?
                        h('details.fg-crit-more', null, h('summary', null, t('showdescription')), h('div', {html: c.description}),
                            c.descriptionmarkers ? h('div.fg-markers', {html: c.descriptionmarkers}) : null) : null)),
                h('div.fg-score-row', null, tip(h('label.fg-score-box', null, input, h('span', null, '/ ' + fmt(c.maxscore))),
                    t('score_tip', fmt(c.maxscore))), quick),
                chips, remark);
        });
        return h('div.fg-guide', null, h('h3.fg-section-title', null, quiz ? t('criteria') : (info.definition.name ||
            t('markingguide'))), this.critEls);
    }

    /**
     * Remark box for a criterion, with a mic.
     *
     * @param {Object} f filling
     * @param {string} target
     * @param {number} critid
     * @returns {HTMLElement}
     */
    remarkBox(f, target, critid = 0) {
        const suggested = critid && this.state.auto.remarks.includes(critid);
        const ta = h('textarea.fg-textarea.is-small', {rows: f.remark ? Math.min(6, 1 + Math.ceil(f.remark.length / 48)) : 1,
            placeholder: t('criterioncomment'), "class": suggested ? 'is-suggested' : '',
            'aria-label': t('criterioncomment'), oninput: e => {
                f.remark = e.target.value;
                if (critid) {
                    this.reviewed('remarks', critid);
                    e.target.classList.remove('is-suggested');
                    this.refreshApproval();
                }
                e.target.rows = Math.min(8, Math.max(1, e.target.value.split('\n').length + (e.target.value.length > 60 ? 1 : 0)));
                this.app.changed();
            }});
        ta.value = f.remark || '';
        const wrap = h('div.fg-dictate-host.fg-remark', null, ta);
        const mic = Dictate.micButton(ta, {small: true, label: t('dictate_criterion_tip'),
            onStop: info => this.logDictation(target, 'neutral', info)});
        if (mic) {
            wrap.appendChild(mic);
        }
        return wrap;
    }

    /**
     * Overall feedback editor.
     *
     * @returns {HTMLElement}
     */
    feedbackSection() {
        const info = this.app.store.get('info');
        if (!info.feedbackcomments && !this.item.question) {
            return h('div.fg-muted.fg-small', null, t('feedbackdisabled'));
        }
        const ed = h('div.fg-editor', {contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true',
            'aria-label': t('overallfeedback'), 'data-placeholder': t('feedback_placeholder'), spellcheck: 'true',
            html: this.state.feedback, "class": this.state.auto.feedback ? 'is-suggested' : ''});
        this.editor = ed;
        const sync = () => {
            this.reviewed('feedback');
            ed.classList.remove('is-suggested');
            this.state.feedback = ed.innerHTML === '<br>' ? '' : ed.innerHTML;
            wc.textContent = t('nwords', words(ed.innerText));
            this.app.changed();
        };
        ed.addEventListener('input', () => {
            sync();
            this.bank.checkTrigger(ed, text => {
                this.state.feedback = ed.innerHTML;
                this.app.changed();
                return text;
            });
        });
        ed.addEventListener('paste', e => {
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData).getData('text/plain');
            document.execCommand('insertText', false, text);
        });
        const cmd = (c, ic, tiptext, key) => tip(h('button.fg-icon-btn.is-small', {type: 'button',
            onmousedown: e => e.preventDefault(), onclick: () => {
                document.execCommand(c);
                sync();
            }}, icon(ic)), tiptext, key);
        const wc = h('span.fg-wc', null, t('nwords', words(textOf(this.state.feedback))));
        const mic = Dictate.micButton(ed, {label: t('dictate_feedback_tip'), key: 'V',
            onStop: inf => this.logDictation('overall', 'neutral', inf)});
        this.feedbackMic = mic;
        const bankbtn = tip(h('button.fg-icon-btn.is-small', {type: 'button', onmousedown: e => e.preventDefault(),
            onclick: () => this.bank.popover(ed, text => this.insertFeedback(text))}, icon('bank')), t('bank_insert_tip'), '#');
        return h('section.fg-feedback', null,
            h('h3.fg-section-title', null, t('overallfeedback')),
            h('div.fg-editor-wrap.fg-dictate-host', null,
                h('div.fg-editor-tools', null,
                    mic ? h('span.fg-mic-wrap', null, mic, h('span.fg-mic-label', null, t('speak'))) : null,
                    h('span.fg-sep'),
                    cmd('bold', 'text', t('bold'), Shortcuts.label('mod+b')),
                    cmd('insertUnorderedList', 'list', t('bulletlist'), ''),
                    bankbtn,
                    h('span.fg-grow'), wc),
                ed));
    }

    /**
     * Insert text into overall feedback.
     *
     * @param {string} text
     */
    insertFeedback(text) {
        if (this.tab !== 'mark') {
            this.tab = 'mark';
            this.renderTabs();
            this.renderBody();
        }
        const ed = this.editor;
        if (!ed) {
            return;
        }
        ed.focus();
        const sel = window.getSelection();
        if (!sel.rangeCount || !ed.contains(sel.getRangeAt(0).commonAncestorContainer)) {
            const r = document.createRange();
            r.selectNodeContents(ed);
            r.collapse(false);
            sel.removeAllRanges();
            sel.addRange(r);
        }
        const before = ed.innerText.trim();
        document.execCommand('insertText', false, (before && !/\s$/.test(ed.innerText) ? ' ' : '') + text);
        this.state.feedback = ed.innerHTML;
        this.app.changed();
    }

    /**
     * Put the cursor in the feedback box.
     */
    focusFeedback() {
        if (this.tab !== 'mark') {
            this.tab = 'mark';
            this.renderTabs();
            this.renderBody();
        }
        if (this.editor) {
            this.editor.focus();
            const r = document.createRange();
            r.selectNodeContents(this.editor);
            r.collapse(false);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(r);
        }
    }

    /**
     * Workflow state.
     *
     * @returns {HTMLElement}
     */
    workflowSection() {
        const info = this.app.store.get('info');
        const st = this.state;
        const sel = h('select.fg-select', {'aria-label': t('workflowstate'), onchange: e => {
            st.workflowstate = e.target.value;
            this.app.changed();
        }}, h('option', {value: ''}, t('workflow_unchanged')),
            info.workflowstates.map(s => h('option', {value: s.value, selected: s.value === st.workflowstate}, s.label)));
        const notify = h('input', {type: 'checkbox', checked: !!st.notify, onchange: e => {
            st.notify = e.target.checked;
            this.app.changed();
        }});
        return h('section.fg-workflow', null, h('h3.fg-section-title', null, t('workflowstate')),
            tip(sel, t('workflow_tip')),
            h('label.fg-check', null, notify, t('notifystudent')));
    }

    /* ---------- Other tabs ---------- */

    /**
     * Quiz question details.
     *
     * @returns {Array}
     */
    questionTab() {
        const q = this.item.question;
        const parts = [h('section.fg-qblock', null, h('h3.fg-section-title', null, t('questionn', q.number) + ' · ' + q.name),
            h('div.fg-qtext', {html: q.text}))];
        if (q.graderinfo) {
            parts.push(h('section.fg-qblock.is-info', null, h('h3.fg-section-title', null, t('graderinfo')),
                h('div.fg-qtext', {html: q.graderinfo})));
        }
        if (q.template) {
            parts.push(h('details.fg-qblock', null, h('summary', null, t('responsetemplate')), h('div.fg-qtext',
                {html: q.template})));
        }
        if (q.minwords || q.maxwords) {
            const ok = (!q.minwords || q.wordcount >= q.minwords) && (!q.maxwords || q.wordcount <= q.maxwords);
            parts.push(h('div.fg-chip', {"class": ok ? 'is-ok' : 'is-amber'}, t('wordlimit', {count: q.wordcount,
                min: q.minwords || '–', max: q.maxwords || '–'})));
        }
        if (q.history && q.history.length) {
            parts.push(h('section.fg-qblock', null, h('h3.fg-section-title', null, t('history')),
                q.history.map(x => h('div.fg-history', null,
                    h('div.fg-small.fg-muted', null, `${date(x.time)} · ${x.by}${x.mark !== null ? ' · ' + fmt(x.mark) : ''}`),
                    x.comment ? h('div', {html: x.comment}) : null))));
        }
        return parts;
    }

    /**
     * Integrity results.
     *
     * @returns {Array}
     */
    integrityTab() {
        const integ = this.item.integrations || {};
        const parts = [];
        const eg = integ.essayguard;
        if (eg && (eg.overall || eg.pending)) {
            let r = eg.overall;
            if (this.item.question && eg.slots && eg.slots[this.item.question.slot]) {
                r = eg.slots[this.item.question.slot];
            }
            parts.push(h('section.fg-integ', null,
                h('h3.fg-section-title', null, icon('shield', 'fg-i-sm'), 'EssayGuard'),
                r ? h('div.fg-integ-score', {"class": 'is-risk-' + r.level}, h('strong', null, String(r.score)), h('span', null,
                    t('risk_' + r.level))) : h('div.fg-muted', null, t('eg_pending')),
                r && r.pastes ? h('div.fg-small', null, t('eg_pastes', r.pastes)) : null,
                r && r.explanations.length ? h('ul.fg-integ-list', null, r.explanations.map(x => h('li', null, x))) : null,
                r ? h('a.fg-btn.is-small.is-ghost', {href: r.url, target: '_blank', rel: 'noopener'}, icon('external', 'fg-i-sm'),
                    t('openreport')) : null,
                h('p.fg-small.fg-muted', null, t('eg_disclaimer'))));
        }
        const dg = integ.docguard || {};
        const docs = (this.item.docs || []).filter(d => d.docref && d.docref.startsWith('file:'));
        docs.forEach(d => {
            const r = dg[d.docref.slice(5)];
            if (!r) {
                return;
            }
            parts.push(h('section.fg-integ', null,
                h('h3.fg-section-title', null, icon('shield', 'fg-i-sm'), 'DocGuard · ' + d.filename),
                h('div.fg-integ-score', {"class": 'is-risk-' + r.level}, h('strong', null, String(r.score)), h('span', null,
                    t('risk_' + r.level))),
                r.findings.length ? h('ul.fg-integ-list', null, r.findings.map(f => h('li', {"class": 'is-' + f.severity},
                    h('strong', null, f.label), f.matched ? h('div.fg-small', null, '“' + f.matched + '”') : null,
                    f.matched ? h('button.fg-link-btn', {type: 'button', onclick: () => this.app.viewer.find(d.docref, f.matched)},
                        t('showindocument')) : null))) : h('div.fg-muted', null, t('dg_nofindings')),
                h('a.fg-btn.is-small.is-ghost', {href: r.url, target: '_blank', rel: 'noopener'}, icon('external', 'fg-i-sm'),
                    t('openreport'))));
        });
        return parts.length ? parts : h('div.fg-empty-small', null, t('nointegrity'));
    }

    /**
     * Private notes.
     *
     * @returns {HTMLElement}
     */
    notesTab() {
        const cur = this.app.store.get('current');
        const ta = h('textarea.fg-textarea', {rows: 8, placeholder: t('notes_placeholder'), 'aria-label': t('tab_notes')});
        ta.value = this.item.note || '';
        const save = debounce(() => {
            Api.call('save_note', {cmid: this.app.cmid, userid: cur.person.id, note: ta.value})
                .then(() => {
                    this.item.note = ta.value;
                })
                .catch(e => toast(Api.message(e), {type: 'error'}));
        }, 800);
        ta.addEventListener('input', save);
        const mic = Dictate.micButton(ta, {label: t('dictate_note_tip')});
        return h('section', null, h('h3.fg-section-title', null, t('tab_notes')), h('p.fg-small.fg-muted', null, t('notes_help')),
            h('div.fg-dictate-host.fg-remark', null, ta, mic));
    }

    /* ---------- Footer ---------- */

    /**
     * Footer buttons.
     */
    renderFooter() {
        const savenext = tip(h('button.fg-btn.is-primary.fg-savenext', {type: 'button', onclick: () => this.app.commit(true)},
            h('span', null, this.pending() ? t('approvenext') : t('savenext')), h('kbd', null, Shortcuts.label('mod+enter'))),
            t('savenext_tip'),
            Shortcuts.label('mod+enter'));
        const save = tip(h('button.fg-btn', {type: 'button', onclick: () => this.app.commit(false)}, t('save')), t('save_tip'),
            Shortcuts.label('mod+s'));
        replace(this.footer, save, savenext);
    }

    /* ---------- Data ---------- */

    /**
     * Record a dictation for reports.
     *
     * @param {string} target
     * @param {string} polarity
     * @param {Object} info
     */
    logDictation(target, polarity, info) {
        if (info && info.text) {
            this.dictlog.push({target, polarity, text: info.text, seconds: info.seconds, provider: info.provider});
        }
    }

    /**
     * Dictations since the last save.
     *
     * @returns {Array}
     */
    takeDictationLog() {
        const l = this.dictlog;
        this.dictlog = [];
        return l;
    }

    /**
     * Current values.
     *
     * @returns {Object}
     */
    collect() {
        const st = this.state;
        if (!st) {
            return {};
        }
        return {
            grade: st.grade,
            filling: [...st.filling.values()].map(f => ({criterionid: f.criterionid, levelid: f.levelid || 0,
                score: f.score === undefined ? null : f.score, remark: f.remark || ''})),
            feedback: st.feedback,
            workflowstate: st.workflowstate,
            notify: st.notify,
            auto: st.auto,
        };
    }

    /**
     * Whether a draft is ready to commit.
     *
     * @param {Object} d
     * @returns {boolean}
     */
    isComplete(d) {
        const info = this.app.store.get('info');
        const item = this.item;
        if (!item || this.pending()) {
            return false;
        }
        if (item.question) {
            if (item.question.criteria && item.question.criteria.length) {
                return item.question.criteria.every(c => d.filling.find(f => f.criterionid === c.id && f.score !== '' &&
                    f.score !== null));
            }
            return d.grade !== '' && d.grade !== null;
        }
        if (info.method === 'rubric') {
            return info.definition.criteria.every(c => d.filling.find(f => f.criterionid === c.id && f.levelid));
        }
        if (info.method === 'guide') {
            return info.definition.criteria.every(c => d.filling.find(f => f.criterionid === c.id && f.score !== '' &&
                f.score !== null));
        }
        if (info.gradetype === 'none') {
            return textOf(d.feedback).trim() !== '';
        }
        return d.grade !== '' && d.grade !== null;
    }

    /**
     * Panel shortcuts.
     */
    registerShortcuts() {
        const m = t('sc_marking');
        const whenMark = () => this.item && this.tab === 'mark';
        for (let i = 1; i <= 9; i++) {
            Shortcuts.add(String(i), () => {
                const info = this.app.store.get('info');
                if (info.method === 'rubric' && !this.item.question) {
                    this.pickLevel(this.activeCriterion, i - 1);
                    return true;
                }
                if (info.gradetype === 'scale' && !info.method && !this.item.question) {
                    const s = info.scaleitems[i - 1];
                    if (s) {
                        this.state.grade = String(s.value);
                        this.changed();
                    }
                    return true;
                }
                return false;
            }, {group: m, label: i === 1 ? t('sc_level') : '', hidden: i > 1, when: whenMark});
        }
        Shortcuts.add('arrowdown', () => {
            if (!this.critEls || !this.critEls.length) {
                return false;
            }
            this.setActive(Math.min(this.critEls.length - 1, this.activeCriterion + 1), true);
            return true;
        }, {group: m, label: t('sc_nextcrit'), when: () => whenMark() && !!this.critEls && this.critEls.length > 0});
        Shortcuts.add('arrowup', () => {
            if (!this.critEls || !this.critEls.length) {
                return false;
            }
            this.setActive(Math.max(0, this.activeCriterion - 1), true);
            return true;
        }, {group: m, label: t('sc_prevcrit'), when: () => whenMark() && !!this.critEls && this.critEls.length > 0});
        Shortcuts.add('g', () => {
            this.tab = 'mark';
            this.renderTabs();
            this.renderBody();
            const g = document.getElementById('fg-grade-input');
            if (g) {
                g.focus();
                g.select();
            }
        }, {group: m, label: t('sc_grade')});
        Shortcuts.add('f', () => this.focusFeedback(), {group: m, label: t('sc_feedback')});
        Shortcuts.add('shift+a', () => this.approveAll() > 0, {group: m, label: t('auto_approveall'),
            when: () => this.pending() > 0});
        Shortcuts.add('v', () => {
            this.focusFeedback();
            if (this.feedbackMic) {
                this.feedbackMic.click();
            }
        }, {group: m, label: t('sc_dictate')});
        Shortcuts.add('b', () => {
            this.tab = 'bank';
            this.renderTabs();
            this.renderBody();
        }, {group: m, label: t('sc_bank')});
    }
}


