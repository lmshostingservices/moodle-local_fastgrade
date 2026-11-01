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
 * Finds the lines of handwritten working on a photographed or scanned page with plain image processing
 * (no AI): separate ink from paper, trace and remove the printed rules (their slope gives the page's tilt),
 * then group the writing into rows along the tilt.
 *
 * @module     local_fastgrade/maths/lines
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/**
 * Box blur of a single-channel image with an integral image.
 *
 * @param {Float32Array} src
 * @param {number} w
 * @param {number} h
 * @param {number} r radius
 * @returns {Float32Array}
 */
const boxBlur = (src, w, h, r) => {
    const ii = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
        let row = 0;
        for (let x = 0; x < w; x++) {
            row += src[y * w + x];
            ii[(y + 1) * (w + 1) + x + 1] = ii[y * (w + 1) + x + 1] + row;
        }
    }
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        const y0 = Math.max(0, y - r);
        const y1 = Math.min(h, y + r + 1);
        for (let x = 0; x < w; x++) {
            const x0 = Math.max(0, x - r);
            const x1 = Math.min(w, x + r + 1);
            const sum = ii[y1 * (w + 1) + x1] - ii[y0 * (w + 1) + x1] - ii[y1 * (w + 1) + x0] + ii[y0 * (w + 1) + x0];
            out[y * w + x] = sum / ((y1 - y0) * (x1 - x0));
        }
    }
    return out;
};

/**
 * Marks darker than the paper around them, inside the page (not the desk or the page edge), without the margin.
 *
 * @param {ImageData} img
 * @returns {Uint8Array}
 */
export const inkMask = img => {
    const {width: w, height: h, data} = img;
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
        gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    }
    const r = Math.max(8, Math.round(w / 40));
    const bg = boxBlur(gray, w, h, r);
    const sorted = Float32Array.from(gray).sort();
    const paper = sorted[Math.floor(sorted.length * 0.9)];
    const onPaper = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
        onPaper[i] = gray[i] > paper * 0.72 ? 1 : 0;
    }
    const inside = boxBlur(onPaper, w, h, r * 3);
    const ink = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
        const red = data[i * 4];
        const green = data[i * 4 + 1];
        const blue = data[i * 4 + 2];
        // The red margin line is pale and pink; pens are not.
        const margin = red > green + 35 && red > blue + 35 && gray[i] > paper * 0.6;
        if (bg[i] - gray[i] > 24 && inside[i] > 0.8 && !margin) {
            ink[i] = 1;
        }
    }
    return ink;
};

/**
 * Trace printed rules: thin lines that run a long way across the page, stepping at most one pixel up or down
 * per column and bridging small gaps. Their pixels are removed from the mask, and their slopes give the tilt.
 *
 * @param {Uint8Array} ink
 * @param {number} w
 * @param {number} h
 * @returns {number} slope dy/dx of the page's rows
 */
const removeRules = (ink, w, h) => {
    const long = Math.round(w * 0.12);
    const seen = new Uint8Array(w * h);
    const slopes = [];
    const rules = [];
    const at = (x, y) => (y >= 0 && y < h && x >= 0 && x < w ? ink[y * w + x] : 0);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            if (!ink[i] || seen[i] || at(x - 1, y) || at(x - 1, y - 1) || at(x - 1, y + 1)) {
                continue;
            }
            const path = [[x, y]];
            let cx = x;
            let cy = y;
            for (;;) {
                let next = null;
                for (let dx = 1; dx <= 12 && !next; dx++) {
                    for (const dy of dx > 4 ? [0, -1, 1, -2, 2] : [0, -1, 1]) {
                        if (at(cx + dx, cy + dy)) {
                            next = [cx + dx, cy + dy];
                            break;
                        }
                    }
                }
                if (!next) {
                    break;
                }
                [cx, cy] = next;
                path.push(next);
                seen[cy * w + cx] = 1;
            }
            if (cx - x >= long) {
                slopes.push((cy - y) / (cx - x));
                rules.push(path);
                // Clear the rule's whole thickness, unless writing crosses it there (a tall run of ink), in which
                // case only the rule's own rows go.
                path.forEach(([px, py]) => {
                    let a = py;
                    let b = py;
                    while (a > 0 && ink[(a - 1) * w + px]) {
                        a--;
                    }
                    while (b < h - 1 && ink[(b + 1) * w + px]) {
                        b++;
                    }
                    if (b - a > 7) {
                        a = Math.max(0, py - 1);
                        b = Math.min(h - 1, py + 1);
                    }
                    for (let y = a; y <= b; y++) {
                        ink[y * w + px] = 0;
                    }
                });
            }
        }
    }
    if (!slopes.length) {
        return {slope: 0, rules};
    }
    slopes.sort((p, q) => p - q);
    return {slope: slopes[Math.floor(slopes.length / 2)], rules};
};

/**
 * Remove long near-vertical lines (the margin, a fold, the page edge), traced down the page the same way.
 *
 * @param {Uint8Array} ink
 * @param {number} w
 * @param {number} h
 */
const removeVerticals = (ink, w, h) => {
    const long = Math.round(h * 0.2);
    const seen = new Uint8Array(w * h);
    const at = (x, y) => (y >= 0 && y < h && x >= 0 && x < w ? ink[y * w + x] : 0);
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            const i = y * w + x;
            if (!ink[i] || seen[i] || at(x, y - 1) || at(x - 1, y - 1) || at(x + 1, y - 1)) {
                continue;
            }
            const path = [[x, y]];
            let cx = x;
            let cy = y;
            for (;;) {
                let next = null;
                for (let dy = 1; dy <= 14 && !next; dy++) {
                    for (const dx of dy > 4 ? [0, -1, 1, -2, 2] : [0, -1, 1]) {
                        if (at(cx + dx, cy + dy)) {
                            next = [cx + dx, cy + dy];
                            break;
                        }
                    }
                }
                if (!next) {
                    break;
                }
                [cx, cy] = next;
                path.push(next);
                seen[cy * w + cx] = 1;
            }
            if (cy - y >= long) {
                path.forEach(([px, py]) => {
                    for (let d = -2; d <= 2; d++) {
                        if (px + d >= 0 && px + d < w) {
                            ink[py * w + px + d] = 0;
                        }
                    }
                });
            }
        }
    }
};

/**
 * Ink in a band of the levelled mask: its columns of upright strokes, kept clusters and the ink's real height.
 *
 * @param {Uint8Array} s levelled mask
 * @param {number} w
 * @param {number} y0 first row
 * @param {number} y1 last row (exclusive)
 * @param {number} left
 * @param {number} right
 * @returns {Object|null} {x0, x1, total}
 */
const bandInk = (s, w, y0, y1, left, right) => {
    const cols = new Uint32Array(w);
    for (let yy = y0; yy < y1; yy++) {
        for (let x = left; x < right; x++) {
            cols[x] += s[yy * w + x];
        }
    }
    const segs = [];
    const join = Math.round(w / 25);
    for (let x = left; x < right; x++) {
        if (!cols[x]) {
            continue;
        }
        const last = segs[segs.length - 1];
        const tall = cols[x] >= 3 ? 1 : 0;
        if (last && x - last.x1 <= join) {
            last.x1 = x;
            last.sum += cols[x];
            last.n++;
            last.tall += tall;
        } else {
            segs.push({x0: x, x1: x, sum: cols[x], n: 1, tall});
        }
    }
    const written = segs.filter(sg => sg.tall / sg.n >= 0.15 && sg.sum >= 12);
    if (!written.length) {
        return null;
    }
    const big = Math.max(...written.map(sg => sg.sum));
    const keep = written.filter(sg => sg.sum >= big * 0.08);
    const sum = keep.reduce((a, sg) => a + sg.sum, 0);
    return {x0: keep[0].x0, x1: keep[keep.length - 1].x1, total: sum};
};

/**
 * Rows of writing.
 *
 * @param {ImageData} img
 * @returns {Array} [{x0, x1, y0, y1, slope, box: [x0, y0, x1, y1]}] in the image's pixels; y0 and y1 are the
 *     row's top and bottom at x = 0, so at x the row spans y0 + x * slope to y1 + x * slope.
 */
export const findLines = img => {
    const {width: w, height: h} = img;
    const ink = inkMask(img);
    const found = removeRules(ink, w, h);
    removeVerticals(ink, w, h);
    const t = found.slope;
    const pad = Math.ceil(w * Math.abs(t)) + 2;
    const H = h + 2 * pad;
    // Shear so the page's rows are horizontal.
    const s = new Uint8Array(w * H);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (ink[y * w + x]) {
                s[(Math.round(y - x * t) + pad) * w + x] = 1;
            }
        }
    }
    // The margin and other vertical rules stay vertical after the shear: clear any column inked over a fifth of the page.
    for (let x = 0; x < w; x++) {
        let n = 0;
        for (let yy = 0; yy < H; yy++) {
            n += s[yy * w + x] || (x > 0 && s[yy * w + x - 1]) || (x < w - 1 && s[yy * w + x + 1]) ? 1 : 0;
        }
        if (n > h * 0.2) {
            for (let yy = 0; yy < H; yy++) {
                s[yy * w + x] = 0;
            }
        }
    }
    const left = Math.round(w * 0.02);
    const right = Math.round(w * 0.98);
    const prof = new Float32Array(H);
    for (let y = 0; y < H; y++) {
        let n = 0;
        for (let x = left; x < right; x++) {
            n += s[y * w + x];
        }
        prof[y] = n;
    }
    const k = Math.max(2, Math.round(h / 400));
    const sm = new Float32Array(H);
    for (let y = 0; y < H; y++) {
        let sum = 0;
        let c = 0;
        for (let d = -k; d <= k; d++) {
            if (y + d >= 0 && y + d < H) {
                sum += prof[y + d];
                c++;
            }
        }
        sm[y] = sum / c;
    }
    const thresh = Math.max(2, w / 250);
    const bands = [];
    let y = 0;
    while (y < H) {
        if (sm[y] > thresh) {
            const y0 = y;
            while (y < H && sm[y] > thresh) {
                y++;
            }
            bands.push([y0, y]);
        }
        y++;
    }
    // Join a fraction's numerator, bar and denominator, and powers, to their line: bands that nearly touch, or a
    // nearby band that holds only part of the other's line (it sits within its span and is narrower or starts
    // further in). Two full lines one above the other stay apart.
    const near = Math.round(h / 160);
    const far = Math.round(h / 55);
    const spanOf = b => bandInk(s, w, b[0], b[1], left, right);
    const partOf = (a, b) => a && b && a.x0 >= b.x0 - w * 0.015 && a.x1 <= b.x1 + w * 0.03 &&
        (a.x1 - a.x0 < (b.x1 - b.x0) * 0.6 || a.x0 > b.x0 + w * 0.04);
    const merged = [];
    bands.forEach(b => {
        const last = merged[merged.length - 1];
        const g = last ? b[0] - last[1] : Infinity;
        if (last && (g < near || (g < far && (partOf(spanOf(b), spanOf(last)) || partOf(spanOf(last), spanOf(b)))))) {
            last[1] = b[1];
        } else {
            merged.push([b[0], b[1]]);
        }
    });
    const minh = Math.round(h / 140);
    const out = [];
    merged.forEach(([y0, y1]) => {
        if (y1 - y0 < minh) {
            return;
        }
        const cols = new Uint32Array(w);
        let total = 0;
        let rows = 0;
        for (let yy = y0; yy < y1; yy++) {
            let n = 0;
            for (let x = left; x < right; x++) {
                cols[x] += s[yy * w + x];
                n += s[yy * w + x];
            }
            rows += n > 2 ? 1 : 0;
        }
        // A band only a few pixels tall is what is left of a printed rule, not writing.
        if (rows < Math.max(6, h / 160)) {
            return;
        }
        const segs = [];
        const join = Math.round(w / 25);
        for (let x = left; x < right; x++) {
            if (!cols[x]) {
                continue;
            }
            total += cols[x];
            const last = segs[segs.length - 1];
            const tall = cols[x] >= 4 ? 1 : 0;
            if (last && x - last.x1 <= join) {
                last.x1 = x;
                last.sum += cols[x];
                last.n++;
                last.tall += tall;
            } else {
                segs.push({x0: x, x1: x, sum: cols[x], n: 1, tall});
            }
        }
        if (!segs.length) {
            return;
        }
        // Writing has upright strokes; leftover pieces of printed rules are flat.
        const written = segs.filter(sg => sg.tall / sg.n >= 0.15);
        if (!written.length) {
            return;
        }
        const big = Math.max(...written.map(sg => sg.sum));
        const keep = written.filter(sg => sg.sum >= big * 0.08 && sg.sum >= (y1 - y0));
        if (!keep.length) {
            return;
        }
        const x0 = keep[0].x0;
        const x1 = keep[keep.length - 1].x1;
        if (x1 - x0 < w / 60 || total < (y1 - y0) * 3) {
            return;
        }
        const top = y0 - pad;
        const bottom = y1 - pad;
        // The box around the ink itself, back on the page.
        let ymin = h;
        let ymax = 0;
        for (let yy = y0; yy < y1; yy++) {
            for (let x = x0; x <= x1; x++) {
                if (s[yy * w + x]) {
                    const yo = yy - pad + x * t;
                    ymin = Math.min(ymin, yo);
                    ymax = Math.max(ymax, yo);
                }
            }
        }
        out.push({x0, x1, y0: top, y1: bottom, slope: t, box: [x0, Math.max(0, ymin), x1, Math.min(h, ymax)]});
    });
    // Keep the cleaned, levelled ink so a stamp can be placed at the end of whatever line the marker clicks.
    out.prep = {s, w, h, H, pad, t};
    return out;
};


/**
 * Where a mark stamp goes when the marker clicks at (x, y): just after the end of the writing at that height.
 * Works from the click itself, so it does not depend on the lines having been grouped perfectly.
 *
 * @param {Array} found result of findLines (with its prep)
 * @param {number} x
 * @param {number} y
 * @returns {Array|null} [x, y] for the stamp, or null when there is no writing there
 */
export const spotAt = (found, x, y) => {
    const p = found && found.prep;
    if (!p) {
        return null;
    }
    const {s, w, h, H, pad, t} = p;
    const heights = found.map(l => l.box[3] - l.box[1]).filter(v => v > 0).sort((a, b) => a - b);
    const lh = heights.length ? heights[Math.floor(heights.length / 2)] : h / 40;
    const half = Math.max(8, Math.round(lh * 0.45));
    const yy = Math.round(y - x * t) + pad;
    const y0 = Math.max(0, yy - half);
    const y1 = Math.min(H, yy + half);
    // A column has writing when at least two of its pixels in the strip are ink (one stray pixel is noise).
    const has = cx => {
        let k = 0;
        for (let r = y0; r < y1; r++) {
            k += s[r * w + cx];
            if (k >= 2) {
                return true;
            }
        }
        return false;
    };
    // Start from the nearest writing to the click, then follow it right until a wide gap.
    let cx = Math.max(0, Math.min(w - 1, Math.round(x)));
    let start = -1;
    for (let d = 0; d < w / 6 && start < 0; d++) {
        if (cx + d < w && has(cx + d)) {
            start = cx + d;
        } else if (cx - d >= 0 && has(cx - d)) {
            start = cx - d;
        }
    }
    if (start < 0) {
        return null;
    }
    const gap = Math.round(w / 16);
    let end = start;
    for (let c = start; c < w && c - end <= gap; c++) {
        if (has(c)) {
            end = c;
        }
    }
    // Vertical middle of the ink near the end of the line.
    let sum = 0;
    let n = 0;
    for (let c = Math.max(0, end - Math.round(w / 12)); c <= end; c++) {
        for (let r = y0; r < y1; r++) {
            if (s[r * w + c]) {
                sum += r;
                n++;
            }
        }
    }
    const my = n ? sum / n : yy;
    const sx = end + 1;
    return [sx, my - pad + sx * t];
};
