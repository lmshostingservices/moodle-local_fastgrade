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
 * Page rotation: turning a page by quarter turns, and moving marks with it so they stay on the same spot.
 * Marks are stored in the page's displayed units, so when a page turns its marks are turned too.
 *
 * @module     local_fastgrade/annotate/rotate
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/**
 * A rotation as 0, 90, 180 or 270.
 *
 * @param {number} deg
 * @returns {number}
 */
export const norm = deg => ((Math.round((Number(deg) || 0) / 90) * 90) % 360 + 360) % 360;

const r1 = v => Math.round(v * 10) / 10;

/**
 * Turn a point on a page of width w and height hgt clockwise by deg (a quarter-turn multiple).
 *
 * @param {number} x
 * @param {number} y
 * @param {number} deg
 * @param {number} w page width before turning
 * @param {number} hgt page height before turning
 * @returns {number[]} [x, y] on the turned page
 */
export const point = (x, y, deg, w, hgt) => {
    switch (norm(deg)) {
        case 90: return [r1(hgt - y), r1(x)];
        case 180: return [r1(w - x), r1(hgt - y)];
        case 270: return [r1(y), r1(w - x)];
        default: return [x, y];
    }
};

/**
 * Turn a rectangle [x, y, width, height].
 *
 * @param {number[]} r
 * @param {number} deg
 * @param {number} w
 * @param {number} hgt
 * @returns {number[]}
 */
export const rect = (r, deg, w, hgt) => {
    const [x, y, rw, rh] = r;
    switch (norm(deg)) {
        case 90: return [r1(hgt - y - rh), r1(x), r1(rh), r1(rw)];
        case 180: return [r1(w - x - rw), r1(hgt - y - rh), r1(rw), r1(rh)];
        case 270: return [r1(y), r1(w - x - rw), r1(rh), r1(rw)];
        default: return r.slice();
    }
};

/**
 * A mark's anchor on the turned page. Text positions (exact, start, end) are kept as they are; only places on the
 * page move. Anchors with no place on the page (cells, times, code lines) come back unchanged.
 *
 * @param {Object|null} anchor
 * @param {number} deg clockwise quarter turns, in degrees
 * @param {number} w page width before turning
 * @param {number} hgt page height before turning
 * @returns {Object|null}
 */
export const anchor = (anchor, deg, w, hgt) => {
    if (!anchor || !norm(deg)) {
        return anchor;
    }
    const a = JSON.parse(JSON.stringify(anchor));
    if (Array.isArray(a.rects)) {
        a.rects = a.rects.map(r => rect(r, deg, w, hgt));
    }
    if (Array.isArray(a.rect)) {
        a.rect = rect(a.rect, deg, w, hgt);
    }
    if (Array.isArray(a.from) && Array.isArray(a.to)) {
        a.from = point(a.from[0], a.from[1], deg, w, hgt);
        a.to = point(a.to[0], a.to[1], deg, w, hgt);
    }
    if (Array.isArray(a.points)) {
        a.points = a.points.map(p => point(p[0], p[1], deg, w, hgt).concat(p.length > 2 ? [p[2]] : []));
    }
    if (typeof a.x === 'number' && typeof a.y === 'number') {
        [a.x, a.y] = point(a.x, a.y, deg, w, hgt);
    }
    return a;
};

/**
 * Draw an image onto a canvas context turned clockwise, filling width cw and height ch (the turned size).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasImageSource} img
 * @param {number} deg
 * @param {number} cw width of the turned picture
 * @param {number} ch height of the turned picture
 */
export const drawImage = (ctx, img, deg, cw, ch) => {
    const r = norm(deg);
    ctx.save();
    if (r === 90) {
        ctx.translate(cw, 0);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(img, 0, 0, ch, cw);
    } else if (r === 180) {
        ctx.translate(cw, ch);
        ctx.rotate(Math.PI);
        ctx.drawImage(img, 0, 0, cw, ch);
    } else if (r === 270) {
        ctx.translate(0, ch);
        ctx.rotate(-Math.PI / 2);
        ctx.drawImage(img, 0, 0, ch, cw);
    } else {
        ctx.drawImage(img, 0, 0, cw, ch);
    }
    ctx.restore();
};

/**
 * Where a point on a displayed page is in PDF space, for a page shown turned by deg (its own /Rotate plus any
 * turn made in Fast Grade). Matches how PDF.js lays a turned page out, so marks land where they were drawn.
 *
 * @param {Object} box crop box {x, y, width, height}
 * @param {number} deg
 * @returns {Function} (x, y) => {x, y}
 */
export const toPdf = (box, deg) => {
    const {x: bx, y: by, width: W, height: H} = box;
    switch (norm(deg)) {
        case 90: return (x, y) => ({x: bx + y, y: by + x});
        case 180: return (x, y) => ({x: bx + W - x, y: by + y});
        case 270: return (x, y) => ({x: bx + W - y, y: by + H - x});
        default: return (x, y) => ({x: bx + x, y: by + H - y});
    }
};
