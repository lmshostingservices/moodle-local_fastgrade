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
 * Read a submitted file's data (sheet, slide notes, text or zip listing) through the web service.
 *
 * @module     local_fastgrade/viewer/filedata
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import Ajax from 'core/ajax';

/**
 * Load one kind of data for a document.
 *
 * @param {Object} doc the document (needs contextid and fileid)
 * @param {String} type sheet, notes, text or zip
 * @returns {Promise<Object>}
 */
export const loadFileData = async(doc, type) => {
    const res = await Ajax.call([{
        methodname: 'local_fastgrade_get_file_data',
        args: {contextid: doc.contextid, fileid: doc.fileid, type},
    }])[0];
    return JSON.parse(res.json || '{}');
};
