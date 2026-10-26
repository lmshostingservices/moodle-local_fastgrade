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
 * Calls to Fast Grade web services. Every service returns one JSON document.
 *
 * @module     local_fastgrade/lib/api
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import Ajax from 'core/ajax';

/**
 * Call one service.
 *
 * @param {string} name without the local_fastgrade_ prefix
 * @param {Object} args
 * @returns {Promise<Object>}
 */
export const call = (name, args = {}) => {
    const clean = {};
    Object.entries(args).forEach(([k, v]) => {
        clean[k] = (v !== null && typeof v === 'object') ? JSON.stringify(v) : v;
    });
    return Ajax.call([{methodname: 'local_fastgrade_' + name, args: clean}])[0].then(r => JSON.parse(r.json));
};

/**
 * A human message from a failed call.
 *
 * @param {*} e
 * @returns {string}
 */
export const message = e => {
    if (!e) {
        return '';
    }
    return e.message || e.error || (e.exception && e.exception.message) || String(e);
};
