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
 * Set up look-fors: what the checks look for in each criterion.
 *
 * @module     local_fastgrade/autograde/editor
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon, replace, textOf} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import {tip} from 'local_fastgrade/ui/tooltip';
import * as Dialog from 'local_fastgrade/ui/dialog';
import * as Api from 'local_fastgrade/lib/api';
import {toast} from 'local_fastgrade/ui/toast';
import * as Engine from 'local_fastgrade/autograde/engine';
import * as Synonyms from 'local_fastgrade/autograde/synonyms';

const KINDS = ['keypoints', 'ideas', 'anyof', 'term', 'parts', 'pattern', 'mustnot', 'length', 'structure', 'threshold'];
const PRESETS = ['citation', 'legislation', 'year', 'money', 'percent', 'number', 'url'];
const STRUCT = ['references', 'headings', 'list'];

/**
 * A blank rule.
 *
 * @param {string} kind
 * @param {Object} crit
 * @returns {Object}
 */
const blank = (kind, crit) => {
    const config = {label: '', terms: [], min: 1, max: 0, comment: '', preset: '', regex: '', levelid: 0, partiallevelid: 0};
    if (kind === 'keypoints') {
        config.terms = Engine.splitPoints(crit.benchmark);
    } else if (kind === 'ideas') {
        config.terms = Engine.keyIdeas(crit.text + ' ' + (crit.top || ''));
        config.min = 0;
    } else if (kind === 'anyof') {
        config.terms = Engine.suggestTerms(crit.text, crit.benchmark).slice(0, 8);
        config.min = Math.min(2, config.terms.length || 1);
    } else if (kind === 'pattern') {
        config.preset = 'citation';
    } else if (kind === 'structure') {
        config.preset = 'references';
    } else if (kind === 'length') {
        config.min = 100;
        config.max = 0;
    }
    return {kind, config};
};

/**
 * Open the editor.
 *
 * @param {Object} app
 * @param {Array} criteria
 * @param {Function} onsaved
 * @param {Object} start the checks that run now, including ready-made ones nobody has saved yet
 * @param {Object} ctx {sources, quiz, info}
 */
export const open = (app, criteria, onsaved, start, ctx = {}) => {
    const all = JSON.parse(JSON.stringify(start || app.store.get('lookfors') || {}));
    let current = criteria[0];
    const nav = h('nav.fg-lf-nav');
    const pane = h('div.fg-lf-pane');
    const compliance = h('input', {type: 'checkbox', checked: (all.all || []).some(r => r.kind === 'compliance')});
    // Where the ready-made checks come from, for this activity.
    const info = ctx.info || {};
    const avail = ctx.quiz ? ['graderinfo', 'question', 'template', 'wordlimit'] :
        ['instructions', 'attachments', 'grading', 'otherforms', 'wordlimit'];
    const chosen = new Set(ctx.sources || avail);
    const found = {
        instructions: !!(textOf(info.intro || '') + textOf(info.instructions || '')).trim(),
        attachments: (info.introfiles || []).length > 0,
        grading: info.method === 'rubric' || info.method === 'guide',
        otherforms: !!(info.otherform && info.otherform.text),
        wordlimit: ctx.quiz || !!info.wordlimit,
        graderinfo: true, question: true, template: true,
    };
    let sourcesChanged = false;
    const sourceBox = h('fieldset.fg-lf-sources', null, h('legend', null, t('lf_sources')),
        h('p.fg-small.fg-muted', null, t('lf_sources_help')),
        h('div.fg-lf-source-list', null, avail.map(k => h('label.fg-check', {"class": found[k] ? '' : 'is-absent'},
            h('input', {type: 'checkbox', checked: chosen.has(k), onchange: e => {
                if (e.target.checked) {
                    chosen.add(k);
                } else {
                    chosen.delete(k);
                }
                sourcesChanged = true;
            }}), h('span', null, t('src_' + k)),
            found[k] ? null : h('small.fg-muted', null, ' · ' + t('src_none'))))));

    const drawNav = () => replace(nav, criteria.map(c => h('button.fg-lf-crit', {type: 'button',
        'aria-pressed': String(c === current), onclick: () => {
            current = c;
            drawNav();
            drawPane();
        }}, h('span', null, c.label), h('span.fg-count', null, String((all[c.key] || []).filter(r => r.kind !== 'compliance')
        .length)))));

    const termsField = (rule, label, help, rows = 3) => {
        const ta = h('textarea.fg-textarea.is-small', {rows, 'aria-label': label});
        ta.value = (rule.config.terms || []).join('\n');
        ta.addEventListener('input', () => {
            rule.config.terms = ta.value.split('\n').map(x => x.trim()).filter(Boolean);
        });
        return h('label.fg-field', null, h('span', null, label), ta, help ? h('small.fg-muted', null, help) : null);
    };
    const num = (rule, key, label) => h('label.fg-field.is-narrow', null, h('span', null, label),
        h('input.fg-input.is-num', {type: 'number', min: '0', value: rule.config[key] || 0, oninput: e => {
            rule.config[key] = parseInt(e.target.value, 10) || 0;
        }}));
    const text = (rule, key, label, placeholder = '') => h('label.fg-field', null, h('span', null, label),
        h('input.fg-input', {type: 'text', value: rule.config[key] || '', placeholder, oninput: e => {
            rule.config[key] = e.target.value;
        }}));
    const select = (rule, key, label, options) => h('label.fg-field.is-narrow', null, h('span', null, label),
        h('select.fg-select', {onchange: e => {
            rule.config[key] = isNaN(parseInt(e.target.value, 10)) ? e.target.value : parseInt(e.target.value, 10);
        }}, options.map(([v, l]) => h('option', {value: v, selected: String(rule.config[key]) === String(v)}, l))));

    const ruleBody = (rule, crit) => {
        const c = rule.config;
        switch (rule.kind) {
            case 'keypoints':
                return [termsField(rule, t('lf_points'), t('lf_points_help'), 6),
                    h('button.fg-btn.is-small.is-ghost', {type: 'button', onclick: () => {
                        c.terms = Engine.splitPoints(crit.benchmark);
                        drawPane();
                    }}, icon('rotate', 'fg-i-sm'), t('lf_frombenchmark'))];
            case 'anyof':
            case 'term':
            case 'mustnot':
                return [text(rule, 'label', t('lf_label')),
                    termsField(rule, t('lf_terms'), t('lf_terms_help')),
                    h('div.fg-field-row', null,
                        rule.kind !== 'mustnot' ? num(rule, 'min',
                            rule.kind === 'anyof' ? t('lf_atleastdistinct') : t('lf_atleast')) : null,
                        h('button.fg-btn.is-small.is-ghost', {type: 'button', onclick: async() => {
                            const extra = await Synonyms.suggest(app, c.terms);
                            if (extra) {
                                c.terms = extra;
                                drawPane();
                            }
                        }}, icon('list', 'fg-i-sm'), t('lf_synonyms')),
                        rule.kind === 'anyof' ? h('button.fg-btn.is-small.is-ghost', {type: 'button', onclick: () => {
                            const sug = Engine.suggestTerms(crit.text, crit.benchmark);
                            c.terms = [...new Set([...(c.terms || []), ...sug])].slice(0, 20);
                            drawPane();
                        }}, icon('wand', 'fg-i-sm'), t('lf_suggest')) : null),
                    rule.kind === 'mustnot' ? text(rule, 'comment', t('lf_comment'), t('lf_comment_placeholder')) : null];
            case 'parts':
                return [termsField(rule, t('lf_parts'), t('lf_parts_help'), 4)];
            case 'ideas':
                return [termsField(rule, t('lf_ideas'), t('lf_ideas_help'), 4),
                    h('div.fg-field-row', null, num(rule, 'min', t('lf_ideas_min')))];
            case 'pattern':
                return [h('div.fg-field-row', null, select(rule, 'preset', t('lf_preset'), [['', t('lf_custom')],
                    ...PRESETS.map(p => [p, t('preset_' + p)])]), num(rule, 'min', t('lf_atleast'))),
                c.preset ? null : text(rule, 'regex', t('lf_regex'), '\\bAS/NZS \\d+')];
            case 'length':
                return [h('div.fg-field-row', null, num(rule, 'min', t('lf_minwords')), num(rule, 'max', t('lf_maxwords')))];
            case 'structure':
                return [h('div.fg-field-row', null, select(rule, 'preset', t('lf_needs'), STRUCT.map(p => [p, t('struct_' + p)])),
                    c.preset !== 'references' ? num(rule, 'min', t('lf_atleast')) : null)];
            case 'threshold':
                if (crit.levels) {
                    const opts = [[0, '—'], ...crit.levels.map(l => [l.id, `${l.score} · ${textOf(l.definition).slice(0, 50)}`])];
                    return [h('p.fg-small.fg-muted', null, t('lf_threshold_help')), h('div.fg-field-row', null,
                        select(rule, 'levelid', t('lf_allmet'), opts), select(rule, 'partiallevelid', t('lf_somemet'), opts))];
                }
                return [h('p.fg-small.fg-muted', null, t('lf_threshold_guide'))];
            default:
                return [];
        }
    };

    const drawPane = () => {
        const rules = all[current.key] = (all[current.key] || []).filter(r => r.kind !== 'compliance');
        const addsel = h('select.fg-select.is-small', {'aria-label': t('lf_add')},
            KINDS.filter(k => k !== 'threshold' || !rules.some(r => r.kind === 'threshold'))
                .map(k => h('option', {value: k}, t('rule_' + k))));
        replace(pane,
            h('div.fg-lf-crittext', null, h('strong', null, current.label),
                current.text ? h('p.fg-small', null, current.text.slice(0, 400)) : null,
                current.benchmark ? h('details', null, h('summary', null, t('lf_benchmark')), h('p.fg-small', null,
                    current.benchmark))
                    : null),
            current.step ? h('p.fg-small.fg-lf-step', null, icon('link', 'fg-i-sm'), t('lf_step', current.step)) : null,
            rules.some(r => r.auto) ? h('p.fg-small.fg-lf-ready', null, icon('wand', 'fg-i-sm'),
                t(current.whole ? 'lf_ready_instructions' : 'lf_ready_rubric')) : null,
            rules.length ? null : h('p.fg-muted.fg-small', null,
                current.whole && !current.text.trim() ? t('lf_nointro') : t('lf_none')),
            current.whole && current.text.trim() ? h('button.fg-btn.is-small.is-ghost', {type: 'button', onclick: () => {
                all[current.key] = Engine.fromInstructions(current.text).map(r => Object.assign(r, {auto: true}));
                drawPane();
                drawNav();
            }}, icon('rotate', 'fg-i-sm'), t('lf_rebuild')) : null,
            rules.map((r, i) => h('section.fg-lf-rule', null,
                h('div.fg-lf-rule-head', null, h('strong', null, t('rule_' + r.kind)),
                    r.auto ? h('span.fg-lf-tag', null, t('auto_fromrubric')) : null,
                    h('small.fg-muted', null, r.config && r.config.label ? r.config.label : t('rule_' + r.kind + '_help')),
                    h('span.fg-grow'),
                    tip(h('button.fg-icon-btn.is-small', {type: 'button', onclick: () => {
                        rules.splice(i, 1);
                        drawPane();
                        drawNav();
                    }}, icon('trash')), t('delete'))),
                ruleBody(r, current))),
            h('div.fg-lf-add', null, addsel, h('button.fg-btn.is-small', {type: 'button', onclick: () => {
                rules.push(blank(addsel.value, current));
                drawPane();
                drawNav();
            }}, icon('plus', 'fg-i-sm'), t('lf_add'))));
    };

    drawNav();
    drawPane();
    Dialog.open({
        title: t('auto_setup'),
        wide: true,
        body: h('div.fg-lf', null,
            h('p.fg-small.fg-muted', null, t('lf_intro')),
            sourceBox,
            ctx.quiz ? null : h('label.fg-check', null, compliance, t('lf_compliance')),
            h('div.fg-lf-grid', null, nav, pane)),
        actions: [
            {label: t('cancel')},
            {label: t('save'), primary: true, onclick: async() => {
                try {
                    let latest = null;
                    if (sourcesChanged) {
                        // New sources mean new ready-made checks: save only the choice and checks a marker wrote.
                        const r = await Api.call('save_criteria', {cmid: app.cmid, kind: 'lookfors', data: {criterionkey: 'sources',
                            rules: [{kind: 'sources', config: {terms: avail.filter(k => chosen.has(k))}}]}});
                        latest = r.lookfors;
                        for (const c of criteria) {
                            if (!(all[c.key] || []).some(r => r.auto)) {
                                continue;
                            }
                            const r2 = await Api.call('save_criteria', {cmid: app.cmid, kind: 'lookfors',
                                data: {criterionkey: c.key, rules: []}});
                            latest = r2.lookfors;
                        }
                        app.store.set({lookfors: latest || {}});
                        toast(t('lf_saved'), {type: 'ok'});
                        onsaved();
                        return;
                    }
                    const plain = rules => (rules || []).filter(r => r.kind !== 'compliance')
                        .map(r => ({kind: r.kind, config: r.config}));
                    const comp = compliance.checked ? [{kind: 'compliance', config: {}}] : [];
                    for (const c of criteria) {
                        const r = await Api.call('save_criteria', {cmid: app.cmid, kind: 'lookfors',
                            data: {criterionkey: c.key, rules: c.key === 'all' ? plain(all.all).concat(comp) : plain(all[c.key])}});
                        latest = r.lookfors;
                    }
                    if (!criteria.some(c => c.key === 'all')) {
                        const r = await Api.call('save_criteria', {cmid: app.cmid, kind: 'lookfors', data: {criterionkey: 'all',
                            rules: comp}});
                        latest = r.lookfors || latest;
                    }
                    app.store.set({lookfors: latest || {}});
                    toast(t('lf_saved'), {type: 'ok'});
                    onsaved();
                } catch (e) {
                    toast(Api.message(e), {type: 'error'});
                }
            }},
        ],
    });
};
