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
 * Layout settings: show or hide each part of the screen, theme, density, behaviour.
 *
 * @module     local_fastgrade/ui/settings
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import * as Dialog from 'local_fastgrade/ui/dialog';
import * as Speech from 'local_fastgrade/voice/speech';

/**
 * Open the dialog.
 *
 * @param {Object} app
 */
export const open = app => {
    const prefs = app.store.get('prefs');
    const toggle = (key, label, help) => h('label.fg-switch-row', null,
        h('span', null, h('strong', null, label), help ? h('small', null, help) : null),
        h('input.fg-switch', {type: 'checkbox', role: 'switch', checked: !!prefs[key], onchange: e => {
            app.savePrefs({[key]: e.target.checked});
        }}));
    const choice = (key, label, options) => h('label.fg-field', null, h('span', null, label),
        h('select.fg-select', {onchange: e => app.savePrefs({[key]: e.target.value})},
            options.map(o => h('option', {value: o, selected: prefs[key] === o}, t(key + '_' + o)))));
    const langs = ['', 'en-AU', 'en-GB', 'en-US', 'en-ZA', 'en-NZ', 'af-ZA', 'de-DE', 'es-ES', 'fr-FR', 'it-IT', 'pt-BR',
        'ja-JP', 'ko-KR', 'zh-CN', 'th-TH'];
    const langsel = h('label.fg-field', null, h('span', null, t('speechlang_user')),
        h('select.fg-select', {onchange: e => {
            app.savePrefs({speechlang: e.target.value});
            Speech.configure(app.speech, app.store.get('prefs').cloudnotice, e.target.value);
        }}, langs.map(l => h('option', {value: l, selected: prefs.speechlang === l}, l || t('speechlang_site', Speech.lang())))));
    Dialog.open({
        title: t('layoutsettings'),
        wide: true,
        body: h('div.fg-settings', null,
            h('section', null, h('h3', null, t('set_appearance')),
                h('div.fg-field-row', null,
                    choice('theme', t('theme'), ['system', 'light', 'dark']),
                    choice('density', t('density'), ['comfortable', 'compact']))),
            h('section', null, h('h3', null, t('set_layout')),
                h('div.fg-field-row', null,
                    choice('rail', t('rail'), ['open', 'mini', 'hidden']),
                    choice('panel', t('panelpref'), ['open', 'hidden']),
                    choice('margin', t('margin'), ['cards', 'pins', 'hidden']),
                    choice('toolbar', t('toolbar'), ['docked', 'floating', 'auto']))),
            h('section', null, h('h3', null, t('set_show')),
                toggle('showstatus', t('showstatus')),
                toggle('showprogress', t('showprogress')),
                toggle('showintegrity', t('showintegrity')),
                toggle('showbank', t('showbank')),
                toggle('shownotes', t('shownotes'))),
            h('section', null, h('h3', null, t('set_behaviour')),
                toggle('autoadvance', t('autoadvance'), t('autoadvance_help')),
                toggle('tooltips', t('tooltips'), t('tooltips_help')),
                toggle('shortcuts', t('singlekeys'), t('singlekeys_help')),
                langsel),
            h('div.fg-settings-foot', null, h('button.fg-btn.is-ghost', {type: 'button', onclick: () => {
                app.savePrefs({theme: 'system', density: 'comfortable', rail: 'open', panel: 'open', margin: 'cards',
                    toolbar: 'docked', showstatus: true, showprogress: true, showintegrity: true, showbank: true,
                    shownotes: true, focus: false, zen: false, railwidth: 260, panelwidth: 400});
            }}, t('resetlayout')))),
        actions: [{label: t('done'), primary: true}],
    });
};
