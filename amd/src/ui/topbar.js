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
 * Top bar: where you are, who you are marking, their status, progress and save state.
 *
 * @module     local_fastgrade/ui/topbar
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon, replace, duration, date} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import {tip} from 'local_fastgrade/ui/tooltip';
import * as Shortcuts from 'local_fastgrade/ui/shortcuts';
import * as Settings from 'local_fastgrade/ui/settings';
import * as Download from 'local_fastgrade/ui/download';

/**
 * An icon button with a tooltip.
 *
 * @param {string} name icon
 * @param {string} tiptext
 * @param {string} key
 * @param {Function} onclick
 * @param {string} cls
 * @returns {HTMLElement}
 */
export const iconButton = (name, tiptext, key, onclick, cls = '') => tip(
    h('button.fg-icon-btn', {type: 'button', "class": cls, onclick}, icon(name)), tiptext, key);

export default class Topbar {
    /**
     * Constructor.
     *
     * @param {Object} app
     */
    constructor(app) {
        this.app = app;
        const st = app.store;
        const info = st.get('info');
        this.who = h('div.fg-who');
        this.status = h('div.fg-status-strip', {'aria-live': 'polite'});
        this.progress = h('div.fg-progress');
        this.save = h('div.fg-savestate', {role: 'status', 'aria-live': 'polite'});
        this.extra = h('div.fg-top-extra');

        const back = tip(h('a.fg-icon-btn.fg-back', {href: info.activityurl}, icon('left')), t('backtoactivity'));
        const title = h('div.fg-title', null,
            h('div.fg-title-main', {title: info.name}, info.name),
            h('div.fg-title-sub', {title: info.coursename}, info.courseshortname));

        const prev = iconButton('left', t('prevstudent'), 'K', () => app.next(false, -1));
        const next = iconButton('right', t('nextstudent'), 'J', () => app.next(false, 1));
        const nextneeds = tip(h('button.fg-btn.is-ghost.fg-nextneeds', {type: 'button', onclick: () => app.next(true, 1)},
            icon('bolt'), h('span', null, t('nextneeds'))), t('nextneeds_tip'), 'N');

        const right = h('div.fg-top-right', null,
            this.progress,
            this.save,
            tip(h('a.fg-btn.is-ghost.is-small.fg-classic', {href: info.classicurl}, t('classicgrader')), t('classicgrader_tip')),
            iconButton('chart', t('report_open_tip'), '', () => window.open(app.boot.wwwroot + '/local/fastgrade/report.php?id=' +
                app.cmid, '_blank')),
            iconButton('download', t('download_tip'), '', () => Download.open(app)),
            iconButton('command', t('palette_tip'), Shortcuts.label('mod+k'), () => app.palette.open()),
            iconButton('keyboard', t('shortcuts_tip'), '?', () => Shortcuts.showHelp()),
            iconButton('settings', t('layout_tip'), '', () => Settings.open(app)),
            iconButton('focus', t('focus_tip'), '\\', () => app.savePrefs({focus: !st.get('prefs').focus}), 'fg-focus-btn'),
            iconButton('zen', t('zen_tip'), '⇧ \\', () => app.savePrefs({zen: !st.get('prefs').zen}), 'fg-zen-btn'));

        this.el = h('header.fg-topbar', null,
            h('div.fg-top-left', null, back, title),
            h('div.fg-top-center', null, prev, this.who, next, nextneeds, this.extra),
            this.status,
            right);

        st.on('current', () => this.renderWho());
        st.on('item', () => {
            this.renderWho();
            this.renderStatus();
        });
        st.on('participants', () => this.updateProgress());
        st.on('savestate', s => this.renderSave(s));
        this.renderSave('idle');
    }

    /**
     * Who is being marked.
     */
    renderWho() {
        const cur = this.app.store.get('current');
        const item = this.app.store.get('item');
        if (!cur) {
            replace(this.who);
            return;
        }
        const p = cur.person;
        const avatar = p.picture ? h('img.fg-avatar', {src: p.picture, alt: ''}) : h('span.fg-avatar.is-initials', null,
            p.initials);
        const btn = tip(h('button.fg-who-btn', {type: 'button', onclick: () => this.app.palette.open('students')},
            avatar, h('span.fg-who-name', null, p.fullname), icon('down', 'fg-i-sm')), t('findstudent_tip'),
            Shortcuts.label('mod+k'));
        const bits = [btn];
        if (item && item.attempts && item.attempts.length > 1) {
            const sel = h('select.fg-select.is-small', {'aria-label': t('attempt'), onchange: e => {
                const n = parseInt(e.target.value, 10);
                const entry = Object.assign({}, cur, {attempt: n, key: `${p.id}:${n}:0`});
                this.app.open(entry);
            }}, item.attempts.map(a => h('option', {value: a.number, selected: a.number === item.attempt},
                t('attemptn', a.number + 1))));
            bits.push(tip(sel, t('attempt_tip')));
        }
        if (item && item.question) {
            bits.push(h('span.fg-chip.is-question', {title: item.question.name}, t('questionn', item.question.number)));
        }
        replace(this.who, bits);
    }

    /**
     * Status chips for the open student.
     */
    renderStatus() {
        const item = this.app.store.get('item');
        if (!item) {
            replace(this.status);
            return;
        }
        const chips = [];
        const chip = (cls, ic, text, tiptext) => tip(h('span.fg-chip', {"class": cls}, icon(ic, 'fg-i-sm'), text), tiptext || text);
        if (item.status === 'submitted') {
            chips.push(chip('is-ok', 'check', t('status_submitted'), t('submittedon', date(item.timesubmitted))));
        } else if (item.status === 'draft') {
            chips.push(chip('is-muted', 'edit', t('status_draft'), t('status_draft_tip')));
        } else if (item.status === 'new') {
            chips.push(chip('is-muted', 'x', t('status_nosubmission'), t('status_nosubmission_tip')));
        } else if (item.status === 'reopened') {
            chips.push(chip('is-muted', 'rotate', t('status_reopened'), t('status_reopened')));
        }
        if (item.late > 0) {
            chips.push(chip('is-amber', 'clock', t('latex', duration(item.late)), t('late_tip', date(item.duedate))));
        }
        if (item.extension) {
            chips.push(chip('is-info', 'clock', t('extension'), t('extension_tip', date(item.extension))));
        }
        if (item.locked) {
            chips.push(chip('is-muted', 'lock', t('locked'), t('locked_tip')));
        }
        const eg = item.integrations && item.integrations.essayguard;
        if (eg) {
            let r = eg.overall;
            if (item.question && eg.slots && eg.slots[item.question.slot]) {
                r = eg.slots[item.question.slot];
            }
            if (eg.pending && !r) {
                chips.push(chip('is-muted fg-integrity', 'shield', t('eg_pending'), t('eg_pending_tip')));
            } else if (r) {
                const c = tip(h('a.fg-chip.fg-integrity', {href: r.url, target: '_blank', rel: 'noopener',
                    "class": 'is-risk-' + r.level},
                    icon('shield', 'fg-i-sm'), t('eg_badge', r.score)),
                    [t('eg_tip', {score: r.score, level: t('risk_' + r.level)}), ...(r.explanations || []).slice(0, 4)].join('\n'));
                chips.push(c);
            }
        }
        replace(this.status, chips);
    }

    /**
     * Progress through the list.
     */
    updateProgress() {
        const list = this.app.store.get('participants');
        const relevant = list.filter(p => p.submitted || p.graded);
        const done = relevant.filter(p => p.graded && !p.needsgrading).length;
        const total = relevant.length;
        const pct = total ? Math.round(done / total * 100) : 0;
        replace(this.progress,
            tip(h('div.fg-progress-inner', {role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': total, 'aria-valuenow': done,
                    'aria-label': t('progress_aria', {done, total})},
                h('span.fg-progress-text', null, t('progress', {done, total})),
                h('span.fg-progress-bar', null, h('span', {style: {width: pct + '%'}})),
            ), t('progress_tip', {done, total})));
    }

    /**
     * Show the save state.
     *
     * @param {string} s
     */
    renderSave(s) {
        const map = {
            idle: ['check', '', ''],
            pending: ['edit', t('save_pending'), 'is-muted'],
            saving: ['rotate', t('save_saving'), 'is-muted is-spinning'],
            draft: ['check', t('save_draft'), 'is-muted'],
            saved: ['check', t('save_saved'), 'is-ok'],
            offline: ['warning', t('save_offline'), 'is-amber'],
            error: ['warning', t('save_error'), 'is-amber'],
        };
        const [ic, text, cls] = map[s] || map.idle;
        this.save.className = 'fg-savestate ' + cls;
        replace(this.save, text ? [icon(ic, 'fg-i-sm'), h('span', null, text)] : null);
    }
}
