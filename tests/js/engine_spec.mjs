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
 * Runs the browser auto-marking engine against tests/fixtures/engine_spec.json (the same cases the
 * server engine is tested on in tests/engine_spec_test.php). Usage, from the plugin folder:
 *
 *     node tests/js/engine_spec.mjs
 *
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const plugin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fgspec-'));
// Copy the modules, pointing "local_fastgrade/x" imports at the copies.
for (const rel of ['autograde/engine.js', 'autograde/sense.js', 'lib/str.js']) {
    const src = fs.readFileSync(path.join(plugin, 'amd/src', rel), 'utf8')
        .replace(/from 'local_fastgrade\/([\w/]+)'/g, (m, mod) => `from '${pathToFileURL(path.join(tmp, mod + '.mjs')).href}'`);
    fs.mkdirSync(path.join(tmp, path.dirname(rel)), {recursive: true});
    fs.writeFileSync(path.join(tmp, rel.replace(/\.js$/, '.mjs')), src);
}
const Engine = await import(pathToFileURL(path.join(tmp, 'autograde/engine.mjs')).href);
const Sense = await import(pathToFileURL(path.join(tmp, 'autograde/sense.mjs')).href);
const Str = await import(pathToFileURL(path.join(tmp, 'lib/str.mjs')).href);
Str.load({});

const spec = JSON.parse(fs.readFileSync(path.join(plugin, 'tests/fixtures/engine_spec.json'), 'utf8'));
let pass = 0;
const fails = [];
const check = (name, got, want) => {
    if (JSON.stringify(got) === JSON.stringify(want)) {
        pass++;
    } else {
        fails.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    }
};

spec.fold.forEach(([w, want]) => check('fold ' + w, Sense.fold(w), want));
spec.slip.forEach(([a, b, want]) => check(`slip ${a}/${b}`, Sense.slip(a, b), want));
spec.phrase.forEach(c => {
    const pt = Engine.phraseTerms(c.phrase);
    const hits = Engine.sentences(c.text).flatMap(s => Engine.findPhrase(Engine.marked(s.text), pt.terms, pt.neg));
    const got = hits.some(h => !h.negated) ? 'found' : (hits.length ? 'negated' : 'none');
    check(`phrase "${c.phrase}" in "${c.text}"`, got, c.want);
});
spec.evaluate.forEach(c => {
    const ev = Engine.evaluate(c.text, c.rules, c.ctx || {});
    check('evaluate ' + c.name, {met: ev.met, total: ev.total}, {met: c.met, total: c.total});
});
spec.coverage.forEach(c => {
    check('coverage ' + c.text, Engine.coverage(c.text, c.points, c.question || '').map(x => x.status), c.status);
});
(spec.parts_js || []).forEach(c => {
    check('parts ' + c.name, Engine.partsCheck(c.text, c.parts, c.question).map(x => x.ok), c.ok);
});
spec.analyse.forEach(c => {
    const sents = Engine.sentences(c.text).map(s => Object.assign(s, {tk: Engine.tokens(s.text)}));
    const res = Sense.analyse(c.text, {tokens: Engine.tokens(c.text), sentences: sents, question: c.question || '',
        questiontokens: Engine.tokens(c.question || ''), templatetokens: Engine.tokens(c.template || ''),
        topic: c.topic || [], items: c.items});
    check('analyse ' + c.name, res.issues.map(i => i.code).sort(), [...c.codes].sort());
});

fs.rmSync(tmp, {recursive: true, force: true});
console.log(`${pass} passed, ${fails.length} failed`);
fails.forEach(f => console.log('FAIL ' + f));
process.exit(fails.length ? 1 : 0);
