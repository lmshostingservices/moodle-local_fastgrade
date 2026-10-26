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
 * Charts for the report, drawn as plain SVG and HTML so they are fast, print well, follow the
 * light and dark themes, and need no chart library. Every mark has a hover label with its value.
 *
 * @module     local_fastgrade/report/charts
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, s} from 'local_fastgrade/lib/dom';
import {tip} from 'local_fastgrade/ui/tooltip';
import * as S from 'local_fastgrade/report/stats';

/**
 * Colour step (0 red … 5 green) for level i of n, so the lowest level is red, the middle amber, the top green.
 *
 * @param {number} i
 * @param {number} n
 * @returns {number}
 */
const STEPS = {"1": [5], "2": [0, 5], "3": [0, 2, 5], "4": [0, 2, 3, 5], "5": [0, 1, 2, 3, 5], "6": [0, 1, 2, 3, 4, 5]};
export const step = (i, n) => (STEPS[n] ? STEPS[n][i] : Math.round(i * 5 / Math.max(1, n - 1)));

/**
 * "Nice" upper bound for an axis.
 *
 * @param {number} v
 * @returns {number}
 */
const nice = v => {
    if (v <= 0) {
        return 1;
    }
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
};

/**
 * Drawing width matched to the space the chart will fill, so text stays the same size on any screen.
 *
 * @param {Object} opts {half}
 * @returns {number}
 */
const autoW = opts => {
    const body = document.querySelector('.fg-rp-body') || document.querySelector('.fg-rp-print');
    let base = Math.max(520, Math.min(1500, ((body && body.clientWidth) || 1000) - 92));
    if (opts.aside && window.innerWidth > 1100) {
        base -= 364;
    }
    return Math.round(opts.half ? Math.max(420, base / 2 - 24) : base);
};

/**
 * Vertical bar chart (histograms and counts over time).
 *
 * @param {Array} bars [{label, value, display, tip, cls, onClick}]
 * @param {Object} opts {height, ylabel, highlight}
 * @returns {HTMLElement}
 */
export const columns = (bars, opts = {}) => {
    const W = autoW(opts);
    const H = opts.height || 250;
    const pad = {l: 40, r: 8, t: 18, b: 30};
    const top = Math.max(1, ...bars.map(b => b.value));
    // Whole-number steps for counts, so gridlines read 0, 2, 4… and never repeat.
    const stepv = Math.max(1, Math.ceil(nice(top / 4)));
    const ticks = Math.max(1, Math.ceil(top / stepv));
    const max = stepv * ticks;
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const bw = iw / Math.max(1, bars.length);
    const svg = s('svg', {viewBox: `0 0 ${W} ${H}`, "class": 'fg-chart', role: 'img', 'aria-label': opts.label || ''});
    for (let i = 0; i <= ticks; i++) {
        const y = pad.t + ih - ih * i / ticks;
        svg.append(s('line', {x1: pad.l, x2: W - pad.r, y1: y, y2: y, "class": 'fg-grid'}),
            s('text', {x: pad.l - 8, y: y + 4, "class": 'fg-axis', 'text-anchor': 'end'}, S.fmt(stepv * i, 0)));
    }
    bars.forEach((b, i) => {
        const bh = ih * b.value / max;
        const x = pad.l + i * bw + bw * 0.12;
        const rect = s('rect', {x, y: pad.t + ih - bh, width: bw * 0.76, height: Math.max(bh, b.value ? 1.5 : 0), rx: 3,
            "class": 'fg-bar ' + (b.cls || ''), tabindex: b.onClick ? 0 : null});
        if (b.onClick) {
            rect.classList.add('is-click');
            rect.addEventListener('click', b.onClick);
            rect.addEventListener('keydown', e => (e.key === 'Enter' ? b.onClick() : null));
        }
        rect.append(s('title', null, b.tip || `${b.label}: ${b.display ?? b.value}`));
        svg.append(rect);
        if (b.value && bars.length <= 16) {
            svg.append(s('text', {x: x + bw * 0.38, y: pad.t + ih - bh - 5, "class": 'fg-val', 'text-anchor': 'middle'},
                String(b.display ?? b.value)));
        }
        if (bars.length <= 16 || i % Math.ceil(bars.length / 12) === 0) {
            svg.append(s('text', {x: x + bw * 0.38, y: H - 9, "class": 'fg-axis', 'text-anchor': 'middle'}, b.label));
        }
    });
    return h('div.fg-chart-wrap', null, svg);
};

/**
 * Horizontal bars with labels (rankings, shares).
 *
 * @param {Array} items [{label, value, display, sub, cls, onClick}]
 * @param {Object} opts {max}
 * @returns {HTMLElement}
 */
export const hbars = (items, opts = {}) => {
    const max = opts.max || Math.max(1e-9, ...items.map(i => i.value || 0));
    return h('div.fg-hbars', {role: 'list'}, items.map(i => {
        const row = h(i.onClick ? 'button.fg-hbar' : 'div.fg-hbar', {role: 'listitem', type: i.onClick ? 'button' : null,
                onclick: i.onClick || null, "class": i.cls || ''},
            h('span.fg-hbar-label', null, i.label, i.sub ? h('small', null, i.sub) : null),
            h('span.fg-hbar-track', null, h('span.fg-hbar-fill', {style: {width: Math.max(0, Math.min(100,
                100 * (i.value || 0) / max)) + '%'}})),
            h('span.fg-hbar-val', null, i.display ?? S.fmt(i.value)));
        return i.tip ? tip(row, i.tip) : row;
    }));
};

/**
 * One 100% stacked bar: the share of students at each level of a criterion.
 *
 * @param {Array} segments [{count, label, step, onClick}]
 * @param {Object} opts {label}
 * @returns {HTMLElement}
 */
export const ladder = (segments, opts = {}) => {
    const total = segments.reduce((a, b) => a + b.count, 0);
    return h('div.fg-ladder', {role: 'img', 'aria-label': opts.label || ''}, segments.map(sg => {
        const w = total ? 100 * sg.count / total : 0;
        const el = h(sg.onClick ? 'button.fg-ladder-seg' : 'span.fg-ladder-seg', {
            type: sg.onClick ? 'button' : null, "class": 'fg-lv-' + sg.step + (sg.cls ? ' ' + sg.cls : ''),
            style: {flexBasis: w + '%', flexGrow: 0}, onclick: sg.onClick || null,
        }, w >= 7 ? h('span', null, Math.round(w) + '%') : null);
        return tip(el, `${sg.label}\n${sg.count} · ${Math.round(w)}%`);
    }));
};

/**
 * Box plot with every value shown as a dot, one row per group (markers).
 *
 * @param {Array} groups [{label, values, sub, onClick}]
 * @param {Object} opts {lo, hi, fmt, ref}
 * @returns {HTMLElement}
 */
export const boxes = (groups, opts = {}) => {
    const lo = opts.lo ?? 0;
    const hi = opts.hi ?? 100;
    const fmt = opts.fmt || (v => S.fmt(v, 0));
    const W = autoW(opts);
    const rowh = 42;
    const pad = {l: 170, r: 16, t: 8, b: 28};
    const H = pad.t + pad.b + rowh * groups.length;
    const X = v => pad.l + (W - pad.l - pad.r) * (v - lo) / ((hi - lo) || 1);
    const svg = s('svg', {viewBox: `0 0 ${W} ${H}`, "class": 'fg-chart', role: 'img', 'aria-label': opts.label || ''});
    for (let i = 0; i <= 4; i++) {
        const v = lo + (hi - lo) * i / 4;
        svg.append(s('line', {x1: X(v), x2: X(v), y1: pad.t, y2: H - pad.b, "class": 'fg-grid'}),
            s('text', {x: X(v), y: H - 8, "class": 'fg-axis', 'text-anchor': 'middle'}, fmt(v)));
    }
    if (opts.ref !== undefined && opts.ref !== null) {
        svg.append(s('line', {x1: X(opts.ref), x2: X(opts.ref), y1: pad.t, y2: H - pad.b, "class": 'fg-ref'},
            s('title', null, opts.reflabel || '')));
    }
    groups.forEach((g, gi) => {
        const cy = pad.t + rowh * gi + rowh / 2;
        const vals = S.nums(g.values);
        const label = s('text', {x: pad.l - 10, y: cy + 4, "class": 'fg-axis is-label', 'text-anchor': 'end'},
            g.label.length > 20 ? g.label.slice(0, 19) + '…' : g.label);
        svg.append(label);
        if (!vals.length) {
            return;
        }
        const q1 = S.quantile(vals, 0.25);
        const q3 = S.quantile(vals, 0.75);
        const med = S.median(vals);
        const mn = Math.min(...vals);
        const mx = Math.max(...vals);
        const grp = s('g', {"class": 'fg-box' + (g.cls ? ' ' + g.cls : '')});
        grp.append(s('line', {x1: X(mn), x2: X(mx), y1: cy, y2: cy, "class": 'fg-whisker'}),
            s('rect', {x: X(q1), y: cy - 10, width: Math.max(2, X(q3) - X(q1)), height: 20, rx: 4, "class": 'fg-boxbody'}),
            s('line', {x1: X(med), x2: X(med), y1: cy - 12, y2: cy + 12, "class": 'fg-median'}));
        vals.forEach((v, i) => {
            const jitter = ((i * 7919) % 11 - 5) * 1.2;
            grp.append(s('circle', {cx: X(v), cy: cy + jitter, r: 2.6, "class": 'fg-dot'}));
        });
        grp.append(s('title', null, `${g.label}${g.sub ? ' (' + g.sub + ')' : ''}\n` +
            `median ${fmt(med)} · middle half ${fmt(q1)}–${fmt(q3)} · range ${fmt(mn)}–${fmt(mx)}`));
        svg.append(grp);
    });
    return h('div.fg-chart-wrap', null, svg);
};

/**
 * Line chart (several series).
 *
 * @param {Array} series [{label, points: [{x, y}], cls}]
 * @param {Object} opts {xfmt, yfmt, ylo, yhi, height}
 * @returns {HTMLElement}
 */
export const lines = (series, opts = {}) => {
    const W = autoW(opts);
    const H = opts.height || 260;
    const pad = {l: 38, r: 12, t: 12, b: 28};
    const xs = series.flatMap(sr => sr.points.map(p => p.x));
    const ys = series.flatMap(sr => sr.points.map(p => p.y));
    if (!xs.length) {
        return h('div.fg-chart-empty');
    }
    const xlo = Math.min(...xs);
    const xhi = Math.max(...xs);
    const ylo = opts.ylo ?? Math.min(0, ...ys);
    const yhi = opts.yhi ?? nice(Math.max(...ys));
    const X = v => pad.l + (W - pad.l - pad.r) * (xhi === xlo ? 0.5 : (v - xlo) / (xhi - xlo));
    const Y = v => pad.t + (H - pad.t - pad.b) * (1 - (v - ylo) / ((yhi - ylo) || 1));
    const svg = s('svg', {viewBox: `0 0 ${W} ${H}`, "class": 'fg-chart', role: 'img', 'aria-label': opts.label || ''});
    for (let i = 0; i <= 4; i++) {
        const v = ylo + (yhi - ylo) * i / 4;
        svg.append(s('line', {x1: pad.l, x2: W - pad.r, y1: Y(v), y2: Y(v), "class": 'fg-grid'}),
            s('text', {x: pad.l - 6, y: Y(v) + 4, "class": 'fg-axis', 'text-anchor': 'end'}, (opts.yfmt || S.fmt)(v)));
    }
    const xf = opts.xfmt || (v => S.fmt(v, 0));
    [xlo, (xlo + xhi) / 2, xhi].forEach(v => svg.append(s('text', {x: X(v), y: H - 8, "class": 'fg-axis',
        'text-anchor': 'middle'}, xf(v))));
    series.forEach((sr, si) => {
        const pts = sr.points.slice().sort((a, b) => a.x - b.x);
        const d = pts.map((p, i) => (i ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1)).join(' ');
        svg.append(s('path', {d, "class": 'fg-line fg-series-' + (si % 6) + (sr.cls ? ' ' + sr.cls : '')},
            s('title', null, sr.label)));
        if (pts.length <= 40) {
            pts.forEach(p => svg.append(s('circle', {cx: X(p.x), cy: Y(p.y), r: 3, "class": 'fg-pt fg-series-' + (si % 6)},
                s('title', null, `${sr.label}: ${(opts.yfmt || S.fmt)(p.y)} · ${xf(p.x)}`))));
        }
    });
    const legend = series.length > 1 ? h('div.fg-legend', null, series.map((sr, si) =>
        h('span', null, h('i', {"class": 'fg-series-' + (si % 6)}), sr.label))) : null;
    return h('div.fg-chart-wrap', null, svg, legend);
};

/**
 * Tiny trend line for KPI tiles.
 *
 * @param {number[]} values
 * @returns {SVGElement}
 */
export const spark = values => {
    const v = S.nums(values);
    const W = 96;
    const H = 26;
    if (v.length < 2) {
        return s('svg', {viewBox: `0 0 ${W} ${H}`, "class": 'fg-spark'});
    }
    const lo = Math.min(...v);
    const hi = Math.max(...v);
    const d = v.map((y, i) => (i ? 'L' : 'M') + (W * i / (v.length - 1)).toFixed(1) + ' ' +
        (H - 3 - (H - 6) * (hi === lo ? 0.5 : (y - lo) / (hi - lo))).toFixed(1)).join(' ');
    return s('svg', {viewBox: `0 0 ${W} ${H}`, "class": 'fg-spark', 'aria-hidden': 'true'}, s('path', {d}));
};
