<?php
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

namespace local_fastgrade;

use local_fastgrade\local\engine\sense;
use local_fastgrade\local\engine\text;

/**
 * The server engine against the shared cases in tests/fixtures/engine_spec.json, which the browser
 * engine also passes (tests/js/engine_spec.mjs).
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 * @covers     \local_fastgrade\local\engine\text
 * @covers     \local_fastgrade\local\engine\sense
 */
final class engine_spec_test extends \advanced_testcase {
    /**
     * The shared cases.
     *
     * @return array
     */
    protected static function spec(): array {
        return json_decode(file_get_contents(__DIR__ . '/fixtures/engine_spec.json'), true);
    }

    /**
     * UK and US spellings fold together.
     */
    public function test_fold(): void {
        foreach (self::spec()['fold'] as [$w, $want]) {
            $this->assertSame($want, sense::fold($w), $w);
        }
    }

    /**
     * Spelling slips are strict.
     */
    public function test_slip(): void {
        foreach (self::spec()['slip'] as [$a, $b, $want]) {
            $this->assertSame($want, sense::slip($a, $b), "$a/$b");
        }
    }

    /**
     * Phrases are found the right way round.
     */
    public function test_phrases(): void {
        foreach (self::spec()['phrase'] as $c) {
            $pt = text::phrase_terms($c['phrase']);
            $hits = [];
            foreach (text::sentences($c['text']) as $s) {
                $hits = array_merge($hits, text::find_phrase(text::marked($s['text']), $pt['terms'], $pt['neg']));
            }
            $got = array_filter($hits, fn($h) => !$h['negated']) ? 'found' : ($hits ? 'negated' : 'none');
            $this->assertSame($c['want'], $got, '"' . $c['phrase'] . '" in "' . $c['text'] . '"');
        }
    }

    /**
     * Rules give the same results as in the browser.
     */
    public function test_evaluate(): void {
        foreach (self::spec()['evaluate'] as $c) {
            $ev = text::evaluate($c['text'], $c['rules'], $c['ctx'] ?? []);
            $this->assertSame([$c['met'], $c['total']], [$ev['met'], $ev['total']], $c['name']);
        }
    }

    /**
     * Key points said the opposite way are not covered.
     */
    public function test_coverage(): void {
        foreach (self::spec()['coverage'] as $c) {
            $got = array_column(text::coverage($c['text'], $c['points'], $c['question'] ?? ''), 'status');
            $this->assertSame($c['status'], $got, $c['text']);
        }
    }

    /**
     * Checks on the answer as a whole.
     */
    public function test_analyse(): void {
        foreach (self::spec()['analyse'] as $c) {
            $sents = array_map(fn($s) => $s + ['tk' => text::tokens($s['text'])], text::sentences($c['text']));
            $res = sense::analyse($c['text'], [
                'tokens' => text::tokens($c['text']),
                'sentences' => $sents,
                'question' => $c['question'] ?? '',
                'questiontokens' => text::tokens($c['question'] ?? ''),
                'templatetokens' => text::tokens($c['template'] ?? ''),
                'topic' => $c['topic'] ?? [],
                'items' => $c['items'] ?? null,
            ]);
            $got = array_column($res['issues'], 'code');
            $want = $c['codes'];
            sort($got);
            sort($want);
            $this->assertSame($want, $got, $c['name']);
        }
    }

    /**
     * The stemmer agrees with the browser on a sample of words (Porter reference outputs).
     */
    public function test_stem(): void {
        $cases = ['caresses' => 'caress', 'ponies' => 'poni', 'relational' => 'relat', 'conditional' => 'condit',
            'hopeful' => 'hope', 'goodness' => 'good', 'electrical' => 'electr', 'adjustment' => 'adjust',
            'controlling' => 'control', 'isolation' => 'isol', 'consultation' => 'consult', 'hazards' => 'hazard'];
        foreach ($cases as $w => $want) {
            $this->assertSame($want, text::stem($w), $w);
        }
    }
}
