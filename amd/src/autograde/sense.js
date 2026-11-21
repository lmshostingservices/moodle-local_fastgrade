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
 * Reading safeguards shared by auto-marking and Instant Feedback: negation ("do not…"), spelling
 * variants and slips, and checks on the answer as a whole (keyword lists, padding, copied question,
 * vague or hedged wording, missing reasons or examples, too few items). Plain rules, no AI.
 *
 * The server has an exact PHP copy (classes/local/instant/sense.php). Both are checked against the
 * same cases in tests/fixtures/engine_spec.json, so a change here must be made there too.
 *
 * @module     local_fastgrade/autograde/sense
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/** Words that turn what follows round. */
export const NEG = new Set(('not no never without cannot cant dont doesnt didnt wont wouldnt shouldnt mustnt isnt arent ' +
    'wasnt werent hasnt havent hadnt couldnt neither nor avoid avoids avoided avoiding ignore ignores ignored ignoring ' +
    'skip skips skipped skipping forget forgets forgot forgetting neglect neglects neglected neglecting omit omits omitted ' +
    'omitting fail fails failed failing lack lacks lacking refuse refuses refused refusing nobody nothing none instead ' +
    'rather').split(' '));

/** Words that end the reach of a negation. */
const BREAK = new Set('but however although though whereas while yet because since so then that which who unless except'
    .split(' '));

/** "X is not necessary": the negation reaches back to X. */
const NEEDWORDS = new Set('necessary needed need needs required important essential mandatory compulsory recommended'
    .split(' '));
const BACKNEG = new Set('unnecessary optional pointless irrelevant useless'.split(' '));
const COPULA = new Set('is are was were be been being isnt arent wasnt werent'.split(' '));

/** A negation reaches this many content words (and at most REACHMAX words in all). */
const REACH = 5;
const REACHMAX = 10;
const PRONOUN = new Set('i you we they he she it someone everyone workers people'.split(' '));

/**
 * Whether the word at i is a negation (and not "not only", "no matter", "rather" without "than").
 *
 * @param {Array} tk tokens
 * @param {number} i
 * @returns {boolean}
 */
const isNeg = (tk, i) => {
    const w = tk[i].w;
    if (!NEG.has(w)) {
        return false;
    }
    const next = tk[i + 1] ? tk[i + 1].w : '';
    if ((w === 'not' && (next === 'only' || next === 'just')) || (w === 'no' && next === 'matter')) {
        return false;
    }
    if (w === 'rather') {
        return next === 'than';
    }
    if (w === 'instead') {
        return next === 'of';
    }
    return true;
};

/**
 * Whether a clause ends between token a and token b.
 *
 * @param {string} text
 * @param {Object} a
 * @param {Object} b
 * @returns {boolean}
 */
const gapBreaks = (text, a, b) => /[,;:.!?()\n]/.test(text.slice(a.end, b.start)) || BREAK.has(b.w) ||
    (['and', 'or', 'then'].includes(a.w) && PRONOUN.has(b.w));

/**
 * Mark each token with neg (true when an odd number of negations reach it) and negword.
 * "Never forget to wear PPE" leaves "wear PPE" positive; "Do not wear PPE" makes it negative.
 *
 * @param {Array} tk tokens of one stretch of text (positions relative to text)
 * @param {string} text
 * @returns {Array} the same tokens
 */
export const markNegation = (tk, text) => {
    const count = tk.map(() => 0);
    tk.forEach((x, i) => {
        x.negword = isNeg(tk, i);
    });
    // Left to right: a negation reaches forward up to the next negation (which it turns round, so "never forget"
    // cancels out), and a negation that has been turned round reaches nothing.
    tk.forEach((x, i) => {
        if (!x.negword || count[i] % 2 === 1) {
            return;
        }
        let n = 0;
        for (let k = i + 1; k < tk.length && n < REACH && k - i <= REACHMAX; k++) {
            if (gapBreaks(text, tk[k - 1], tk[k])) {
                break;
            }
            count[k]++;
            if (tk[k].negword) {
                break;
            }
            if (!STOPISH.has(tk[k].w)) {
                n++;
            }
        }
    });
    // Reaching back: "PPE is not necessary", "PPE is optional".
    tk.forEach((x, i) => {
        let back = BACKNEG.has(x.w);
        if (!back && NEEDWORDS.has(x.w)) {
            for (let k = i - 1; k >= Math.max(0, i - 3); k--) {
                if (gapBreaks(text, tk[k], tk[k + 1])) {
                    break;
                }
                if (tk[k].negword) {
                    // Only "X is not necessary" reaches back to X; in "I do not need to…" the negation already reaches forward.
                    back = COPULA.has(tk[k].w) || (k > 0 && COPULA.has(tk[k - 1].w));
                    break;
                }
            }
        }
        if (!back) {
            return;
        }
        let n = 0;
        for (let k = i - 1; k >= 0 && n < REACH; k--) {
            if (gapBreaks(text, tk[k], tk[k + 1])) {
                break;
            }
            if (!tk[k].negword) {
                count[k]++;
                n++;
            }
        }
    });
    tk.forEach((x, i) => {
        x.neg = count[i] % 2 === 1;
    });
    return tk;
};

/* ---------- Spelling: UK and US forms, and small slips ---------- */

const OUR = ['colour', 'behaviour', 'labour', 'favour', 'honour', 'neighbour', 'harbour', 'rumour', 'humour', 'odour', 'vapour',
    'flavour', 'endeavour', 'saviour', 'armour', 'parlour', 'vigour', 'tumour', 'clamour', 'rigour', 'valour', 'ardour',
    'candour'];
const OURSUF = new Set(['', 's', 'ed', 'ing', 'ite', 'ites', 'able', 'ably', 'ful', 'less', 'hood', 'er', 'ers']);
const ISEKEEP = new Set(('advise advertise apprise arise chastise comprise compromise demise despise devise disguise enterprise ' +
    'excise exercise expertise franchise improvise incise merchandise premise promise revise supervise surmise surprise ' +
    'televise treatise wise rise raise noise praise poise cruise bruise concise precise paradise otherwise likewise clockwise ' +
    'circumcise anise valise reprise').split(' '));
const WORDS = {programme: 'program', programmes: 'programs', aluminium: 'aluminum', mould: 'mold', moulds: 'molds',
    plough: 'plow', grey: 'gray', judgement: 'judgment', judgements: 'judgments', ageing: 'aging', enrolment: 'enrollment',
    enrolments: 'enrollments', fulfil: 'fulfill', fulfilment: 'fulfillment', skilful: 'skillful', instalment: 'installment',
    kerb: 'curb', tyre: 'tire', tyres: 'tires', cheque: 'check', cheques: 'checks', sceptical: 'skeptical', practise: 'practice',
    practised: 'practiced', practising: 'practicing', licence: 'license', licences: 'licenses', defence: 'defense',
    offence: 'offense', offences: 'offenses', pretence: 'pretense', manoeuvre: 'maneuver', manoeuvres: 'maneuvers',
    oedema: 'edema', diarrhoea: 'diarrhea', oestrogen: 'estrogen', oesophagus: 'esophagus', storey: 'story', storeys: 'stories'};

/**
 * One spelling for words spelt differently in UK and US English (colour/color, centre/center, organise/organize).
 *
 * @param {string} w lower-case word
 * @returns {string}
 */
export const fold = w => {
    if (WORDS[w]) {
        return WORDS[w];
    }
    for (const base of OUR) {
        if (w.startsWith(base) && OURSUF.has(w.slice(base.length))) {
            return base.slice(0, -3) + 'or' + w.slice(base.length);
        }
    }
    let m = w.match(/^(cent|met|lit|fib|theat|kilomet|centimet|millimet|calib|lust|somb|spect|sab|meag)re(s|d)?$/);
    if (m) {
        return m[1] + 'er' + (m[2] === 'd' ? 'ed' : (m[2] || ''));
    }
    m = w.match(/^(\w*?)(anal|paral|catal|electrol|hydrol)ys(e|es|ed|ing|er|ers)$/);
    if (m) {
        return m[1] + m[2] + 'yz' + m[3];
    }
    m = w.match(/^(catal|dial|anal|prol|epil|monol)ogue(s)?$/);
    if (m) {
        return m[1] + 'og' + (m[2] || '');
    }
    m = w.match(/^(\w*?)(paed|anaes|haem|orthopaed|leukaem|gynaec|faec|caes)(\w*)$/);
    if (m) {
        return m[1] + m[2].replace('ae', 'e') + m[3];
    }
    m = w.match(/^(\w{3,}?)is(e|es|ed|ing|er|ers|ation|ations|able)$/);
    if (m && !ISEKEEP.has(m[1] + 'ise') && !/^(\w*)(cis|vis|mis|pris|wis|nois|rais)$/.test(m[1] + 'is')) {
        return m[1] + 'iz' + m[2];
    }
    return w;
};

/**
 * Restricted edit distance (one swap of neighbouring letters counts as one edit).
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export const distance = (a, b) => {
    const d = [];
    for (let i = 0; i <= a.length; i++) {
        d[i] = [i];
    }
    for (let j = 0; j <= b.length; j++) {
        d[0][j] = j;
    }
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
            if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
                d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
            }
        }
    }
    return d[a.length][b.length];
};

/**
 * Whether a written word is a likely misspelling of an expected word. Strict on purpose: only words of
 * seven letters or more, the same first two letters, one slip (two for ten letters or more).
 *
 * @param {string} written
 * @param {string} expected
 * @returns {boolean}
 */
export const slip = (written, expected) => {
    if (written === expected || written.length < 7 || expected.length < 7 || /\d/.test(written + expected)) {
        return false;
    }
    if (written.slice(0, 2) !== expected.slice(0, 2) || Math.abs(written.length - expected.length) > 2) {
        return false;
    }
    const long = Math.min(written.length, expected.length) >= 10;
    if (distance(written, expected) > (long ? 2 : 1)) {
        return false;
    }
    if (long || written.length !== expected.length) {
        return true;
    }
    // Same length and shorter than ten letters: only two letters swapped, never one letter changed
    // ("conduit" is a different word from "conduct").
    const diff = [...written].map((ch, i) => (ch === expected[i] ? -1 : i)).filter(i => i >= 0);
    return diff.length === 2 && diff[1] === diff[0] + 1;
};

/**
 * Whether a token matches one term of a phrase: same stem, or a spelling slip.
 *
 * @param {Object} tok {w, s}
 * @param {Object|string} term {w, s} or a stem
 * @returns {number} 0 no, 1 exact, 2 spelling slip
 */
export const termMatch = (tok, term) => {
    if (typeof term === 'string') {
        return tok.s === term ? 1 : 0;
    }
    if (tok.s === term.s) {
        return 1;
    }
    return slip(tok.w, term.w) ? 2 : 0;
};

/* ---------- The answer as a whole ---------- */

const NUMWORDS = {two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, both: 2};
const ITEMWORDS = '(?:ways?|precautions?|steps?|hazards?|risks?|reasons?|examples?|controls?|methods?|factors?|types?|items?|' +
    'points?|things?|benefits?|advantages?|disadvantages?|strategies|strategy|measures?|signs?|symptoms?|causes?|effects?|' +
    'responsibilities|duties|requirements?|features?|principles?|stages?|actions?|questions?|differences?|tools?|' +
    'pieces?|sources?|options?|techniques?|skills?|elements?|components?|parts?|key|main|different|common|important|' +
    'possible|safety|specific|workplace|legal|potential)';
const words = list => new RegExp('\\b(' + list.join('|') + ')\\b', 'i');
const REASON = words(['because', 'so that', 'so as to', 'in order to',
    'to (?:prevent|avoid|stop|ensure|reduce|protect|keep|make sure|minimi[sz]e|lower|limit|control|eliminate)',
    'therefore', 'as a result', 'which means', 'this means', 'that means', 'this is why', 'since', 'due to', 'otherwise',
    'leads? to', 'results? in', 'causes?', 'so (?:the|that|it|you|they|we|workers|people|there)', 'reason', 'why', 'helps?',
    'allows?', 'enables?']);
const EXAMPLE = words(['for example', 'for instance', 'e\\.?g\\.?', 'such as', 'example', 'an instance', 'like when',
    'including', 'such a', 'i\\.?e\\.?', 'case', 'when i', 'once i', 'at my', 'in my']);
const VAGUE = new RegExp(words(['be careful', 'be safe', 'stay safe', 'take care', 'stuff', 'things like that', 'and so on',
    'etc\\.?', 'whatever', 'something like', 'and stuff', 'you know', 'all that', 'common sense', 'use common sense',
    'do the right thing', 'be aware', 'watch out']).source, 'gi');
const HEDGE = new RegExp(words(['i think', 'i guess', 'i suppose', 'maybe', 'perhaps', 'not sure', 'unsure', "i don'?t know",
    'dont know', 'idk', 'i believe', 'probably', 'might be', "i'?m not certain", 'no idea']).source, 'gi');
const TEXTSPEAK = new Set(('u ur cos coz cuz gonna wanna gotta lol idk thx pls plz b4 ppl bc tho dunno kinda sorta ya nah ' +
    'yep imo tbh btw omg').split(' '));
const STOPISH = new Set(('a an the and or but if of to in on at by for with from as is are was were be been being it its this ' +
    'that these those there their they them he she his her we our you your i me my not no do does did can could should would ' +
    'will shall may might must have has had so such than then also into about over under more most other some any each ' +
    'which who whom what when where why how all both either neither').split(' '));

/**
 * How many items a question asks for ("three precautions", "2 reasons"), or 0.
 *
 * @param {string} question
 * @returns {number}
 */
export const askedCount = question => {
    const re = new RegExp('\\b(two|three|four|five|six|seven|eight|nine|ten|both|[2-9]|10)\\s+(?:\\w+\\s+){0,2}?' + ITEMWORDS +
        '\\b', 'i');
    const m = String(question || '').match(re);
    if (!m) {
        return 0;
    }
    const v = m[1].toLowerCase();
    return NUMWORDS[v] || parseInt(v, 10) || 0;
};

/**
 * What a question asks for beyond its content: reasons, examples, a count.
 *
 * @param {string} question
 * @returns {Object} {reasons, example, count}
 */
export const asks = question => {
    const q = String(question || '');
    return {
        reasons: words(['explain', 'why', 'justify', 'discuss', 'describe how', 'how (?:does|do|would|can|could|should)',
            'reasons?', 'evaluate', 'analy[sz]e', 'outline why']).test(q),
        example: /\b(example|examples|e\.g\.|for instance|give an instance|illustrate)\b/i.test(q),
        count: askedCount(q),
    };
};

/**
 * Whether a word looks like random typing.
 *
 * @param {string} w
 * @returns {boolean}
 */
const junk = w => w.length >= 4 && !/\d/.test(w) && (!/[aeiouy]/.test(w) || /[^aeiouy]{5,}/.test(w) || /(.)\1\1/.test(w));

/**
 * Checks on the answer as a whole. Each issue has a code, a level (warn: likely a real problem;
 * info: worth a look; review: the rules cannot judge this answer) and details for the message.
 *
 * @param {string} text the answer
 * @param {Object} opts {tokens, sentences, question, template, topic (words of the criteria), items (ideas found)}
 * @returns {Object} {issues: [{code, level, detail}], words, effectivewords, dupsentences, listy}
 */
export const analyse = (text, opts) => {
    const o = opts || {};
    const tk = o.tokens || [];
    const sents = o.sentences || [];
    const issues = [];
    const add = (code, level, detail) => issues.push({code, level, detail: detail === undefined ? '' : String(detail)});
    const words = tk.length;
    if (!words) {
        add('empty', 'review');
        return {issues, words: 0, effectivewords: 0, dupsentences: 0, listy: false};
    }
    // Random typing or the same word over and over.
    const junkn = tk.filter(x => junk(x.w)).length;
    const distinct = new Set(tk.map(x => x.s)).size;
    if ((words >= 3 && junkn / words > 0.35) || (words >= 8 && distinct / words < 0.25)) {
        add('gibberish', 'review');
    }
    // A list of key words with nothing joining them.
    const stopn = tk.filter(x => STOPISH.has(x.w)).length;
    const listy = words >= 4 && stopn / words < 0.12;
    if (listy) {
        add('keywords', 'warn');
    }
    // The same sentence more than once (padding).
    const seen = [];
    let dupwords = 0;
    let dups = 0;
    sents.forEach(s => {
        const set = new Set((s.tk || []).filter(x => !STOPISH.has(x.w)).map(x => x.s));
        if (set.size < 3) {
            return;
        }
        const twin = seen.find(p => {
            let inter = 0;
            set.forEach(x => {
                if (p.has(x)) {
                    inter++;
                }
            });
            return inter / (set.size + p.size - inter) >= 0.85;
        });
        if (twin) {
            dups++;
            dupwords += (s.tk || []).length;
        } else {
            seen.push(set);
        }
    });
    if (dups && dupwords >= 6) {
        add('repeat', 'warn', dups);
    }
    // Content words: the answer's own, and how many come from the question or the template.
    const content = x => !STOPISH.has(x.w) && x.w.length > 2 && !/^\d+$/.test(x.w);
    const mine = new Set(tk.filter(content).map(x => x.s));
    const qset = new Set((o.questiontokens || []).filter(content).map(x => x.s));
    const tset = new Set((o.templatetokens || []).filter(content).map(x => x.s));
    const fresh = [...mine].filter(x => !qset.has(x) && !tset.has(x));
    if (tset.size && mine.size && [...mine].filter(x => !tset.has(x)).length <= 2) {
        add('template', 'warn');
    } else if (qset.size >= 4 && mine.size >= 4 && (fresh.length <= 1 || fresh.length / mine.size < 0.2)) {
        add('copied', 'warn');
    }
    // Nothing in common with the question or the criteria.
    const topic = new Set([...qset, ...(o.topic || [])]);
    if (topic.size >= 3 && words >= 12 && !(o.items > 0)) {
        const shared = [...mine].filter(x => topic.has(x)).length;
        if (shared / Math.max(1, mine.size) < 0.08) {
            add('offtopic', 'review');
        }
    }
    const want = asks(o.question || '');
    if (want.reasons && words >= 6 && !REASON.test(text)) {
        add('noreason', 'warn');
    }
    if (want.example && words >= 6 && !EXAMPLE.test(text)) {
        add('noexample', 'warn');
    }
    if (want.count && typeof o.items === 'number' && o.items > 0 && o.items < want.count) {
        add('count', 'warn', o.items + '/' + want.count);
    }
    const vague = [...new Set((text.match(VAGUE) || []).map(x => x.toLowerCase()))];
    if (vague.length && (vague.length >= 2 || words < 40)) {
        add('vague', 'info', vague.slice(0, 4).join(', '));
    }
    const hedge = [...new Set((text.match(HEDGE) || []).map(x => x.toLowerCase()))];
    if (hedge.some(x => /know|idk|sure|idea|certain/.test(x)) || hedge.length >= 2) {
        add('hedge', 'info', hedge.slice(0, 3).join(', '));
    }
    const slang = [...new Set(tk.filter(x => TEXTSPEAK.has(x.w)).map(x => x.w))];
    if (slang.length) {
        add('textspeak', 'info', slang.slice(0, 5).join(', '));
    }
    // When the answer as a whole cannot be judged, the finer checks would only add noise.
    const blocking = issues.some(i => ['gibberish', 'template', 'copied', 'offtopic'].includes(i.code));
    const out = blocking ? issues.filter(i => !['keywords', 'noreason', 'noexample', 'count', 'vague'].includes(i.code)) :
        issues;
    return {issues: out, words, effectivewords: words - dupwords, dupsentences: dups, listy};
};

/* ---------- Values and order ---------- */

/**
 * Numbers in a text with the word after them, for value checks ("240 volts", "1.5 m", "2 metres").
 *
 * @param {string} text
 * @returns {Array} [{n, unit, start, end}]
 */
export const numbers = text => {
    const out = [];
    const re = /(-?\d+(?:[.,]\d+)?)\s?(%|°c|°f|[a-zμ°]+)?/giu;
    let m;
    while ((m = re.exec(text))) {
        const before = text.slice(Math.max(0, m.index - 1), m.index);
        if (/[\p{L}]/u.test(before)) {
            continue;
        }
        out.push({n: parseFloat(m[1].replace(',', '.')), unit: (m[2] || '').toLowerCase(), start: m.index,
            end: m.index + m[0].length});
    }
    return out;
};
