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
 * "Check my answer" for students: on a quiz essay question, on an assignment's online text while it is
 * being written, or on the assignment page after submitting. The answer is checked on the server; this
 * script never sees what is being looked for. Checking does not save or submit anything.
 *
 * @module     local_fastgrade/instant/student
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import Ajax from 'core/ajax';
import {el, fill, result} from 'local_fastgrade/instant/render';

/**
 * Turn editor HTML into plain text, keeping a line break between paragraphs, so only text is sent.
 *
 * @param {String} html
 * @return {String}
 */
const plainText = html => {
    if (!/<[a-z!/][^>]*>/i.test(html || '')) {
        return html || '';
    }
    const marked = String(html).replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, '$&\n');
    const doc = new DOMParser().parseFromString(marked, 'text/html');
    return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
};

/**
 * The answer as typed: from TinyMCE if it is in use, otherwise the text area.
 *
 * @param {HTMLTextAreaElement} ta
 * @returns {Promise<string>}
 */
const answerOf = async ta => {
    if (!ta) {
        return '';
    }
    try {
        const tiny = await import('editor_tiny/editor');
        const ed = tiny.getInstanceForElementId ? tiny.getInstanceForElementId(ta.id) : null;
        if (ed) {
            return ed.getContent();
        }
    } catch (e) {
        // TinyMCE is not in use on this site or this field.
    }
    if (window.tinyMCE && window.tinyMCE.get && window.tinyMCE.get(ta.id)) {
        return window.tinyMCE.get(ta.id).getContent();
    }
    return ta.value;
};

/**
 * Where to put the panel, and the field holding the answer.
 *
 * @param {Object} args
 * @param {Object} target
 * @returns {Object|null} {after, field}
 */
const place = (args, target) => {
    if (args.kind === 'quiz') {
        const q = document.getElementById('question-' + target.usageid + '-' + target.slot);
        if (!q) {
            return null;
        }
        const field = q.querySelector('textarea[name$="_answer"]');
        const after = q.querySelector('.answer') || q.querySelector('.ablock') || q.querySelector('.formulation');
        return after ? {after, field} : null;
    }
    if (target.source === 'draft') {
        const field = document.getElementById('id_onlinetext_editor');
        const after = document.getElementById('fitem_id_onlinetext_editor') || (field && field.closest('.form-group'));
        return after ? {after, field} : null;
    }
    const after = document.querySelector('.submissionstatustable') || document.querySelector('[role="main"] .box') ||
        document.querySelector('[role="main"]');
    return after ? {after, field: null, before: !!document.querySelector('.submissionstatustable')} : null;
};

/**
 * Set up one panel.
 *
 * @param {Object} args
 * @param {Object} target
 * @param {Function} t
 */
const panel = (args, target, t) => {
    const where = place(args, target);
    if (!where) {
        return;
    }
    const wrap = el('div', 'fg-if');
    const bar = el('div', 'fg-if-actions');
    const label = target.source === 'submitted' ? t('if_ui_checksubmitted') : t('if_ui_check');
    const btn = el('button', 'btn btn-outline-primary fg-if-btn', label);
    btn.type = 'button';
    const left = el('span', 'fg-if-left');
    bar.append(btn, left);
    const out = el('div', 'fg-if-out');
    out.setAttribute('aria-live', 'polite');
    out.setAttribute('role', 'status');
    wrap.append(bar, out);
    if (where.before) {
        where.after.parentNode.insertBefore(wrap, where.after);
    } else {
        where.after.parentNode.insertBefore(wrap, where.after.nextSibling);
    }

    const showLeft = view => {
        if (view.attemptsleft === null || view.attemptsleft === undefined) {
            left.textContent = '';
        } else if (view.attemptsleft === 0) {
            left.textContent = t('if_ui_nomore');
        } else {
            left.textContent = view.attemptsleft === 1 ? t('if_ui_leftone') : fill(t('if_ui_left'), view.attemptsleft);
        }
        btn.disabled = view.attemptsleft === 0 || (view.canretry === false && view.attemptno > 0);
    };
    const show = view => {
        out.replaceChildren();
        if (view.result && view.result.status) {
            out.append(result(view.result, view, t));
            if (view.repeat && view.attemptno) {
                out.prepend(el('p', 'fg-if-repeat', view.limitreached ? t('if_ui_nomore') : t('if_ui_repeat')));
            }
        }
        showLeft(view);
    };
    const call = (action, response) => Ajax.call([{methodname: 'local_fastgrade_instant_check', args: {
        cmid: args.cmid, action, attemptid: target.attemptid || 0, slot: target.slot || 0,
        source: target.source || 'draft', response: response || ''}}])[0].then(r => JSON.parse(r.json));

    btn.addEventListener('click', async() => {
        if (btn.disabled) {
            return;
        }
        btn.disabled = true;
        btn.textContent = t('if_ui_checking');
        try {
            const text = target.source === 'submitted' ? '' : plainText(await answerOf(where.field));
            show(await call('check', text));
        } catch (e) {
            out.replaceChildren(el('p', 'fg-if-error alert alert-warning', (e && e.message) || t('if_ui_error')));
            btn.disabled = false;
        }
        btn.textContent = label;
    });
    call('state').then(view => {
        showLeft(view);
        if (view.hasresult && view.result && view.result.status) {
            show(view);
        }
        return view;
    }).catch(() => {
        // The panel still works; the count shows after the first check.
    });
};

/**
 * Start.
 *
 * @param {string} selector the page's data: {cmid, kind, targets, strings}
 */
export const init = selector => {
    const node = document.querySelector(selector);
    if (!node) {
        return;
    }
    const args = JSON.parse(node.textContent);
    const t = k => (args.strings && args.strings[k]) || k;
    (args.targets || []).forEach(target => panel(args, target, t));
};
