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
 * Code and plain-text files, with line numbers. Marked like online text.
 *
 * @module     local_fastgrade/viewer/code
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import TextViewer from 'local_fastgrade/viewer/text';
import {esc} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';

export default class CodeViewer extends TextViewer {
    /**
     * Load the text.
     */
    async load() {
        const res = await fetch(this.doc.dataurl + '&type=text', {credentials: 'same-origin'});
        const data = await res.json();
        if (data.error) {
            throw new Error(data.error);
        }
        const lines = String(data.text || '').split('\n');
        this.doc.html = '<div class="fg-code">' + lines.map((l, i) =>
            `<div class="fg-code-line"><span class="fg-code-n fg-ignore">${i + 1}</span><span class="fg-code-t">` +
            `${esc(l) || ' '}</span></div>`).join('') + '</div>' +
            (data.truncated ? `<p class="fg-notice fg-ignore">${esc(t('filetruncated'))}</p>` : '');
        this.doc.wordcount = lines.length;
        this.el.classList.add('is-code');
        await super.load();
    }
}
