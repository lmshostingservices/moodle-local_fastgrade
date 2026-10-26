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
 * One-click dictation into any text box. Every text box in Fast Grade gets a mic.
 *
 * @module     local_fastgrade/voice/dictate
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import * as Speech from 'local_fastgrade/voice/speech';
import * as Dialog from 'local_fastgrade/ui/dialog';
import {toast} from 'local_fastgrade/ui/toast';
import {tip} from 'local_fastgrade/ui/tooltip';

let active = null;
let savePref = null;

/**
 * Tell the module how to remember the cloud notice.
 *
 * @param {Function} fn (key, value) => void
 */
export const setPrefSaver = fn => {
    savePref = fn;
};

/**
 * Whether dictation is running.
 *
 * @returns {boolean}
 */
export const isActive = () => !!active;

/**
 * Stop any running dictation.
 */
export const stopAll = () => {
    if (active) {
        active.session.stop('user');
    }
};

/**
 * Read the field's text.
 *
 * @param {HTMLElement} el
 * @returns {string}
 */
const getText = el => (el.isContentEditable ? el.innerText : el.value) || '';

/**
 * Insert text at the caret (or the end).
 *
 * @param {HTMLElement} el
 * @param {string} text
 */
const insertText = (el, text) => {
    if (!text) {
        return;
    }
    if (el.isContentEditable) {
        el.focus();
        const sel = window.getSelection();
        const inside = sel.rangeCount && el.contains(sel.getRangeAt(0).commonAncestorContainer);
        if (!inside) {
            const r = document.createRange();
            r.selectNodeContents(el);
            r.collapse(false);
            sel.removeAllRanges();
            sel.addRange(r);
        }
        const parts = text.split('\n');
        parts.forEach((p, i) => {
            if (i > 0) {
                document.execCommand('insertLineBreak');
            }
            if (p) {
                document.execCommand('insertText', false, p);
            }
        });
    } else {
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        el.value = el.value.slice(0, start) + text + el.value.slice(end);
        const pos = start + text.length;
        el.setSelectionRange(pos, pos);
    }
    el.dispatchEvent(new Event('input', {bubbles: true}));
};

/**
 * Text before the caret, for capitalisation.
 *
 * @param {HTMLElement} el
 * @returns {string}
 */
const textBefore = el => {
    if (el.isContentEditable) {
        return getText(el);
    }
    return el.value.slice(0, el.selectionStart ?? el.value.length);
};

/**
 * Explain why speech is not available, and offer what can be done.
 *
 * @param {Object} st probe result
 * @returns {Promise<boolean>} whether it is now ready
 */
const resolveState = async st => {
    if (st.state === 'ready') {
        return true;
    }
    if (st.state === 'needs-install') {
        return new Promise(resolve => {
            Dialog.open({
                title: t('speech_install_title'),
                body: h('div', null, h('p', null, t('speech_install_body', st.lang)),
                    h('p.fg-muted', null, t('speech_private_note'))),
                actions: [
                    {label: t('cancel'), onclick: () => resolve(false)},
                    {label: t('speech_install_btn'), primary: true, onclick: () => {
                        toast(t('speech_installing'), {type: 'info'});
                        Speech.install().then(ok => {
                            toast(ok ? t('speech_installed') : t('speech_installfailed'), {type: ok ? 'ok' : 'error'});
                            resolve(ok);
                        });
                    }},
                ],
            });
        });
    }
    if (st.state === 'needs-cloud-ack') {
        return new Promise(resolve => {
            Dialog.open({
                title: t('speech_cloud_title'),
                body: h('div', null, h('p', null, t('speech_cloud_body')), h('p.fg-muted', null, t('speech_cloud_body2'))),
                actions: [
                    {label: t('cancel'), onclick: () => resolve(false)},
                    {label: t('speech_cloud_accept'), primary: true, onclick: () => {
                        Speech.acknowledgeCloud();
                        if (savePref) {
                            savePref('cloudnotice', true);
                        }
                        resolve(true);
                    }},
                ],
            });
        });
    }
    if (st.state === 'off') {
        toast(t('speech_off'), {type: 'info'});
        return false;
    }
    const reason = st.reason === 'insecure' ? t('speech_insecure') :
        (st.reason === 'noondevice' ? t('speech_noondevice') : t('speech_nobrowser'));
    Dialog.open({
        title: t('speech_unavailable_title'),
        body: h('div', null, h('p', null, reason), h('p.fg-muted', null, t('speech_os_hint'))),
        actions: [{label: t('ok'), primary: true}],
    });
    return false;
};

/**
 * Start dictating into a field.
 *
 * @param {HTMLElement} field textarea or contenteditable
 * @param {Object} opts {button, polarity, onStop({seconds, provider, text})}
 * @returns {Promise<boolean>}
 */
export const startInto = async(field, opts = {}) => {
    if (active) {
        const same = active.field === field;
        active.session.stop('user');
        if (same) {
            return false;
        }
    }
    let st = await Speech.probe();
    if (st.state !== 'ready') {
        const ok = await resolveState(st);
        if (!ok) {
            return false;
        }
        st = await Speech.probe();
        if (st.state !== 'ready') {
            return false;
        }
    }
    const host = field.closest('.fg-dictate-host') || field.parentNode;
    const chip = h('div.fg-interim', {'aria-live': 'polite'},
        h('span.fg-bars', {'aria-hidden': 'true'}, h('i'), h('i'), h('i'), h('i')),
        h('span.fg-interim-text', null, t('listening')),
        h('kbd', null, 'Esc'));
    host.classList.add('is-listening');
    host.appendChild(chip);
    if (opts.button) {
        opts.button.classList.add('is-recording');
        opts.button.setAttribute('aria-pressed', 'true');
    }
    let added = '';
    let lastSegment = '';
    const onkey = e => {
        if (e.key === 'Escape' && active) {
            e.preventDefault();
            e.stopPropagation();
            active.session.stop('user');
        }
    };
    document.addEventListener('keydown', onkey, true);
    try {
        const session = await Speech.start({
            onInterim: text => {
                chip.querySelector('.fg-interim-text').textContent = text || t('listening');
            },
            onFinal: text => {
                if (/^\s*scratch that\s*$/i.test(text)) {
                    if (lastSegment) {
                        const cur = getText(field);
                        if (!field.isContentEditable && cur.endsWith(lastSegment)) {
                            field.value = cur.slice(0, cur.length - lastSegment.length);
                            field.dispatchEvent(new Event('input', {bubbles: true}));
                            added = added.slice(0, Math.max(0, added.length - lastSegment.length));
                        }
                        lastSegment = '';
                    }
                    return;
                }
                const clean = Speech.tidy(text, textBefore(field));
                insertText(field, clean);
                added += clean;
                lastSegment = clean;
            },
            onEnd: reason => {
                document.removeEventListener('keydown', onkey, true);
                chip.remove();
                host.classList.remove('is-listening');
                if (opts.button) {
                    opts.button.classList.remove('is-recording');
                    opts.button.setAttribute('aria-pressed', 'false');
                }
                const info = {seconds: session.seconds(), provider: session.provider, text: added.trim(), reason};
                active = null;
                field.focus();
                if (opts.onStop) {
                    opts.onStop(info);
                }
            },
            onError: code => {
                const msg = {
                    'not-allowed': t('speech_err_denied'),
                    'service-not-allowed': t('speech_err_denied'),
                    'audio-capture': t('speech_err_nomic'),
                    'network': t('speech_err_network'),
                    'language-not-supported': t('speech_err_lang'),
                }[code] || t('speech_err_generic', code);
                toast(msg, {type: 'error'});
            },
        });
        active = {session, field};
        return true;
    } catch (e) {
        document.removeEventListener('keydown', onkey, true);
        chip.remove();
        host.classList.remove('is-listening');
        if (opts.button) {
            opts.button.classList.remove('is-recording');
        }
        toast(t('speech_err_generic', e.message), {type: 'error'});
        return false;
    }
};

/**
 * A mic button for a field.
 *
 * @param {HTMLElement} field
 * @param {Object} opts {polarity: 'improvement'|'positive'|'neutral', label, key, onStop, small}
 * @returns {HTMLElement|null}
 */
export const micButton = (field, opts = {}) => {
    if (!Speech.present()) {
        return null;
    }
    const pol = opts.polarity || 'neutral';
    const btn = h('button.fg-mic', {type: 'button', "class": 'is-' + pol + (opts.small ? ' is-small' : ''),
        'aria-pressed': 'false'}, icon('mic'));
    tip(btn, opts.label || t('dictate_tip'), opts.key || '');
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => {
        startInto(field, {button: btn, polarity: pol, onStop: opts.onStop});
    });
    return btn;
};
