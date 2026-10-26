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

const KINDS = ['keypoints', 'anyof', 'term', 'parts', 'pattern', 'mustnot', 'length', 'structure', 'threshold'];
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
 */
export const open = (app, criteria, onsaved) => {
    const all = JSON.parse(JSON.stringify(app.store.get('lookfors') || {}));
    let current = criteria[0];
    const nav = h('nav.fg-lf-nav');
    const pane = h('div.fg-lf-pane');
    const compliance = h('input', {type: 'checkbox', checked: (all.all || []).some(r => r.kind === 'compliance')});

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
            rules.length ? null : h('p.fg-muted.fg-small', null, t('lf_none')),
            rules.map((r, i) => h('section.fg-lf-rule', null,
                h('div.fg-lf-rule-head', null, h('strong', null, t('rule_' + r.kind)),
                    h('small.fg-muted', null, t('rule_' + r.kind + '_help')),
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
            h('label.fg-check', null, compliance, t('lf_compliance')),
            h('div.fg-lf-grid', null, nav, pane)),
        actions: [
            {label: t('cancel')},
            {label: t('save'), primary: true, onclick: async() => {
                try {
                    let latest = null;
                    for (const c of criteria) {
                        const r = await Api.call('save_criteria', {cmid: app.cmid, kind: 'lookfors',
                            data: {criterionkey: c.key, rules: all[c.key] || []}});
                        latest = r.lookfors;
                    }
                    const r = await Api.call('save_criteria', {cmid: app.cmid, kind: 'lookfors', data: {criterionkey: 'all',
                        rules: compliance.checked ? [{kind: 'compliance', config: {}}] : []}});
                    latest = r.lookfors || latest;
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
