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
 * Editor for the quiz criteria panel (a small marking guide per question).
 *
 * @module     local_fastgrade/ui/criteria
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import {tip} from 'local_fastgrade/ui/tooltip';
import * as Dialog from 'local_fastgrade/ui/dialog';
import * as Api from 'local_fastgrade/lib/api';
import {toast} from 'local_fastgrade/ui/toast';

/**
 * Open the editor.
 *
 * @param {Object} app
 * @param {Object} item
 */
export const editQuiz = (app, item) => {
    const q = item.question;
    const rows = (q.criteria || []).map(c => Object.assign({}, c));
    if (!rows.length) {
        rows.push({id: 1, description: '', maxscore: q.maxmark || 1});
    }
    const list = h('div.fg-crit-editor');
    const draw = () => {
        list.replaceChildren(...rows.map((r, i) => h('div.fg-crit-edit-row', null,
            h('span.fg-crit-n', null, String(i + 1)),
            h('input.fg-input', {type: 'text', value: r.description, placeholder: t('criterion_placeholder'),
                'aria-label': t('criterion_description'), oninput: e => {
                    r.description = e.target.value;
                }}),
            h('input.fg-input.is-num', {type: 'number', min: '0', step: '0.5', value: r.maxscore,
                'aria-label': t('criterion_max'), oninput: e => {
                    r.maxscore = parseFloat(e.target.value) || 0;
                }}),
            tip(h('button.fg-icon-btn.is-small', {type: 'button', onclick: () => {
                rows.splice(i, 1);
                draw();
            }}, icon('trash')), t('delete')))),
        h('button.fg-btn.is-small.is-ghost', {type: 'button', onclick: () => {
            rows.push({id: Math.max(0, ...rows.map(x => x.id)) + 1, description: '', maxscore: 1});
            draw();
        }}, icon('plus', 'fg-i-sm'), t('addcriterion')));
    };
    draw();
    Dialog.open({
        title: t('criteria_title', q.name),
        wide: true,
        body: h('div', null, h('p.fg-small.fg-muted', null, t('criteria_help', q.maxmark)), list),
        actions: [
            {label: t('cancel')},
            {label: t('save'), primary: true, onclick: async() => {
                try {
                    const r = await Api.call('save_criteria', {cmid: app.cmid, kind: 'qcrit',
                        data: {questionid: q.questionid, criteria: rows}});
                    q.criteria = r.definition;
                    app.panel.show(item, true);
                    toast(t('criteria_saved'), {type: 'ok'});
                } catch (e) {
                    toast(Api.message(e), {type: 'error'});
                }
            }},
        ],
    });
};
