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
 * Download the open document with its marks drawn in and a numbered comments summary.
 * Built in the browser with pdf-lib; nothing is sent anywhere.
 *
 * @module     local_fastgrade/annotate/export
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {t} from 'local_fastgrade/lib/str';
import * as Loader from 'local_fastgrade/lib/loader';
import {toast} from 'local_fastgrade/ui/toast';
import * as Rotate from 'local_fastgrade/annotate/rotate';

const COL = {improvement: [0.85, 0.47, 0.02], positive: [0.133, 0.776, 0.369], neutral: [0.05, 0.53, 1]};

/**
 * Wrap text to a width.
 *
 * @param {Object} font
 * @param {string} text
 * @param {number} size
 * @param {number} width
 * @returns {string[]}
 */
const wrap = (font, text, size, width) => {
    const out = [];
    String(text || '').split('\n').forEach(para => {
        let line = '';
        para.split(/\s+/).forEach(w => {
            const test = line ? line + ' ' + w : w;
            if (font.widthOfTextAtSize(test, size) > width && line) {
                out.push(line);
                line = w;
            } else {
                line = test;
            }
        });
        out.push(line);
    });
    return out;
};

/**
 * Keep characters the standard font can draw.
 *
 * @param {string} s
 * @returns {string}
 */
const safe = s => String(s || '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '');

/**
 * The photo as shown (turned the way the marker turned it), as JPEG or PNG bytes, with its size in page units.
 * Uses the picture already open in the viewer when there is one.
 *
 * @param {Object} app
 * @param {Object} host
 * @param {Object} doc
 * @returns {Promise<Object>} {bytes, png, w, h}
 */
const photoPage = async(app, host, doc) => {
    const v = host.viewer;
    let img = v && v.doc === doc && v.image ? v.image : null;
    if (!img) {
        img = new Image();
        img.src = doc.url;
        await img.decode();
    }
    const rot = app.annotations.rotation(doc.docref, 1);
    const ratio = Math.min(1, 1200 / img.naturalWidth);
    const iw = img.naturalWidth * ratio;
    const ih = img.naturalHeight * ratio;
    const [w, hgt] = rot % 180 ? [ih, iw] : [iw, ih];
    // Keep the photo sharp in the PDF: up to 2400 pixels on the long side.
    const px = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const cw = Math.max(1, Math.round((rot % 180 ? img.naturalHeight : img.naturalWidth) * px));
    const ch = Math.max(1, Math.round((rot % 180 ? img.naturalWidth : img.naturalHeight) * px));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    const png = /png|gif|svg|webp/i.test(doc.mimetype || doc.filename || '');
    if (!png) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, cw, ch);
    }
    Rotate.drawImage(ctx, img, rot, cw, ch);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, png ? 'image/png' : 'image/jpeg', 0.9));
    canvas.width = 0;
    canvas.height = 0;
    return {bytes: await blob.arrayBuffer(), png, w, h: hgt};
};

/**
 * Build and download.
 *
 * @param {Object} app
 * @param {Object} host viewer host
 */
export const download = async(app, host) => {
    const doc = host.doc;
    if (!doc) {
        return;
    }
    toast(t('export_building'), {type: 'info'});
    try {
        const lib = await Loader.pdflib(app.boot.libs);
        const {PDFDocument, StandardFonts, rgb, degrees} = lib;
        const MARKCOL = {M1: rgb(0.08, 0.5, 0.24), A1: rgb(0.08, 0.5, 0.24), B1: rgb(0.08, 0.5, 0.24),
            ft: rgb(0.04, 0.39, 0.77), A0: rgb(0.71, 0.33, 0.04)};
        const anns = app.annotations.forDoc(doc.docref).filter(a => a.status === 'active');
        let pdf;
        const numbered = anns.filter(a => a.comment).sort((a, b) => (a.page - b.page) ||
            (((a.anchor && (a.anchor.rects ? a.anchor.rects[0][1] : (a.anchor.rect ? a.anchor.rect[1] : a.anchor.y))) || 0) -
            ((b.anchor && (b.anchor.rects ? b.anchor.rects[0][1] : (b.anchor.rect ? b.anchor.rect[1] : b.anchor.y))) || 0)));
        const num = new Map(numbered.map((a, i) => [a.clientid, i + 1]));
        const isPhoto = doc.kind === 'image' && !doc.pdfurl;
        if (doc.pdfurl) {
            const bytes = await (await fetch(doc.pdfurl, {credentials: 'same-origin'})).arrayBuffer();
            pdf = await PDFDocument.load(bytes, {ignoreEncryption: true});
        } else {
            pdf = await PDFDocument.create();
        }
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
        if (isPhoto) {
            const photo = await photoPage(app, host, doc);
            const pic = photo.png ? await pdf.embedPng(photo.bytes) : await pdf.embedJpg(photo.bytes);
            pdf.addPage([photo.w, photo.h]).drawImage(pic, {x: 0, y: 0, width: photo.w, height: photo.h});
        }
        if (doc.pdfurl || isPhoto) {
            const pages = pdf.getPages();
            // Each page is saved turned the way it was marked (its own /Rotate plus the marker's turn).
            // A photo is already drawn turned, so its marks need no turning.
            const turn = pages.map((page, i) => {
                if (isPhoto) {
                    return 0;
                }
                const own = page.getRotation().angle;
                const total = Rotate.norm(own + app.annotations.rotation(doc.docref, i + 1));
                if (total !== Rotate.norm(own)) {
                    page.setRotation(degrees(total));
                }
                return total;
            });
            anns.forEach(a => {
                const page = pages[(a.page || 1) - 1];
                if (!page) {
                    return;
                }
                const R = turn[(a.page || 1) - 1];
                const P = Rotate.toPdf(page.getCropBox(), R);
                const rot = degrees(R);
                // Upright on the page as shown: a box with its top-left corner at (x, y) in page units.
                const box = (x, y, w, hh, opts) => {
                    const o = P(x, y + hh);
                    page.drawRectangle(Object.assign({x: o.x, y: o.y, width: w, height: hh, rotate: rot}, opts));
                };
                const line = (x1, y1, x2, y2, opts) => page.drawLine(Object.assign({start: P(x1, y1), end: P(x2, y2)}, opts));
                const text = (str, x, y, opts) => {
                    const o = P(x, y);
                    page.drawText(str, Object.assign({x: o.x, y: o.y, rotate: rot}, opts));
                };
                const c = COL[a.polarity] || COL.neutral;
                const colour = rgb(c[0], c[1], c[2]);
                const an = a.anchor || {};
                const rects = an.rects || (an.rect ? [an.rect] : []);
                switch (a.type) {
                    case 'border': case 'comment': case 'area':
                        rects.forEach(r => box(r[0] - 1.5, r[1] - 1, r[2] + 3, r[3] + 2, {borderColor: colour, borderWidth: 1,
                            color: colour, opacity: 0.06, borderOpacity: 0.9}));
                        break;
                    case 'highlight':
                        rects.forEach(r => box(r[0], r[1], r[2], r[3], {color: rgb(0.98, 0.8, 0.08), opacity: 0.35}));
                        break;
                    case 'underline':
                        rects.forEach(r => line(r[0], r[1] + r[3], r[0] + r[2], r[1] + r[3], {thickness: 1, color: colour}));
                        break;
                    case 'strike':
                        rects.forEach(r => line(r[0], r[1] + r[3] / 2, r[0] + r[2], r[1] + r[3] / 2, {thickness: 1,
                            color: rgb(0.85, 0.47, 0.02)}));
                        break;
                    case 'rect':
                        if (an.rect) {
                            box(an.rect[0], an.rect[1], an.rect[2], an.rect[3], {borderColor: colour, borderWidth: 1.5});
                        }
                        break;
                    case 'ellipse':
                        if (an.rect) {
                            const c0 = P(an.rect[0] + an.rect[2] / 2, an.rect[1] + an.rect[3] / 2);
                            const [xs, ys] = R % 180 ? [an.rect[3] / 2, an.rect[2] / 2] : [an.rect[2] / 2, an.rect[3] / 2];
                            page.drawEllipse({x: c0.x, y: c0.y, xScale: xs, yScale: ys, borderColor: colour, borderWidth: 1.5});
                        }
                        break;
                    case 'arrow':
                    case 'line':
                        if (an.from) {
                            line(an.from[0], an.from[1], an.to[0], an.to[1], {thickness: 1.5, color: colour});
                            if (a.type === 'arrow') {
                                const ang = Math.atan2(an.to[1] - an.from[1], an.to[0] - an.from[0]);
                                [-0.45, 0.45].forEach(d => line(an.to[0], an.to[1], an.to[0] - 9 * Math.cos(ang + d),
                                    an.to[1] - 9 * Math.sin(ang + d), {thickness: 1.5, color: colour}));
                            }
                        }
                        break;
                    case 'ink':
                        (an.points || []).forEach((p, i, arr) => {
                            if (i) {
                                line(arr[i - 1][0], arr[i - 1][1], p[0], p[1], {thickness: 1.5, color: colour});
                            }
                        });
                        break;
                    case 'stamp': {
                        if ((a.style || {}).stamp === 'mark') {
                            const code = String(a.style.code || 'M1');
                            // Photos are wide in page units; keep the stamp the size it is on screen.
                            const k = Math.max(1, (R % 180 ? page.getHeight() : page.getWidth()) / 640);
                            const size = 10 * k;
                            const tw = bold.widthOfTextAtSize(code, size);
                            const mc = MARKCOL[code] || colour;
                            box(an.x - tw / 2 - 4 * k, an.y - 7 * k, tw + 8 * k, 14 * k, {borderColor: mc, borderWidth: 1.2 * k,
                                color: rgb(1, 1, 1), opacity: 0.9});
                            text(code, an.x - tw / 2, an.y + 3.5 * k, {size, font: bold, color: mc});
                            break;
                        }
                        const glyph = {tick: 'OK', cross: 'X', query: '?'}[(a.style || {}).stamp] || '*';
                        const c0 = P(an.x, an.y);
                        page.drawCircle({x: c0.x, y: c0.y, size: 9, borderColor: colour, borderWidth: 1, color: rgb(1, 1, 1),
                            opacity: 0.85});
                        text(glyph, an.x - bold.widthOfTextAtSize(glyph, 8) / 2, an.y + 3, {size: 8, font: bold, color: colour});
                        break;
                    }
                    case 'text':
                        wrap(font, safe(a.comment), 10, 220).forEach((ln, i) => text(ln, an.x, an.y + 11 + i * 12,
                            {size: 10, font, color: colour}));
                        break;
                    default:
                        break;
                }
                const n = num.get(a.clientid);
                if (n && rects.length) {
                    const r = rects[0];
                    const c0 = P(r[0] - 7, r[1] + 5);
                    page.drawCircle({x: c0.x, y: c0.y, size: 6.5, color: colour});
                    const label = String(n);
                    text(label, r[0] - 7 - bold.widthOfTextAtSize(label, 7) / 2, r[1] + 7.5, {size: 7, font: bold,
                        color: rgb(1, 1, 1)});
                }
            });
        }
        // Summary pages.
        const W = 595;
        const H = 842;
        let page = pdf.addPage([W, H]);
        let y = H - 56;
        const line = (text, size = 10, f = font, colour = rgb(0.1, 0.1, 0.12), indent = 0) => {
            wrap(f, safe(text), size, W - 112 - indent).forEach(ln => {
                if (y < 56) {
                    page = pdf.addPage([W, H]);
                    y = H - 56;
                }
                page.drawText(ln, {x: 56 + indent, y, size, font: f, color: colour});
                y -= size + 4;
            });
        };
        line(t('export_title'), 16, bold);
        line(safe(doc.filename), 10, font, rgb(0.4, 0.4, 0.45));
        y -= 8;
        if (!numbered.length) {
            line(t('export_nocomments'));
        }
        numbered.forEach(a => {
            const c = COL[a.polarity] || COL.neutral;
            const label = `${num.get(a.clientid)}. ${t('pol_' + a.polarity)}` + (a.page ? ` · ${t('pagen', a.page)}` : '');
            line(label, 10, bold, rgb(c[0], c[1], c[2]));
            if (a.anchor && a.anchor.exact) {
                line('"' + a.anchor.exact.slice(0, 200) + (a.anchor.exact.length > 200 ? '...' : '') + '"', 9, font,
                    rgb(0.4, 0.4, 0.45), 12);
            }
            line(a.comment, 10, font, rgb(0.1, 0.1, 0.12), 12);
            y -= 6;
        });
        const out = await pdf.save();
        const blob = new Blob([out], {type: 'application/pdf'});
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = (doc.filename || 'feedback').replace(/\.[^.]+$/, '') + ' - ' + t('export_suffix') + '.pdf';
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
        toast(t('export_failed') + ' ' + (e.message || ''), {type: 'error'});
    }
};
