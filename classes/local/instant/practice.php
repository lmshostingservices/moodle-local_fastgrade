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

defined('MOODLE_INTERNAL') || die();

global $CFG;
require_once($CFG->dirroot . '/mod/assign/locallib.php');

use moodle_exception;

/**
 * A student's practice check: who may check what, the limits, and the record kept. Practice checks
 * are stored apart from grades and never change a grade, a quiz attempt or a submission.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class practice {
    /**
     * The answer a student may check in a quiz: their own attempt, still in progress, an essay question
     * with Instant Feedback on, and a quiz that does not run in a locked browser.
     *
     * @param int $cmid
     * @param int $attemptid
     * @param int $slot
     * @return array target
     */
    public static function quiz_target(int $cmid, int $attemptid, int $slot): array {
        global $USER, $DB;
        [$course, $cm] = get_course_and_cm_from_cmid($cmid, 'quiz');
        $context = \context_module::instance($cm->id);
        $attemptobj = \mod_quiz\quiz_attempt::create($attemptid);
        if ((int)$attemptobj->get_cmid() !== (int)$cm->id || (int)$attemptobj->get_userid() !== (int)$USER->id) {
            throw new moodle_exception('if_notyours', 'local_fastgrade');
        }
        if ($attemptobj->get_state() !== \mod_quiz\quiz_attempt::IN_PROGRESS) {
            throw new moodle_exception('if_attemptclosed', 'local_fastgrade');
        }
        if (!$attemptobj->is_preview() && !has_capability('mod/quiz:attempt', $context)) {
            throw new \required_capability_exception($context, 'mod/quiz:attempt', 'nopermissions', '');
        }
        $quiz = $attemptobj->get_quiz();
        if (!empty($quiz->browsersecurity) && $quiz->browsersecurity !== '-') {
            throw new moodle_exception('if_securequiz', 'local_fastgrade');
        }
        $dbman = $DB->get_manager();
        if (
            $dbman->table_exists('quizaccess_seb_quizsettings') &&
                $DB->record_exists_select(
                    'quizaccess_seb_quizsettings',
                    'quizid = ? AND requiresafeexambrowser > 0',
                    [$quiz->id]
                )
        ) {
            throw new moodle_exception('if_securequiz', 'local_fastgrade');
        }
        if (!in_array($slot, array_map('intval', $attemptobj->get_slots()), true)) {
            throw new moodle_exception('invalidslot', 'local_fastgrade');
        }
        $qa = $attemptobj->get_question_attempt($slot);
        $question = $qa->get_question();
        if ($question->get_type_name() !== 'essay') {
            throw new moodle_exception('if_notessay', 'local_fastgrade');
        }
        $qbeid = questions::qbeid((int)$question->id);
        $set = config::live((int)$cm->id, $qbeid);
        if (!$set) {
            throw new moodle_exception('if_off', 'local_fastgrade');
        }
        return [
            'course' => $course,
            'cm' => $cm,
            'context' => $context,
            'qbeid' => $qbeid,
            'set' => $set,
            'itemkey' => 'q' . $attemptid . 's' . $slot,
            'source' => 'draft',
            'question' => trim(html_to_text((string)$question->questiontext, 0, false)),
            'template' => trim(html_to_text((string)($question->responsetemplate ?? ''), 0, false)),
            'minwords' => (int)($question->minwordlimit ?? 0),
            'maxwords' => (int)($question->maxwordlimit ?? 0),
            'response' => null,
        ];
    }

    /**
     * The answer a student may check in an assignment: their online text while they can still edit it
     * (draft), or what they submitted (submitted).
     *
     * @param int $cmid
     * @param string $source draft or submitted
     * @return array target
     */
    public static function assign_target(int $cmid, string $source): array {
        global $USER, $DB;
        [$course, $cm] = get_course_and_cm_from_cmid($cmid, 'assign');
        $context = \context_module::instance($cm->id);
        require_capability('mod/assign:submit', $context);
        $set = config::live((int)$cm->id, 0);
        if (!$set) {
            throw new moodle_exception('if_off', 'local_fastgrade');
        }
        $assign = new \assign($context, $cm, $course);
        $plugin = $assign->get_submission_plugin_by_type('onlinetext');
        if (!$plugin || !$plugin->is_enabled() || !$plugin->is_visible()) {
            throw new moodle_exception('if_noonlinetext', 'local_fastgrade');
        }
        $instance = $assign->get_instance();
        $submission = $instance->teamsubmission ? $assign->get_group_submission($USER->id, 0, false) :
            $assign->get_user_submission($USER->id, false);
        $when = $set->config['when'];
        $response = null;
        if ($source === 'submitted') {
            if (!in_array($when, ['aftersubmit', 'both'], true)) {
                throw new moodle_exception('if_off', 'local_fastgrade');
            }
            if (!$submission || $submission->status !== ASSIGN_SUBMISSION_STATUS_SUBMITTED) {
                throw new moodle_exception('if_notsubmitted', 'local_fastgrade');
            }
            if (!get_config('local_fastgrade', 'instant_aftergraded')) {
                $grade = $assign->get_user_grade($USER->id, false);
                if ($grade && $grade->grade !== null && (float)$grade->grade >= 0) {
                    throw new moodle_exception('if_graded', 'local_fastgrade');
                }
            }
            $rec = $DB->get_record('assignsubmission_onlinetext', ['submission' => $submission->id]);
            $response = $rec ? trim(html_to_text((string)$rec->onlinetext, 0, false)) : '';
        } else {
            $source = 'draft';
            if (!in_array($when, ['practice', 'both'], true)) {
                throw new moodle_exception('if_off', 'local_fastgrade');
            }
            if (!$assign->can_edit_submission($USER->id, $USER->id) || !$assign->submissions_open($USER->id)) {
                throw new moodle_exception('if_cannotedit', 'local_fastgrade');
            }
        }
        $intro = trim(html_to_text((string)$instance->intro . "\n" . (string)($instance->activity ?? ''), 0, false));
        return [
            'course' => $course,
            'cm' => $cm,
            'context' => $context,
            'qbeid' => 0,
            'set' => $set,
            'itemkey' => 'a' . ($submission ? (int)$submission->attemptnumber : 0),
            'source' => $source,
            'question' => $intro,
            'template' => '',
            'minwords' => 0,
            'maxwords' => $plugin->get_config('wordlimitenabled') ? (int)$plugin->get_config('wordlimit') : 0,
            'response' => $response,
        ];
    }

    /**
     * Previous checks of this answer by this student.
     *
     * @param array $target
     * @param int $userid
     * @return array records, oldest first
     */
    public static function previous(array $target, int $userid): array {
        global $DB;
        return array_values($DB->get_records('local_fastgrade_ifattempt', ['cmid' => $target['cm']->id,
            'userid' => $userid, 'qbeid' => $target['qbeid'], 'itemkey' => $target['itemkey']], 'attemptno ASC'));
    }

    /**
     * Checks left for this answer, or null for no limit.
     *
     * @param array $target
     * @param int $used
     * @return int|null
     */
    public static function left(array $target, int $used): ?int {
        $max = config::max_attempts($target['set']->config);
        return $max ? max(0, $max - $used) : null;
    }

    /**
     * Run a student's check and keep a record.
     *
     * @param array $target
     * @param string $response plain text (ignored for submitted work: the submission is read instead)
     * @return array student view, with attemptsleft and history
     */
    public static function check(array $target, string $response): array {
        global $DB, $USER;
        if ($target['response'] !== null) {
            $response = $target['response'];
        }
        $response = trim(preg_replace('/[ \t]+/u', ' ', $response));
        $config = $target['set']->config;
        $prev = self::previous($target, (int)$USER->id);
        $hash = hash('sha256', $response . "\0" . $target['set']->rev);
        $last = $prev ? end($prev) : null;
        // The same answer again (or a double click): show the last result, no new check is used.
        if ($last && $last->responsehash === $hash && $last->resultjson) {
            return self::view($target, $prev, json_decode($last->resultjson, true), true);
        }
        $left = self::left($target, count($prev));
        if ($left === 0) {
            $view = $last && $last->resultjson ? json_decode($last->resultjson, true) : [];
            return self::view($target, $prev, $view, true) + ['limitreached' => true];
        }
        $attemptno = count($prev) + 1;
        $ctx = ['question' => $target['question'], 'template' => $target['template'], 'minwords' => $target['minwords'],
            'maxwords' => $target['maxwords']];
        $rules = evaluator::check($config, $response, $ctx, $attemptno);
        if ($rules['result']['status'] === 'empty') {
            // Nothing written yet: shown, but no check is used and nothing is kept.
            return self::view($target, $prev, $rules['result'], true);
        }
        $res = $rules;
        $engine = 'rules';
        $credits = 0;
        if ($config['engine'] === 'ai' && $rules['result']['status'] === 'ok') {
            [$res, $engine, $credits] = ai::student($target, $config, $response, $rules, $attemptno);
        }
        $history = get_config('local_fastgrade', 'instant_history') !== '0';
        $rec = (object)[
            'courseid' => $target['course']->id,
            'cmid' => $target['cm']->id,
            'qbeid' => $target['qbeid'],
            'userid' => $USER->id,
            'itemkey' => $target['itemkey'],
            'attemptno' => $attemptno,
            'source' => $target['source'],
            'engine' => $engine,
            'responsehash' => $hash,
            'response' => $history ? $response : null,
            'resultjson' => json_encode($res['result']),
            'rulesjson' => json_encode($rules['states']),
            'detected' => $res['detected'],
            'total' => $res['total'],
            'score' => $res['score'],
            'rulesrev' => $target['set']->rev,
            'enginever' => evaluator::VERSION,
            'credits' => $credits,
            'timecreated' => time(),
        ];
        try {
            $rec->id = $DB->insert_record('local_fastgrade_ifattempt', $rec);
        } catch (\dml_write_exception $e) {
            // Two clicks at once: the other one was kept.
            $prev = self::previous($target, (int)$USER->id);
            $last = end($prev);
            return self::view($target, $prev, json_decode($last->resultjson, true) ?: [], true);
        }
        $prev[] = $rec;
        \local_fastgrade\event\instant_feedback_checked::create([
            'context' => $target['context'],
            'objectid' => $rec->id,
            'relateduserid' => $USER->id,
            'other' => ['attemptno' => $attemptno, 'engine' => $engine],
        ])->trigger();
        return self::view($target, $prev, $res['result'], false);
    }

    /**
     * The view sent back: the result, checks left and a short history.
     *
     * @param array $target
     * @param array $prev records
     * @param array $result
     * @param bool $repeat whether no new check was used
     * @return array
     */
    protected static function view(array $target, array $prev, array $result, bool $repeat): array {
        $config = $target['set']->config;
        $history = [];
        if (!empty($config['showhistory']) && get_config('local_fastgrade', 'instant_history') !== '0') {
            foreach ($prev as $p) {
                $history[] = ['attemptno' => (int)$p->attemptno, 'detected' => (int)$p->detected, 'total' => (int)$p->total,
                    'score' => $p->score === null ? null : (float)$p->score, 'time' => (int)$p->timecreated];
            }
        }
        return [
            'result' => $result,
            'attemptno' => count($prev),
            'attemptsleft' => self::left($target, count($prev)),
            'repeat' => $repeat,
            'history' => $history,
            'canretry' => !empty($config['allowretry']),
        ];
    }

    /**
     * What a student sees before checking: checks left and history, without running a check.
     *
     * @param array $target
     * @return array
     */
    public static function state(array $target): array {
        global $USER;
        $prev = self::previous($target, (int)$USER->id);
        $last = $prev ? end($prev) : null;
        $view = self::view($target, $prev, $last && $last->resultjson ? json_decode($last->resultjson, true) : [], true);
        $view['hasresult'] = (bool)$last;
        return $view;
    }
}
