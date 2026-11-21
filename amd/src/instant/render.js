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
 * Draws an Instant Feedback result. Used on the student's page and in the teacher's preview, so a
 * teacher sees exactly what a student will see. All text is set as text, never as HTML.
 *
 * @module     local_fastgrade/instant/render
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/**
 * Make an element.
 *
 * @param {string} tag
 * @param {string} cls
 * @param {string} text
 * @returns {HTMLElement}
 */
export const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) {
        e.className = cls;
    }
    if (text !== undefined && text !== null && text !== '') {
        e.textContent = String(text);
    }
    return e;
};

/**
 * Fill {$a} and {$a->x} placeholders.
 *
 * @param {string} s
 * @param {*} a
 * @returns {string}
 */
export const fill = (s, a) => {
    if (a === undefined || a === null) {
        return s;
    }
    if (typeof a === 'object') {
        return s.replace(/\{\$a->(\w+)\}/g, (m, k) => (a[k] !== undefined ? a[k] : m));
    }
    return s.replace(/\{\$a\}/g, a);
};

const ICON = {detected: '✓', partial: '◐', uncertain: '?', missing: '○', wrong: '✕'};

/**
 * One item.
 *
 * @param {Object} it
 * @param {Function} t strings
 * @returns {HTMLElement}
 */
const item = (it, t) => {
    const li = el('li', 'fg-if-item is-' + it.state);
    const head = el('div', 'fg-if-item-head');
    head.append(el('span', 'fg-if-ic', ICON[it.state] || '•'));
    head.firstChild.setAttribute('aria-hidden', 'true');
    const sr = el('span', 'sr-only', t('if_ui_' + it.state));
    head.append(sr);
    head.append(el('strong', 'fg-if-label', it.label || (it.state === 'detected' ? t('if_ui_mentioned') : t('if_ui_hidden'))));
    li.append(head);
    if (it.message) {
        li.append(el('p', 'fg-if-msg', it.message));
    }
    if (it.hint) {
        const p = el('p', 'fg-if-hint');
        p.append(el('span', 'fg-if-hint-k', t('if_ui_hint') + ' '), document.createTextNode(it.hint));
        li.append(p);
    }
    if (it.resource && it.resource.url) {
        const a = el('a', 'fg-if-res', fill(t('if_ui_resource'), it.resource.name));
        a.href = it.resource.url;
        li.append(a);
    }
    return li;
};

/**
 * A titled list.
 *
 * @param {string} title
 * @param {Array} list
 * @param {Function} t
 * @returns {HTMLElement|null}
 */
const group = (title, list, t) => {
    if (!list.length) {
        return null;
    }
    const sec = el('section', 'fg-if-group');
    sec.append(el('h4', 'fg-if-h', title));
    const ul = el('ul', 'fg-if-list');
    list.forEach(it => ul.append(item(it, t)));
    sec.append(ul);
    return sec;
};

/**
 * The whole result.
 *
 * @param {Object} r result from the server
 * @param {Object} view {attemptsleft, history, attemptno, repeat}
 * @param {Function} t strings
 * @returns {HTMLElement}
 */
export const result = (r, view, t) => {
    const box = el('div', 'fg-if-result');
    const v = view || {};
    if (!r || !r.status) {
        return box;
    }
    const head = el('div', 'fg-if-head');
    head.append(el('h3', 'fg-if-title', t('if_ui_title')));
    if (r.engine === 'ai') {
        head.append(el('span', 'fg-if-badge', t('if_ui_ai')));
    }
    box.append(head);
    if (r.intro) {
        box.append(el('p', 'fg-if-intro', r.intro));
    }
    if (r.status === 'empty' || r.status === 'review') {
        box.append(el('p', 'fg-if-review', r.status === 'empty' ? t('if_ui_empty') : t('if_ui_review')));
    }
    const sum = r.summary || {};
    if (r.status === 'ok' && sum.total) {
        const line = el('p', 'fg-if-summary');
        line.textContent = fill(t('if_ui_count'), {n: sum.detected, total: sum.total});
        if (r.score !== null && r.score !== undefined) {
            line.append(el('span', 'fg-if-score', fill(t('if_ui_score'), r.score)));
        }
        box.append(line);
        const bar = el('div', 'fg-if-bar');
        bar.setAttribute('aria-hidden', 'true');
        const fillw = el('span', 'fg-if-bar-fill');
        fillw.style.width = Math.round(100 * (sum.detected + 0.5 * (sum.partial || 0)) / sum.total) + '%';
        bar.append(fillw);
        box.append(bar);
    }
    if (r.aisummary) {
        box.append(el('p', 'fg-if-aisum', r.aisummary));
    }
    const items = r.items || [];
    [group(t('if_ui_found'), items.filter(i => i.state === 'detected'), t),
        group(t('if_ui_checks'), items.filter(i => i.state === 'uncertain'), t),
        group(t('if_ui_suggestions'), items.filter(i => ['partial', 'missing', 'wrong'].includes(i.state)), t)]
        .filter(Boolean).forEach(g => box.append(g));
    if (r.uncertain) {
        box.append(el('p', 'fg-if-note', t('if_ui_uncertainnote')));
    }
    if ((r.warnings || []).length) {
        const sec = el('section', 'fg-if-group is-warn');
        sec.append(el('h4', 'fg-if-h', t('if_ui_warnings')));
        const ul = el('ul', 'fg-if-list');
        r.warnings.forEach(w => {
            const li = el('li', 'fg-if-item is-wrong');
            li.append(el('p', 'fg-if-msg', w.message));
            if (w.quote) {
                li.append(el('blockquote', 'fg-if-quote', w.quote));
            }
            ul.append(li);
        });
        sec.append(ul);
        box.append(sec);
    }
    if ((r.notices || []).length) {
        const ul = el('ul', 'fg-if-notices');
        r.notices.forEach(n => ul.append(el('li', 'fg-if-notice is-' + n.code, n.message)));
        box.append(ul);
    }
    if ((v.history || []).length > 1) {
        const det = el('details', 'fg-if-history');
        det.append(el('summary', '', t('if_ui_history')));
        const tbl = el('table', 'fg-if-hist generaltable');
        const tr = el('tr');
        tr.append(el('th', '', t('if_ui_attempt')), el('th', '', t('if_ui_detected')));
        const thead = el('thead');
        thead.append(tr);
        tbl.append(thead);
        const tb = el('tbody');
        v.history.forEach(h => {
            const row = el('tr');
            row.append(el('td', '', String(h.attemptno)), el('td', '', h.total ? h.detected + ' / ' + h.total :
                String(h.detected)));
            tb.append(row);
        });
        tbl.append(tb);
        det.append(tbl);
        box.append(det);
    }
    box.append(el('p', 'fg-if-disclaimer', r.disclaimer || t('if_disclaimer')));
    return box;
};
