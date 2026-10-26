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
 * Download every submission as one ZIP: latest only or all versions; for a quiz, one essay
 * question or all of them.
 *
 * @module     local_fastgrade/ui/download
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import * as Dialog from 'local_fastgrade/ui/dialog';
import {toast} from 'local_fastgrade/ui/toast';

/**
 * A set of radio choices.
 *
 * @param {string} name
 * @param {Array} options [{value, label, hint}]
 * @param {string} value
 * @returns {HTMLElement}
 */
const choices = (name, options, value) => h('div.fg-choices', {role: 'radiogroup'}, options.map(o =>
    h('label.fg-choice', null,
        h('input', {type: 'radio', name, value: o.value, checked: o.value === value}),
        h('span.fg-choice-text', null, h('strong', null, o.label), o.hint ? h('small', null, o.hint) : null))));

/**
 * Open the dialog.
 *
 * @param {Object} app
 */
export const open = app => {
    const info = app.store.get('info');
    const quiz = info.modname === 'quiz';
    const body = h('div.fg-download', null,
        h('p.fg-small.fg-muted', null, t('download_intro')),
        h('h3.fg-section-title', null, t('download_which')),
        choices('fg-dl-versions', [
            {value: 'latest', label: t('download_latest'), hint: t('download_latest_hint')},
            {value: 'all', label: t('download_allversions'), hint: quiz ? t('download_all_hint_quiz') : t('download_all_hint')},
        ], 'latest'));
    if (quiz && (info.slots || []).length > 1) {
        const cur = app.store.get('quizkey') || 0;
        body.append(h('h3.fg-section-title', null, t('download_questions')),
            choices('fg-dl-slot', [{value: '0', label: t('download_allquestions')}].concat(info.slots.map(s => ({
                value: String(s.slot), label: t('questionn', s.number) + ' · ' + s.name}))), String(cur || 0)));
    }
    Dialog.open({
        title: t('download_title'),
        body,
        actions: [
            {label: t('cancel')},
            {label: t('download'), primary: true, onclick: () => {
                const versions = body.querySelector('[name="fg-dl-versions"]:checked').value;
                const slotEl = body.querySelector('[name="fg-dl-slot"]:checked');
                const url = new URL(M.cfg.wwwroot + '/local/fastgrade/download.php');
                url.searchParams.set('id', app.cmid);
                url.searchParams.set('versions', versions);
                url.searchParams.set('sesskey', M.cfg.sesskey);
                if (quiz) {
                    url.searchParams.set('slot', slotEl ? slotEl.value : String((info.slots || [])[0]?.slot || 0));
                }
                const group = (info.groups || {}).active || 0;
                if (group) {
                    url.searchParams.set('group', group);
                }
                // A hidden frame keeps the marker on the page while the ZIP builds and downloads.
                const frame = h('iframe', {hidden: true, src: url.toString(), title: t('download_title')});
                document.body.appendChild(frame);
                setTimeout(() => frame.remove(), 120000);
                toast(t('download_started'), {type: 'info'});
                return true;
            }},
        ],
    });
};
