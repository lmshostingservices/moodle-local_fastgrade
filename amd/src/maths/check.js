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
 * Maths working checks: reads typed working one line at a time and decides, with exact evaluation and root
 * finding (computer algebra, no AI), whether each line follows from the line before.
 *
 * The parsing is done by the Compute Engine passed in; everything here is plain arithmetic.
 *
 * @module     local_fastgrade/maths/check
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

const SAMPLES = [0.37, 1.91, 2.63, -1.27, 3.71, 0.83];
const RANGE = 60;
const STEPS = 24000;

/**
 * Plain typed maths (what a student types in an essay box) as LaTeX.
 *
 * @param {string} s
 * @returns {string}
 */
export const toTex = s => {
    let x = String(s).trim()
        .replace(/[×*]/g, '\\times ').replace(/÷/g, '/').replace(/[−–]/g, '-').replace(/≤|<=/g, '\\leq ')
        .replace(/≥|>=/g, '\\geq ').replace(/²/g, '^2').replace(/³/g, '^3').replace(/π/g, '\\pi ')
        .replace(/[₀-₉]/g, d => '_' + '₀₁₂₃₄₅₆₇₈₉'.indexOf(d));
    x = x.replace(/±|\+\/-|\+-/g, '\\pm ');
    x = x.replace(/(?:√|sqrt)\s*\(((?:[^()]|\([^()]*\))*)\)/g, (m, a) => `\\sqrt{${a}}`).replace(/√\s*(\d+)/g, '\\sqrt{$1}');
    x = x.replace(/\blog_?(\d+)\s*\(((?:[^()]|\([^()]*\))*)\)/g, '\\log_{$1}($2)').replace(/\blog_?(\d+)\s*x/g, '\\log_{$1}x');
    x = x.replace(/\bln\s*\(/g, '\\ln(').replace(/\b(sin|cos|tan)\s*\(/g, '\\$1(');
    x = x.replace(/\bd\s*y\s*\/\s*d\s*x\b/g, '\\frac{dy}{dx}');
    x = x.replace(/\^\(([^()]*)\)/g, '^{$1}').replace(/\^(-?\d+(?:\.\d+)?|[a-z])/g, '^{$1}');
    const opnd = '(\\((?:[^()]|\\([^()]*\\))*\\)|\\d+(?:\\.\\d+)?|[a-z])';
    x = x.replace(new RegExp(opnd + '\\s*\\/\\s*' + opnd, 'g'), (m, a, b) =>
        `\\frac{${a.replace(/^\((.*)\)$/, '$1')}}{${b.replace(/^\((.*)\)$/, '$1')}}`);
    x = x.replace(/\s+or\s+/gi, '\\;or\\;');
    return x;
};

/**
 * Whether a line of text is maths working (rather than words).
 *
 * @param {string} s
 * @param {boolean} expr also accept an expression with no equals sign
 * @returns {boolean}
 */
export const isMaths = (s, expr = false) => {
    const x = s.trim();
    if (!x || x.length > 160) {
        return false;
    }
    if (!expr && !/[=<>≤≥]/.test(x) && !/^\s*=/.test(x)) {
        return false;
    }
    if (expr && !(/[0-9a-z)]\s*[-+×*/^²³]|\)\s*\(|√|sqrt/i.test(x) && /[0-9x]/.test(x))) {
        return false;
    }
    // Remove maths words; what is left must be mostly symbols, digits and single letters.
    const rest = x.replace(/\b(or|and|int|log(?:_?\d+)?|ln|sqrt|sin|cos|tan|dy|dx)(?![a-z])/gi, '').replace(/\\[a-z]+/gi, '');
    const words = rest.match(/[a-z]{3,}/gi) || [];
    return words.length === 0;
};

/**
 * Whether a question or brief contains an equation to work with (no engine needed).
 *
 * @param {string} html
 * @returns {boolean}
 */
export const hasEquation = html => {
    const plain = String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
    if (/\\\([\s\S]*?=[\s\S]*?\\\)|\$\$[^$]*=[^$]*\$\$/.test(plain)) {
        return true;
    }
    return plain.split(/[\n;]|\.\s/).some(seg => /x/.test(seg) && /\d/.test(seg) &&
        /[0-9a-z)²³]\s*[+\-^]\s*[0-9a-z(]|[0-9]x/i.test(seg) && seg.includes('='));
};

/**
 * Maths lines of a text, with their character ranges. A part label such as "(b)" or "Q2" starts a new chain.
 *
 * @param {string} text
 * @returns {Array} [{start, end, text, typed, restart}]
 */
export const mathsLines = text => {
    const out = [];
    let pos = 0;
    const all = String(text).split('\n');
    // The next line that has something on it.
    const next = i => all.slice(i + 1).find(l => l.trim()) || '';
    all.forEach((raw, i) => {
        const start = pos;
        pos += raw.length + 1;
        let line = raw;
        let restart = false;
        const label = line.match(/^\s*(?:\(?[a-h]\)|\(?[ivx]+\)|Q?\d+\s*[).:]|[a-h]\.)\s*/i);
        if (label) {
            line = line.slice(label[0].length);
            restart = true;
        }
        line = line.replace(/^\s*(?:∴|therefore|so|hence|thus)\s*/i, '');
        // An expression with no equals sign counts when the working continues on the next line with "= ...".
        if (!isMaths(line) && !(/^\s*=/.test(next(i)) && isMaths(line, true))) {
            return;
        }
        const lead = raw.indexOf(line.trim());
        out.push({start: start + Math.max(0, lead), end: start + raw.trimEnd().length, typed: line.trim(), restart});
    });
    return out;
};

/**
 * Split "x = a or x = b" (and ±) into branches.
 *
 * @param {string} tex
 * @returns {Array}
 */
const branches = tex => {
    const out = [];
    tex.split(/\\;\s*or\s*\\;|\s+or\s+|,\s*(?=x\s*=)/).map(p => p.trim()).filter(Boolean).forEach(p => {
        if (p.includes('\\pm')) {
            out.push(p.replace('\\pm', '+'), p.replace('\\pm', '-'));
        } else {
            out.push(p);
        }
    });
    return out;
};

/**
 * A checker bound to a Compute Engine instance.
 *
 * @param {Object} ce ComputeEngine
 * @returns {Object}
 */
export const checker = ce => {
    const fn = tex => {
        const e = ce.parse(tex);
        if (!e.isValid) {
            throw new Error('parse');
        }
        const f = e.compile();
        return x => {
            try {
                const v = f({x});
                return typeof v === 'number' ? v : Number(v);
            } catch (err) {
                return NaN;
            }
        };
    };

    const fn2 = tex => {
        const e = ce.parse(tex);
        if (!e.isValid) {
            throw new Error('parse');
        }
        const f = e.compile();
        return (x, y) => {
            try {
                const v = f({x, y});
                return typeof v === 'number' ? v : Number(v);
            } catch (err) {
                return NaN;
            }
        };
    };

    // Comparisons: "<", ">", "≤", "≥" in typed or TeX form.
    const CMP = /(\\leq|\\geq|<=|>=|≤|≥|<|>)/;
    const holds = (a, b, op) => {
        if (!Number.isFinite(a) || !Number.isFinite(b)) {
            return false;
        }
        const e = 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
        if (op === '<') {
            return a < b - e;
        }
        if (op === '>') {
            return a > b + e;
        }
        if (op === '\\leq' || op === '<=' || op === '≤') {
            return a <= b + e;
        }
        return a >= b - e;
    };
    // Points to compare two inequalities at: a fine grid, plus every whole and half number (where boundaries fall).
    const GRID = (() => {
        const g = [];
        for (let x = -60; x <= 60; x += 0.0137) {
            g.push(x);
        }
        for (let x = -60; x <= 60; x += 0.25) {
            g.push(x);
        }
        return g;
    })();

    // Simultaneous equations in x and y.
    const hasY = tex => /(^|[^a-z\\])y(?![a-z])/i.test(tex.replace(/\\frac\{dy\}\{dx\}|dy\/dx/g, ''));
    const sysParse = tex => {
        const t = tex.replace(/\s*\.*\s*\((?:\d|i+)\)\s*$/, '').replace(/^\s*\((?:\d|i+)\)\s*/, '');
        const alts = t.split(/\\;\s*or\s*\\;|\s+or\s+/).map(a => a.split(/,|\\;\s*and\s*\\;|\s+and\s+/)
            .map(q => q.trim()).filter(Boolean).map(q => {
                const sides = q.split('=');
                if (sides.length !== 2 || CMP.test(q)) {
                    throw new Error('sys');
                }
                const l = fn2(sides[0]);
                const r = fn2(sides[1]);
                const v = sides[0].trim();
                const solved = /^[xy]$/.test(v) && !/[xy]/.test(sides[1]) ? {v, val: r(0, 0)} : null;
                return {l, r, solved};
            }));
        if (!alts.length || alts.some(a => !a.length)) {
            throw new Error('sys');
        }
        return {type: 'sys', alts, solved: alts.every(a => a.every(q => q.solved))};
    };
    const sysHolds = (line, s, approx) => line.alts.some(a => a.every(q => {
        if (q.solved && approx) {
            return Math.abs(q.solved.val - (q.solved.v === 'x' ? s[0] : s[1])) <= 0.006 * Math.max(1, Math.abs(q.solved.val));
        }
        const l = q.l(s[0], s[1]);
        const r = q.r(s[0], s[1]);
        return Number.isFinite(l) && Number.isFinite(r) && Math.abs(l - r) <= 1e-6 * Math.max(1, Math.abs(l), Math.abs(r));
    }));
    const solveSys = (e1, e2) => {
        const g1 = (x, y) => e1.l(x, y) - e1.r(x, y);
        const g2 = (x, y) => e2.l(x, y) - e2.r(x, y);
        const found = [];
        for (let x0 = -20; x0 <= 20; x0 += 2.5) {
            for (let y0 = -20; y0 <= 20; y0 += 2.5) {
                let x = x0 + 0.137;
                let y = y0 - 0.071;
                for (let k = 0; k < 40; k++) {
                    const a = g1(x, y);
                    const b = g2(x, y);
                    const hh = 1e-6;
                    const j11 = (g1(x + hh, y) - a) / hh;
                    const j12 = (g1(x, y + hh) - a) / hh;
                    const j21 = (g2(x + hh, y) - b) / hh;
                    const j22 = (g2(x, y + hh) - b) / hh;
                    const det = j11 * j22 - j12 * j21;
                    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
                        break;
                    }
                    x -= (a * j22 - b * j12) / det;
                    y -= (b * j11 - a * j21) / det;
                }
                if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 1e4 && Math.abs(y) < 1e4 &&
                        Math.abs(g1(x, y)) < 1e-8 && Math.abs(g2(x, y)) < 1e-8 &&
                        !found.some(f => Math.abs(f[0] - x) < 1e-5 && Math.abs(f[1] - y) < 1e-5)) {
                    found.push([Math.round(x * 1e9) / 1e9, Math.round(y * 1e9) / 1e9]);
                }
            }
        }
        return found.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    };
    // The values a one-variable line allows, e.g. "3 + y = 7" gives {v: 'y', set: [4]}.
    const oneVar = line => {
        const qs = line.alts.map(a => a.length === 1 ? a[0] : null);
        if (qs.some(q => !q)) {
            return null;
        }
        if (qs.every(q => q.solved)) {
            const v = qs[0].solved.v;
            return qs.every(q => q.solved.v === v) ? {v, set: qs.map(q => q.solved.val).sort((p, q) => p - q)} : null;
        }
        if (qs.length !== 1) {
            return null;
        }
        const g = (x, y) => qs[0].l(x, y) - qs[0].r(x, y);
        if (Math.abs(g(0.37, 0.5) - g(0.37, 1.9)) < 1e-9) {
            return {v: 'x', set: roots(x => g(x, 0.5))};
        }
        if (Math.abs(g(0.5, 0.37) - g(1.9, 0.37)) < 1e-9) {
            return {v: 'y', set: roots(y => g(0.5, y))};
        }
        return null;
    };
    const sysLabel = sols => sols.map(s => `x = ${fmt([s[0]])}, y = ${fmt([s[1]])}`).join(' or ');

    const roots = f => {
        const out = [];
        let px = -RANGE;
        let pv = f(px);
        for (let i = 1; i <= STEPS; i++) {
            const xx = -RANGE + 2 * RANGE * i / STEPS;
            const v = f(xx);
            if (Number.isFinite(v) && Math.abs(v) < 1e-9) {
                out.push(xx);
            } else if (Number.isFinite(v) && Number.isFinite(pv) && pv * v < 0) {
                let a = px;
                let b = xx;
                let fa = pv;
                for (let k = 0; k < 80; k++) {
                    const m = (a + b) / 2;
                    const fm = f(m);
                    if (fa * fm <= 0) {
                        b = m;
                    } else {
                        a = m;
                        fa = fm;
                    }
                }
                const r = (a + b) / 2;
                if (Math.abs(f(r)) < 1e-4) {
                    out.push(r);
                }
            }
            px = xx;
            pv = v;
        }
        const uniq = [];
        out.sort((p, q) => p - q).forEach(r => {
            if (!uniq.length || Math.abs(uniq[uniq.length - 1] - r) > 1e-5) {
                uniq.push(r);
            }
        });
        return uniq;
    };

    /**
     * What one line says.
     *
     * @param {string} tex
     * @returns {Object}
     */
    const interpret = tex => {
        const t = tex.replace(/\s+/g, ' ').trim();
        // Integrals: "∫ 6x^2 + 2 dx = 2x^3 + 2x + c", or with limits, "∫_0^2 3x^2 dx = 8".
        let im = t.match(/^(?:∫|\\int|int)\s*(?:_\{?(-?[\d.]+)\}?\s*\^\{?(-?[\d.]+)\}?)?\s*(.+?)\s*(?:\\,)?\s*d\s*x\s*=\s*(.+)$/);
        if (im) {
            const f = fn(im[3].replace(/^\((.*)\)$/, '$1'));
            if (im[1] !== undefined) {
                return {type: 'defint', f, a: Number(im[1]), b: Number(im[2]), value: fn(im[4])(0)};
            }
            return {type: 'indefint', f, F: fn(im[4].replace(/\+\s*[cCkK]\s*$/, '') || '0')};
        }
        // Inequalities, including "2 < x < 3" and "x < 2 or x > 3".
        if (CMP.test(t) && !/[=](?![<>])/.test(t.replace(/<=|>=/g, ''))) {
            const parts = t.split(/\\;\s*or\s*\\;|\s+or\s+/).map(p => p.trim()).filter(Boolean);
            const preds = parts.map(part => {
                const bits = part.split(CMP).map(b => b.trim());
                const sides = bits.filter((b, i) => i % 2 === 0).map(fn);
                const ops = bits.filter((b, i) => i % 2 === 1);
                if (sides.length < 2) {
                    throw new Error('ineq');
                }
                return x => ops.every((op, i) => holds(sides[i](x), sides[i + 1](x), op));
            });
            return {type: 'ineq', pred: x => preds.some(pr => pr(x))};
        }
        let m = t.match(/^x\s*=\s*(-?[\d.]+)\s*[:,]\s*\\frac\{dy\}\{dx\}\s*=\s*(.+)$/);
        if (m) {
            return {type: 'gradat', at: Number(m[1]), value: fn(m[2])(0)};
        }
        m = t.match(/^\\frac\{dy\}\{dx\}\s*=\s*(.+)$/);
        if (m) {
            return {type: 'deriv', f: fn(m[1])};
        }
        m = t.match(/^y\s*=\s*(.+)$/);
        if (m && /x/.test(m[1])) {
            return {type: 'func', f: fn(m[1])};
        }
        if (t.startsWith('=')) {
            return {type: 'expr', f: fn(t.slice(1))};
        }
        const br = branches(t);
        if (br.every(b => /^x\s*=/.test(b) && !/x/.test(b.replace(/^x\s*=/, '')))) {
            const vals = br.map(b => fn(b.replace(/^x\s*=/, ''))(0));
            if (vals.some(v => !Number.isFinite(v))) {
                throw new Error('value');
            }
            return {type: 'set', set: vals.sort((p, q) => p - q), approx: /\d\.\d/.test(t)};
        }
        // A bare number answering an expression chain, e.g. "-45".
        if (!/[=<>]/.test(t)) {
            return {type: 'expr', f: fn(t)};
        }
        if (t.includes('\\pm') && t.split('=').length === 2) {
            // "x + 3 = ±2" is two equations; its solutions are both sets together.
            const all = [];
            ['+', '-'].forEach(sign => {
                const [l, r] = t.replace('\\pm', sign).split('=');
                const fl = fn(l);
                const fr = fn(r);
                all.push(...roots(x => fl(x) - fr(x)));
            });
            return {type: 'set', set: [...new Set(all.map(v => Math.round(v * 1e9) / 1e9))].sort((p, q) => p - q)};
        }
        if (t.split('=').length === 2 && !/[<>]|\\leq|\\geq/.test(t)) {
            const [l, r] = t.split('=');
            const fl = fn(l);
            const fr = fn(r);
            return {type: 'set', set: roots(x => fl(x) - fr(x))};
        }
        throw new Error('unsupported');
    };

    const sameSet = (a, b, tol) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);
    const subset = (a, b, tol) => a.every(v => b.some(w => Math.abs(v - w) <= tol));
    const sameFn = (f, g) => {
        let n = 0;
        for (const x of SAMPLES) {
            const a = f(x);
            const b = g(x);
            if (!Number.isFinite(a) || !Number.isFinite(b)) {
                continue;
            }
            n++;
            if (Math.abs(a - b) > 1e-7 * Math.max(1, Math.abs(a))) {
                return false;
            }
        }
        return n >= 3;
    };
    const fmt = s => s.map(v => {
        const r = Math.round(v * 1e4) / 1e4;
        const fr = [2, 3, 4, 5, 6, 7, 8, 9, 10, 12].map(d => [d, Math.round(v * d)]).find(([d, n]) =>
            Math.abs(v - n / d) < 1e-9 && Math.abs(n) % d !== 0);
        return fr ? `${fr[1]}/${fr[0]}` : String(r);
    }).join(', ');
    const label = set => set.length ? 'x = ' + fmt(set).split(', ').join(' or x = ') : 'no solutions';

    /**
     * Check a chain of lines.
     *
     * @param {Array} lines [{typed or tex, restart}]
     * @param {Object} opts {question: interpreted question line or null}
     * @returns {Array} per line {verdict: question|ok|slip|ft|unread|unchecked, reason, value}
     */
    const checkChain = (lines, opts = {}) => {
        const out = [];
        let prev = null;
        let question = opts.question || null;
        let func = null;
        let deriv = null;
        let slipped = false;
        let sys = null;
        let sysEqs = [];
        let known = {};
        // System mode: the first two lines of a part both use y (and are not derivatives).
        const texOf = ln => ln.tex || toTex(ln.typed);
        const startSys = i => {
            const a = lines[i];
            const b = lines[i + 1];
            if (!a || !b || (b.restart && i + 1)) {
                return false;
            }
            return [a, b].every(l => hasY(texOf(l))) && ![a, b].some(l => /dy|dx/.test(l.typed || texOf(l)));
        };
        let sysOn = startSys(0);
        lines.forEach((ln, i) => {
            let cur;
            if (ln.restart && i) {
                prev = null;
                question = null;
                func = null;
                deriv = null;
                slipped = false;
                sys = null;
                sysEqs = [];
                known = {};
                sysOn = startSys(i);
            }
            if (sysOn) {
                let line;
                try {
                    line = sysParse(texOf(ln));
                } catch (e) {
                    const after = (ln.typed || '').split(':').pop();
                    try {
                        line = sysParse(toTex(after));
                    } catch (e2) {
                        out.push({verdict: 'unread', reason: 'unread'});
                        return;
                    }
                }
                if (!sys) {
                    if (line.alts.length === 1 && line.alts[0].length === 1) {
                        sysEqs.push(line.alts[0][0]);
                    }
                    out.push({verdict: 'question', value: line});
                    if (sysEqs.length === 2) {
                        sys = solveSys(sysEqs[0], sysEqs[1]);
                    }
                    return;
                }
                if (!sys.length) {
                    out.push({verdict: 'unchecked', reason: 'norule', value: line});
                    return;
                }
                const approx = /\d\.\d/.test(ln.typed || '');
                // Each "or" choice must fit a solution, and the line as a whole at least one.
                const badAlt = line.alts.length > 1 && line.alts.some(a => !sys.some(sol => sysHolds({alts: [a]}, sol, approx)));
                const at = badAlt ? 0 : sys.filter(sol => sysHolds(line, sol, approx)).length;
                line.sols = sys;
                const tol = approx ? 0.006 : 1e-5;
                // A final "x = 3, y = 4" after a slip follows through if it uses the values found on earlier lines.
                const usesKnown = line.solved && line.alts.every(a => a.every(q => (known[q.solved.v] || [])
                    .some(v => Math.abs(v - q.solved.val) <= tol * Math.max(1, Math.abs(v)))));
                const before = prev && prev.type === 'sys' ? oneVar(prev) : null;
                const now = before ? oneVar(line) : null;
                if (!at && slipped && before && now && before.v === now.v && now.set.length &&
                        subset(now.set, before.set, approx ? 0.006 : 1e-5)) {
                    // Follows correctly from an earlier slip.
                    out.push({verdict: 'ft', reason: 'same', value: line});
                } else if (!at && slipped && usesKnown) {
                    out.push({verdict: 'ft', reason: 'same', value: line});
                } else if (!at) {
                    out.push({verdict: 'slip', reason: 'sys_bad', from: '', to: '', value: line});
                    slipped = true;
                } else {
                    out.push({verdict: slipped ? 'ft' : 'ok', reason: at === sys.length ? 'sys_ok' : 'chosen', value: line});
                }
                const vals = oneVar(line);
                if (vals && vals.set.length) {
                    known[vals.v] = vals.set;
                }
                line.known = Object.assign({}, known);
                prev = line;
                return;
            }
            try {
                cur = interpret(ln.tex || toTex(ln.typed));
            } catch (e) {
                out.push({verdict: 'unread', reason: 'unread'});
                return;
            }
            if (!prev && cur.type !== 'indefint' && cur.type !== 'defint') {
                if (cur.type === 'func') {
                    func = cur.f;
                }
                // With a known question, the first line is checked against it too.
                if (question && question.type === 'set' && cur.type === 'set') {
                    prev = question;
                } else {
                    out.push({verdict: 'question', value: cur});
                    if (!question) {
                        question = cur;
                    }
                    prev = cur;
                    return;
                }
            }
            let ok = null;
            let reason = '';
            if (cur.type === 'indefint') {
                // The answer differentiates back to what was integrated.
                const hh = 1e-5;
                ok = SAMPLES.every(x => {
                    const d = (cur.F(x + hh) - cur.F(x - hh)) / (2 * hh);
                    return Math.abs(d - cur.f(x)) < 1e-3 * Math.max(1, Math.abs(cur.f(x)));
                });
                reason = ok ? 'int_ok' : 'int_bad';
            } else if (cur.type === 'defint') {
                // Simpson's rule.
                const n = 2000;
                const hh = (cur.b - cur.a) / n;
                let sum = cur.f(cur.a) + cur.f(cur.b);
                for (let i = 1; i < n; i++) {
                    sum += cur.f(cur.a + i * hh) * (i % 2 ? 4 : 2);
                }
                const val = sum * hh / 3;
                ok = Math.abs(val - cur.value) < 0.006 * Math.max(1, Math.abs(val));
                reason = ok ? 'int_ok' : 'defint_bad';
            } else if (cur.type === 'ineq' && prev.type === 'ineq') {
                ok = GRID.every(x => prev.pred(x) === cur.pred(x));
                reason = ok ? 'same_range' : 'range_changed';
            } else if (cur.type === 'deriv') {
                const base = func || (prev.type === 'func' ? prev.f : null);
                if (base) {
                    const hh = 1e-5;
                    const d = x => (base(x + hh) - base(x - hh)) / (2 * hh);
                    ok = SAMPLES.every(x => Math.abs(d(x) - cur.f(x)) < 1e-3 * Math.max(1, Math.abs(d(x))));
                    reason = ok ? 'deriv_ok' : 'deriv_bad';
                }
                deriv = cur.f;
            } else if (cur.type === 'gradat') {
                if (deriv) {
                    ok = Math.abs(deriv(cur.at) - cur.value) < 1e-6;
                    reason = ok ? 'value_ok' : 'value_bad';
                }
            } else if (cur.type === 'expr' && prev.type === 'expr') {
                ok = sameFn(prev.f, cur.f);
                reason = ok ? 'equal' : 'notequal';
            } else if (cur.type === 'set' && prev.type === 'set') {
                const tol = cur.approx || prev.approx ? 0.006 : 1e-5;
                if (sameSet(prev.set, cur.set, tol)) {
                    ok = true;
                    reason = 'same';
                } else if (subset(prev.set, cur.set, tol)) {
                    ok = true;
                    reason = 'extra';
                } else if (cur.set.length && subset(cur.set, prev.set, tol)) {
                    // Keeping some of the solutions (rejecting an invalid one, or rounding) is a valid step; whether
                    // the right ones were kept is the final answer's check.
                    ok = true;
                    reason = 'chosen';
                } else {
                    ok = false;
                    reason = 'changed';
                }
            }
            if (ok === null) {
                out.push({verdict: 'unchecked', reason: 'norule', value: cur});
            } else if (!ok) {
                out.push({verdict: 'slip', reason, from: prev && prev.set ? label(prev.set) : '', to: cur.set ? label(cur.set) : '',
                    value: cur});
                slipped = true;
            } else {
                // An integral is checked on its own, so it is right whatever came before it.
                const own = cur.type === 'indefint' || cur.type === 'defint';
                out.push({verdict: slipped && !own ? 'ft' : 'ok', reason, value: cur});
            }
            prev = cur;
        });
        return out;
    };

    /**
     * The first equation in a question's text, as typed or as TeX.
     *
     * @param {string} text plain text or HTML of the question
     * @returns {Object|null} interpreted line
     */
    const questionLine = text => {
        const plain = String(text || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
        const cands = [];
        const delim = /^\\\(|\\\)$|^\$\$|\$\$$|^\\\[|\\\]$/g;
        (plain.match(/\\\((.+?)\\\)|\$\$(.+?)\$\$|\\\[(.+?)\\\]/g) || []).forEach(m =>
            cands.push({tex: m.replace(delim, '')}));
        plain.replace(/[−–]/g, '-').split(/[\n;,]|\.\s|\.$|\s{2,}/).forEach(seg => {
            // Drop leading words such as "Solve" or "Given", keeping maths words like log.
            const m = seg.replace(/^\s*(?:(?!(?:log|ln|sqrt|sin|cos|tan)\b)[a-z]+\s+)+/i, '').trim();
            if (m && isMaths(m) && /x/.test(m)) {
                cands.push({typed: m});
            }
        });
        for (const c of cands) {
            try {
                const v = interpret(c.tex || toTex(c.typed));
                if (v.type === 'set' && v.set.length) {
                    return v;
                }
            } catch (e) {
                // Try the next candidate.
            }
        }
        return null;
    };

    /**
     * Check all the working in a text.
     *
     * @param {string} text
     * @param {Object} opts {answer: typed model answer, question: question text}
     * @returns {Object} {lines, steps, slips, answer: {ok, have, want}|null}
     */
    const checkText = (text, opts = {}) => {
        const lines = mathsLines(text);
        let question = null;
        if (opts.question) {
            question = questionLine(opts.question);
        }
        const res = checkChain(lines, {question});
        const merged = lines.map((l, i) => Object.assign({}, l, res[i]));
        const steps = merged.filter(l => ['ok', 'slip', 'ft'].includes(l.verdict));
        const last = [...merged].reverse().find(l => l.value && l.value.type === 'set');
        let want = null;
        if (opts.answer && opts.answer.trim()) {
            try {
                want = interpret(toTex(opts.answer));
            } catch (e) {
                want = null;
            }
        }
        if (!want && question) {
            want = question;
        }
        let answer = null;
        const end = [...merged].reverse().find(l => l.value && ['set', 'sys', 'ineq', 'indefint', 'defint'].includes(l.value.type));
        const firstIneq = merged.find(l => l.value && l.value.type === 'ineq');
        if (end && end.value.type === 'sys' && end.value.solved && end.value.sols && end.value.sols.length) {
            const sols = end.value.sols;
            const approx = /\d\.\d/.test(end.typed || '');
            const held = sols.filter(sol => sysHolds(end.value, sol, approx)).length;
            const wrong = end.value.alts.filter(a => !sols.some(sol => sysHolds({alts: [a]}, sol, approx))).length;
            let ok = held === sols.length && !wrong && end.value.alts.every(a => a.length >= 2);
            let have = end.typed;
            let partial = ok ? 1 : (wrong ? 0 : held / sols.length);
            const kn = end.value.known || {};
            if (!ok && end.value.alts.every(a => a.length === 1) && kn.x && kn.y) {
                // "y = 2" on one line and "x = 3" on the last: the answer is both.
                const same = (set, v) => set.length === v.length &&
                    set.every((a, i) => Math.abs(a - v[i]) <= 0.006 * Math.max(1, Math.abs(a)));
                const xs = [...new Set(sols.map(sol => sol[0]))].sort((p, q) => p - q);
                const ys = [...new Set(sols.map(sol => sol[1]))].sort((p, q) => p - q);
                ok = same(kn.x, xs) && same(kn.y, ys);
                partial = ok ? 1 : (same(kn.x, xs) || same(kn.y, ys) ? 0.5 : 0);
                have = `x = ${fmt(kn.x)}, y = ${fmt(kn.y)}`;
            }
            answer = {ok, partial, have, want: sysLabel(sols), line: end};
        } else if (end && end.value.type === 'ineq') {
            let w = want && want.type === 'ineq' ? want : null;
            if (!w && firstIneq && firstIneq !== end) {
                w = firstIneq.value;
            }
            if (w) {
                // Right range, and written as a range ("2 < x < 3", "x <= 2 or x >= 3"), not still to be solved.
                const num = String.raw`-?\d+(?:[./]\d+)?`;
                const op = String.raw`(?:<=|>=|<|>|≤|≥)`;
                const solved = new RegExp(`^(?:${num}\\s*${op}\\s*)?x\\s*${op}\\s*${num}$|^${num}\\s*${op}\\s*x$`);
                const ok = GRID.every(x => w.pred(x) === end.value.pred(x)) &&
                    end.typed.replace(/[−–]/g, '-').split(/\s+or\s+|,\s*/).every(part => solved.test(part.trim()));
                answer = {ok, partial: ok ? 1 : 0, have: end.typed, want: opts.answer || '', line: end};
            }
        } else if (end && (end.value.type === 'indefint' || end.value.type === 'defint')) {
            answer = {ok: end.verdict === 'ok', partial: end.verdict === 'ok' ? 1 : 0, have: end.typed, want: '', line: end};
        } else if (last && want && want.type === 'set') {
            const tol = last.value.approx || /\d\.\d/.test(opts.answer || '') ? 0.006 : 1e-5;
            const ok = sameSet(last.value.set, want.set, tol);
            // Some of the right answers and nothing wrong is part of the answer.
            const right = last.value.set.filter(v => want.set.some(w => Math.abs(v - w) <= tol)).length;
            const partial = ok ? 1 : (right === last.value.set.length && want.set.length ? right / want.set.length : 0);
            answer = {ok, partial, have: label(last.value.set), want: label(want.set), line: last};
        } else if (last && !want) {
            answer = {ok: null, have: label(last.value.set), want: '', line: last};
        }
        return {lines: merged, steps: steps.length, slips: merged.filter(l => l.verdict === 'slip').length,
            unread: merged.filter(l => l.verdict === 'unread').length, answer};
    };

    /**
     * Final answer of a text as a set key (for grouping equal answers).
     *
     * @param {string} text
     * @returns {Object|null} {key, label}
     */
    const finalKey = text => {
        const lines = mathsLines(text);
        for (let i = lines.length - 1; i >= 0; i--) {
            try {
                if (hasY(toTex(lines[i].typed)) && !/dy|dx/.test(lines[i].typed)) {
                    const sv = sysParse(toTex(lines[i].typed));
                    if (sv.solved && sv.alts.every(a => a.length === 2)) {
                        const pts = sv.alts.map(a => {
                            const x = a.find(q => q.solved.v === 'x');
                            const y = a.find(q => q.solved.v === 'y');
                            return [x ? x.solved.val : NaN, y ? y.solved.val : NaN];
                        }).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
                        if (pts.every(pt => pt.every(Number.isFinite))) {
                            return {key: 's' + pts.map(pt => pt.map(v => v.toFixed(4)).join(',')).join('|'), label: sysLabel(pts)};
                        }
                    }
                }
                const v = interpret(toTex(lines[i].typed));
                if (v.type === 'set') {
                    return {key: v.set.map(x => x.toFixed(4)).join('|'), label: label(v.set), set: v.set};
                }
                if (v.type === 'gradat') {
                    return {key: 'g' + v.at + ':' + v.value.toFixed(4), label: `dy/dx = ${fmt([v.value])} at x = ${v.at}`};
                }
                if (v.type === 'expr' && /^\s*=/.test(lines[i].typed) && Number.isFinite(v.f(0.37)) &&
                        Math.abs(v.f(0.37) - v.f(1.91)) < 1e-9) {
                    return {key: 'v' + v.f(0).toFixed(4), label: '= ' + fmt([v.f(0)])};
                }
            } catch (e) {
                // Keep looking upward.
            }
        }
        return null;
    };

    return {interpret, checkChain, checkText, questionLine, finalKey, toTex, fmt, label};
};
