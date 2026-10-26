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
 * Student rail: search, filters, sort, the marking queue and bulk actions.
 *
 * @module     local_fastgrade/ui/rail
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon, replace, duration, debounce} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import {tip} from 'local_fastgrade/ui/tooltip';
import * as Api from 'local_fastgrade/lib/api';
import {toast} from 'local_fastgrade/ui/toast';
import * as Dialog from 'local_fastgrade/ui/dialog';

const FILTERS = ['needsgrading', 'all', 'submitted', 'notsubmitted', 'graded', 'late', 'draft'];

export default class Rail {
    /**
     * Constructor.
     *
     * @param {Object} app
     */
    constructor(app) {
        this.app = app;
        const st = app.store;
        this.list = h('div.fg-rail-list', {role: 'listbox', 'aria-label': t('students')});
        this.count = h('span.fg-rail-count');
        this.bulk = h('div.fg-bulk');
        const search = h('input.fg-input.fg-rail-search', {type: 'search', placeholder: t('searchstudents'),
            'aria-label': t('searchstudents'), oninput: debounce(e => {
                st.set({search: e.target.value});
                this.render();
            }, 120)});
        this.filtersel = h('select.fg-select.is-small', {'aria-label': t('filter'), onchange: e => {
            app.savePrefs({filter: e.target.value});
            this.render();
        }}, FILTERS.map(f => h('option', {value: f}, t('filter_' + f))));
        this.sortsel = h('select.fg-select.is-small', {'aria-label': t('sort'), onchange: e => {
            app.savePrefs({sort: e.target.value});
            this.render();
        }}, ['name', 'submitted', 'status', 'random'].map(s => h('option', {value: s}, t('sort_' + s))));
        this.quizbar = h('div.fg-rail-quiz');
        this.groupsel = this.groupSelect();
        const mini = tip(h('button.fg-icon-btn.fg-rail-toggle', {type: 'button', onclick: () => {
            app.savePrefs({rail: st.get('prefs').rail === 'open' ? 'mini' : 'open'});
        }}, icon('sidebar')), t('rail_toggle'), '[');

        this.el = h('aside.fg-rail', {'aria-label': t('students')},
            h('div.fg-rail-head', null,
                h('div.fg-rail-titlebar', null, h('h2.fg-rail-title', null, t('students')), this.count, mini),
                this.quizbar,
                h('div.fg-rail-tools', null, search),
                h('div.fg-rail-tools', null, tip(this.filtersel, t('filter_tip')), tip(this.sortsel, t('sort_tip')),
                    this.groupsel)),
            this.list,
            this.bulk);

        st.on('participants', () => this.render());
        st.on('current', () => this.markCurrent());
        st.on('prefs', p => {
            this.filtersel.value = p.filter;
            this.sortsel.value = p.sort;
        });
        this.renderQuizBar();
    }

    /**
     * Group selector, if the activity uses groups.
     *
     * @returns {HTMLElement|null}
     */
    groupSelect() {
        const info = this.app.store.get('info');
        if (!info.groups || !info.groups.mode || !info.groups.groups.length) {
            return null;
        }
        const sel = h('select.fg-select.is-small', {'aria-label': t('group'), onchange: async e => {
            info.groups.active = parseInt(e.target.value, 10);
            await this.app.loadParticipants();
        }}, info.groups.groups.map(g => h('option', {value: g.id, selected: g.id === info.groups.active}, g.name)));
        return tip(sel, t('group_tip'));
    }

    /**
     * Quiz: marking mode and question selector.
     */
    renderQuizBar() {
        const app = this.app;
        const st = app.store;
        const info = st.get('info');
        if (info.modname !== 'quiz') {
            this.quizbar.remove();
            return;
        }
        const mode = st.get('mode');
        const seg = (value, label, tiptext) => tip(h('button.fg-seg-btn', {type: 'button', 'aria-pressed': String(mode === value),
            onclick: async() => {
                if (st.get('mode') === value) {
                    return;
                }
                st.set({mode: value});
                if (value === 'variant') {
                    const slot = info.slots.find(s => s.slot === st.get('quizkey')) || info.slots[0];
                    st.set({quizkey: slot && slot.variants[0] ? slot.variants[0].questionid : 0});
                } else if (value === 'question') {
                    st.set({quizkey: (info.slots.find(s => s.needs) || info.slots[0] || {}).slot || 0});
                }
                this.renderQuizBar();
                await app.loadParticipants();
                app.openFirst();
            }}, label), tiptext);
        const bits = [h('div.fg-seg', {role: 'group', 'aria-label': t('markingmode')},
            seg('question', t('mode_question'), t('mode_question_tip')),
            seg('student', t('mode_student'), t('mode_student_tip')),
            info.slots.some(s => s.variants.length > 1) ? seg('variant', t('mode_variant'), t('mode_variant_tip')) : null)];
        if (mode === 'question' || mode === 'variant') {
            const options = [];
            info.slots.forEach(s => {
                if (mode === 'question') {
                    options.push(h('option', {value: s.slot, selected: s.slot === st.get('quizkey')},
                        `${t('questionn', s.number)} · ${s.name} (${s.needs})`));
                } else {
                    s.variants.forEach(v => options.push(h('option', {value: v.questionid,
                        selected: v.questionid === st.get('quizkey')}, `${t('questionn', s.number)} · ${v.name}`)));
                }
            });
            bits.push(tip(h('select.fg-select.is-small.fg-qsel', {'aria-label': t('question'), onchange: async e => {
                st.set({quizkey: parseInt(e.target.value, 10)});
                await app.loadParticipants();
                app.openFirst();
            }}, options), t('question_tip')));
        }
        replace(this.quizbar, bits);
    }

    /**
     * One row.
     *
     * @param {Object} p
     * @returns {HTMLElement}
     */
    row(p) {
        const app = this.app;
        const st = app.store;
        const avatar = p.person.picture ? h('img.fg-avatar', {src: p.person.picture, alt: '', loading: 'lazy'}) :
            h('span.fg-avatar.is-initials', null, p.person.initials);
        let state = 'none';
        let statelabel = t('state_nosubmission');
        if (p.needsgrading) {
            state = 'needs';
            statelabel = t('state_needs');
        } else if (p.hasdraft) {
            state = 'draft';
            statelabel = t('state_draft');
        } else if (p.graded) {
            state = 'done';
            statelabel = t('state_done');
        } else if (p.submitted) {
            state = 'needs';
            statelabel = t('state_needs');
        }
        const meta = [];
        if (p.grade) {
            meta.push(h('span.fg-row-grade', null, p.grade));
        }
        if (p.late > 0) {
            meta.push(h('span.fg-row-late', {title: t('late_tip_short', duration(p.late))}, t('latex', duration(p.late))));
        }
        if (p.needscount > 1) {
            meta.push(h('span.fg-row-count', null, t('nquestions', p.needscount)));
        }
        const check = h('input.fg-row-check', {type: 'checkbox', 'aria-label': t('select_student', p.person.fullname),
            checked: st.get('selected').has(p.key), onclick: e => {
                e.stopPropagation();
                const sel = st.get('selected');
                if (e.target.checked) {
                    sel.add(p.key);
                } else {
                    sel.delete(p.key);
                }
                this.renderBulk();
            }});
        const el = h('div.fg-row', {role: 'option', tabindex: '-1', 'aria-selected': 'false', dataset: {key: p.key},
                onclick: () => app.open(p),
                onkeydown: e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        app.open(p);
                    }
                }},
            st.get('info').modname === 'assign' && st.get('info').markingworkflow ? check : null,
            h('span.fg-row-avatar', null, avatar, h('span.fg-dot', {"class": 'is-' + state, title: statelabel})),
            h('span.fg-row-main', null,
                h('span.fg-row-name', null, p.person.fullname),
                h('span.fg-row-meta', null, h('span.fg-row-state', {"class": 'is-' + state}, statelabel), meta)));
        tip(el, `${p.person.fullname}\n${statelabel}${p.grade ? ' · ' + p.grade : ''}`);
        return el;
    }

    /**
     * Render the list.
     */
    render() {
        const vis = this.app.visible();
        const all = this.app.store.get('participants');
        this.rows = new Map();
        const frag = document.createDocumentFragment();
        vis.forEach(p => {
            const el = this.row(p);
            this.rows.set(p.key, el);
            frag.appendChild(el);
        });
        replace(this.list, frag);
        if (!vis.length) {
            this.list.appendChild(h('div.fg-empty-small', null, all.length ? t('nomatches') : t('nostudents')));
        }
        replace(this.count, `${vis.length}/${all.length}`);
        this.markCurrent();
        this.renderBulk();
    }

    /**
     * Refresh one row after a change.
     *
     * @param {Object} p
     */
    refreshEntry(p) {
        const old = this.rows && this.rows.get(p.key);
        if (old) {
            const fresh = this.row(p);
            old.replaceWith(fresh);
            this.rows.set(p.key, fresh);
            this.markCurrent();
        }
    }

    /**
     * Highlight the open student.
     */
    markCurrent() {
        const cur = this.app.store.get('current');
        if (!this.rows) {
            return;
        }
        this.rows.forEach((el, key) => {
            const on = cur && key === cur.key;
            el.classList.toggle('is-current', !!on);
            el.setAttribute('aria-selected', on ? 'true' : 'false');
            el.tabIndex = on ? 0 : -1;
            if (on) {
                el.scrollIntoView({block: 'nearest'});
            }
        });
    }

    /**
     * Bulk action bar.
     */
    renderBulk() {
        const app = this.app;
        const st = app.store;
        const sel = st.get('selected');
        const info = st.get('info');
        if (!sel.size || info.modname !== 'assign') {
            replace(this.bulk);
            this.bulk.classList.remove('is-open');
            return;
        }
        this.bulk.classList.add('is-open');
        const ids = [...sel].map(k => parseInt(k.split(':')[0], 10));
        replace(this.bulk,
            h('span.fg-bulk-count', null, t('nselected', sel.size)),
            tip(h('button.fg-btn.is-small.is-primary', {type: 'button', onclick: async() => {
                const ok = await Dialog.confirm(t('release_title'), t('release_body', sel.size), t('release'));
                if (!ok) {
                    return;
                }
                try {
                    const r = await Api.call('release', {cmid: app.cmid, data: {userids: ids}});
                    toast(t('released', r.released), {type: 'ok'});
                    sel.clear();
                    await app.loadParticipants();
                } catch (e) {
                    toast(Api.message(e), {type: 'error'});
                }
            }}, icon('send'), t('release')), t('release_tip')),
            h('button.fg-btn.is-small.is-ghost', {type: 'button', onclick: () => {
                sel.clear();
                this.render();
            }}, t('clearselection')));
    }
}
