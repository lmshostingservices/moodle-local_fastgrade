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
 * Loads the maths engine (CortexJS Compute Engine, bundled) the first time maths is needed.
 *
 * @module     local_fastgrade/maths/engine
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {importModule} from 'local_fastgrade/lib/loader';
import {checker} from 'local_fastgrade/maths/check';

let ready = null;
let current = null;

/**
 * The checker, loading the engine if needed.
 *
 * @param {Object} libs URLs from the boot data
 * @returns {Promise<Object>}
 */
export const load = libs => {
    if (!ready) {
        ready = importModule(libs.mathengine).then(lib => {
            current = checker(new lib.ComputeEngine());
            return current;
        }).catch(e => {
            ready = null;
            throw e;
        });
    }
    return ready;
};

/**
 * The checker if it has already loaded, else null.
 *
 * @returns {Object|null}
 */
export const loaded = () => current;
