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
 * Loads the bundled third-party ES modules (PDF.js, pdf-lib) without going through RequireJS.
 *
 * @module     local_fastgrade/lib/loader
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

const cache = new Map();

/**
 * Import an ES module by URL and resolve with its namespace.
 *
 * @param {string} url
 * @returns {Promise<Object>}
 */
export const importModule = url => {
    if (cache.has(url)) {
        return cache.get(url);
    }
    const key = '__fg_mod_' + Math.random().toString(36).slice(2);
    const p = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.type = 'module';
        window.addEventListener(key, () => {
            const mod = window[key];
            delete window[key];
            script.remove();
            if (mod && mod.__error) {
                reject(new Error(mod.__error));
            } else {
                resolve(mod);
            }
        }, {once: true});
        script.textContent = `import(${JSON.stringify(url)}).then(m => { window[${JSON.stringify(key)}] = m; })` +
            `.catch(e => { window[${JSON.stringify(key)}] = {__error: String(e && e.message || e)}; })` +
            `.finally(() => window.dispatchEvent(new Event(${JSON.stringify(key)})));`;
        document.head.appendChild(script);
    });
    cache.set(url, p);
    return p;
};

let pdfjsPromise = null;

/**
 * PDF.js, configured.
 *
 * @param {Object} libs URLs from the boot data
 * @returns {Promise<Object>}
 */
export const pdfjs = libs => {
    if (!pdfjsPromise) {
        pdfjsPromise = importModule(libs.pdfjs).then(lib => {
            lib.GlobalWorkerOptions.workerSrc = libs.pdfworker;
            return lib;
        });
    }
    return pdfjsPromise;
};

/**
 * Pdf-lib.
 *
 * @param {Object} libs
 * @returns {Promise<Object>}
 */
export const pdflib = libs => importModule(libs.pdflib);
