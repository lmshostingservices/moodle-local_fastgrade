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
 * Synonym tick-boxes for look-for terms, from WordNet 3.1 (Princeton; permissive licence).
 * Synonyms are only offered while setting up; nothing is added unless the assessor ticks it.
 *
 * @module     local_fastgrade/autograde/synonyms
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import * as Dialog from 'local_fastgrade/ui/dialog';
import {toast} from 'local_fastgrade/ui/toast';

let data = null;

/**
 * Load the synonym map.
 *
 * @param {Object} app
 * @returns {Promise<Object>}
 */
const load = async app => {
    if (!data) {
        const res = await fetch(app.boot.wwwroot + '/local/fastgrade/thirdparty/wordnet/synonyms.json');
        data = await res.json();
    }
    return data;
};

/**
 * Offer synonyms for each term and return the new term list ("term|syn|syn").
 *
 * @param {Object} app
 * @param {string[]} terms
 * @returns {Promise<string[]|null>}
 */
export const suggest = async(app, terms) => {
    if (!terms || !terms.length) {
        toast(t('lf_addtermsfirst'), {type: 'info'});
        return null;
    }
    let map;
    try {
        map = await load(app);
    } catch (e) {
        toast(t('loadfailed'), {type: 'error'});
        return null;
    }
    const rows = terms.map(term => {
        const parts = term.split(/\s*[|/]\s*/);
        const head = parts[0].toLowerCase();
        const have = new Set(parts.map(p => p.toLowerCase()));
        const offers = (map[head] || map[head.replace(/s$/, '')] || []).filter(s => !have.has(s));
        const boxes = offers.map(s => h('label.fg-check.is-chip', null, h('input', {type: 'checkbox', value: s}), s));
        return {term, parts, boxes};
    });
    return new Promise(resolve => {
        let done = false;
        Dialog.open({
            title: t('lf_synonyms'),
            wide: true,
            body: h('div.fg-syn', null, h('p.fg-small.fg-muted', null, t('lf_synonyms_help')),
                rows.map(r => h('div.fg-syn-row', null, h('strong', null, r.parts.join(' | ')),
                    r.boxes.length ? h('div.fg-syn-boxes', null, r.boxes) : h('span.fg-muted.fg-small', null,
                        t('lf_nosynonyms'))))),
            actions: [
                {label: t('cancel'), onclick: () => {
                    done = true;
                    resolve(null);
                }},
                {label: t('lf_addticked'), primary: true, onclick: () => {
                    done = true;
                    resolve(rows.map(r => {
                        const ticked = r.boxes.map(b => b.querySelector('input')).filter(i => i.checked).map(i => i.value);
                        return [...r.parts, ...ticked].join(' | ');
                    }));
                }},
            ],
            onclose: () => {
                if (!done) {
                    resolve(null);
                }
            },
        });
    });
};
