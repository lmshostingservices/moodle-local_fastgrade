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
 * Fast Grade app: loads the activity, keeps state, and wires the screen together.
 *
 * @module     local_fastgrade/app
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, replace, debounce} from 'local_fastgrade/lib/dom';
import * as Str from 'local_fastgrade/lib/str';
import {t} from 'local_fastgrade/lib/str';
import * as Api from 'local_fastgrade/lib/api';
import Store from 'local_fastgrade/lib/store';
import * as Tooltip from 'local_fastgrade/ui/tooltip';
import * as Toast from 'local_fastgrade/ui/toast';
import * as Shortcuts from 'local_fastgrade/ui/shortcuts';
import * as Speech from 'local_fastgrade/voice/speech';
import * as Dictate from 'local_fastgrade/voice/dictate';
import Topbar from 'local_fastgrade/ui/topbar';
import Rail from 'local_fastgrade/ui/rail';
import Panel from 'local_fastgrade/ui/panel';
import ViewerHost from 'local_fastgrade/viewer/host';
import Palette from 'local_fastgrade/ui/palette';
import * as Layout from 'local_fastgrade/ui/layout';
import AnnotationModel from 'local_fastgrade/annotate/model';

/**
 * The application.
 */
class App {
    /**
     * Constructor.
     *
     * @param {Object} boot
     * @param {HTMLElement} mountpoint
     */
    constructor(boot, mountpoint) {
        this.boot = boot;
        this.mount = mountpoint;
        this.cmid = boot.cmid;
        this.store = new Store({
            info: null,
            participants: [],
            prefs: {},
            bank: [],
            current: null,
            item: null,
            savestate: 'idle',
            dirty: false,
            search: '',
            mode: boot.modname === 'quiz' ? 'question' : 'student',
            quizkey: boot.startslot || 0,
            selected: new Set(),
            lookfors: {},
        });
        this.cache = new Map();
        this.draftQueue = debounce(() => this.saveDraft(), 1200);
        this.annotations = null;
    }

    /**
     * Start.
     */
    async start() {
        const st = this.store;
        let data;
        try {
            data = await Api.call('get_activity', {cmid: this.cmid});
        } catch (e) {
            replace(this.mount, h('div.fg-fatal', null, h('h2', null, t('loadfailed')), h('p', null, Api.message(e))));
            return;
        }
        st.set({info: data.info, prefs: data.prefs, bank: data.bank, lookfors: data.lookfors || {}});
        this.integrations = data.integrations;
        this.speech = data.speech;
        this.canmanagecriteria = data.canmanagecriteria;
        Speech.configure(data.speech, data.prefs.cloudnotice, data.prefs.speechlang);
        Dictate.setPrefSaver((k, v) => this.savePrefs({[k]: v}));

        // Quiz: start on the first question with something to mark.
        if (data.info.modname === 'quiz') {
            const slots = data.info.slots || [];
            if (!st.get('quizkey') || !slots.find(s => s.slot === st.get('quizkey'))) {
                const first = slots.find(s => s.needs > 0) || slots[0];
                st.set({quizkey: first ? first.slot : 0});
            }
        }
        this.render();
        Layout.applyPrefs(this.root, st.get('prefs'));
        Tooltip.setEnabled(st.get('prefs').tooltips);
        Shortcuts.setSingleKeys(st.get('prefs').shortcuts);
        this.registerShortcuts();
        this.trackActiveTime();
        await this.loadParticipants(data.participants);
        this.openFirst();
        window.addEventListener('beforeunload', e => {
            if (this.store.get('dirty') || (this.annotations && this.annotations.pending())) {
                this.saveDraft();
                if (this.annotations) {
                    this.annotations.flush();
                }
                e.preventDefault();
                e.returnValue = '';
            }
        });
        window.addEventListener('online', () => this.retryOffline());
    }

    /**
     * Build the screen.
     */
    render() {
        this.root = h('div.fg-app', {dataset: {mod: this.boot.modname}});
        this.topbar = new Topbar(this);
        this.rail = new Rail(this);
        this.viewer = new ViewerHost(this);
        this.panel = new Panel(this);
        this.palette = new Palette(this);
        const body = h('div.fg-body', null,
            this.rail.el,
            h('div.fg-resizer', {dataset: {side: 'rail'}, role: 'separator', 'aria-orientation': 'vertical', tabindex: '0',
                'aria-label': t('resize_rail')}),
            this.viewer.el,
            h('div.fg-resizer', {dataset: {side: 'panel'}, role: 'separator', 'aria-orientation': 'vertical', tabindex: '0',
                'aria-label': t('resize_panel')}),
            this.panel.el);
        replace(this.mount, this.root);
        this.mount.removeAttribute('aria-busy');
        this.mount.className = 'fg-mount';
        this.root.append(this.topbar.el, body);
        Toast.mount(this.root);
        Tooltip.init(this.root);
        Shortcuts.init();
        Layout.initResizers(this.root, (k, v) => this.savePrefs({[k]: v}));
        document.body.classList.add('fg-has-app');
    }

    /**
     * Save some preferences.
     *
     * @param {Object} changes
     */
    savePrefs(changes) {
        const prefs = Object.assign({}, this.store.get('prefs'), changes);
        this.store.set({prefs});
        Layout.applyPrefs(this.root, prefs);
        Tooltip.setEnabled(prefs.tooltips);
        Shortcuts.setSingleKeys(prefs.shortcuts);
        Api.call('save_prefs', {data: changes}).catch(() => null);
    }

    /**
     * Load the participant (or queue) list.
     *
     * @param {Array|null} given
     */
    async loadParticipants(given = null) {
        const st = this.store;
        let list = given;
        if (this.boot.modname === 'quiz') {
            const mode = st.get('mode');
            const key = mode === 'student' ? 0 : st.get('quizkey');
            const group = st.get('info').groups.active || 0;
            const q = await Api.call('quiz_queue', {cmid: this.cmid, mode, key, groupid: group});
            list = q.entries;
        } else if (!list) {
            const r = await Api.call('get_participants', {cmid: this.cmid, groupid: st.get('info').groups.active || 0});
            list = r.participants;
        }
        list.forEach(p => {
            p.key = `${p.person.id}:${p.attempt}:${p.slot || 0}`;
        });
        st.set({participants: list});
    }

    /**
     * The participants after search, filter and sort.
     *
     * @returns {Array}
     */
    visible() {
        const st = this.store;
        const prefs = st.get('prefs');
        const q = st.get('search').trim().toLowerCase();
        let list = st.get('participants').filter(p => {
            if (q && !p.person.fullname.toLowerCase().includes(q)) {
                return false;
            }
            switch (prefs.filter) {
                case 'needsgrading': return p.needsgrading;
                case 'submitted': return p.submitted;
                case 'notsubmitted': return !p.submitted;
                case 'graded': return p.graded;
                case 'late': return p.late > 0;
                case 'draft': return p.hasdraft;
                default: return true;
            }
        });
        const sort = prefs.sort;
        list = list.slice();
        if (sort === 'submitted') {
            list.sort((a, b) => (a.timesubmitted || Infinity) - (b.timesubmitted || Infinity));
        } else if (sort === 'status') {
            const rank = p => (p.needsgrading ? 0 : (p.hasdraft ? 1 : (p.graded ? 3 : 2)));
            list.sort((a, b) => rank(a) - rank(b) || a.sortname.localeCompare(b.sortname));
        } else if (sort === 'random') {
            const seed = this.cmid;
            const hash = s => [...s].reduce((acc, c) => (acc * 31 + c.charCodeAt(0) + seed) % 1000003, 7);
            list.sort((a, b) => hash(a.key) - hash(b.key));
        } else {
            list.sort((a, b) => a.sortname.localeCompare(b.sortname));
        }
        return list;
    }

    /**
     * Open the requested or first student needing marking.
     */
    openFirst() {
        const all = this.store.get('participants');
        let entry = null;
        if (this.boot.startuserid) {
            entry = all.find(p => p.person.id === this.boot.startuserid);
        }
        if (!entry) {
            const vis = this.visible();
            entry = vis.find(p => p.needsgrading) || vis[0] || all[0];
        }
        if (entry) {
            this.open(entry);
        } else {
            this.viewer.empty(t('nothingtomark'));
            this.panel.empty();
        }
    }

    /**
     * Fetch an item (cached for prefetch).
     *
     * @param {Object} entry
     * @returns {Promise<Object>}
     */
    fetchItem(entry) {
        const k = entry.key;
        if (!this.cache.has(k)) {
            const p = Api.call('get_item', {cmid: this.cmid, userid: entry.person.id, attempt: entry.attempt,
                slot: entry.slot || 0});
            p.catch(() => this.cache.delete(k));
            this.cache.set(k, p);
        }
        return this.cache.get(k);
    }

    /**
     * Open an entry.
     *
     * @param {Object} entry
     * @param {Object} opts {skipCommit}
     */
    /**
     * Count the seconds the marker is actually working on the open submission: the tab is visible
     * and focused and they have typed, clicked, scrolled or moved the mouse in the last 90 seconds.
     * Used for the workload report, so coffee breaks do not count as marking time.
     */
    trackActiveTime() {
        this.activeSecs = 0;
        let last = Date.now();
        const touch = () => {
            last = Date.now();
        };
        ['keydown', 'pointerdown', 'wheel', 'pointermove'].forEach(ev => window.addEventListener(ev, touch,
            {passive: true, capture: true}));
        setInterval(() => {
            if (document.visibilityState === 'visible' && document.hasFocus() && Date.now() - last < 90000 &&
                    this.store.get('item')) {
                this.activeSecs++;
            }
        }, 1000);
    }

    async open(entry, opts = {}) {
        const st = this.store;
        const current = st.get('current');
        if (current && current.key === entry.key && !opts.force) {
            return;
        }
        Dictate.stopAll();
        if (current && !opts.skipCommit) {
            await this.leaveCurrent();
        }
        if (this.annotations) {
            await this.annotations.flush();
        }
        st.set({current: entry, item: null, dirty: false});
        this.viewer.loading();
        this.panel.loading();
        let item;
        try {
            item = await this.fetchItem(entry);
        } catch (e) {
            this.cache.delete(entry.key);
            this.viewer.empty(Api.message(e));
            return;
        }
        if (st.get('current') !== entry) {
            return;
        }
        // Use the latest saved state next time we come back.
        this.cache.delete(entry.key);
        this.annotations = new AnnotationModel(this, entry, item);
        st.set({item});
        this.panel.show(item);
        this.viewer.show(item);
        this.prefetch(entry);
        const url = new URL(window.location.href);
        url.searchParams.set('userid', entry.person.id);
        if (entry.slot) {
            url.searchParams.set('slot', entry.slot);
        }
        window.history.replaceState(null, '', url.toString());
    }

    /**
     * Prefetch the next two items so moving on is instant.
     *
     * @param {Object} entry
     */
    prefetch(entry) {
        const vis = this.visible();
        const i = vis.findIndex(p => p.key === entry.key);
        vis.slice(i + 1, i + 3).forEach(p => {
            if (!this.cache.has(p.key)) {
                setTimeout(() => this.fetchItem(p), 400);
            }
        });
    }

    /**
     * Before leaving the current student: commit a complete grade, else keep the draft.
     */
    async leaveCurrent() {
        const st = this.store;
        if (!st.get('dirty')) {
            return;
        }
        const draft = this.panel.collect();
        if (this.panel.isComplete(draft) && st.get('prefs').autoadvance) {
            await this.commit(false);
        } else {
            this.draftQueue.cancel();
            await this.saveDraft();
        }
    }

    /**
     * Something changed in the marking panel.
     */
    changed() {
        this.store.set({dirty: true, savestate: 'pending'});
        this.draftQueue();
    }

    /**
     * Autosave the draft.
     */
    async saveDraft() {
        const st = this.store;
        const cur = st.get('current');
        const item = st.get('item');
        if (!cur || !item || !st.get('dirty')) {
            return;
        }
        const data = this.panel.collect();
        st.set({savestate: 'saving'});
        try {
            await Api.call('save_draft', {cmid: this.cmid, userid: cur.person.id, attempt: item.attempt,
                slot: cur.slot || 0, data});
            cur.hasdraft = true;
            st.set({savestate: 'draft'});
            this.rail.refreshEntry(cur);
        } catch (e) {
            st.set({savestate: navigator.onLine ? 'error' : 'offline'});
            this.storeOffline(cur, item, data);
        }
    }

    /**
     * Keep unsaved work in this browser when offline.
     *
     * @param {Object} cur
     * @param {Object} item
     * @param {Object} data
     */
    storeOffline(cur, item, data) {
        try {
            const key = `fastgrade-offline-${this.cmid}`;
            const all = JSON.parse(window.localStorage.getItem(key) || '{}');
            all[cur.key] = {userid: cur.person.id, attempt: item.attempt, slot: cur.slot || 0, data, time: Date.now()};
            window.localStorage.setItem(key, JSON.stringify(all));
        } catch (e) {
            // Storage may be unavailable.
        }
    }

    /**
     * Send drafts kept while offline.
     */
    async retryOffline() {
        const key = `fastgrade-offline-${this.cmid}`;
        let all = {};
        try {
            all = JSON.parse(window.localStorage.getItem(key) || '{}');
        } catch (e) {
            return;
        }
        for (const [k, v] of Object.entries(all)) {
            try {
                await Api.call('save_draft', {cmid: this.cmid, userid: v.userid, attempt: v.attempt, slot: v.slot, data: v.data});
                delete all[k];
            } catch (e) {
                break;
            }
        }
        try {
            window.localStorage.setItem(key, JSON.stringify(all));
        } catch (e) {
            // Ignore.
        }
        if (this.annotations) {
            this.annotations.flush();
        }
        Toast.toast(t('backonline'), {type: 'ok'});
        this.store.set({savestate: 'saved'});
    }

    /**
     * Commit the grade to Moodle.
     *
     * @param {boolean} next move to the next student after
     * @returns {Promise<boolean>}
     */
    async commit(next = true) {
        const st = this.store;
        const cur = st.get('current');
        const item = st.get('item');
        if (!cur || !item) {
            return false;
        }
        Dictate.stopAll();
        this.draftQueue.cancel();
        // Saving is the marker's approval of whatever the auto-marker suggested and they kept.
        this.panel.approveAll(true);
        const data = this.panel.collect();
        data.dictation = this.panel.takeDictationLog();
        data.activesecs = this.activeSecs || 0;
        const summary = this.panel.auto.summaryFor(cur.key);
        if (summary) {
            data.autosummary = summary;
        }
        if (item.question) {
            data.sequencecheck = item.gradestate.sequencecheck;
        }
        st.set({savestate: 'saving'});
        if (this.annotations) {
            await this.annotations.flush();
        }
        try {
            const r = await Api.call('save_grade', {cmid: this.cmid, userid: cur.person.id, attempt: item.attempt,
                slot: cur.slot || 0, data});
            item.gradestate = r.gradestate;
            item.draft = null;
            cur.graded = true;
            cur.needsgrading = false;
            cur.hasdraft = false;
            cur.grade = r.gradestate.gradedisplay;
            if (item.question) {
                item.question.sequencecheck = r.gradestate.sequencecheck;
            }
            this.activeSecs = 0;
            st.set({dirty: false, savestate: 'saved'});
            this.rail.refreshEntry(cur);
            this.topbar.updateProgress();
            Toast.toast(t('savedfor', cur.person.fullname), {type: 'ok'});
            if (next) {
                this.next(true);
            } else {
                this.panel.show(item, true);
            }
            return true;
        } catch (e) {
            st.set({savestate: 'error'});
            Toast.toast(Api.message(e), {type: 'error'});
            return false;
        }
    }

    /**
     * Move through the list.
     *
     * @param {boolean} needsOnly only students needing marking
     * @param {number} dir 1 or -1
     */
    next(needsOnly = false, dir = 1) {
        const vis = this.visible();
        const cur = this.store.get('current');
        let i = cur ? vis.findIndex(p => p.key === cur.key) : -1;
        for (let n = 0; n < vis.length; n++) {
            i += dir;
            if (i < 0 || i >= vis.length) {
                break;
            }
            if (!needsOnly || vis[i].needsgrading) {
                this.open(vis[i]);
                return;
            }
        }
        if (needsOnly && dir === 1) {
            Toast.toast(t('allmarked'), {type: 'ok'});
        }
    }

    /**
     * Keyboard shortcuts.
     */
    registerShortcuts() {
        const g = t('sc_navigation');
        const v = t('sc_view');
        const m = t('sc_marking');
        Shortcuts.add('j', () => this.next(false, 1), {group: g, label: t('sc_next')});
        Shortcuts.add('k', () => this.next(false, -1), {group: g, label: t('sc_prev')});
        Shortcuts.add('n', () => this.next(true, 1), {group: g, label: t('sc_nextneeds')});
        Shortcuts.add('mod+enter', () => this.commit(true), {group: m, label: t('sc_savenext')});
        Shortcuts.add('mod+s', () => this.commit(false), {group: m, label: t('sc_save')});
        Shortcuts.add('mod+k', () => this.palette.open(), {group: g, label: t('sc_palette')});
        Shortcuts.add('?', () => Shortcuts.showHelp(), {group: g, label: t('sc_help')});
        Shortcuts.add('\\', () => this.savePrefs({focus: !this.store.get('prefs').focus}), {group: v, label: t('sc_focus')});
        Shortcuts.add('shift+\\', () => this.savePrefs({zen: !this.store.get('prefs').zen}), {group: v, label: t('sc_zen')});
        Shortcuts.add('[', () => this.savePrefs({rail: this.store.get('prefs').rail === 'open' ? 'mini' : 'open'}),
            {group: v, label: t('sc_rail')});
        Shortcuts.add(']', () => this.savePrefs({panel: this.store.get('prefs').panel === 'open' ? 'hidden' : 'open'}),
            {group: v, label: t('sc_panel')});
        Shortcuts.add('m', () => {
            const order = ['cards', 'pins', 'hidden'];
            const cur = order.indexOf(this.store.get('prefs').margin);
            this.savePrefs({margin: order[(cur + 1) % order.length]});
        }, {group: v, label: t('sc_margin')});
        Shortcuts.add('escape', () => {
            if (this.store.get('prefs').zen) {
                this.savePrefs({zen: false});
                return true;
            }
            return false;
        }, {hidden: true});
        this.panel.registerShortcuts();
        this.viewer.registerShortcuts();
    }
}

/**
 * Start the app.
 *
 * @param {string} bootselector
 */
export const init = bootselector => {
    const bootel = document.querySelector(bootselector);
    if (!bootel) {
        return;
    }
    const boot = JSON.parse(bootel.textContent);
    Str.load(boot.strings);
    const app = new App(boot, document.getElementById('fg-app'));
    window.fastgrade = app;
    app.start();
};
