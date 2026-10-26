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
 * Language strings for the app, delivered with the page so there is no extra request.
 *
 * @module     local_fastgrade/lib/str
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

let strings = {};

/**
 * Load the strings.
 *
 * @param {Object} map
 */
export const load = map => {
    strings = map || {};
};

/**
 * Get a string, with {$a} or {$a->name} placeholders filled.
 *
 * @param {string} key
 * @param {*} a
 * @returns {string}
 */
export const t = (key, a) => {
    let str = strings[key];
    if (str === undefined) {
        return '[[' + key + ']]';
    }
    if (a !== undefined && a !== null) {
        if (typeof a === 'object') {
            str = str.replace(/\{\$a->(\w+)\}/g, (m, k) => (a[k] !== undefined ? a[k] : m));
        } else {
            str = str.replace(/\{\$a\}/g, a);
        }
    }
    return str;
};

/**
 * Whether a string exists.
 *
 * @param {string} key
 * @returns {boolean}
 */
export const has = key => strings[key] !== undefined;
