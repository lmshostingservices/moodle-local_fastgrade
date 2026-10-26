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
        const {PDFDocument, StandardFonts, rgb} = lib;
        const anns = app.annotations.forDoc(doc.docref).filter(a => a.status === 'active');
        let pdf;
        const numbered = anns.filter(a => a.comment).sort((a, b) => (a.page - b.page) ||
            (((a.anchor && (a.anchor.rects ? a.anchor.rects[0][1] : (a.anchor.rect ? a.anchor.rect[1] : a.anchor.y))) || 0) -
            ((b.anchor && (b.anchor.rects ? b.anchor.rects[0][1] : (b.anchor.rect ? b.anchor.rect[1] : b.anchor.y))) || 0)));
        const num = new Map(numbered.map((a, i) => [a.clientid, i + 1]));
        if (doc.pdfurl) {
            const bytes = await (await fetch(doc.pdfurl, {credentials: 'same-origin'})).arrayBuffer();
            pdf = await PDFDocument.load(bytes, {ignoreEncryption: true});
        } else {
            pdf = await PDFDocument.create();
        }
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
        if (doc.pdfurl) {
            const pages = pdf.getPages();
            anns.forEach(a => {
                const page = pages[(a.page || 1) - 1];
                if (!page || page.getRotation().angle % 360 !== 0) {
                    return;
                }
                const box = page.getCropBox();
                const X = x => box.x + x;
                const Y = y => box.y + box.height - y;
                const c = COL[a.polarity] || COL.neutral;
                const colour = rgb(c[0], c[1], c[2]);
                const an = a.anchor || {};
                const rects = an.rects || (an.rect ? [an.rect] : []);
                switch (a.type) {
                    case 'border': case 'comment': case 'area':
                        rects.forEach(r => page.drawRectangle({x: X(r[0] - 1.5), y: Y(r[1] + r[3] + 1), width: r[2] + 3,
                            height: r[3] + 2, borderColor: colour, borderWidth: 1, color: colour, opacity: 0.06,
                            borderOpacity: 0.9}));
                        break;
                    case 'highlight':
                        rects.forEach(r => page.drawRectangle({x: X(r[0]), y: Y(r[1] + r[3]), width: r[2], height: r[3],
                            color: rgb(0.98, 0.8, 0.08), opacity: 0.35}));
                        break;
                    case 'underline':
                        rects.forEach(r => page.drawLine({start: {x: X(r[0]), y: Y(r[1] + r[3])}, end: {x: X(r[0] + r[2]),
                            y: Y(r[1] + r[3])}, thickness: 1, color: colour}));
                        break;
                    case 'strike':
                        rects.forEach(r => page.drawLine({start: {x: X(r[0]), y: Y(r[1] + r[3] / 2)}, end: {x: X(r[0] + r[2]),
                            y: Y(r[1] + r[3] / 2)}, thickness: 1, color: rgb(0.85, 0.47, 0.02)}));
                        break;
                    case 'rect':
                        if (an.rect) {
                            page.drawRectangle({x: X(an.rect[0]), y: Y(an.rect[1] + an.rect[3]), width: an.rect[2],
                                height: an.rect[3], borderColor: colour, borderWidth: 1.5});
                        }
                        break;
                    case 'ellipse':
                        if (an.rect) {
                            page.drawEllipse({x: X(an.rect[0] + an.rect[2] / 2), y: Y(an.rect[1] + an.rect[3] / 2),
                                xScale: an.rect[2] / 2, yScale: an.rect[3] / 2, borderColor: colour, borderWidth: 1.5});
                        }
                        break;
                    case 'arrow':
                    case 'line':
                        if (an.from) {
                            page.drawLine({start: {x: X(an.from[0]), y: Y(an.from[1])}, end: {x: X(an.to[0]), y: Y(an.to[1])},
                                thickness: 1.5, color: colour});
                        }
                        break;
                    case 'ink':
                        (an.points || []).forEach((p, i, arr) => {
                            if (i) {
                                page.drawLine({start: {x: X(arr[i - 1][0]), y: Y(arr[i - 1][1])}, end: {x: X(p[0]), y: Y(p[1])},
                                    thickness: 1.5, color: colour});
                            }
                        });
                        break;
                    case 'stamp': {
                        const glyph = {tick: 'OK', cross: 'X', query: '?'}[(a.style || {}).stamp] || '*';
                        page.drawCircle({x: X(an.x), y: Y(an.y), size: 9, borderColor: colour, borderWidth: 1, color: rgb(1, 1, 1),
                            opacity: 0.85});
                        page.drawText(glyph, {x: X(an.x) - bold.widthOfTextAtSize(glyph, 8) / 2, y: Y(an.y) - 3, size: 8,
                            font: bold, color: colour});
                        break;
                    }
                    case 'text':
                        wrap(font, safe(a.comment), 10, 220).forEach((ln, i) => page.drawText(ln, {x: X(an.x),
                            y: Y(an.y + 11 + i * 12),
                            size: 10, font, color: colour}));
                        break;
                    default:
                        break;
                }
                const n = num.get(a.clientid);
                if (n && rects.length) {
                    const r = rects[0];
                    const cx = X(r[0]) - 7;
                    const cy = Y(r[1]) - 5;
                    page.drawCircle({x: cx, y: cy, size: 6.5, color: colour});
                    const label = String(n);
                    page.drawText(label, {x: cx - bold.widthOfTextAtSize(label, 7) / 2, y: cy - 2.5, size: 7, font: bold,
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
