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

namespace local_fastgrade\local;
/**
 * Auto-marking look-for rules. Matching itself runs in the marker's browser against the text being
 * shown, so suggestions line up exactly with what is on screen; no AI service is involved.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class lookfors {
    /** Rule kinds. */
    const KINDS = [
        'term', 'anyof', 'pattern', 'mustnot', 'length', 'structure', 'threshold', 'keypoints', 'parts', 'compliance',
        'sources', 'ideas',
    ];

    /**
     * Rules for an activity, grouped by criterion key.
     *
     * @param int $cmid
     * @return array
     */
    public static function for_cm(int $cmid): array {
        global $DB;
        $rows = $DB->get_records('local_fastgrade_lookfor', ['cmid' => $cmid], 'criterionkey, sortorder, id');
        $out = [];
        foreach ($rows as $r) {
            $out[$r->criterionkey][] = ['kind' => $r->kind, 'config' => json_decode($r->configjson, true) ?: []];
        }
        return $out;
    }

    /**
     * Clean one rule.
     *
     * @param array $rule
     * @return array|null
     */
    protected static function clean(array $rule): ?array {
        $kind = $rule['kind'] ?? '';
        if (!in_array($kind, self::KINDS)) {
            return null;
        }
        $c = (array)($rule['config'] ?? []);
        $terms = [];
        foreach ((array)($c['terms'] ?? []) as $t) {
            $t = trim(clean_param((string)$t, PARAM_TEXT));
            if ($t !== '') {
                $terms[] = \core_text::substr($t, 0, 400);
            }
        }
        $config = [
            'label' => \core_text::substr(trim(clean_param((string)($c['label'] ?? ''), PARAM_TEXT)), 0, 200),
            'terms' => array_slice($terms, 0, 50),
            'min' => max(0, min(1000, (int)($c['min'] ?? 1))),
            'max' => max(0, min(100000, (int)($c['max'] ?? 0))),
            'comment' => \core_text::substr(trim(clean_param((string)($c['comment'] ?? ''), PARAM_TEXT)), 0, 1000),
            'preset' => clean_param((string)($c['preset'] ?? ''), PARAM_ALPHANUMEXT),
            'regex' => '',
            'levelid' => (int)($c['levelid'] ?? 0),
            'partiallevelid' => (int)($c['partiallevelid'] ?? 0),
            'score' => isset($c['score']) ? (float)$c['score'] : null,
        ];
        if ($kind === 'pattern' && isset($c['regex'])) {
            $regex = (string)$c['regex'];
            // Only accept patterns that compile, are short, and use no inline code.
            if (strlen($regex) <= 200 && @preg_match('/' . str_replace('/', '\/', $regex) . '/u', '') !== false) {
                $config['regex'] = $regex;
            }
        }
        return ['kind' => $kind, 'config' => $config];
    }

    /**
     * Replace all rules for a criterion.
     *
     * @param int $cmid
     * @param string $key
     * @param array $rules
     */
    public static function save(int $cmid, string $key, array $rules): void {
        global $DB, $USER;
        $key = clean_param($key, PARAM_ALPHANUMEXT);
        if ($key === '') {
            throw new \invalid_parameter_exception('criterionkey');
        }
        $transaction = $DB->start_delegated_transaction();
        $DB->delete_records('local_fastgrade_lookfor', ['cmid' => $cmid, 'criterionkey' => $key]);
        $i = 0;
        foreach (array_slice($rules, 0, 40) as $rule) {
            $clean = self::clean((array)$rule);
            if (!$clean) {
                continue;
            }
            $DB->insert_record(
                'local_fastgrade_lookfor',
                (object)[
                    'cmid' => $cmid,
                    'criterionkey' => $key,
                    'kind' => $clean['kind'],
                    'configjson' => json_encode($clean['config']),
                    'sortorder' => $i++,
                    'usermodified' => $USER->id,
                    'timemodified' => time(),
                ]
            );
        }
        $transaction->allow_commit();
    }
}
