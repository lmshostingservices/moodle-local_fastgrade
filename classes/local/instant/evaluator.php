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

namespace local_fastgrade\local\instant;

use local_fastgrade\local\engine\sense;
use local_fastgrade\local\engine\text;

/**
 * Instant Feedback: check an answer against a teacher's set-up, on the server, with the same rules as
 * Fast Grade's auto-marking. The result holds only what the student may see: never the wording looked
 * for, the model answer or anything the teacher has not chosen to show.
 *
 * It errs on the side of caution: wording found the wrong way round, said both ways, or written as a
 * bare list of key words is shown as "cannot confirm", never as correct.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class evaluator {
    /** Engine version, kept with each check. */
    const VERSION = '1.6.0';

    /** Longest answer checked, in characters. */
    const MAXCHARS = 30000;

    /**
     * A string from the plugin.
     *
     * @param string $key
     * @param mixed $a
     * @return string
     */
    protected static function s(string $key, $a = null): string {
        return get_string($key, 'local_fastgrade', $a);
    }

    /**
     * Check an answer with the free rules.
     *
     * @param array $config set-up
     * @param string $response the answer, as plain text
     * @param array $ctx question, template (plain text)
     * @param int $attemptno this check's number for the answer (1 = first)
     * @return array [result => student view, states => [id => state], detected, total, score]
     */
    public static function check(array $config, string $response, array $ctx, int $attemptno): array {
        $response = trim($response);
        $out = [
            'status' => 'ok',
            'mode' => $config['mode'],
            'engine' => 'rules',
            'items' => [],
            'warnings' => [],
            'notices' => [],
            'summary' => ['detected' => 0, 'partial' => 0, 'uncertain' => 0, 'total' => 0],
            'score' => null,
            'intro' => $config['intro'] ?? '',
            'uncertain' => false,
        ];
        if (\core_text::strlen($response) > self::MAXCHARS) {
            $out['status'] = 'review';
            $out['notices'][] = ['code' => 'toolong', 'message' => self::s('if_toolong')];
            return self::finish($out, [], 0, 0, null);
        }
        $sents = text::marked_sentences($response);
        $tokens = text::tokens($response);
        $words = count($tokens);

        $states = [];
        $items = [];
        $detected = 0;
        $partial = 0;
        $uncertain = 0;
        $required = 0;
        $topic = [];

        // Concepts: ideas the answer should contain.
        foreach ($config['concepts'] as $c) {
            foreach ($c['phrases'] as $p) {
                foreach (text::alternatives([$p])[0]['alts'] as $alt) {
                    foreach ($alt['terms'] as $t) {
                        $topic[] = $t['s'];
                    }
                }
            }
            $state = self::concept_state($sents, $c['phrases']);
            $items[] = ['id' => $c['id'], 'kind' => 'concept', 'state' => $state['state'], 'slip' => $state['slip'],
                'required' => (int)$c['required'], 'src' => $c];
        }
        // Terms that must be used, spelt right.
        foreach ($config['terms'] as $c) {
            $state = self::concept_state($sents, $c['phrases']);
            if ($state['state'] === 'detected' && $state['slip']) {
                $state['state'] = 'partial';
            }
            $items[] = ['id' => $c['id'], 'kind' => 'term', 'state' => $state['state'], 'slip' => $state['slip'],
                'required' => 1, 'src' => $c];
        }
        // Values: a number in range, in a sentence about the quantity.
        foreach ($config['values'] as $v) {
            $res = text::value_check($sents, ['terms' => $v['phrases'], 'unit' => $v['unit'], 'vmin' => $v['vmin'],
                'vmax' => $v['vmax']]);
            $state = $res['wrong'] ? 'wrong' : ($res['good'] ? 'detected' : 'missing');
            $items[] = ['id' => $v['id'], 'kind' => 'value', 'state' => $state, 'slip' => false, 'required' => 1, 'src' => $v,
                'have' => $res['wrong'][0] ?? ''];
        }

        // The answer as a whole.
        $foundn = count(array_filter($items, fn($i) => $i['state'] === 'detected'));
        $q = sense::analyse($response, [
            'tokens' => $tokens,
            'sentences' => $sents,
            'question' => (string)($ctx['question'] ?? ''),
            'questiontokens' => text::tokens((string)($ctx['question'] ?? '')),
            'templatetokens' => text::tokens((string)($ctx['template'] ?? '')),
            'topic' => array_values(array_unique($topic)),
            'items' => $foundn,
        ]);
        $codes = array_column($q['issues'], 'code');
        if (in_array('empty', $codes, true)) {
            $out['status'] = 'empty';
            $out['notices'][] = ['code' => 'empty', 'message' => self::s('if_q_empty')];
            return self::finish($out, [], 0, count($items), null);
        }
        if (array_intersect(['gibberish', 'offtopic'], $codes)) {
            // Nothing the rules can stand behind.
            $out['status'] = 'review';
            foreach ($q['issues'] as $is) {
                if (in_array($is['code'], ['gibberish', 'offtopic'], true)) {
                    $out['notices'][] = ['code' => $is['code'], 'message' => self::s('if_q_' . $is['code'])];
                }
            }
            return self::finish($out, array_fill_keys(array_column($items, 'id'), 'missing'), 0, count($items), null);
        }
        $doubt = array_intersect(['copied', 'template', 'keywords'], $codes);
        foreach ($items as &$it) {
            // Wording copied from the question, a template left as it is, or a bare list of key words
            // cannot show understanding: the idea is noted, not confirmed.
            if ($doubt && $it['state'] === 'detected' && $it['kind'] !== 'value') {
                $it['state'] = 'uncertain';
            }
        }
        unset($it);

        // Order of the ideas, when it matters.
        if (!empty($config['order'])) {
            $steps = array_map(fn($c) => implode(' | ', $c['phrases']), array_values(array_filter(
                $config['concepts'],
                fn($c) => $c['required']
            )));
            if (count($steps) >= 2) {
                $seq = text::sequence_check($sents, $steps);
                if ($seq['outoforder']) {
                    $items[] = ['id' => 'order', 'kind' => 'order', 'state' => 'wrong', 'slip' => false, 'required' => 0,
                        'src' => []];
                }
            }
        }

        // Banned or unsafe statements.
        foreach ($config['prohibited'] as $p) {
            $f = text::find_alternatives($sents, $p['phrases']);
            if ($f['found']) {
                $hit = reset($f['found'])[0];
                $out['warnings'][] = [
                    'message' => $p['message'] !== '' ? $p['message'] : self::s('if_prohibited'),
                    'quote' => \core_text::substr(substr($response, $hit['start'], $hit['end'] - $hit['start']), 0, 300),
                ];
                $states['x' . $p['id']] = 'flagged';
            }
        }

        // Word limits.
        $minw = (int)$config['minwords'] ?: (int)($ctx['minwords'] ?? 0);
        $maxw = (int)$config['maxwords'] ?: (int)($ctx['maxwords'] ?? 0);
        $effective = $q['effectivewords'];
        if ($minw && $effective < $minw) {
            $out['notices'][] = ['code' => 'short', 'message' => self::s('if_short', (object)['have' => $effective,
                'want' => $minw])];
        }
        if ($maxw && $words > $maxw) {
            $out['notices'][] = ['code' => 'long', 'message' => self::s('if_long', (object)['have' => $words, 'want' => $maxw])];
        }
        if (!empty($config['quality'])) {
            foreach ($q['issues'] as $is) {
                if ($is['code'] === 'count') {
                    [$have, $want] = explode('/', $is['detail']) + [0, 0];
                    $out['notices'][] = ['code' => 'count', 'message' => self::s('if_q_count', (object)['have' => $have,
                        'want' => $want])];
                } else {
                    $out['notices'][] = ['code' => $is['code'], 'message' => self::s('if_q_' . $is['code'], $is['detail'])];
                }
            }
        }

        // Tally and messages.
        foreach ($items as $it) {
            $states[$it['id']] = $it['state'];
            if ($it['kind'] === 'order') {
                continue;
            }
            if ($it['required']) {
                $required++;
                if ($it['state'] === 'detected') {
                    $detected++;
                } else if ($it['state'] === 'partial') {
                    $partial++;
                } else if ($it['state'] === 'uncertain') {
                    $uncertain++;
                }
            }
        }
        $out['items'] = self::present($items, $config, $attemptno);
        $out['uncertain'] = $uncertain > 0;
        $score = null;
        if ($config['mode'] === 'score' && $required) {
            $score = round(100 * ($detected + 0.5 * $partial) / $required);
        }
        $out['summary'] = ['detected' => $detected, 'partial' => $partial, 'uncertain' => $uncertain, 'total' => $required];
        return self::finish($out, $states, $detected, $required, $score);
    }

    /**
     * How a concept shows in the answer.
     *
     * @param array $sents marked sentences
     * @param array $phrases wording, alternatives with |
     * @return array [state => detected|partial|missing|uncertain, slip => bool]
     */
    public static function concept_state(array $sents, array $phrases): array {
        $f = text::find_alternatives($sents, $phrases);
        $pos = array_merge([], ...array_values($f['found']));
        $neg = array_merge([], ...array_values($f['negated']));
        if ($pos && $neg) {
            // Said both ways round.
            return ['state' => 'uncertain', 'slip' => false];
        }
        if ($pos) {
            return ['state' => 'detected', 'slip' => (bool)array_filter($pos, fn($x) => $x['slip'])];
        }
        if ($neg) {
            return ['state' => 'uncertain', 'slip' => false];
        }
        // Most of the words of one wording in one sentence, stated the right way round: part-way.
        foreach (text::alternatives($phrases) as $alt) {
            foreach ($alt['alts'] as $a) {
                $terms = $a['terms'];
                if (count($terms) < 2) {
                    continue;
                }
                foreach ($sents as $s) {
                    $got = 0;
                    foreach ($terms as $t) {
                        foreach ($s['tk'] as $tok) {
                            if (empty($tok['neg']) && empty($tok['negword']) && sense::term_match($tok, $t)) {
                                $got++;
                                break;
                            }
                        }
                    }
                    if ($got >= 2 && $got / count($terms) >= 0.5) {
                        return ['state' => 'partial', 'slip' => false];
                    }
                }
            }
        }
        return ['state' => 'missing', 'slip' => false];
    }

    /**
     * What the student sees for each item, in the chosen mode.
     *
     * @param array $items
     * @param array $config
     * @param int $attemptno
     * @return array
     */
    public static function present(array $items, array $config, int $attemptno): array {
        $mode = $config['mode'];
        $out = [];
        foreach ($items as $it) {
            $c = $it['src'];
            $state = $it['state'];
            $show = ['id' => $it['id'], 'kind' => $it['kind'], 'state' => $state, 'label' => '', 'message' => '',
                'hint' => '', 'resource' => null, 'required' => (int)$it['required']];
            $named = $state === 'detected' || $state === 'uncertain' ||
                ($mode !== 'hints' && !empty($config['namemissing']));
            if ($it['kind'] === 'order') {
                $show['label'] = self::s('if_order_label');
                $show['message'] = self::s('if_order');
                $out[] = $show;
                continue;
            }
            if ($named) {
                $show['label'] = $c['label'] ?? '';
            }
            switch ($state) {
                case 'detected':
                    $show['message'] = ($c['found'] ?? '') !== '' ? $c['found'] : '';
                    if ($it['slip']) {
                        $show['message'] = trim($show['message'] . ' ' . self::s('if_spelling'));
                    }
                    break;
                case 'partial':
                    $show['message'] = ($c['partial'] ?? '') !== '' ? $c['partial'] :
                        ($it['kind'] === 'term' && $it['slip'] ? self::s('if_termspelling') : self::s('if_partial'));
                    break;
                case 'uncertain':
                    $show['message'] = self::s('if_uncertain');
                    break;
                case 'wrong':
                    $show['message'] = ($c['wrong'] ?? '') !== '' ? $c['wrong'] : self::s('if_valuewrong', s($it['have'] ?? ''));
                    break;
                default:
                    $show['message'] = ($c['missing'] ?? '') !== '' ? $c['missing'] : self::s($named ? 'if_missing' :
                        'if_missing_unnamed');
            }
            if (in_array($state, ['missing', 'partial', 'wrong'], true)) {
                $hints = $c['hints'] ?? [];
                if ($hints) {
                    $show['hint'] = $hints[min(max(0, $attemptno - 1), count($hints) - 1)];
                }
                if ($mode === 'hints') {
                    // Hints only: no teacher explanation of the missing idea until the hints run out.
                    if ($hints && $attemptno <= count($hints)) {
                        $show['message'] = '';
                    }
                }
                if (!empty($c['resource'])) {
                    $show['resource'] = self::resource((int)$c['resource']);
                }
            }
            $out[] = $show;
        }
        return $out;
    }

    /**
     * A learning resource link.
     *
     * @param int $cmid
     * @return array|null [name, url]
     */
    protected static function resource(int $cmid): ?array {
        try {
            [$course, $cm] = get_course_and_cm_from_cmid($cmid);
            if (!$cm->uservisible || !$cm->url) {
                return null;
            }
            return ['name' => format_string($cm->name, true, ['context' => \context_module::instance($cm->id)]),
                'url' => $cm->url->out(false)];
        } catch (\Throwable $e) {
            return null;
        }
    }

    /**
     * Close off a result.
     *
     * @param array $out
     * @param array $states
     * @param int $detected
     * @param int $total
     * @param float|null $score
     * @return array
     */
    protected static function finish(array $out, array $states, int $detected, int $total, ?float $score): array {
        $out['score'] = $score;
        $out['disclaimer'] = self::s('if_disclaimer');
        return ['result' => $out, 'states' => $states, 'detected' => $detected, 'total' => $total, 'score' => $score];
    }
}
