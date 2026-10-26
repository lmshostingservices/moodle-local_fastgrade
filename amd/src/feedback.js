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
 * Student view of annotated feedback (read only).
 *
 * @module     local_fastgrade/feedback
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon} from 'local_fastgrade/lib/dom';
import * as Str from 'local_fastgrade/lib/str';
import {t} from 'local_fastgrade/lib/str';
import Store from 'local_fastgrade/lib/store';
import * as Tooltip from 'local_fastgrade/ui/tooltip';
import * as Toast from 'local_fastgrade/ui/toast';
import ViewerHost from 'local_fastgrade/viewer/host';
import AnnotationModel from 'local_fastgrade/annotate/model';
import * as Export from 'local_fastgrade/annotate/export';

/**
 * Start.
 *
 * @param {string} selector
 */
export const init = selector => {
    const boot = JSON.parse(document.querySelector(selector).textContent);
    Str.load(boot.strings);
    const fb = boot.feedback;
    const mount = document.getElementById('fg-app');
    const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
    const root = h('div.fg-app.is-student', {dataset: {theme: media && media.matches ? 'dark' : 'light', density: 'comfortable',
        margin: 'cards', rail: 'hidden', panel: 'hidden', toolbar: 'docked'}});
    const app = {
        boot,
        cmid: boot.cmid,
        readonly: true,
        root,
        store: new Store({prefs: {margin: 'cards'}, savestate: 'idle', dirty: false, lookfors: {}}),
        panel: null,
    };
    const item = {docs: fb.docs, annotations: fb.annotations, attempt: fb.attempt, integrations: {}};
    app.annotations = new AnnotationModel(app, {person: {id: boot.me.id}, slot: 0}, item);
    const host = new ViewerHost(app);
    const counts = {improvement: 0, positive: 0, neutral: 0};
    fb.annotations.forEach(a => {
        if (a.comment) {
            counts[a.polarity] = (counts[a.polarity] || 0) + 1;
        }
    });
    const legend = h('div.fg-student-legend', null,
        h('span.fg-chip.is-positive', null, icon('check', 'fg-i-sm'), t('student_positive', counts.positive)),
        h('span.fg-chip.is-improvement', null, icon('up', 'fg-i-sm'), t('student_improvement', counts.improvement)),
        h('span.fg-grow'),
        h('button.fg-btn.is-small', {type: 'button', onclick: () => Export.download(app, host)}, icon('download', 'fg-i-sm'),
            t('downloadannotated')));
    root.append(h('p.fg-small.fg-muted', null, t('student_help')), legend, host.el);
    mount.appendChild(root);
    Toast.mount(root);
    Tooltip.init(root);
    host.show(item);
};
