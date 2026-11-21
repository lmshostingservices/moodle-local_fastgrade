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
 * Optional AI marking of typed answers through LMS Labs AI, as an alternative to the free rules.
 *
 * Off unless a site administrator turns it on and confirms consent. Markers use it to compare with
 * the free rules; teachers may also choose it for a student Instant Feedback activity. Each answer
 * costs CREDITS LMS Labs credits; a result is kept, so the same answer with the same criteria is never
 * charged twice. Student checks have a daily credit cap. Contract: docs/lmslabs-text-marking-api.md.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class aitext extends aiimage {
    /** Credits per answer (LMS Labs may report a different price in its status). */
    const CREDITS = 1;

    /** Longest answer sent, in characters. */
    const MAXCHARS = 20000;

    /** Statuses LMS Labs may return. */
    const STATUSES = ['met', 'partial', 'notmet', 'unsure'];

    /**
     * Whether AI marking is on for markers, or for student feedback.
     *
     * @param string $audience marker or student
     * @return bool
     */
    public static function enabled_for(string $audience): bool {
        if (!get_config('local_fastgrade', 'aitext_consent')) {
            return false;
        }
        if ($audience === 'student') {
            return (bool)get_config('local_fastgrade', 'aitext_students');
        }
        return (bool)get_config('local_fastgrade', 'aitext');
    }

    /**
     * Connection status and the price of one answer.
     *
     * @param bool $fresh
     * @return array {connected, balance, credits, code}
     */
    public static function text_status(bool $fresh = false): array {
        $cache = \cache::make('local_fastgrade', 'aistatus');
        if (!$fresh && ($hit = $cache->get('textstatus'))) {
            return $hit;
        }
        [$code, $data] = static::post('/api/ai/status', ['feature' => 'text-marking'], 15);
        $out = [
            'connected' => $code === 200 && !empty($data['connected']),
            'balance' => isset($data['balance']) && (int)$data['balance'] >= 0 ? (int)$data['balance'] : null,
            'credits' => isset($data['creditsPerText']) ? max(0, (int)$data['creditsPerText']) : self::CREDITS,
            'code' => $code,
        ];
        $cache->set('textstatus', $out);
        return $out;
    }

    /**
     * Credits spent today on student checks.
     *
     * @return int
     */
    public static function spent_today(): int {
        global $DB;
        return (int)$DB->get_field_sql(
            "SELECT COALESCE(SUM(credits), 0) FROM {local_fastgrade_aitext} WHERE audience = 'student' AND timecreated >= ?",
            [usergetmidnight(time(), \core_date::get_server_timezone())]
        );
    }

    /**
     * Whether today's cap for student checks still has room.
     *
     * @return bool
     */
    public static function under_cap(): bool {
        $cap = get_config('local_fastgrade', 'aitext_dailycap');
        $cap = $cap === false ? 200 : (int)$cap;
        return !$cap || self::spent_today() + self::CREDITS <= $cap;
    }

    /**
     * Criteria in the shape LMS Labs expects: id, label, wording to look for, required.
     *
     * @param array $criteria
     * @return array
     */
    public static function clean_text_criteria(array $criteria): array {
        $out = [];
        foreach (array_slice($criteria, 0, 30) as $c) {
            $c = (array)$c;
            $label = \core_text::substr(trim(clean_param((string)($c['label'] ?? ''), PARAM_TEXT)), 0, 300);
            if ($label === '') {
                continue;
            }
            $look = [];
            foreach (array_slice((array)($c['lookFor'] ?? []), 0, 20) as $l) {
                $l = \core_text::substr(trim(clean_param((string)$l, PARAM_TEXT)), 0, 300);
                if ($l !== '') {
                    $look[] = $l;
                }
            }
            $out[] = ['id' => clean_param((string)($c['id'] ?? count($out) + 1), PARAM_ALPHANUMEXT) ?: (string)(count($out) + 1),
                'label' => $label, 'lookFor' => $look, 'required' => !empty($c['required'] ?? true)];
        }
        return $out;
    }

    /**
     * Ask LMS Labs AI to mark one typed answer against criteria.
     *
     * @param int $cmid
     * @param int $userid the student whose answer it is
     * @param string $audience marker or student
     * @param string $question question or task, plain text
     * @param string $response the answer, plain text
     * @param array $criteria cleaned with clean_text_criteria
     * @param string $model model answer or marking notes, plain text ('' for none)
     * @return array {criteria: [{id, status, evidence, feedback}], summary, credits, cached}
     */
    public static function mark(
        int $cmid,
        int $userid,
        string $audience,
        string $question,
        string $response,
        array $criteria,
        string $model = ''
    ): array {
        global $DB, $USER;
        $audience = $audience === 'student' ? 'student' : 'marker';
        if (!self::enabled_for($audience)) {
            throw new \moodle_exception('ai_textoff', 'local_fastgrade');
        }
        $question = \core_text::substr(trim($question), 0, 4000);
        $response = \core_text::substr(trim($response), 0, self::MAXCHARS);
        $model = \core_text::substr(trim($model), 0, 5000);
        $key = hash('sha256', json_encode([$audience, $question, $response, $criteria, $model]));
        if ($kept = $DB->get_record('local_fastgrade_aitext', ['requestkey' => $key, 'cmid' => $cmid], '*', IGNORE_MULTIPLE)) {
            return ['credits' => 0, 'cached' => true] + (json_decode($kept->resultjson, true) ?: []);
        }
        if ($audience === 'student' && !self::under_cap()) {
            throw new \moodle_exception('ai_dailycap', 'local_fastgrade');
        }
        $age = (string)get_config('local_fastgrade', 'aiimages_age');
        [$code, $data] = static::post('/api/ai/text-marking', [
            'requestId' => $key,
            'audience' => $audience,
            'learnerAge' => $age === 'under18' ? 'under18' : 'adult',
            'language' => current_language(),
            'question' => $question,
            'response' => $response,
            'modelAnswer' => $model,
            'criteria' => $criteria,
        ], 60);
        if ($code === 402) {
            throw new \moodle_exception('ai_nocredits', 'local_fastgrade');
        }
        if ($code === 401 || $code === 403 || $code === 404) {
            throw new \moodle_exception('ai_notconnected', 'local_fastgrade');
        }
        if ($code === 422 && ($data['error'] ?? '') === 'response_refused') {
            return ['refused' => true, 'credits' => 0, 'criteria' => [], 'summary' => ''];
        }
        if ($code !== 200 || !is_array($data) || !isset($data['result'])) {
            throw new \moodle_exception('ai_failed', 'local_fastgrade');
        }
        $res = self::clean_text_result((array)$data['result'], $criteria);
        $credits = (int)($data['creditsCharged'] ?? self::CREDITS);
        $DB->insert_record('local_fastgrade_aitext', (object)[
            'cmid' => $cmid,
            'userid' => $userid,
            'audience' => $audience,
            'requestkey' => $key,
            'resultjson' => json_encode($res),
            'credits' => $credits,
            'usermodified' => $USER->id,
            'timecreated' => time(),
        ]);
        \cache::make('local_fastgrade', 'aistatus')->delete('textstatus');
        return $res + ['credits' => $credits, 'cached' => false,
            'balance' => isset($data['balance']) && (int)$data['balance'] >= 0 ? (int)$data['balance'] : null];
    }

    /**
     * Keep only known criteria and fields.
     *
     * @param array $r
     * @param array $criteria
     * @return array
     */
    public static function clean_text_result(array $r, array $criteria): array {
        $ids = array_column($criteria, 'id');
        $out = [];
        foreach ((array)($r['criteria'] ?? []) as $c) {
            $c = (array)$c;
            $id = (string)($c['id'] ?? '');
            if (!in_array($id, $ids, true)) {
                continue;
            }
            $status = in_array($c['status'] ?? '', self::STATUSES, true) ? $c['status'] : 'unsure';
            $out[$id] = [
                'id' => $id,
                'status' => $status,
                'evidence' => \core_text::substr(clean_param((string)($c['evidence'] ?? ''), PARAM_TEXT), 0, 400),
                'feedback' => \core_text::substr(clean_param((string)($c['feedback'] ?? ''), PARAM_TEXT), 0, 600),
            ];
        }
        // Every criterion gets an answer, even one the AI left out.
        foreach ($ids as $id) {
            if (!isset($out[$id])) {
                $out[$id] = ['id' => $id, 'status' => 'unsure', 'evidence' => '', 'feedback' => ''];
            }
        }
        return [
            'criteria' => array_values($out),
            'summary' => \core_text::substr(clean_param((string)($r['summary'] ?? ''), PARAM_TEXT), 0, 1000),
        ];
    }
}
