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

use local_fastgrade\local\aitext;

/**
 * Instant Feedback with AI (when a teacher chooses it and the site allows it). The free rules always
 * run as well: their result is kept for comparison, and is what the student sees if AI cannot answer.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class ai {
    /** AI status => Instant Feedback state. */
    const MAP = ['met' => 'detected', 'partial' => 'partial', 'notmet' => 'missing', 'unsure' => 'uncertain'];

    /**
     * The criteria sent to LMS Labs for a set-up.
     *
     * @param array $config
     * @return array
     */
    public static function criteria(array $config): array {
        $out = [];
        foreach ($config['concepts'] as $c) {
            $out[] = ['id' => $c['id'], 'label' => $c['label'], 'lookFor' => $c['phrases'], 'required' => (bool)$c['required']];
        }
        foreach ($config['terms'] as $c) {
            $out[] = ['id' => $c['id'], 'label' => get_string('if_ai_term', 'local_fastgrade', $c['label']),
                'lookFor' => $c['phrases'], 'required' => true];
        }
        foreach ($config['values'] as $v) {
            $range = $v['vmin'] !== '' && $v['vmax'] !== '' ? $v['vmin'] . '–' . $v['vmax'] : ($v['vmin'] !== '' ?
                '≥ ' . $v['vmin'] : '≤ ' . $v['vmax']);
            $out[] = ['id' => $v['id'], 'label' => trim($v['label'] . ' ' . $range . ' ' . $v['unit']),
                'lookFor' => $v['phrases'], 'required' => true];
        }
        return aitext::clean_text_criteria($out);
    }

    /**
     * Mark with AI for a student, falling back to the free rules.
     *
     * @param array $target
     * @param array $config
     * @param string $response
     * @param array $rules result of evaluator::check
     * @param int $attemptno
     * @return array [result like evaluator::check, engine, credits]
     */
    public static function student(array $target, array $config, string $response, array $rules, int $attemptno): array {
        global $USER;
        $fallback = function (string $why) use ($rules) {
            $rules['result']['notices'][] = ['code' => 'aifallback', 'message' => get_string(
                'if_aifallback_' . $why,
                'local_fastgrade'
            )];
            $rules['result']['engine'] = 'rules';
            return [$rules, 'fallback', 0];
        };
        if (!aitext::enabled_for('student')) {
            return $fallback('off');
        }
        try {
            $ai = aitext::mark(
                (int)$target['cm']->id,
                (int)$USER->id,
                'student',
                $target['question'],
                $response,
                self::criteria($config),
                $config['modelanswer']
            );
        } catch (\moodle_exception $e) {
            return $fallback($e->errorcode === 'ai_dailycap' ? 'cap' : 'error');
        }
        if (!empty($ai['refused'])) {
            return $fallback('error');
        }
        return [self::merge($config, $rules, $ai, $attemptno), 'ai', (int)($ai['credits'] ?? 0)];
    }

    /**
     * The AI judgement of each item, shown the same way as the rules' result. Answer-level checks and
     * banned statements still come from the rules.
     *
     * @param array $config
     * @param array $rules
     * @param array $ai
     * @param int $attemptno
     * @return array
     */
    public static function merge(array $config, array $rules, array $ai, int $attemptno): array {
        $byid = [];
        foreach ($ai['criteria'] ?? [] as $c) {
            $byid[$c['id']] = $c;
        }
        $items = [];
        $src = [];
        foreach ($config['concepts'] as $c) {
            $src[$c['id']] = ['kind' => 'concept', 'required' => (int)$c['required'], 'src' => $c];
        }
        foreach ($config['terms'] as $c) {
            $src[$c['id']] = ['kind' => 'term', 'required' => 1, 'src' => $c];
        }
        foreach ($config['values'] as $c) {
            $src[$c['id']] = ['kind' => 'value', 'required' => 1, 'src' => $c];
        }
        $states = [];
        foreach ($src as $id => $s) {
            $state = self::MAP[$byid[$id]['status'] ?? 'unsure'] ?? 'uncertain';
            if ($s['kind'] === 'value' && $state === 'missing' && ($rules['states'][$id] ?? '') === 'wrong') {
                $state = 'wrong';
            }
            $states[$id] = $state;
            $items[] = ['id' => $id, 'kind' => $s['kind'], 'state' => $state, 'slip' => false, 'required' => $s['required'],
                'src' => $s['src']];
        }
        $shown = evaluator::present($items, $config, $attemptno);
        foreach ($shown as &$it) {
            $why = $byid[$it['id']]['feedback'] ?? '';
            if ($why !== '' && ($config['mode'] !== 'hints' || $it['state'] === 'detected')) {
                $it['message'] = trim($it['message'] . ' ' . $why);
            }
        }
        unset($it);
        $detected = 0;
        $partial = 0;
        $uncertain = 0;
        $required = 0;
        foreach ($items as $it) {
            if (!$it['required']) {
                continue;
            }
            $required++;
            $detected += $it['state'] === 'detected' ? 1 : 0;
            $partial += $it['state'] === 'partial' ? 1 : 0;
            $uncertain += $it['state'] === 'uncertain' ? 1 : 0;
        }
        $result = $rules['result'];
        $result['engine'] = 'ai';
        $result['items'] = $shown;
        $result['aisummary'] = $config['mode'] === 'hints' ? '' : (string)($ai['summary'] ?? '');
        $result['summary'] = ['detected' => $detected, 'partial' => $partial, 'uncertain' => $uncertain, 'total' => $required];
        $result['uncertain'] = $uncertain > 0;
        $score = $config['mode'] === 'score' && $required ? round(100 * ($detected + 0.5 * $partial) / $required) : null;
        $result['score'] = $score;
        return ['result' => $result, 'states' => $states, 'detected' => $detected, 'total' => $required, 'score' => $score];
    }
}
