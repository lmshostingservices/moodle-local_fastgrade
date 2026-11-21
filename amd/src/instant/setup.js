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
 * Teachers: set up Instant Feedback for an assignment or a quiz essay question, try sample answers
 * (seeing exactly what a student sees, from the free rules and from AI side by side), and read the
 * practice report.
 *
 * @module     local_fastgrade/instant/setup
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import Ajax from 'core/ajax';
import Notification from 'core/notification';
import {el, fill, result} from 'local_fastgrade/instant/render';

let boot;
let t;
let state;

/**
 * Call the set-up service.
 *
 * @param {string} action
 * @param {Object} data
 * @returns {Promise<Object>}
 */
const call = (action, data) => Ajax.call([{methodname: 'local_fastgrade_instant_manage', args: {cmid: boot.cmid, action,
    qbeid: state.qbeid || 0, data: JSON.stringify(data || {})}}])[0].then(r => JSON.parse(r.json));

/**
 * A labelled field.
 *
 * @param {string} label
 * @param {HTMLElement} input
 * @param {string} help
 * @returns {HTMLElement}
 */
const field = (label, input, help) => {
    const w = el('label', 'fg-ifs-field');
    w.append(el('span', 'fg-ifs-flabel', label), input);
    if (help) {
        w.append(el('small', 'fg-ifs-help text-muted', help));
    }
    return w;
};

/**
 * A text input bound to obj[key].
 *
 * @param {Object} obj
 * @param {string} key
 * @param {Object} opts {type, rows, placeholder, lines}
 * @returns {HTMLElement}
 */
const input = (obj, key, opts = {}) => {
    let i;
    if (opts.rows) {
        i = el('textarea', 'form-control');
        i.rows = opts.rows;
        i.value = opts.lines ? (obj[key] || []).join('\n') : (obj[key] || '');
    } else {
        i = el('input', 'form-control');
        i.type = opts.type || 'text';
        if (opts.type === 'number') {
            i.step = 'any';
        }
        i.value = obj[key] === undefined || obj[key] === null ? '' : obj[key];
    }
    if (opts.placeholder) {
        i.placeholder = opts.placeholder;
    }
    i.addEventListener('input', () => {
        if (opts.lines) {
            obj[key] = i.value.split('\n').map(x => x.trim()).filter(Boolean);
        } else if (opts.type === 'number') {
            obj[key] = i.value === '' ? '' : Number(i.value);
        } else {
            obj[key] = i.value;
        }
        state.dirty = true;
    });
    return i;
};

/**
 * A checkbox bound to obj[key].
 *
 * @param {Object} obj
 * @param {string} key
 * @param {string} label
 * @returns {HTMLElement}
 */
const check = (obj, key, label) => {
    const w = el('label', 'fg-ifs-check');
    const i = el('input');
    i.type = 'checkbox';
    i.checked = !!obj[key];
    i.addEventListener('change', () => {
        obj[key] = i.checked ? 1 : 0;
        state.dirty = true;
    });
    w.append(i, document.createTextNode(' ' + label));
    return w;
};

/**
 * A select bound to obj[key].
 *
 * @param {Object} obj
 * @param {string} key
 * @param {Array} options [[value, label]]
 * @param {Function} onchange
 * @returns {HTMLElement}
 */
const select = (obj, key, options, onchange) => {
    const s = el('select', 'custom-select form-select');
    options.forEach(([v, l]) => {
        const o = el('option', '', l);
        o.value = String(v);
        o.selected = String(obj[key]) === String(v);
        s.append(o);
    });
    s.addEventListener('change', () => {
        obj[key] = isNaN(Number(s.value)) || s.value === '' ? s.value : Number(s.value);
        state.dirty = true;
        if (onchange) {
            onchange();
        }
    });
    return s;
};

/**
 * A button.
 *
 * @param {string} label
 * @param {Function} onclick
 * @param {string} cls
 * @returns {HTMLElement}
 */
const button = (label, onclick, cls = 'btn btn-secondary') => {
    const b = el('button', cls, label);
    b.type = 'button';
    b.addEventListener('click', onclick);
    return b;
};

/**
 * Resource options for a select.
 *
 * @returns {Array}
 */
const resources = () => [[0, t('ifs_noresource')], ...boot.resources.map(r => [r.id, r.name])];

/**
 * A list of editable cards (concepts, terms, banned statements, values).
 *
 * @param {string} key config list
 * @param {Function} body card body for one entry
 * @param {Function} blank new entry
 * @param {string} addlabel
 * @returns {HTMLElement}
 */
const cards = (key, body, blank, addlabel) => {
    const wrap = el('div', 'fg-ifs-cards');
    const draw = () => {
        wrap.replaceChildren();
        state.config[key].forEach((x, i) => {
            const card = el('div', 'fg-ifs-card');
            const head = el('div', 'fg-ifs-card-head');
            head.append(el('strong', '', String(i + 1)), button(t('ifs_remove'), () => {
                state.config[key].splice(i, 1);
                state.dirty = true;
                draw();
            }, 'btn btn-link btn-sm'));
            card.append(head, ...body(x));
            wrap.append(card);
        });
        wrap.append(button(addlabel, () => {
            state.config[key].push(blank());
            state.dirty = true;
            draw();
        }, 'btn btn-outline-secondary btn-sm'));
    };
    draw();
    return wrap;
};

let uid = 0;
const newid = () => 'n' + Date.now().toString(36) + (uid++);

/**
 * The set-up form.
 *
 * @returns {HTMLElement}
 */
const setupTab = () => {
    const c = state.config;
    const box = el('div', 'fg-ifs-setup');
    const top = el('div', 'fg-ifs-row');
    top.append(check(state, 'enabled', t('ifs_enabled')));
    box.append(top);
    box.append(el('p', 'fg-ifs-help text-muted', t('ifs_intro_' + boot.kind)));

    const opts = el('fieldset', 'fg-ifs-fs');
    opts.append(el('legend', '', t('ifs_how')));
    const engines = [['rules', t('ifs_engine_rules')]];
    if (boot.ai.allowed || c.engine === 'ai') {
        engines.push(['ai', fill(t('ifs_engine_ai'), boot.ai.credits)]);
    }
    opts.append(field(t('ifs_engine'), select(c, 'engine', engines, () => render()), boot.ai.allowed ?
        t('ifs_engine_help') : t('ifs_engine_noai')));
    opts.append(field(t('ifs_mode'), select(c, 'mode', [['guidance', t('if_mode_guidance')], ['score', t('if_mode_score')],
        ['hints', t('if_mode_hints')]]), t('ifs_mode_help')));
    if (boot.kind === 'assign') {
        opts.append(field(t('ifs_when'), select(c, 'when', [['practice', t('ifs_when_practice')],
            ['aftersubmit', t('ifs_when_aftersubmit')], ['both', t('ifs_when_both')]])));
    }
    const row = el('div', 'fg-ifs-row');
    row.append(field(t('ifs_maxattempts'), input(c, 'maxattempts', {type: 'number'}), fill(t('ifs_maxattempts_help'),
        boot.sitemax || t('if_ui_unlimited'))),
    field(t('ifs_minwords'), input(c, 'minwords', {type: 'number'})),
    field(t('ifs_maxwords'), input(c, 'maxwords', {type: 'number'})));
    opts.append(row);
    [['allowretry', 'ifs_allowretry'], ['namemissing', 'ifs_namemissing'], ['showhistory', 'ifs_showhistory'],
        ['order', 'ifs_order'], ['quality', 'ifs_quality']].forEach(([k, s]) => opts.append(check(c, k, t(s))));
    opts.append(field(t('ifs_note'), input(c, 'intro', {rows: 2}), t('ifs_note_help')));
    opts.append(field(t('ifs_model'), input(c, 'modelanswer', {rows: 3}), t('ifs_model_help')));
    box.append(opts);

    const ideas = el('fieldset', 'fg-ifs-fs');
    ideas.append(el('legend', '', t('ifs_concepts')), el('p', 'fg-ifs-help text-muted', t('ifs_concepts_help')));
    ideas.append(button(t('ifs_suggest'), async() => {
        try {
            const r = await call('suggest');
            const s = r.suggested || {};
            const have = new Set(c.concepts.map(x => x.label.toLowerCase()));
            (s.concepts || []).forEach(x => {
                if (!have.has(x.label.toLowerCase())) {
                    c.concepts.push(Object.assign(x, {id: newid()}));
                }
            });
            (s.prohibited || []).forEach(x => c.prohibited.push(Object.assign(x, {id: newid()})));
            c.minwords = c.minwords || s.minwords || 0;
            c.maxwords = c.maxwords || s.maxwords || 0;
            c.modelanswer = c.modelanswer || s.modelanswer || '';
            state.dirty = true;
            render();
            Notification.addNotification({message: fill(t('ifs_suggested'), (s.concepts || []).length), type: 'info'});
        } catch (e) {
            Notification.exception(e);
        }
    }, 'btn btn-outline-primary btn-sm mb-2'));
    ideas.append(cards('concepts', x => {
        const hints = x.hints = x.hints || [];
        const hintbox = el('div', 'fg-ifs-row');
        [0, 1, 2].forEach(i => {
            const hi = el('input', 'form-control');
            hi.value = hints[i] || '';
            hi.placeholder = fill(t('ifs_hintn'), i + 1);
            hi.addEventListener('input', () => {
                hints[i] = hi.value;
                x.hints = hints.filter(Boolean);
                state.dirty = true;
            });
            hintbox.append(hi);
        });
        return [field(t('ifs_label'), input(x, 'label'), t('ifs_label_help')),
            field(t('ifs_phrases'), input(x, 'phrases', {rows: 3, lines: true, placeholder: t('ifs_phrases_ph')}),
                t('ifs_phrases_help')),
            check(x, 'required', t('ifs_required')),
            field(t('ifs_found'), input(x, 'found', {placeholder: t('ifs_found_ph')})),
            field(t('ifs_missing'), input(x, 'missing', {placeholder: t('ifs_missing_ph')})),
            field(t('ifs_partial'), input(x, 'partial')),
            field(t('ifs_hints'), hintbox, t('ifs_hints_help')),
            field(t('ifs_resource'), select(x, 'resource', resources()))];
    }, () => ({id: newid(), label: '', phrases: [], required: 1, found: '', missing: '', partial: '', hints: [], resource: 0}),
    t('ifs_addconcept')));
    box.append(ideas);

    const terms = el('fieldset', 'fg-ifs-fs');
    terms.append(el('legend', '', t('ifs_terms')), el('p', 'fg-ifs-help text-muted', t('ifs_terms_help')));
    terms.append(cards('terms', x => [field(t('ifs_label'), input(x, 'label')),
        field(t('ifs_phrases'), input(x, 'phrases', {rows: 2, lines: true})),
        field(t('ifs_missing'), input(x, 'missing')), field(t('ifs_resource'), select(x, 'resource', resources()))],
    () => ({id: newid(), label: '', phrases: [], missing: '', resource: 0}), t('ifs_addterm')));
    box.append(terms);

    const values = el('fieldset', 'fg-ifs-fs');
    values.append(el('legend', '', t('ifs_values')), el('p', 'fg-ifs-help text-muted', t('ifs_values_help')));
    values.append(cards('values', x => {
        const r = el('div', 'fg-ifs-row');
        r.append(field(t('lf_vmin'), input(x, 'vmin', {type: 'number'})), field(t('lf_vmax'), input(x, 'vmax',
            {type: 'number'})), field(t('lf_unit'), input(x, 'unit', {placeholder: 'V | volts'})));
        return [field(t('ifs_label'), input(x, 'label')),
            field(t('lf_valueabout'), input(x, 'phrases', {rows: 2, lines: true}), t('lf_valueabout_help')), r,
            field(t('ifs_valuewrong'), input(x, 'wrong')), field(t('ifs_missing'), input(x, 'missing'))];
    }, () => ({id: newid(), label: '', phrases: [], unit: '', vmin: '', vmax: '', wrong: '', missing: ''}),
    t('ifs_addvalue')));
    box.append(values);

    const bad = el('fieldset', 'fg-ifs-fs');
    bad.append(el('legend', '', t('ifs_prohibited')), el('p', 'fg-ifs-help text-muted', t('ifs_prohibited_help')));
    bad.append(cards('prohibited', x => [field(t('ifs_phrases'), input(x, 'phrases', {rows: 2, lines: true,
        placeholder: t('ifs_prohibited_ph')})), field(t('ifs_prohibitedmsg'), input(x, 'message'))],
    () => ({id: newid(), phrases: [], message: ''}), t('ifs_addprohibited')));
    box.append(bad);

    const save = button(t('ifs_save'), async() => {
        save.disabled = true;
        try {
            const r = await call('save', {enabled: state.enabled ? 1 : 0, config: state.config});
            state.config = r.config;
            state.enabled = r.enabled;
            state.dirty = false;
            const q = (boot.questions || []).find(x => x.qbeid === state.qbeid);
            if (q) {
                q.enabled = r.enabled;
            }
            Notification.addNotification({message: t('ifs_saved'), type: 'success'});
            render();
        } catch (e) {
            Notification.exception(e);
        }
        save.disabled = false;
    }, 'btn btn-primary');
    const foot = el('div', 'fg-ifs-foot');
    foot.append(save);
    box.append(foot);
    return box;
};

/**
 * Try an answer.
 *
 * @returns {HTMLElement}
 */
const tryTab = () => {
    const box = el('div', 'fg-ifs-try');
    box.append(el('p', 'fg-ifs-help text-muted', t('ifs_try_help')));
    const kinds = ['correct', 'partial', 'incorrect', 'nonsense', 'negated', 'otherwording', 'contradiction', 'keywords'];
    const list = el('ul', 'fg-ifs-checklist');
    kinds.forEach(k => list.append(el('li', '', t('ifs_try_' + k))));
    box.append(list);
    const ta = el('textarea', 'form-control');
    ta.rows = 6;
    ta.value = state.sample || '';
    ta.setAttribute('aria-label', t('ifs_sample'));
    ta.addEventListener('input', () => {
        state.sample = ta.value;
    });
    box.append(field(t('ifs_sample'), ta));
    const opt = {attemptno: 1, ai: 0};
    const row = el('div', 'fg-ifs-row');
    row.append(field(t('ifs_asattempt'), select(opt, 'attemptno', [1, 2, 3, 4].map(n => [n, String(n)]))));
    if (state.config.engine === 'ai') {
        row.append(check(opt, 'ai', fill(t('ifs_alsoai'), boot.ai.credits)));
    }
    box.append(row);
    const out = el('div', 'fg-ifs-preview');
    out.setAttribute('aria-live', 'polite');
    const go = button(t('ifs_test'), async() => {
        go.disabled = true;
        out.replaceChildren(el('p', 'text-muted', t('if_ui_checking')));
        try {
            const r = await call('preview', {config: state.config, text: ta.value, attemptno: opt.attemptno, ai: opt.ai});
            out.replaceChildren();
            const cols = el('div', r.ai ? 'fg-ifs-cols' : '');
            const one = (title, res) => {
                const col = el('div', 'fg-ifs-col');
                col.append(el('h4', '', title), result(res, {}, t));
                return col;
            };
            cols.append(one(t('ifs_rulesview'), r.rules));
            if (r.ai) {
                cols.append(one(fill(t('ifs_aiview'), r.ai.credits), r.ai));
            }
            out.append(cols);
            if (r.aierror) {
                out.append(el('p', 'alert alert-warning', r.aierror));
            }
            if ((r.compare || []).length) {
                const tbl = el('table', 'generaltable fg-ifs-compare');
                const h = el('tr');
                [t('ifs_label'), t('ai_col_rules'), t('ai_col_ai'), ''].forEach(x => h.append(el('th', '', x)));
                tbl.append(h);
                r.compare.forEach(c => {
                    const tr = el('tr', c.agree ? 'is-agree' : 'is-disagree');
                    tr.append(el('td', '', c.label), el('td', '', t('if_ui_' + c.rules)), el('td', '', t('if_ui_' + c.ai)),
                        el('td', '', c.agree ? t('ai_agree') : t('ai_disagree')));
                    tbl.append(tr);
                });
                out.append(el('h4', '', t('ifs_compare')), tbl);
            }
        } catch (e) {
            out.replaceChildren();
            Notification.exception(e);
        }
        go.disabled = false;
    }, 'btn btn-primary');
    box.append(go, out);
    return box;
};

/**
 * The practice report.
 *
 * @returns {HTMLElement}
 */
const reportTab = () => {
    const box = el('div', 'fg-ifs-report');
    box.append(el('p', 'fg-ifs-help text-muted', t('ifs_report_help')));
    const out = el('div');
    box.append(out);
    call('report').then(r => {
        const stats = el('div', 'fg-ifs-stats');
        const stat = (n, label) => {
            const s = el('div', 'fg-ifs-stat');
            s.append(el('strong', '', n === null || n === undefined ? '–' : String(n)), el('span', '', label));
            stats.append(s);
        };
        stat(r.students, t('ifs_r_students'));
        stat(r.checks, t('ifs_r_checks'));
        stat(r.avgchecks, t('ifs_r_avg'));
        stat(r.improvement === null ? null : r.improvement + '%', t('ifs_r_improve'));
        stat(r.needreview, t('ifs_r_review'));
        if (r.compared) {
            stat(r.agreement + '%', t('ifs_r_agree'));
            stat(r.credits, t('ifs_r_credits'));
        }
        out.append(stats);
        const lists = el('div', 'fg-ifs-cols');
        const lst = (title, items) => {
            const col = el('div', 'fg-ifs-col');
            col.append(el('h4', '', title));
            const ul = el('ul');
            items.forEach(i => ul.append(el('li', '', i.label + ' (' + i.count + ')')));
            if (!items.length) {
                ul.append(el('li', 'text-muted', '–'));
            }
            col.append(ul);
            return col;
        };
        lists.append(lst(t('ifs_r_missed'), r.missed || []), lst(t('ifs_r_found'), r.found || []));
        out.append(lists);
        const tbl = el('table', 'generaltable');
        const h = el('tr');
        [t('ifs_r_student'), t('ifs_r_checks'), t('ifs_r_best'), ''].forEach(x => h.append(el('th', '', x)));
        tbl.append(h);
        const detail = el('div', 'fg-ifs-detail');
        (r.people || []).forEach(p => {
            const tr = el('tr');
            tr.append(el('td', '', p.name), el('td', '', String(p.checks)), el('td', '', p.total ? p.best + ' / ' + p.total :
                String(p.best)));
            const td = el('td');
            td.append(button(t('ifs_r_view'), async() => {
                const a = await call('attempts', {userid: p.userid});
                detail.replaceChildren(el('h4', '', p.name));
                a.attempts.forEach(x => {
                    const card = el('div', 'fg-ifs-card');
                    card.append(el('strong', '', fill(t('ifs_r_attempt'), {n: x.attemptno, engine: x.engine === 'ai' ?
                        t('if_ui_ai') : t('ifs_engine_rules')})));
                    if (x.response) {
                        card.append(el('blockquote', 'fg-if-quote', x.response));
                    }
                    card.append(result(x.result, {}, t));
                    detail.append(card);
                });
                detail.scrollIntoView({behavior: 'smooth'});
            }, 'btn btn-link btn-sm'));
            tr.append(td);
            tbl.append(tr);
        });
        out.append(tbl, detail);
        return r;
    }).catch(Notification.exception);
    return box;
};

/**
 * Draw the page.
 */
const render = () => {
    const root = document.getElementById('fg-ifs');
    root.replaceChildren();
    if (boot.kind === 'quiz') {
        const nav = el('nav', 'fg-ifs-qnav');
        nav.setAttribute('aria-label', t('ifs_questions'));
        if (!boot.questions.length) {
            root.append(el('p', 'alert alert-info', t('ifs_noessays')));
            return;
        }
        boot.questions.forEach(q => {
            const b = button(fill(t('ifs_qlabel'), {n: q.number, name: q.name}), () => open(q.qbeid),
                'btn btn-sm ' + (q.qbeid === state.qbeid ? 'btn-primary' : 'btn-outline-secondary'));
            b.setAttribute('aria-pressed', String(q.qbeid === state.qbeid));
            if (q.enabled) {
                b.append(el('span', 'badge bg-success ms-1', t('ifs_on')));
            }
            nav.append(b);
        });
        root.append(nav);
        const q = boot.questions.find(x => x.qbeid === state.qbeid);
        if (q && q.text) {
            root.append(el('blockquote', 'fg-ifs-qtext', q.text));
        }
    }
    const tabs = el('div', 'fg-ifs-tabs');
    tabs.setAttribute('role', 'tablist');
    ['setup', 'try', 'report'].forEach(k => {
        const b = button(t('ifs_tab_' + k), () => {
            state.tab = k;
            render();
        }, 'btn btn-sm ' + (state.tab === k ? 'btn-dark' : 'btn-light'));
        b.setAttribute('role', 'tab');
        b.setAttribute('aria-selected', String(state.tab === k));
        tabs.append(b);
    });
    root.append(tabs);
    const pane = el('div', 'fg-ifs-pane');
    pane.setAttribute('role', 'tabpanel');
    pane.append(state.tab === 'try' ? tryTab() : (state.tab === 'report' ? reportTab() : setupTab()));
    root.append(pane);
};

/**
 * Load a question's (or the assignment's) set-up.
 *
 * @param {number} qbeid
 */
const open = async qbeid => {
    if (state && state.dirty && !window.confirm(t('ifs_unsaved'))) {
        return;
    }
    state = {qbeid, tab: state ? state.tab : 'setup', dirty: false, sample: ''};
    try {
        const r = await call('get');
        state.config = r.config;
        state.enabled = r.enabled;
        render();
    } catch (e) {
        Notification.exception(e);
    }
};

/**
 * Start.
 *
 * @param {string} selector boot data
 */
export const init = selector => {
    boot = JSON.parse(document.querySelector(selector).textContent);
    t = k => (boot.strings[k] !== undefined ? boot.strings[k] : k);
    state = null;
    window.addEventListener('beforeunload', e => {
        if (state && state.dirty) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
    open(boot.kind === 'quiz' ? (boot.qbeid || (boot.questions[0] || {}).qbeid || 0) : 0);
};
