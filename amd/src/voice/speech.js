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
 * Speech to text. Uses the browser's speech recognition, on the computer itself by default
 * (processLocally); the browser's cloud service only when the site administrator allows it and the
 * marker has acknowledged the notice. Nothing here generates text: it only transcribes what was said.
 *
 * @module     local_fastgrade/voice/speech
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;

let settings = {mode: 'ondevice', lang: 'en-AU', phrases: [], silencesecs: 8};
let cloudAcknowledged = false;
let status = null;

/**
 * Configure.
 *
 * @param {Object} s settings from the server
 * @param {boolean} cloudack whether the marker accepted the cloud notice
 * @param {string} userlang marker's language override
 */
export const configure = (s, cloudack, userlang) => {
    settings = Object.assign({}, settings, s || {});
    if (userlang) {
        settings.lang = userlang;
    }
    cloudAcknowledged = !!cloudack;
    status = null;
};

/**
 * Current language.
 *
 * @returns {string}
 */
export const lang = () => settings.lang;

/**
 * Mark the cloud notice as accepted.
 */
export const acknowledgeCloud = () => {
    cloudAcknowledged = true;
    status = null;
};

/**
 * Work out what is possible here.
 *
 * @returns {Promise<Object>} {state: 'ready'|'needs-install'|'needs-cloud-ack'|'unsupported'|'off', provider}
 */
export const probe = async() => {
    if (status) {
        return status;
    }
    if (settings.mode === 'off') {
        status = {state: 'off', provider: ''};
        return status;
    }
    if (!SR || !window.isSecureContext) {
        status = {state: 'unsupported', provider: '', reason: !window.isSecureContext ? 'insecure' : 'nobrowser'};
        return status;
    }
    let local = 'unavailable';
    if (typeof SR.available === 'function') {
        try {
            local = await SR.available({langs: [settings.lang], processLocally: true});
        } catch (e) {
            local = 'unavailable';
        }
        if (local === 'unavailable' && settings.lang !== 'en-US' && settings.lang.startsWith('en')) {
            // Fall back to another English model on the device, still private.
            try {
                const us = await SR.available({langs: ['en-US'], processLocally: true});
                if (us !== 'unavailable') {
                    status = {state: us === 'available' ? 'ready' : 'needs-install', provider: 'ondevice',
                        lang: 'en-US', fallbacklang: true};
                    return status;
                }
            } catch (e) {
                // Ignore.
            }
        }
    }
    if (local === 'available') {
        status = {state: 'ready', provider: 'ondevice', lang: settings.lang};
    } else if (local === 'downloadable' || local === 'downloading') {
        status = {state: 'needs-install', provider: 'ondevice', lang: settings.lang};
    } else if (settings.mode === 'browser') {
        status = cloudAcknowledged ? {state: 'ready', provider: 'cloud', lang: settings.lang} :
            {state: 'needs-cloud-ack', provider: 'cloud', lang: settings.lang};
    } else {
        status = {state: 'unsupported', provider: '', reason: 'noondevice'};
    }
    return status;
};

/**
 * Download the on-device language pack.
 *
 * @returns {Promise<boolean>}
 */
export const install = async() => {
    const st = await probe();
    if (typeof SR.install !== 'function') {
        return false;
    }
    try {
        const ok = await SR.install({langs: [st.lang || settings.lang], processLocally: true});
        status = null;
        return !!ok;
    } catch (e) {
        return false;
    }
};

const COMMANDS = [
    [/\s*\b(full stop|period)\b/gi, '.'],
    [/\s*\bcomma\b/gi, ','],
    [/\s*\bquestion mark\b/gi, '?'],
    [/\s*\b(exclamation mark|exclamation point)\b/gi, '!'],
    [/\s*\bsemicolon\b/gi, ';'],
    [/\s*\bcolon\b/gi, ':'],
    [/\s*\bnew paragraph\b\s*/gi, '\n\n'],
    [/\s*\bnew line\b\s*/gi, '\n'],
    [/\bopen (bracket|parenthesis)\s*/gi, '('],
    [/\s*\bclose (bracket|parenthesis)\b/gi, ')'],
    [/\s+\bdash\b\s+/gi, ' – '],
];

const AU = [['organize', 'organise'], ['organization', 'organisation'], ['behavior', 'behaviour'], ['color', 'colour'],
    ['center', 'centre'], ['analyze', 'analyse'], ['recognize', 'recognise'], ['realize', 'realise'],
    ['favorite', 'favourite'], ['honor', 'honour'], ['labor', 'labour'],
    ['defense', 'defence'], ['judgment', 'judgement'],
    ['emphasize', 'emphasise'], ['summarize', 'summarise'], ['prioritize', 'prioritise'], ['utilize', 'utilise']];

/**
 * Turn spoken words into tidy text: spoken punctuation, capitals, local spelling.
 *
 * @param {string} raw
 * @param {string} before text already in the field (to know about capitals)
 * @returns {string}
 */
export const tidy = (raw, before = '') => {
    let out = ' ' + raw.trim();
    COMMANDS.forEach(([re, rep]) => {
        out = out.replace(re, rep);
    });
    out = out.replace(/\s+([.,;:?!)])/g, '$1').replace(/[ \t]{2,}/g, ' ');
    if (/^(en-AU|en-GB|en-ZA|en-NZ|en-IE)$/.test(settings.lang) || settings.lang === 'en') {
        AU.forEach(([us, uk]) => {
            out = out.replace(new RegExp('\\b' + us, 'gi'), m => (m[0] === m[0].toUpperCase() ?
                uk[0].toUpperCase() + uk.slice(1) : uk));
        });
    }
    out = out.replace(/\bi\b/g, 'I');
    const prev = before.replace(/\s+$/, '');
    const startSentence = prev === '' || /[.?!\n]$/.test(prev);
    out = out.replace(/^\s*/, '');
    if (startSentence) {
        out = out.charAt(0).toUpperCase() + out.slice(1);
    }
    out = out.replace(/([.?!]\s+|\n)([a-z])/g, (m, a, b) => a + b.toUpperCase());
    const needsSpace = prev !== '' && !/[\s(]$/.test(before) && !/^[.,;:?!)\n]/.test(out);
    return (needsSpace ? ' ' : '') + out;
};

/**
 * Start listening.
 *
 * @param {Object} cb {onInterim(text), onFinal(text), onEnd(reason), onError(code)}
 * @returns {Promise<Object>} session with stop()
 */
export const start = async cb => {
    const st = await probe();
    if (st.state !== 'ready') {
        throw new Error(st.state);
    }
    let stopped = false;
    let rec = null;
    let silence = null;
    const started = Date.now();
    const armSilence = () => {
        clearTimeout(silence);
        silence = setTimeout(() => session.stop('silence'), (settings.silencesecs || 8) * 1000);
    };
    const make = () => {
        rec = new SR();
        rec.lang = st.lang || settings.lang;
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        if (st.provider === 'ondevice' && 'processLocally' in rec) {
            rec.processLocally = true;
        }
        if (settings.phrases && settings.phrases.length && 'phrases' in rec && window.SpeechRecognitionPhrase) {
            try {
                rec.phrases = settings.phrases.map(p => new window.SpeechRecognitionPhrase(p, 3.0));
            } catch (e) {
                // Biasing is optional.
            }
        }
        rec.onresult = ev => {
            armSilence();
            let interim = '';
            for (let i = ev.resultIndex; i < ev.results.length; i++) {
                const r = ev.results[i];
                if (r.isFinal) {
                    cb.onFinal(r[0].transcript);
                } else {
                    interim += r[0].transcript;
                }
            }
            cb.onInterim(interim);
        };
        rec.onerror = ev => {
            if (ev.error === 'no-speech' || ev.error === 'aborted') {
                return;
            }
            stopped = true;
            clearTimeout(silence);
            cb.onError(ev.error);
        };
        rec.onend = () => {
            if (!stopped) {
                // Cloud recognition ends by itself after a while; carry on until the marker stops.
                try {
                    make();
                    rec.start();
                    return;
                } catch (e) {
                    stopped = true;
                }
            }
            clearTimeout(silence);
            cb.onInterim('');
            cb.onEnd(session.reason || 'stopped');
        };
    };
    const session = {
        provider: st.provider,
        reason: '',
        seconds: () => Math.round((Date.now() - started) / 1000),
        stop: (reason = 'stopped') => {
            if (stopped) {
                return;
            }
            stopped = true;
            session.reason = reason;
            clearTimeout(silence);
            try {
                rec.stop();
            } catch (e) {
                cb.onEnd(reason);
            }
        },
    };
    make();
    rec.start();
    armSilence();
    return session;
};

/**
 * Whether speech can work at all in this browser (for showing mic buttons).
 *
 * @returns {boolean}
 */
export const present = () => settings.mode !== 'off' && !!SR && !(status && status.state === 'unsupported');
