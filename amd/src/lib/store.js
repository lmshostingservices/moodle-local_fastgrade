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
 * A minimal observable store.
 *
 * @module     local_fastgrade/lib/store
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

export default class Store {
    /**
     * Constructor.
     *
     * @param {Object} initial
     */
    constructor(initial) {
        this.state = initial;
        this.listeners = new Map();
    }

    /**
     * Read a value.
     *
     * @param {string} key
     * @returns {*}
     */
    get(key) {
        return this.state[key];
    }

    /**
     * Set values and notify.
     *
     * @param {Object} patch
     */
    set(patch) {
        const changed = [];
        Object.entries(patch).forEach(([k, v]) => {
            if (this.state[k] !== v) {
                this.state[k] = v;
                changed.push(k);
            }
        });
        changed.forEach(k => this.emit(k, this.state[k]));
        if (changed.length) {
            this.emit('*', changed);
        }
    }

    /**
     * Listen for a key (or "*", or any custom event name).
     *
     * @param {string} key
     * @param {Function} fn
     * @returns {Function} unsubscribe
     */
    on(key, fn) {
        if (!this.listeners.has(key)) {
            this.listeners.set(key, new Set());
        }
        this.listeners.get(key).add(fn);
        return () => this.listeners.get(key).delete(fn);
    }

    /**
     * Emit an event.
     *
     * @param {string} key
     * @param {*} value
     */
    emit(key, value) {
        (this.listeners.get(key) || []).forEach(fn => {
            try {
                fn(value);
            } catch (e) {
                window.console.error(e);
            }
        });
    }
}
