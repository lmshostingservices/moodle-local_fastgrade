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
 * The Fast Grade activity report: filters, saved views, tabs, pivot table and exports.
 * All the data arrives with the page, so every filter, pivot and chart updates instantly.
 *
 * @module     local_fastgrade/report/app
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon, replace, debounce} from 'local_fastgrade/lib/dom';
import * as Str from 'local_fastgrade/lib/str';
import {t} from 'local_fastgrade/lib/str';
import * as Api from 'local_fastgrade/lib/api';
import * as Tooltip from 'local_fastgrade/ui/tooltip';
import {tip} from 'local_fastgrade/ui/tooltip';
import * as Toast from 'local_fastgrade/ui/toast';
import * as Dialog from 'local_fastgrade/ui/dialog';
import * as Layout from 'local_fastgrade/ui/layout';
import * as Model from 'local_fastgrade/report/model';
import * as Tabs from 'local_fastgrade/report/tabs';
import * as Table from 'local_fastgrade/report/table';
import * as Pivot from 'local_fastgrade/report/pivot';
import * as Exporter from 'local_fastgrade/report/export';

const DEFAULTS = {
    tab: 'overview',
    versions: 'latest',
    filters: {},
    ranges: {},
    search: '',
    pivot: {rows: 'marker', cols: '', measure: 'meanpct', heat: true},
    columns: null,
    sort: {key: 'name', dir: 1},
};

/**
 * A copy of a state object.
 *
 * @param {Object} s
 * @returns {Object}
 */
const clone = s => JSON.parse(JSON.stringify(s));

class Report {
    /**
     * Constructor.
     *
     * @param {Object} boot
     * @param {HTMLElement} mount
     */
    constructor(boot, mount) {
        this.boot = boot;
        this.mount = mount;
        this.meta = boot.meta;
        this.all = boot.rows;
        this.meta.hasEg = this.all.some(r => r.eg);
        this.meta.hasDg = this.all.some(r => r.dg);
        this.F = Model.build(this.meta);
        this.views = boot.views || [];
        this.viewid = 0;
        this.state = clone(DEFAULTS);
        this.state.columns = Table.defaultColumns(this);
        this.fromHash();
    }

    /**
     * The tabs that apply to this activity.
     *
     * @returns {Array} [[key, label, icon]]
     */
    tabs() {
        const quiz = this.meta.kind === 'quiz';
        const out = [['overview', t('rp_tab_overview'), 'sparkle']];
        if (quiz) {
            out.push(['questions', t('rp_tab_questions'), 'question']);
        } else if ((this.meta.criteria || []).length) {
            out.push(['criteria', t('rp_tab_criteria'), 'list']);
        }
        out.push(['markers', t('rp_tab_markers'), 'users'], ['feedback', t('rp_tab_feedback'), 'comment'],
            ['auto', t('rp_tab_auto'), 'wand']);
        if (this.meta.hasEg || this.meta.hasDg) {
            out.push(['integrity', t('rp_tab_integrity'), 'shield']);
        }
        out.push(['workload', t('rp_tab_workload'), 'clock'], ['students', t('rp_tab_students'), 'user'],
            ['pivot', t('rp_tab_pivot'), 'grid']);
        return out;
    }

    /**
     * Draw the page.
     */
    start() {
        this.root = h('div.fg-app.fg-report', {dataset: {mod: this.meta.kind}});
        Layout.applyPrefs(this.root, Object.assign({}, this.boot.prefs, {focus: false, zen: false}));
        this.head = h('header.fg-rp-head');
        this.filterbar = h('div.fg-rp-filters', {role: 'toolbar', 'aria-label': t('rp_filters')});
        this.tabbar = h('nav.fg-rp-tabs', {role: 'tablist', 'aria-label': t('rp_sections')});
        this.body = h('main.fg-rp-body', {id: 'fg-rp-body', tabindex: '-1'});
        replace(this.mount, this.root);
        this.mount.removeAttribute('aria-busy');
        this.mount.className = 'fg-mount';
        this.root.append(this.head, h('div.fg-rp-sticky', null, this.filterbar, this.tabbar), this.body);
        Toast.mount(this.root);
        Tooltip.init(this.root);
        document.body.classList.add('fg-has-app');
        this.renderHead();
        this.refresh();
        window.addEventListener('hashchange', () => {
            if (this.fromHash()) {
                this.refresh();
            }
        });
        document.addEventListener('keydown', e => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
                e.preventDefault();
                Exporter.print(this);
            }
        });
    }

    /**
     * Header: title, views, export.
     */
    renderHead() {
        const m = this.meta;
        const view = this.views.find(v => v.id === this.viewid);
        const viewbtn = tip(h('button.fg-btn.is-ghost.fg-rp-viewbtn', {type: 'button', 'aria-haspopup': 'menu',
            onclick: e => this.viewMenu(e.currentTarget)}, icon('bookmark', 'fg-i-sm'),
        h('span', null, view ? view.name : t('rp_view_default')), icon('down', 'fg-i-sm')), t('rp_views_tip'));
        const exportbtn = tip(h('button.fg-btn.is-primary.fg-rp-export', {type: 'button', 'aria-haspopup': 'menu',
            onclick: e => this.exportMenu(e.currentTarget)}, icon('download', 'fg-i-sm'), h('span', null, t('rp_export')),
        icon('down', 'fg-i-sm')), t('rp_export_tip'));
        replace(this.head,
            h('div.fg-rp-head-left', null,
                tip(h('a.fg-icon-btn', {href: m.activityurl, 'aria-label': t('backtoactivity')}, icon('left')),
                    t('backtoactivity')),
                h('div.fg-rp-title', null,
                    h('h1', null, m.name),
                    h('p', null, t('rp_subtitle', {course: m.course, time: new Date(m.calculated * 1000).toLocaleString(undefined,
                        {day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit'})})))),
            h('div.fg-rp-head-right', null,
                viewbtn,
                tip(h('button.fg-btn.is-ghost', {type: 'button', onclick: () => this.saveViewDialog()}, icon('save', 'fg-i-sm'),
                    h('span', null, t('rp_saveview'))), t('rp_saveview_tip')),
                tip(h('button.fg-icon-btn', {type: 'button', 'aria-label': t('rp_copylink'), onclick: () => this.copyLink()},
                    icon('link')), t('rp_copylink_tip')),
                this.boot.cangrade ? tip(h('a.fg-btn.is-ghost', {href: m.graderurl}, icon('pen', 'fg-i-sm'),
                    h('span', null, t('rp_openmarking'))), t('rp_openmarking_tip')) : null,
                exportbtn));
    }

    /**
     * Rows after filters.
     *
     * @returns {Array}
     */
    rows() {
        return Model.filter(this.all, this.state, this.F.dims);
    }

    /**
     * Redraw filters, tabs and the current section.
     */
    refresh() {
        this.current = this.rows();
        this.renderFilters();
        this.renderTabs();
        this.renderBody();
        this.toHash();
    }

    /**
     * Change state and redraw.
     *
     * @param {Object} changes
     */
    set(changes) {
        Object.assign(this.state, changes);
        this.refresh();
    }

    /**
     * Follow an insight or chart click: apply filters and switch tab.
     *
     * @param {Object} action {filters, tab}
     */
    act(action) {
        if (!action) {
            return;
        }
        if (action.filters) {
            this.state.filters = Object.assign({}, this.state.filters, action.filters);
        }
        if (action.tab) {
            this.state.tab = action.tab;
        }
        this.refresh();
        this.body.focus({preventScroll: true});
        window.scrollTo({top: 0, behavior: 'smooth'});
    }

    /**
     * Toggle one filter value.
     *
     * @param {string} dim
     * @param {string} value
     */
    toggleFilter(dim, value) {
        const cur = new Set(this.state.filters[dim] || []);
        if (cur.has(value)) {
            cur.delete(value);
        } else {
            cur.add(value);
        }
        this.state.filters[dim] = [...cur];
        this.refresh();
    }

    /* ---------- Filters ---------- */

    /**
     * The filter bar.
     */
    renderFilters() {
        const st = this.state;
        const seg = h('div.fg-seg', {role: 'radiogroup', 'aria-label': t('rp_versions')},
            ['latest', 'all'].map(v => tip(h('button.fg-seg-btn', {type: 'button', role: 'radio',
                'aria-checked': String(st.versions === v), onclick: () => this.set({versions: v})},
            t(v === 'latest' ? 'rp_latestonly' : 'rp_allversions')),
                t(v === 'latest' ? 'rp_latestonly_tip' : 'rp_allversions_tip'))));
        const chips = [];
        Object.entries(st.filters).forEach(([k, vals]) => {
            if (!vals || !vals.length) {
                return;
            }
            const d = this.F.dims.find(x => x.key === k);
            if (!d) {
                return;
            }
            const labels = Model.group(this.all, d).filter(g => vals.includes(g.value)).map(g => g.label);
            chips.push(this.chip(d.label, labels.length > 2 ? t('rp_nselected', labels.length) : labels.join(', '),
                () => this.filterPopover(d, null), () => {
                    delete st.filters[k];
                    this.refresh();
                }));
        });
        Object.entries(st.ranges).forEach(([k, r]) => {
            if (!r) {
                return;
            }
            chips.push(this.chip(t('rp_range_' + k), `${r[0]}–${r[1]}${k === 'pct' ? '%' : ' ' + t('rp_daysunit')}`,
                () => this.rangePopover(k, null), () => {
                    delete st.ranges[k];
                    this.refresh();
                }));
        });
        const add = tip(h('button.fg-btn.is-ghost.is-small.fg-rp-addfilter', {type: 'button', onclick: e =>
            this.addFilterMenu(e.currentTarget)}, icon('filter', 'fg-i-sm'), h('span', null, t('rp_addfilter'))),
                t('rp_addfilter_tip'));
        const search = h('input.fg-input.is-small.fg-rp-search', {type: 'search', placeholder: t('rp_findstudent'),
            value: st.search, 'aria-label': t('rp_findstudent')});
        search.addEventListener('input', debounce(() => {
            st.search = search.value;
            this.current = this.rows();
            this.renderTabs();
            this.renderBody();
            this.toHash();
            this.renderCount();
        }, 160));
        const any = chips.length || st.search;
        this.countEl = h('span.fg-rp-count');
        replace(this.filterbar, seg, h('div.fg-rp-chips', null, chips, add), h('span.fg-grow'), this.countEl, search,
            any ? tip(h('button.fg-btn.is-ghost.is-small', {type: 'button', onclick: () => this.set({filters: {}, ranges: {},
                search: ''})}, t('rp_clearall')), t('rp_clearall_tip')) : null);
        this.renderCount();
    }

    /**
     * "Showing 12 of 30".
     */
    renderCount() {
        const total = this.all.filter(r => this.state.versions === 'all' || r.latest).length;
        this.countEl.textContent = t('rp_showing', {n: this.current.length, total});
    }

    /**
     * A filter chip.
     *
     * @param {string} label
     * @param {string} value
     * @param {Function} onedit
     * @param {Function} onremove
     * @returns {HTMLElement}
     */
    chip(label, value, onedit, onremove) {
        return h('span.fg-rp-chip', null,
            h('button.fg-rp-chip-main', {type: 'button', onclick: e => onedit(e.currentTarget)},
                h('span.fg-rp-chip-k', null, label), h('span.fg-rp-chip-v', null, value)),
            tip(h('button.fg-rp-chip-x', {type: 'button', 'aria-label': t('rp_removefilter', label), onclick: onremove},
                icon('x', 'fg-i-xs')), t('rp_removefilter', label)));
    }

    /**
     * Open a popover next to an element.
     *
     * @param {HTMLElement} anchor
     * @param {HTMLElement} content
     * @returns {Function} close
     */
    popover(anchor, content) {
        this.closePopover();
        const pop = h('div.fg-rp-pop', {role: 'dialog'}, content);
        this.root.append(pop);
        const r = (anchor || this.filterbar).getBoundingClientRect();
        const pr = pop.getBoundingClientRect();
        pop.style.top = Math.min(window.innerHeight - pr.height - 8, r.bottom + 6) + 'px';
        pop.style.left = Math.max(8, Math.min(window.innerWidth - pr.width - 8, r.left)) + 'px';
        const outside = e => {
            if (!pop.contains(e.target) && !(anchor && anchor.contains(e.target))) {
                this.closePopover();
            }
        };
        const esc = e => {
            if (e.key === 'Escape') {
                this.closePopover();
                if (anchor) {
                    anchor.focus();
                }
            }
        };
        setTimeout(() => document.addEventListener('mousedown', outside), 0);
        document.addEventListener('keydown', esc);
        this.popClose = () => {
            document.removeEventListener('mousedown', outside);
            document.removeEventListener('keydown', esc);
            pop.remove();
            this.popClose = null;
        };
        const first = pop.querySelector('input, button');
        if (first) {
            first.focus();
        }
        return this.popClose;
    }

    /**
     * Close any popover.
     */
    closePopover() {
        if (this.popClose) {
            this.popClose();
        }
    }

    /**
     * Menu of fields to filter on.
     *
     * @param {HTMLElement} anchor
     */
    addFilterMenu(anchor) {
        const q = h('input.fg-input.is-small', {type: 'search', placeholder: t('rp_findfield'), 'aria-label': t('rp_findfield')});
        const list = h('div.fg-rp-menu', {role: 'menu'});
        const items = this.F.dims.filter(d => !['latest'].includes(d.key)).map(d => ({label: d.label, run: () =>
            this.filterPopover(d, anchor)}))
            .concat([{label: t('rp_range_pct'), run: () => this.rangePopover('pct', anchor)},
                {label: t('rp_range_turn'), run: () => this.rangePopover('turn', anchor)}]);
        const draw = () => {
            const s = q.value.trim().toLowerCase();
            replace(list, items.filter(i => !s || i.label.toLowerCase().includes(s)).map(i =>
                h('button.fg-rp-menu-item', {type: 'button', role: 'menuitem', onclick: i.run}, i.label)));
        };
        q.addEventListener('input', draw);
        draw();
        this.popover(anchor, h('div.fg-rp-pop-in', null, q, list));
    }

    /**
     * Pick values of one field.
     *
     * @param {Object} d dimension
     * @param {HTMLElement} anchor
     */
    filterPopover(d, anchor) {
        // Counts reflect every other filter, so you see what each choice would leave.
        const others = Object.assign({}, this.state, {filters: Object.assign({}, this.state.filters, {[d.key]: []})});
        const base = Model.filter(this.all, others, this.F.dims);
        const groups = Model.group(this.all.filter(r => this.state.versions === 'all' || r.latest), d);
        const counts = new Map(Model.group(base, d).map(g => [g.value, g.rows.length]));
        const chosen = new Set(this.state.filters[d.key] || []);
        const boxes = groups.map(g => h('label.fg-rp-check', null,
            h('input', {type: 'checkbox', value: g.value, checked: chosen.has(g.value)}),
            h('span', null, g.label), h('small', null, String(counts.get(g.value) || 0))));
        const apply = () => {
            this.state.filters[d.key] = [...this.closestPop().querySelectorAll('input[type=checkbox]:checked')].map(i => i.value);
            this.closePopover();
            this.refresh();
        };
        this.popover(anchor || this.filterbar.querySelector('.fg-rp-addfilter'), h('div.fg-rp-pop-in', null,
            h('div.fg-rp-pop-title', null, d.label),
            h('div.fg-rp-checks', null, boxes),
            h('div.fg-rp-pop-foot', null,
                h('button.fg-btn.is-ghost.is-small', {type: 'button', onclick: () => {
                    this.closestPop().querySelectorAll('input[type=checkbox]').forEach(i => {
                        i.checked = false;
                    });
                }}, t('rp_none')),
                h('span.fg-grow'),
                h('button.fg-btn.is-primary.is-small', {type: 'button', onclick: apply}, t('rp_apply')))));
    }

    /**
     * The open popover.
     *
     * @returns {HTMLElement}
     */
    closestPop() {
        return this.root.querySelector('.fg-rp-pop');
    }

    /**
     * A number range filter.
     *
     * @param {string} key pct or turn
     * @param {HTMLElement} anchor
     */
    rangePopover(key, anchor) {
        const cur = this.state.ranges[key] || (key === 'pct' ? [0, 100] : [0, 30]);
        const lo = h('input.fg-input.is-small', {type: 'number', value: cur[0], min: 0, step: 'any', 'aria-label': t('rp_from')});
        const hi = h('input.fg-input.is-small', {type: 'number', value: cur[1], min: 0, step: 'any', 'aria-label': t('rp_to')});
        this.popover(anchor || this.filterbar.querySelector('.fg-rp-addfilter'), h('div.fg-rp-pop-in', null,
            h('div.fg-rp-pop-title', null, t('rp_range_' + key)),
            h('div.fg-rp-range', null, h('label', null, t('rp_from'), lo), h('label', null, t('rp_to'), hi)),
            h('div.fg-rp-pop-foot', null, h('span.fg-grow'),
                h('button.fg-btn.is-primary.is-small', {type: 'button', onclick: () => {
                    const a = parseFloat(lo.value);
                    const b = parseFloat(hi.value);
                    if (!isNaN(a) && !isNaN(b)) {
                        this.state.ranges[key] = [Math.min(a, b), Math.max(a, b)];
                    }
                    this.closePopover();
                    this.refresh();
                }}, t('rp_apply')))));
    }

    /* ---------- Tabs ---------- */

    /**
     * Tab strip.
     */
    renderTabs() {
        const tabs = this.tabs();
        if (!tabs.some(x => x[0] === this.state.tab)) {
            this.state.tab = 'overview';
        }
        replace(this.tabbar, tabs.map(([key, label, ic]) => h('button.fg-rp-tab', {type: 'button', role: 'tab',
            'aria-selected': String(this.state.tab === key), onclick: () => this.set({tab: key})}, icon(ic, 'fg-i-sm'),
        h('span', null, label))));
    }

    /**
     * The current section.
     */
    renderBody() {
        const ctx = this.ctx();
        let el;
        switch (this.state.tab) {
            case 'students':
                el = Table.render(ctx);
                break;
            case 'pivot':
                el = Pivot.render(ctx);
                break;
            default:
                el = Tabs.render(this.state.tab, ctx);
        }
        replace(this.body, el);
    }

    /**
     * What the section renderers need.
     *
     * @returns {Object}
     */
    ctx() {
        return {app: this, meta: this.meta, rows: this.current, all: this.all, F: this.F, state: this.state, boot: this.boot};
    }

    /* ---------- Saved views and links ---------- */

    /**
     * What a view saves.
     *
     * @returns {Object}
     */
    snapshot() {
        const s = clone(this.state);
        Object.keys(s.filters).forEach(k => {
            if (!s.filters[k] || !s.filters[k].length) {
                delete s.filters[k];
            }
        });
        return s;
    }

    /**
     * Load a view's settings.
     *
     * @param {Object} config
     */
    load(config) {
        this.state = Object.assign(clone(DEFAULTS), {columns: Table.defaultColumns(this)}, clone(config || {}));
        this.state.pivot = Object.assign(clone(DEFAULTS.pivot), this.state.pivot || {});
    }

    /**
     * Keep the state in the address so the page can be bookmarked or shared.
     */
    toHash() {
        try {
            const enc = btoa(unescape(encodeURIComponent(JSON.stringify(this.snapshot()))));
            this.lastHash = '#r=' + enc;
            history.replaceState(null, '', this.lastHash);
        } catch (e) {
            // Ignore.
        }
    }

    /**
     * Read the state from the address.
     *
     * @returns {boolean} changed
     */
    fromHash() {
        const m = /#r=([^&]+)/.exec(window.location.hash);
        if (!m || ('#r=' + m[1]) === this.lastHash) {
            return false;
        }
        try {
            this.load(JSON.parse(decodeURIComponent(escape(atob(m[1])))));
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Copy a link to exactly this view.
     */
    copyLink() {
        this.toHash();
        const url = window.location.href;
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
            .then(() => Toast.toast(t('rp_linkcopied'), {type: 'ok'}))
            .catch(() => Dialog.open({title: t('rp_copylink'), body: h('input.fg-input', {value: url, readonly: true,
                onfocus: e => e.target.select()})}));
    }

    /**
     * The views menu.
     *
     * @param {HTMLElement} anchor
     */
    viewMenu(anchor) {
        const item = (v, label, sub) => h('div.fg-rp-viewitem', null,
            h('button.fg-rp-menu-item', {type: 'button', role: 'menuitemradio',
                'aria-checked': String(this.viewid === (v ? v.id : 0)),
                onclick: () => {
                    this.viewid = v ? v.id : 0;
                    this.load(v ? v.config : {});
                    this.closePopover();
                    this.renderHead();
                    this.refresh();
                }}, h('span', null, label), sub ? h('small', null, sub) : null),
            v && v.mine ? tip(h('button.fg-icon-btn.is-xs', {type: 'button', 'aria-label': t('delete'), onclick: async() => {
                const ok = await Dialog.confirm(t('rp_deleteview'), t('rp_deleteview_q', v.name), t('delete'));
                if (ok) {
                    this.saveViews(await Api.call('report_views', {cmid: this.meta.cmid, action: 'delete', data: {id: v.id}}));
                    if (this.viewid === v.id) {
                        this.viewid = 0;
                    }
                    this.renderHead();
                    Toast.toast(t('rp_viewdeleted'), {type: 'info'});
                }
            }}, icon('trash')), t('delete')) : null);
        const mine = this.views.filter(v => v.mine);
        const shared = this.views.filter(v => !v.mine);
        this.popover(anchor, h('div.fg-rp-pop-in.fg-rp-views', {role: 'menu'},
            item(null, t('rp_view_default'), t('rp_view_default_sub')),
            mine.length ? h('div.fg-rp-pop-sub', null, t('rp_myviews')) : null,
            mine.map(v => item(v, v.name, [v.shared ? t('rp_shared') : '', v.allactivities ? t('rp_allactivities') : '']
                .filter(Boolean).join(' · '))),
            shared.length ? h('div.fg-rp-pop-sub', null, t('rp_sharedviews')) : null,
            shared.map(v => item(v, v.name, v.owner)),
            !this.views.length ? h('p.fg-small.fg-muted.fg-rp-pop-note', null, t('rp_noviews')) : null));
    }

    /**
     * Keep the views list from the server.
     *
     * @param {Object} r
     */
    saveViews(r) {
        this.views = r.views || [];
    }

    /**
     * Save the current view.
     */
    saveViewDialog() {
        const cur = this.views.find(v => v.id === this.viewid && v.mine);
        const name = h('input.fg-input', {type: 'text', maxlength: 100, value: cur ? cur.name : '',
            placeholder: t('rp_viewname_ph'),
            'aria-label': t('rp_viewname'), autofocus: true});
        const shared = h('input', {type: 'checkbox', checked: cur ? cur.shared : false});
        const allact = h('input', {type: 'checkbox', checked: cur ? cur.allactivities : false});
        const asnew = cur ? h('input', {type: 'checkbox'}) : null;
        const save = async() => {
            if (!name.value.trim()) {
                name.focus();
                return false;
            }
            try {
                const r = await Api.call('report_views', {cmid: this.meta.cmid, action: 'save', data: {
                    id: cur && !(asnew && asnew.checked) ? cur.id : 0, name: name.value.trim(), config: this.snapshot(),
                    shared: shared.checked, allactivities: allact.checked}});
                this.saveViews(r);
                const found = this.views.filter(v => v.mine && v.name === name.value.trim()).pop();
                this.viewid = found ? found.id : 0;
                this.renderHead();
                Toast.toast(t('rp_viewsaved'), {type: 'ok'});
            } catch (e) {
                Toast.toast(Api.message(e), {type: 'error'});
            }
            return true;
        };
        Dialog.open({title: cur ? t('rp_updateview') : t('rp_saveview'), body: h('div.fg-rp-form', null,
            h('label.fg-field', null, h('span', null, t('rp_viewname')), name),
            h('label.fg-check', null, shared, h('span', null, t('rp_shareview'), h('small', null, t('rp_shareview_hint')))),
            h('label.fg-check', null, allact, h('span', null, t('rp_allactivitiesview'), h('small', null,
                t('rp_allactivitiesview_hint')))),
            asnew ? h('label.fg-check', null, asnew, h('span', null, t('rp_saveasnew'))) : null),
        actions: [{label: t('cancel')}, {label: t('rp_save'), primary: true, onclick: () => {
            save();
            return true;
        }}]});
    }

    /**
     * The export menu.
     *
     * @param {HTMLElement} anchor
     */
    exportMenu(anchor) {
        const it = (ic, label, sub, run) => h('button.fg-rp-menu-item.has-icon', {type: 'button', role: 'menuitem', onclick: () => {
            this.closePopover();
            run();
        }}, icon(ic, 'fg-i-sm'), h('span', null, label, h('small', null, sub)));
        this.popover(anchor, h('div.fg-rp-pop-in.fg-rp-exportmenu', {role: 'menu'},
            it('printer', t('rp_ex_pdf'), t('rp_ex_pdf_sub'), () => Exporter.print(this)),
            it('sheet', t('rp_ex_excel'), t('rp_ex_excel_sub'), () => Exporter.table(this, 'excel')),
            it('filetext', t('rp_ex_csv'), t('rp_ex_csv_sub'), () => Exporter.table(this, 'csv')),
            it('grid', t('rp_ex_pivot'), t('rp_ex_pivot_sub'), () => Exporter.pivot(this, 'excel')),
            it('code', t('rp_ex_json'), t('rp_ex_json_sub'), () => Exporter.json(this))));
        const r = anchor.getBoundingClientRect();
        const pop = this.closestPop();
        pop.style.left = Math.max(8, r.right - pop.getBoundingClientRect().width) + 'px';
    }
}

/**
 * Start the report.
 *
 * @param {string} bootselector
 */
export const init = bootselector => {
    const el = document.querySelector(bootselector);
    if (!el) {
        return;
    }
    const boot = JSON.parse(el.textContent);
    Str.load(boot.strings);
    const report = new Report(boot, document.getElementById('fg-app'));
    window.fastgradeReport = report;
    report.start();
};
