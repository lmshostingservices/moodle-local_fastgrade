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
 * Small statistics helpers for the report. Every function ignores null and non-numeric values.
 *
 * @module     local_fastgrade/report/stats
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/**
 * Shorten text to a length, ending with an ellipsis.
 *
 * @param {String} text
 * @param {Number} max
 * @returns {String}
 */
export const clip = (text, max) => (text.length > max ? text.slice(0, max - 2) + '…' : text);

/**
 * Finite numbers only.
 *
 * @param {Array} a
 * @returns {Number[]}
 */
export const nums = a => a.filter(v => typeof v === 'number' && isFinite(v));

/**
 * Sum.
 *
 * @param {Array} a
 * @returns {number}
 */
export const sum = a => nums(a).reduce((x, y) => x + y, 0);

/**
 * Mean, or null.
 *
 * @param {Array} a
 * @returns {number|null}
 */
export const mean = a => {
    const n = nums(a);
    return n.length ? sum(n) / n.length : null;
};

/**
 * Quantile (linear interpolation), or null.
 *
 * @param {Array} a
 * @param {number} q 0..1
 * @returns {number|null}
 */
export const quantile = (a, q) => {
    const n = nums(a).sort((x, y) => x - y);
    if (!n.length) {
        return null;
    }
    const pos = (n.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return n[lo] + (n[hi] - n[lo]) * (pos - lo);
};

/**
 * Median, or null.
 *
 * @param {Array} a
 * @returns {number|null}
 */
export const median = a => quantile(a, 0.5);

/**
 * Sample standard deviation, or null.
 *
 * @param {Array} a
 * @returns {number|null}
 */
export const sd = a => {
    const n = nums(a);
    if (n.length < 2) {
        return null;
    }
    const m = mean(n);
    return Math.sqrt(n.reduce((s, v) => s + (v - m) * (v - m), 0) / (n.length - 1));
};

/**
 * Pearson correlation of paired values, or null when there are fewer than 5 complete pairs or no spread.
 *
 * @param {Array} xs
 * @param {Array} ys
 * @returns {number|null}
 */
export const corr = (xs, ys) => {
    const pairs = [];
    xs.forEach((x, i) => {
        const y = ys[i];
        if (typeof x === 'number' && typeof y === 'number' && isFinite(x) && isFinite(y)) {
            pairs.push([x, y]);
        }
    });
    if (pairs.length < 5) {
        return null;
    }
    const mx = mean(pairs.map(p => p[0]));
    const my = mean(pairs.map(p => p[1]));
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    pairs.forEach(([x, y]) => {
        sxy += (x - mx) * (y - my);
        sxx += (x - mx) * (x - mx);
        syy += (y - my) * (y - my);
    });
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
};

/**
 * Most common value.
 *
 * @param {Array} a
 * @returns {*}
 */
export const mode = a => {
    const c = new Map();
    a.forEach(v => {
        if (v !== null && v !== undefined) {
            c.set(v, (c.get(v) || 0) + 1);
        }
    });
    let best = null;
    let n = 0;
    c.forEach((k, v) => {
        if (k > n) {
            best = v;
            n = k;
        }
    });
    return best;
};

/**
 * Share (0..1) of items matching a test, or null when there are none.
 *
 * @param {Array} a
 * @param {Function} test
 * @returns {number|null}
 */
export const share = (a, test) => (a.length ? a.filter(test).length / a.length : null);

/**
 * Equal-width bins.
 *
 * @param {Array} a values
 * @param {number} lo
 * @param {number} hi
 * @param {number} n number of bins
 * @returns {Array} [{from, to, count}]
 */
export const bins = (a, lo, hi, n) => {
    const out = [];
    const w = (hi - lo) / n;
    for (let i = 0; i < n; i++) {
        out.push({from: lo + i * w, to: lo + (i + 1) * w, count: 0});
    }
    nums(a).forEach(v => {
        let i = Math.floor((v - lo) / w);
        i = Math.max(0, Math.min(n - 1, i));
        out[i].count++;
    });
    return out;
};

/**
 * Format a number for display.
 *
 * @param {number|null} v
 * @param {number} dp decimal places
 * @returns {string}
 */
export const fmt = (v, dp = 1) => {
    if (v === null || v === undefined || !isFinite(v)) {
        return '–';
    }
    return Number(v).toLocaleString(undefined, {maximumFractionDigits: dp, minimumFractionDigits: 0});
};

/**
 * A share as a percentage.
 *
 * @param {number|null} v 0..1
 * @returns {string}
 */
export const pct = v => (v === null || v === undefined || !isFinite(v) ? '–' : Math.round(v * 100) + '%');

/**
 * Seconds as days (one decimal).
 *
 * @param {number|null} secs
 * @returns {number|null}
 */
export const days = secs => (secs === null || secs === undefined ? null : secs / 86400);
