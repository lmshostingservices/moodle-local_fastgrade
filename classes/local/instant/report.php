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

/**
 * Instant Feedback for teachers: trying sample answers, and the practice report. Practice results show
 * which ideas were found in the wording; they are not a measure of competence.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class report {
    /**
     * The question or task the answer is checked against.
     *
     * @param \cm_info $cm
     * @param int $qbeid
     * @return array [question, template, minwords, maxwords]
     */
    public static function task(\cm_info $cm, int $qbeid): array {
        global $DB;
        if ($cm->modname === 'quiz') {
            $q = $qbeid ? questions::latest($qbeid) : null;
            return [
                'question' => $q ? trim(html_to_text((string)$q->questiontext, 0, false)) : '',
                'template' => $q ? trim(html_to_text((string)($q->responsetemplate ?? ''), 0, false)) : '',
                'minwords' => $q ? (int)($q->minwordlimit ?? 0) : 0,
                'maxwords' => $q ? (int)($q->maxwordlimit ?? 0) : 0,
            ];
        }
        $a = $DB->get_record('assign', ['id' => $cm->instance], 'id, intro, activity');
        return ['question' => trim(html_to_text((string)$a->intro . "\n" . (string)($a->activity ?? ''), 0, false)),
            'template' => '', 'minwords' => 0, 'maxwords' => 0];
    }

    /**
     * Try an answer: exactly what a student would see, from the free rules and (when asked for, and
     * the set-up uses AI) from AI too, with where they agree.
     *
     * @param \cm_info $cm
     * @param int $qbeid
     * @param array $config cleaned set-up (not yet saved is fine)
     * @param string $text
     * @param int $attemptno
     * @param bool $withai
     * @return array
     */
    public static function preview(\cm_info $cm, int $qbeid, array $config, string $text, int $attemptno, bool $withai): array {
        global $USER;
        $task = self::task($cm, $qbeid);
        $rules = evaluator::check($config, $text, $task, $attemptno);
        $out = ['rules' => $rules['result'], 'ai' => null, 'aierror' => '', 'compare' => []];
        if ($withai && $config['engine'] === 'ai' && $rules['result']['status'] === 'ok') {
            try {
                $ai = \local_fastgrade\local\aitext::mark(
                    (int)$cm->id,
                    (int)$USER->id,
                    'student',
                    $task['question'],
                    $text,
                    ai::criteria($config),
                    $config['modelanswer']
                );
                if (!empty($ai['refused'])) {
                    $out['aierror'] = get_string('ai_refused_text', 'local_fastgrade');
                } else {
                    $merged = ai::merge($config, $rules, $ai, $attemptno);
                    $out['ai'] = $merged['result'] + ['credits' => (int)($ai['credits'] ?? 0)];
                    $out['compare'] = self::compare($config, $rules['states'], $merged['states']);
                }
            } catch (\moodle_exception $e) {
                $out['aierror'] = $e->getMessage();
            }
        }
        return $out;
    }

    /**
     * Item by item: what the rules found and what AI found.
     *
     * @param array $config
     * @param array $rules id => state
     * @param array $ai id => state
     * @return array
     */
    public static function compare(array $config, array $rules, array $ai): array {
        $out = [];
        foreach (array_merge($config['concepts'], $config['terms'], $config['values']) as $c) {
            $r = $rules[$c['id']] ?? 'missing';
            $a = $ai[$c['id']] ?? 'uncertain';
            $out[] = ['id' => $c['id'], 'label' => $c['label'], 'rules' => $r, 'ai' => $a,
                'agree' => self::credit($r) === self::credit($a)];
        }
        return $out;
    }

    /**
     * Whether a state counts as shown (for agreement).
     *
     * @param string $state
     * @return string yes, part or no
     */
    protected static function credit(string $state): string {
        return $state === 'detected' ? 'yes' : (in_array($state, ['partial', 'uncertain'], true) ? 'part' : 'no');
    }

    /**
     * The practice report for an activity or a quiz question.
     *
     * @param int $cmid
     * @param int $qbeid
     * @return array
     */
    public static function summary(int $cmid, int $qbeid): array {
        global $DB;
        $rows = $DB->get_records(
            'local_fastgrade_ifattempt',
            ['cmid' => $cmid, 'qbeid' => $qbeid],
            'userid, itemkey, attemptno',
            'id, userid, itemkey, attemptno, engine, detected, total, score, resultjson, ' .
            'rulesjson, credits, timecreated'
        );
        $set = config::get($cmid, $qbeid);
        $labels = [];
        if ($set) {
            foreach (array_merge($set->config['concepts'], $set->config['terms'], $set->config['values']) as $c) {
                $labels[$c['id']] = $c['label'] !== '' ? $c['label'] : $c['id'];
            }
        }
        $items = [];
        foreach ($rows as $r) {
            $items[$r->userid . '|' . $r->itemkey][] = $r;
        }
        $students = [];
        $missed = [];
        $found = [];
        $gains = [];
        $agree = 0;
        $compared = 0;
        $credits = 0;
        $needreview = 0;
        foreach ($items as $list) {
            $first = $list[0];
            $last = end($list);
            $uid = (int)$last->userid;
            $students[$uid] = ($students[$uid] ?? ['userid' => $uid, 'checks' => 0, 'best' => 0, 'total' => 0, 'last' => 0]);
            $students[$uid]['checks'] += count($list);
            $students[$uid]['best'] = max($students[$uid]['best'], max(array_map(fn($x) => (int)$x->detected, $list)));
            $students[$uid]['total'] = max($students[$uid]['total'], (int)$last->total);
            $students[$uid]['last'] = max($students[$uid]['last'], (int)$last->timecreated);
            if (count($list) > 1 && $last->total) {
                $gains[] = ((int)$last->detected - (int)$first->detected) / (int)$last->total;
            }
            $result = json_decode((string)$last->resultjson, true) ?: [];
            if (($result['status'] ?? '') === 'review' || !empty($result['warnings']) || !empty($result['uncertain'])) {
                $needreview++;
            }
            foreach ($result['items'] ?? [] as $it) {
                if (!isset($labels[$it['id']])) {
                    continue;
                }
                if ($it['state'] === 'detected') {
                    $found[$it['id']] = ($found[$it['id']] ?? 0) + 1;
                } else {
                    $missed[$it['id']] = ($missed[$it['id']] ?? 0) + 1;
                }
            }
            foreach ($list as $x) {
                $credits += (int)$x->credits;
                if ($x->engine === 'ai') {
                    $rs = json_decode((string)$x->rulesjson, true) ?: [];
                    $res = json_decode((string)$x->resultjson, true) ?: [];
                    foreach ($res['items'] ?? [] as $it) {
                        if (!isset($labels[$it['id']])) {
                            continue;
                        }
                        $compared++;
                        $agree += self::credit($rs[$it['id']] ?? 'missing') === self::credit($it['state']) ? 1 : 0;
                    }
                }
            }
        }
        arsort($missed);
        arsort($found);
        $named = fn($map) => array_map(fn($id, $n) => ['label' => $labels[$id], 'count' => $n], array_keys(array_slice(
            $map,
            0,
            5,
            true
        )), array_slice($map, 0, 5, true));
        $users = $students ? user_get_users_by_id(array_keys($students)) : [];
        $context = \context_module::instance($cmid);
        $people = [];
        foreach ($students as $uid => $s) {
            $people[] = $s + ['name' => isset($users[$uid]) ? fullname($users[$uid], has_capability(
                'moodle/site:viewfullnames',
                $context
            )) : '?'];
        }
        usort($people, fn($a, $b) => strcmp($a['name'], $b['name']));
        return [
            'checks' => count($rows),
            'students' => count($students),
            'answers' => count($items),
            'avgchecks' => $items ? round(count($rows) / count($items), 1) : 0,
            'improvement' => $gains ? round(100 * array_sum($gains) / count($gains)) : null,
            'missed' => $named($missed),
            'found' => $named($found),
            'needreview' => $needreview,
            'agreement' => $compared ? round(100 * $agree / $compared) : null,
            'compared' => $compared,
            'credits' => $credits,
            'people' => $people,
        ];
    }

    /**
     * One student's checks, for a teacher to review.
     *
     * @param int $cmid
     * @param int $qbeid
     * @param int $userid
     * @return array
     */
    public static function attempts(int $cmid, int $qbeid, int $userid): array {
        global $DB;
        $rows = $DB->get_records(
            'local_fastgrade_ifattempt',
            ['cmid' => $cmid, 'qbeid' => $qbeid, 'userid' => $userid],
            'itemkey, attemptno'
        );
        $out = [];
        foreach ($rows as $r) {
            $out[] = ['attemptno' => (int)$r->attemptno, 'itemkey' => $r->itemkey, 'engine' => $r->engine,
                'source' => $r->source, 'response' => (string)$r->response, 'detected' => (int)$r->detected,
                'total' => (int)$r->total, 'score' => $r->score === null ? null : (float)$r->score,
                'result' => json_decode((string)$r->resultjson, true), 'rules' => json_decode((string)$r->rulesjson, true),
                'time' => (int)$r->timecreated];
        }
        return ['attempts' => $out];
    }
}
