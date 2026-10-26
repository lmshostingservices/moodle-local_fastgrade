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
 * Text anchoring: character offsets plus the quoted words and their context (the W3C TextQuote
 * approach), so a mark finds its words again even when the document is re-rendered.
 * Also one-click word and two-click paragraph selection.
 *
 * @module     local_fastgrade/annotate/textanchor
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

const CONTEXT = 32;
const SKIP = '.fg-ignore, script, style';

/**
 * Text nodes under a root, in order.
 *
 * @param {Node} root
 * @returns {Text[]}
 */
export const textNodes = root => {
    const out = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: n => (n.parentElement && n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    let n;
    while ((n = walker.nextNode())) {
        out.push(n);
    }
    return out;
};

/**
 * Full text of a root.
 *
 * @param {Node} root
 * @returns {string}
 */
export const fullText = root => textNodes(root).map(n => n.data).join('');

/**
 * Character offset of a point (node + offset) within a root.
 *
 * @param {Node} root
 * @param {Node} node
 * @param {number} offset
 * @returns {number}
 */
const pointOffset = (root, node, offset) => {
    const nodes = textNodes(root);
    let pos = 0;
    if (node.nodeType !== Node.TEXT_NODE) {
        // Convert an element boundary to the following text position.
        const r = document.createRange();
        r.setStart(root, 0);
        r.setEnd(node, offset);
        const frag = r.cloneContents();
        const tmp = document.createElement('div');
        tmp.appendChild(frag);
        tmp.querySelectorAll(SKIP).forEach(x => x.remove());
        return tmp.textContent.length;
    }
    for (const n of nodes) {
        if (n === node) {
            return pos + offset;
        }
        pos += n.data.length;
    }
    return pos;
};

/**
 * Offsets of a range.
 *
 * @param {Node} root
 * @param {Range} range
 * @returns {{start: number, end: number}}
 */
export const offsetsFromRange = (root, range) => ({
    start: pointOffset(root, range.startContainer, range.startOffset),
    end: pointOffset(root, range.endContainer, range.endOffset),
});

/**
 * A range from offsets.
 *
 * @param {Node} root
 * @param {number} start
 * @param {number} end
 * @returns {Range|null}
 */
export const rangeFromOffsets = (root, start, end) => {
    const nodes = textNodes(root);
    let pos = 0;
    const r = document.createRange();
    let started = false;
    for (const n of nodes) {
        const len = n.data.length;
        if (!started && start <= pos + len) {
            r.setStart(n, Math.max(0, start - pos));
            started = true;
        }
        if (started && end <= pos + len) {
            r.setEnd(n, Math.max(0, end - pos));
            return r;
        }
        pos += len;
    }
    return null;
};

/**
 * Build an anchor for offsets.
 *
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @returns {Object}
 */
export const makeAnchor = (text, start, end) => ({
    start, end,
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - CONTEXT), start),
    suffix: text.slice(end, end + CONTEXT),
});

/**
 * Find an anchor's words again.
 *
 * @param {string} text
 * @param {Object} a anchor
 * @returns {{start: number, end: number}|null}
 */
export const resolve = (text, a) => {
    if (!a || !a.exact) {
        return null;
    }
    if (text.slice(a.start, a.end) === a.exact) {
        return {start: a.start, end: a.end};
    }
    // With context.
    const withctx = (a.prefix || '') + a.exact + (a.suffix || '');
    let i = text.indexOf(withctx);
    if (i >= 0) {
        return {start: i + (a.prefix || '').length, end: i + (a.prefix || '').length + a.exact.length};
    }
    // Closest occurrence of the words.
    let best = -1;
    let bestdist = Infinity;
    i = text.indexOf(a.exact);
    while (i >= 0) {
        const d = Math.abs(i - (a.start || 0));
        if (d < bestdist) {
            best = i;
            bestdist = d;
        }
        i = text.indexOf(a.exact, i + 1);
    }
    if (best >= 0) {
        return {start: best, end: best + a.exact.length};
    }
    // Whitespace-insensitive match.
    const squash = s => s.replace(/\s+/g, '');
    const target = squash(a.exact);
    if (target.length < 3) {
        return null;
    }
    const map = [];
    let flat = '';
    for (let k = 0; k < text.length; k++) {
        if (!/\s/.test(text[k])) {
            map.push(k);
            flat += text[k];
        }
    }
    const j = flat.indexOf(target);
    if (j >= 0) {
        return {start: map[j], end: map[j + target.length - 1] + 1};
    }
    return null;
};

/**
 * Caret position from a point.
 *
 * @param {number} x
 * @param {number} y
 * @returns {{node: Node, offset: number}|null}
 */
export const caretAt = (x, y) => {
    if (document.caretPositionFromPoint) {
        const p = document.caretPositionFromPoint(x, y);
        return p ? {node: p.offsetNode, offset: p.offset} : null;
    }
    if (document.caretRangeFromPoint) {
        const r = document.caretRangeFromPoint(x, y);
        return r ? {node: r.startContainer, offset: r.startOffset} : null;
    }
    return null;
};

const segmenter = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter(undefined, {granularity: 'word'}) : null;

/**
 * Word boundaries around an index in a string.
 *
 * @param {string} s
 * @param {number} i
 * @returns {[number, number]|null}
 */
export const wordAt = (s, i) => {
    if (segmenter) {
        for (const seg of segmenter.segment(s)) {
            if (i >= seg.index && i < seg.index + seg.segment.length) {
                return seg.isWordLike ? [seg.index, seg.index + seg.segment.length] : null;
            }
        }
        return null;
    }
    const re = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
    let m;
    while ((m = re.exec(s))) {
        if (i >= m.index && i < m.index + m[0].length) {
            return [m.index, m.index + m[0].length];
        }
    }
    return null;
};

/**
 * Offsets of the word under a point inside root.
 *
 * @param {Node} root
 * @param {number} x
 * @param {number} y
 * @returns {{start: number, end: number}|null}
 */
export const wordOffsetsAt = (root, x, y) => {
    const c = caretAt(x, y);
    if (!c || !root.contains(c.node) || c.node.nodeType !== Node.TEXT_NODE) {
        return null;
    }
    const data = c.node.data;
    let w = wordAt(data, Math.min(c.offset, data.length - 1));
    if (!w && c.offset > 0) {
        w = wordAt(data, c.offset - 1);
    }
    if (!w) {
        return null;
    }
    const base = pointOffset(root, c.node, 0);
    return {start: base + w[0], end: base + w[1]};
};

/**
 * Select a range in the page.
 *
 * @param {Range} r
 */
export const selectRange = r => {
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
};

/**
 * Wrap a text range in marks (one span per text node piece).
 *
 * @param {Node} root
 * @param {number} start
 * @param {number} end
 * @param {Function} make creates the wrapper element
 * @returns {HTMLElement[]}
 */
export const wrap = (root, start, end, make) => {
    const nodes = textNodes(root);
    let pos = 0;
    const pieces = [];
    nodes.forEach(n => {
        const len = n.data.length;
        const s = Math.max(start, pos);
        const e = Math.min(end, pos + len);
        if (s < e) {
            pieces.push({node: n, s: s - pos, e: e - pos});
        }
        pos += len;
    });
    const out = [];
    pieces.forEach(({node, s, e}) => {
        let target = node;
        if (e < target.data.length) {
            target.splitText(e);
        }
        if (s > 0) {
            target = target.splitText(s);
        }
        if (!target.data.trim() && out.length === 0 && pieces.length > 1) {
            // Skip a leading whitespace-only piece.
        }
        const w = make();
        target.parentNode.insertBefore(w, target);
        w.appendChild(target);
        out.push(w);
    });
    return out;
};
