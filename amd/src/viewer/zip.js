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
 * Zip files: list the contents.
 *
 * @module     local_fastgrade/viewer/zip
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon, replace} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';

export default class ZipViewer {
    /**
     * Constructor.
     *
     * @param {Object} app
     * @param {Object} doc
     */
    constructor(app, doc) {
        this.app = app;
        this.doc = doc;
        this.docref = doc.docref;
        this.list = h('div.fg-zip');
        this.el = h('div.fg-viewer.is-zip', null, h('div.fg-doc-scroll', null, h('div.fg-paper.is-zip', null, this.list)));
    }

    /**
     * Load.
     */
    async load() {
        const res = await fetch(this.doc.dataurl + '&type=zip', {credentials: 'same-origin'});
        const data = await res.json();
        if (data.error) {
            throw new Error(data.error);
        }
        const kb = n => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
        replace(this.list, h('h3.fg-section-title', null, icon('file', 'fg-i-sm'), this.doc.filename),
            h('p.fg-small.fg-muted', null, t('zip_help')),
            h('table.fg-zip-table', null, h('tbody', null, data.entries.map(e => h('tr', null,
                h('td', null, e.name), h('td.is-num', null, e.dir ? '' : kb(e.size)))))),
            h('a.fg-btn', {href: this.doc.downloadurl}, icon('download', 'fg-i-sm'), t('download')));
    }

    /**
     * Clean up.
     */
    destroy() {
        // Nothing to clean.
    }
}
