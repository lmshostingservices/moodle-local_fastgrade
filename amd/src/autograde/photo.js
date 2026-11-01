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
 * Optional AI image analysis (LMS Labs AI credits) in the Auto tab: checks photos against what each criterion should
 * show, or reads handwritten working so the maths engine can check it. Off unless the site and the activity turn it
 * on, never runs by itself, shows the credit cost before it runs, and only ever suggests.
 *
 * @module     local_fastgrade/autograde/photo
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon, replace, textOf} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import {tip} from 'local_fastgrade/ui/tooltip';
import {toast} from 'local_fastgrade/ui/toast';
import * as Api from 'local_fastgrade/lib/api';
import * as Maths from 'local_fastgrade/maths/engine';

/** Results kept for this page, by student and photo set, so switching students does not lose them. */
const kept = new Map();

/**
 * Photos in the current submission that can be analysed.
 *
 * @param {Object} item
 * @returns {Array}
 */
export const photosOf = item => (item && item.docs || []).filter(d => d.kind === 'image' && d.fileid &&
    !/svg/i.test(d.mimetype || ''));

/**
 * Criteria that have a photo check, with what each photo should show.
 *
 * @param {Object} tab the Auto tab
 * @param {Object} item
 * @returns {Array} [{id, crit, label, lookfor}]
 */
export const photoCriteria = (tab, item) => {
    const lf = tab.lookfors(item);
    return tab.criteria(item).map((c, i) => {
        const rule = (lf[c.key] || []).find(r => r.kind === 'photo');
        if (!rule) {
            return null;
        }
        const terms = (rule.config.terms || []).filter(x => x.trim());
        return {id: 'c' + i, crit: c, label: c.whole ? t('ai_whole') : c.label,
            lookfor: terms.length ? terms : [textOf(c.text || c.label).slice(0, 300)]};
    }).filter(Boolean);
};

const VERDICT = {met: 'is-ok', partly: 'is-amber', notmet: 'is-amber', unclear: 'is-muted'};
const SEEN = {yes: 'check', partly: 'up', no: 'x', unclear: 'question'};

/**
 * The Photo check card, or null when it does not apply.
 *
 * @param {Object} tab the Auto tab
 * @param {Object} item
 * @param {boolean} mathsTask whether the question or brief has an equation
 * @returns {HTMLElement|null}
 */
export const block = (tab, item, mathsTask) => {
    const app = tab.app;
    const photos = photosOf(item);
    if (!app.boot.aiimages || !photos.length) {
        return null;
    }
    const crits = photoCriteria(tab, item);
    // The activity turns it on by giving a criterion a Photo check in Set up checks.
    if (!crits.length) {
        return null;
    }
    const cur = app.store.get('current');
    const each = app.boot.aicredits || 2;
    const body = h('div.fg-ai-body');
    const status = h('p.fg-small.fg-ai-status', {role: 'status'});
    const keyOf = mode => cur.key + '|' + mode + '|' + photos.map(p => p.fileid).join(',');

    const showStatus = st => {
        replace(status, h('span.fg-ai-light', {"class": st.connected ? 'is-on' : 'is-off', 'aria-hidden': 'true'}),
            st.connected ? (st.balance !== null && st.balance !== undefined ? t('ai_connected_balance', st.balance) :
                t('ai_connected')) : t('ai_notconnected_light'));
    };
    Api.call('analyse_images', {cmid: app.cmid, userid: cur.person.id, fileids: '', mode: 'status'})
        .then(showStatus).catch(() => showStatus({connected: false}));

    const run = async(mode, btn) => {
        btn.disabled = true;
        replace(body, h('p.fg-small.fg-muted', null, icon('rotate', 'fg-i-xs'), ' ', t('ai_working', photos.length)));
        try {
            const res = await Api.call('analyse_images', {cmid: app.cmid, userid: cur.person.id,
                fileids: photos.map(p => p.fileid).join(','), mode,
                task: textOf(item.question ? item.question.text : (tab.criteria(item).find(c => c.whole) || {}).text || '')
                    .slice(0, 2000),
                criteriajson: JSON.stringify(crits.map(c => ({id: c.id, label: c.label, lookfor: c.lookfor})))});
            kept.set(keyOf(mode), res);
            await draw(mode, res);
            if (res.balance !== null && res.balance !== undefined) {
                showStatus({connected: true, balance: res.balance});
            }
            toast(res.credits ? t('ai_done_charged', res.credits) : t('ai_done_free'), {type: 'ok'});
        } catch (e) {
            replace(body, h('p.fg-small.fg-ai-error', null, icon('warning', 'fg-i-xs'), ' ', e.message || t('ai_failed')));
        }
        btn.disabled = false;
    };

    // Ask before spending credits: the first press shows the cost, the second runs.
    const costButton = (mode, label) => {
        const btn = h('button.fg-btn.is-small', {type: 'button'}, icon('sparkle', 'fg-i-sm'), label);
        btn.onclick = () => {
            if (btn.dataset.confirm) {
                delete btn.dataset.confirm;
                replace(btn, icon('sparkle', 'fg-i-sm'), label);
                btn.classList.remove('is-primary');
                run(mode, btn);
                return;
            }
            btn.dataset.confirm = '1';
            replace(btn, icon('sparkle', 'fg-i-sm'), t('ai_confirm', {n: photos.length, credits: photos.length * each}));
            btn.classList.add('is-primary');
            setTimeout(() => {
                if (btn.dataset.confirm) {
                    delete btn.dataset.confirm;
                    replace(btn, icon('sparkle', 'fg-i-sm'), label);
                    btn.classList.remove('is-primary');
                }
            }, 6000);
        };
        return btn;
    };

    const levelButton = (c, verdict) => {
        const info = app.store.get('info');
        const lf = tab.lookfors(item)[c.crit.key] || [];
        if (!c.crit.id || item.question) {
            return null;
        }
        // The criterion's own threshold, or else its top and middle levels.
        const th = (lf.find(r => r.kind === 'threshold') || {}).config || {};
        const levels = [...(c.crit.levels || [])].sort((x, y) => x.score - y.score);
        const top = th.levelid || (levels.length ? levels[levels.length - 1].id : 0);
        const mid = th.partiallevelid || (levels.length ? levels[Math.floor((levels.length - 1) / 2)].id : 0);
        const id = verdict === 'met' ? top : (verdict === 'partly' ? mid : 0);
        if (info.method === 'rubric' && id) {
            const lvl = (c.crit.levels || []).find(l => l.id === id);
            return lvl ? h('button.fg-btn.is-small.is-ghost', {type: 'button', onclick: () => tab.applyLevel(c.crit, id)},
                t('auto_applylevel', textOf(lvl.definition).slice(0, 30))) : null;
        }
        if (info.method === 'guide' && c.crit.maxscore && verdict !== 'unclear') {
            const score = verdict === 'met' ? c.crit.maxscore : (verdict === 'partly' ? Math.round(c.crit.maxscore) / 2 : 0);
            return h('button.fg-btn.is-small.is-ghost', {type: 'button', onclick: () => tab.applyScore(c.crit, score)},
                t('auto_applyscore', score));
        }
        return null;
    };

    const draw = async(mode, res) => {
        let maths = null;
        if (mode === 'transcribe') {
            try {
                maths = await Maths.load(app.boot.libs);
            } catch (e) {
                maths = null;
            }
        }
        replace(body, (res.images || []).map(img => {
            const name = h('div.fg-ai-file', null, icon('image', 'fg-i-xs'), ' ', img.filename || '',
                img.cached ? h('small.fg-muted', null, ' · ', t('ai_kept')) : null);
            if (img.error) {
                return h('section.fg-auto-card', null, name, h('p.fg-small.fg-ai-error', null, img.error));
            }
            if (img.refused) {
                return h('section.fg-auto-card', null, name, h('p.fg-small.fg-muted', null, t('ai_refused')));
            }
            if (mode === 'transcribe') {
                const checked = maths && img.transcription ? maths.checkText(img.transcription, {
                    question: item.question ? item.question.text : ''}) : null;
                return h('section.fg-auto-card', null, name,
                    h('p.fg-small.fg-muted', null, t('ai_transcribed')),
                    checked && checked.lines.some(l => l.verdict !== 'question') ? h('ol.fg-maths-lines', null,
                        checked.lines.map(l => h('li', {"class": 'is-' + (l.verdict || 'unchecked')},
                            h('span.fg-maths-ic', {'aria-hidden': 'true'}, {ok: '✓', ft: 'ft', slip: '!', question: '?',
                                unread: '…', unchecked: '·'}[l.verdict] || '·'),
                            h('code', null, l.typed), h('small', null, l.verdict ? t('maths_v_' + l.verdict) : ''))))
                        : h('pre.fg-ai-text', null, img.transcription || t('ai_nothingread')),
                    checked && checked.answer && checked.answer.ok !== null ? h('p.fg-small', null,
                        checked.answer.ok ? t('rule_mathsanswer') + ': ✓ ' + checked.answer.have :
                            t('rule_mathsanswer') + ': ' + checked.answer.have) : null);
            }
            return h('section.fg-auto-card', null, name,
                img.summary ? h('p.fg-small', null, img.summary) : null,
                (img.criteria || []).map(r => {
                    const c = crits.find(x => x.id === r.id);
                    if (!c) {
                        return null;
                    }
                    return h('div.fg-ai-crit', null,
                        h('div.fg-auto-card-head', null, h('strong', null, c.label),
                            h('span.fg-chip', {"class": VERDICT[r.verdict] || 'is-muted'}, t('ai_v_' + r.verdict))),
                        h('ul.fg-auto-list', null, (r.lookFor || []).map(l => h('li',
                            {"class": l.seen === 'yes' ? 'is-ok' : (l.seen === 'unclear' ? '' : 'is-miss')},
                            icon(SEEN[l.seen] || 'question', 'fg-i-xs'), h('span', null, l.text),
                            l.evidence ? h('small', null, l.evidence) : null))),
                        r.improve ? h('p.fg-small.fg-ai-improve', null, r.improve) : null,
                        h('div.fg-row-actions', null, levelButton(c, r.verdict)));
                }));
        }));
    };

    const actions = h('div.fg-row-actions', null,
        tip(costButton('criteria', t('ai_analyse', photos.length)), t('ai_analyse_tip', each)),
        mathsTask ? tip(costButton('transcribe', t('ai_transcribe', photos.length)), t('ai_transcribe_tip', each)) : null);
    const card = h('section.fg-auto-card.fg-ai', null,
        h('div.fg-auto-card-head', null, h('strong', null, icon('sparkle', 'fg-i-sm'), ' ', t('ai_title')),
            h('span.fg-chip.is-muted', null, t('ai_cost', each))),
        h('p.fg-small.fg-muted', null, t('ai_suggestonly')), status, actions, body);
    const done = kept.get(keyOf('criteria')) || kept.get(keyOf('transcribe'));
    if (done) {
        draw(kept.has(keyOf('criteria')) ? 'criteria' : 'transcribe', done);
    }
    return card;
};
