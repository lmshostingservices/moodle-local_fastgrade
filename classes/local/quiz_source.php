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

use moodle_exception;
use mod_quiz\quiz_attempt;
use mod_quiz\quiz_settings;

defined('MOODLE_INTERNAL') || die();

global $CFG;
require_once($CFG->dirroot . '/mod/quiz/locallib.php');

/**
 * Quiz manual marking (essays and any other manually graded question), through the question engine.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class quiz_source extends source {
    /** @var quiz_settings */
    protected quiz_settings $quizobj;

    /**
     * Constructor.
     *
     * @param \cm_info $cm
     */
    protected function __construct(\cm_info $cm) {
        parent::__construct($cm);
        $this->quizobj = quiz_settings::create($cm->instance);
    }

    /**
     * The activity's own capability needed for marking.
     *
     * @return string
     */
    protected function activity_grade_capability(): string {
        return 'mod/quiz:grade';
    }

    /**
     * Whether the marker may not see names.
     *
     * @return bool
     */
    public function is_anonymous(): bool {
        return !has_capability('quiz/grading:viewstudentnames', $this->context);
    }

    /**
     * All manually marked question attempts in finished attempts, with their latest state.
     *
     * @param int $groupid
     * @return array
     */
    protected function load_rows(int $groupid): array {
        global $DB;
        $params = ['quizid' => $this->quizobj->get_quizid(), 'finished' => quiz_attempt::FINISHED];
        $groupjoin = '';
        if ($groupid) {
            $groupjoin = 'JOIN {groups_members} gm ON gm.userid = quiza.userid AND gm.groupid = :groupid';
            $params['groupid'] = $groupid;
        }
        $sql = "SELECT qa.id AS qaid, qa.slot, qa.questionid, qa.maxmark, qa.behaviour,
                       quiza.id AS attemptid, quiza.userid, quiza.attempt AS attemptno, quiza.timefinish,
                       qas.state, qas.fraction
                  FROM {quiz_attempts} quiza
                  JOIN {question_attempts} qa ON qa.questionusageid = quiza.uniqueid
                  JOIN {question_attempt_steps} qas ON qas.questionattemptid = qa.id
                       AND qas.sequencenumber = (SELECT MAX(s2.sequencenumber) FROM {question_attempt_steps} s2
                                                  WHERE s2.questionattemptid = qa.id)
                  $groupjoin
                 WHERE quiza.quiz = :quizid AND quiza.preview = 0 AND quiza.state = :finished
                   AND (qa.behaviour = 'manualgraded' OR qas.state = 'needsgrading' OR qas.state LIKE 'mangr%')
              ORDER BY quiza.timefinish ASC, quiza.id ASC, qa.slot ASC";
        return array_values($DB->get_records_sql($sql, $params));
    }

    /**
     * Whether a question attempt state still needs marking.
     *
     * @param string $state
     * @return bool
     */
    protected static function needs(string $state): bool {
        return $state === 'needsgrading';
    }

    /**
     * Activity information for the app bootstrap.
     *
     * @return array
     */
    public function get_info(): array {
        global $DB;
        $quiz = $this->quizobj->get_quiz();
        $rows = $this->load_rows(0);
        $slots = [];
        $qids = [];
        foreach ($rows as $r) {
            $s = (int)$r->slot;
            if (!isset($slots[$s])) {
                $slots[$s] = [
                    'slot' => $s,
                    'needs' => 0,
                    'graded' => 0,
                    'all' => 0,
                    'questionids' => [],
                    'maxmark' => (float)$r->maxmark,
                ];
            }
            $slots[$s]['all']++;
            if (self::needs($r->state)) {
                $slots[$s]['needs']++;
            } else {
                $slots[$s]['graded']++;
            }
            $slots[$s]['questionids'][(int)$r->questionid] = true;
            $qids[(int)$r->questionid] = true;
        }
        $names = $qids ? $DB->get_records_list('question', 'id', array_keys($qids), '', 'id, name, qtype') : [];
        $out = [];
        ksort($slots);
        foreach ($slots as $s) {
            $variants = [];
            foreach (array_keys($s['questionids']) as $qid) {
                $variants[] = [
                    'questionid' => $qid,
                    'name' => isset($names[$qid]) ? format_string($names[$qid]->name) : '',
                    'qtype' => $names[$qid]->qtype ?? '',
                ];
            }
            $s['variants'] = $variants;
            $s['name'] = count($variants) === 1 ? $variants[0]['name'] :
                get_string('randomquestion', 'local_fastgrade', count($variants));
            $s['number'] = $s['slot'];
            unset($s['questionids']);
            $out[] = $s;
        }
        return [
            'modname' => 'quiz',
            'cmid' => (int)$this->cm->id,
            'name' => format_string($quiz->name, true, ['context' => $this->context]),
            'coursename' => format_string($this->course->fullname, true, ['context' => $this->context]),
            'courseshortname' => format_string($this->course->shortname, true, ['context' => $this->context]),
            'activityurl' => (new \moodle_url('/mod/quiz/view.php', ['id' => $this->cm->id]))->out(false),
            'classicurl' => (new \moodle_url(
                '/mod/quiz/report.php',
                [
                    'id' => $this->cm->id,
                    'mode' => 'grading',
                    'classic' => 1,
                ]
            ))->out(false),
            'intro' => format_module_intro('quiz', $quiz, $this->cm->id),
            'gradetype' => 'point',
            'maxgrade' => 0,
            'scaleitems' => [],
            'method' => '',
            'definition' => [],
            'anonymous' => $this->is_anonymous(),
            'markingworkflow' => false,
            'workflowstates' => [],
            'teamsubmission' => false,
            'feedbackcomments' => true,
            'feedbackfiles' => false,
            'slots' => $out,
            // Marker comments follow the "specific feedback" review option (a separate option on newer Moodle).
            'reviewhidescomments' => !((int)($quiz->reviewmanualcomment ?? $quiz->reviewspecificfeedback) &
                (\mod_quiz\question\display_options::AFTER_CLOSE | \mod_quiz\question\display_options::LATER_WHILE_OPEN)),
            'groups' => $this->get_group_info(),
        ];
    }

    /**
     * Stable alias for anonymous marking.
     *
     * @param int $userid
     * @return string
     */
    protected function alias(int $userid): string {
        // Stable per quiz, not guessable from the user id.
        $n = hexdec(substr(sha1($this->cm->id . ':' . $userid . ':' . get_site_identifier()), 0, 6)) % 90000 + 10000;
        return get_string('participantn', 'local_fastgrade', $n);
    }

    /**
     * Users by id.
     *
     * @param array $rows
     * @return array
     */
    protected function users_for(array $rows): array {
        global $DB;
        $ids = array_unique(array_map(fn($r) => (int)$r->userid, $rows));
        if (!$ids) {
            return [];
        }
        return $DB->get_records_list(
            'user',
            'id',
            $ids,
            '',
            \core_user\fields::for_userpic()->get_sql(
                '',
                false,
                '',
                '',
                false
            )->selects
        );
    }

    /**
     * The list of people to mark.
     *
     * @param int $groupid
     * @return array
     */
    public function get_participants(int $groupid): array {
        return $this->get_queue('student', 0, $groupid)['entries'];
    }

    /**
     * The marking queue.
     *
     * @param string $mode question (key = slot), variant (key = question id) or student
     * @param int $key
     * @param int $groupid
     * @return array
     */
    public function get_queue(string $mode, int $key, int $groupid): array {
        $rows = $this->load_rows($groupid);
        $users = $this->users_for($rows);
        $anon = $this->is_anonymous();
        $entries = [];
        if ($mode === 'student') {
            $byattempt = [];
            foreach ($rows as $r) {
                $a = (int)$r->attemptid;
                if (!isset($byattempt[$a])) {
                    $byattempt[$a] = ['r' => $r, 'slots' => [], 'needs' => 0];
                }
                $byattempt[$a]['slots'][] = ['slot' => (int)$r->slot, 'needs' => self::needs($r->state), 'state' => $r->state];
                if (self::needs($r->state)) {
                    $byattempt[$a]['needs']++;
                }
            }
            foreach ($byattempt as $a => $info) {
                $r = $info['r'];
                $u = $users[$r->userid] ?? null;
                if (!$u) {
                    continue;
                }
                $first = $info['slots'][0]['slot'];
                foreach ($info['slots'] as $s) {
                    if ($s['needs']) {
                        $first = $s['slot'];
                        break;
                    }
                }
                $entries[] = $this->entry($u, $r, $anon) + [
                    'slot' => $first,
                    'slots' => $info['slots'],
                    'needsgrading' => $info['needs'] > 0,
                    'graded' => $info['needs'] === 0,
                    'needscount' => $info['needs'],
                ];
            }
        } else {
            foreach ($rows as $r) {
                if ($mode === 'question' && (int)$r->slot !== $key) {
                    continue;
                }
                if ($mode === 'variant' && (int)$r->questionid !== $key) {
                    continue;
                }
                $u = $users[$r->userid] ?? null;
                if (!$u) {
                    continue;
                }
                $mark = '';
                if (!self::needs($r->state) && $r->fraction !== null) {
                    $mark = format_float((float)$r->fraction * (float)$r->maxmark, 2, true, true) . ' / ' .
                        format_float((float)$r->maxmark, 2, true, true);
                }
                $entries[] = $this->entry($u, $r, $anon) + [
                    'slot' => (int)$r->slot,
                    'slots' => [],
                    'needsgrading' => self::needs($r->state),
                    'graded' => !self::needs($r->state),
                    'grade' => $mark,
                    'questionid' => (int)$r->questionid,
                ];
            }
        }
        return ['mode' => $mode, 'key' => $key, 'entries' => $entries];
    }

    /**
     * Common entry fields.
     *
     * @param \stdClass $u
     * @param \stdClass $r
     * @param bool $anon
     * @return array
     */
    protected function entry(\stdClass $u, \stdClass $r, bool $anon): array {
        return [
            'person' => $this->export_person($u, $anon, $this->alias((int)$u->id)),
            'sortname' => $anon ? $this->alias((int)$u->id) : \core_text::strtolower($u->lastname . ' ' . $u->firstname),
            'attempt' => (int)$r->attemptid,
            'attemptno' => (int)$r->attemptno,
            'status' => 'submitted',
            'submitted' => true,
            'late' => 0,
            'extension' => 0,
            'timesubmitted' => (int)$r->timefinish,
            'workflowstate' => '',
            'grade' => '',
            'hasdraft' => false,
            'locked' => false,
        ];
    }

    /**
     * Load and check an attempt belongs to this quiz and user.
     *
     * @param int $attemptid
     * @param int $userid
     * @return quiz_attempt
     */
    protected function load_attempt(int $attemptid, int $userid): quiz_attempt {
        $attemptobj = quiz_attempt::create($attemptid);
        if ((int)$attemptobj->get_cmid() !== (int)$this->cm->id || (int)$attemptobj->get_userid() !== $userid) {
            throw new moodle_exception('invalidattempt', 'local_fastgrade');
        }
        if (!$attemptobj->is_finished()) {
            throw new moodle_exception('attemptnotfinished', 'local_fastgrade');
        }
        return $attemptobj;
    }

    /**
     * Everything the marking screen needs for one student.
     *
     * @param int $userid
     * @param int $attempt
     * @param int $slot
     * @return array
     */
    public function get_item(int $userid, int $attempt, int $slot = 0): array {
        global $DB;
        $attemptobj = $this->load_attempt($attempt, $userid);
        if (!$slot) {
            throw new moodle_exception('invalidslot', 'local_fastgrade');
        }
        $qa = $attemptobj->get_question_attempt($slot);
        $question = $qa->get_question();
        $ctxid = $this->context->id;
        $user = $DB->get_record('user', ['id' => $userid], '*', MUST_EXIST);
        $anon = $this->is_anonymous();

        $docs = [];
        $answer = $qa->get_last_qt_var('answer');
        $step = $qa->get_last_step_with_qt_var('answer');
        $wordcount = 0;
        if ($answer !== null && $answer !== '') {
            $format = (int)$qa->get_last_qt_var('answerformat', FORMAT_HTML);
            $text = $qa->rewrite_response_pluginfile_urls($answer, $ctxid, 'answer', $step);
            if (in_array($question->responseformat ?? '', ['plain', 'monospaced'])) {
                $html = \html_writer::tag(
                    'div',
                    s($answer),
                    [
                        'class' => 'fg-plain' .
                        (($question->responseformat ?? '') === 'monospaced' ? ' fg-mono' : ''),
                    ]
                );
            } else {
                $html = format_text($text, $format, ['context' => $this->context, 'para' => false, 'filter' => false]);
            }
            $wordcount = count_words($answer);
            $docs[] = [
                'docref' => 'response',
                'kind' => 'text',
                'filename' => get_string('response', 'local_fastgrade'),
                'html' => $html,
                'wordcount' => $wordcount,
            ];
        }
        $files = $qa->get_last_qt_files('attachments', $ctxid);
        foreach ($files as $file) {
            $docs[] = files::export($file, 'rfile');
        }

        $mark = $this->get_mark_record($userid, $attempt, $slot, (int)$qa->get_database_id());
        $this->touch_opened($mark, (int)$attemptobj->get_attempt()->timefinish);

        $questiontext = $question->format_questiontext($qa);
        $graderinfo = '';
        if (!empty($question->graderinfo)) {
            $graderinfo = $question->format_text(
                $question->graderinfo,
                $question->graderinfoformat,
                $qa,
                'qtype_essay',
                'graderinfo',
                $question->id
            );
        }
        $template = '';
        if (!empty($question->responsetemplate)) {
            $template = format_text(
                $question->responsetemplate,
                $question->responsetemplateformat ?? FORMAT_HTML,
                ['context' => $this->context]
            );
        }
        $history = [];
        foreach ($qa->get_step_iterator() as $s) {
            $comment = $s->get_behaviour_var('comment');
            $m = $s->get_behaviour_var('mark');
            if ($comment !== null || $m !== null) {
                $grader = \core_user::get_user($s->get_user_id());
                $history[] = [
                    'time' => (int)$s->get_timecreated(),
                    'mark' => $m === null ? null : (float)$m,
                    'comment' => $comment === null ? '' : format_text(
                        $comment,
                        $s->get_behaviour_var('commentformat') ?? FORMAT_HTML,
                        ['context' => $this->context]
                    ),
                    'by' => $grader ? fullname($grader) : '',
                ];
            }
        }
        $criteria = $this->get_criteria((int)$question->id);

        return [
            'userid' => $userid,
            'quizattemptid' => $attempt,
            'person' => $this->export_person($user, $anon, $this->alias($userid)),
            'attempt' => $attempt,
            'attempts' => [],
            'status' => 'submitted',
            'timesubmitted' => (int)$attemptobj->get_attempt()->timefinish,
            'duedate' => 0,
            'extension' => 0,
            'late' => 0,
            'locked' => false,
            'docs' => $docs,
            'question' => [
                'slot' => $slot,
                'number' => $attemptobj->get_question_number($slot),
                'questionid' => (int)$question->id,
                'name' => format_string($question->name),
                'qtype' => $question->get_type_name(),
                'text' => $questiontext,
                'graderinfo' => $graderinfo,
                'template' => $template,
                'minwords' => (int)($question->minwordlimit ?? 0),
                'maxwords' => (int)($question->maxwordlimit ?? 0),
                'wordcount' => $wordcount,
                'maxmark' => (float)$qa->get_max_mark(),
                'minfraction' => (float)$qa->get_min_fraction(),
                'maxfraction' => (float)$qa->get_max_fraction(),
                'state' => (string)$qa->get_state(),
                'sequencecheck' => (int)$qa->get_sequence_check_count(),
                'history' => $history,
                'criteria' => $criteria,
            ],
            'gradestate' => $this->get_grade_state($attemptobj, $slot, $mark),
            'markid' => (int)$mark->id,
            'draft' => $mark->draftjson ? json_decode($mark->draftjson, true) : null,
        ];
    }

    /**
     * Current mark and comment for a slot.
     *
     * @param quiz_attempt $attemptobj
     * @param int $slot
     * @param \stdClass $mark
     * @return array
     */
    protected function get_grade_state(quiz_attempt $attemptobj, int $slot, \stdClass $mark): array {
        $qa = $attemptobj->get_question_attempt($slot);
        // A response waiting to be marked has no mark yet (core reports it as 0).
        $current = $qa->get_fraction() === null ? null : $qa->get_current_manual_mark();
        [$comment, $format, $commentstep] = $qa->get_manual_comment();
        $html = '';
        if ($comment !== null && $comment !== '') {
            $html = $commentstep ? $qa->rewrite_response_pluginfile_urls(
                $comment,
                $this->context->id,
                'bf_comment',
                $commentstep
            ) : $comment;
            if ((int)$format !== FORMAT_HTML) {
                $html = format_text($html, $format, ['context' => $this->context]);
            }
        }
        $filling = $mark->fillingjson ? json_decode($mark->fillingjson, true) : [];
        return [
            'grade' => $current === null ? null : (float)$current,
            'gradedisplay' => $current === null ? '' : format_float((float)$current, 2, true, true) . ' / ' .
                format_float((float)$qa->get_max_mark(), 2, true, true),
            'filling' => is_array($filling) ? $filling : [],
            'feedback' => $html,
            'workflowstate' => '',
            'timemodified' => 0,
            'grader' => '',
            'state' => (string)$qa->get_state(),
            'sequencecheck' => (int)$qa->get_sequence_check_count(),
        ];
    }

    /**
     * Save a grade and feedback.
     *
     * @param int $userid
     * @param int $attempt
     * @param int $slot
     * @param array $data
     * @return array Fresh grade state.
     */
    public function save_grade(int $userid, int $attempt, int $slot, array $data): array {
        global $DB;
        $attemptobj = $this->load_attempt($attempt, $userid);
        $qa = $attemptobj->get_question_attempt($slot);
        $maxmark = (float)$qa->get_max_mark();

        $markvalue = $data['grade'] ?? null;
        $criteria = $this->get_criteria((int)$qa->get_question()->id);
        $filling = [];
        if ($criteria && !empty($data['filling'])) {
            [$markvalue, $filling] = $this->mark_from_criteria($criteria, (array)$data['filling'], $maxmark);
        }
        if ($markvalue !== null && $markvalue !== '') {
            $markvalue = (float)unformat_float((string)$markvalue);
            $min = $qa->get_min_fraction() * $maxmark;
            $max = $qa->get_max_fraction() * $maxmark;
            if ($markvalue < $min - 0.0000001 || $markvalue > $max + 0.0000001) {
                throw new moodle_exception('gradeoutofrange', 'local_fastgrade', '', format_float($max, 2, true, true));
            }
        } else {
            $markvalue = null;
        }
        if ($maxmark == 0) {
            $markvalue = null;
        }
        $seq = isset($data['sequencecheck']) ? (int)$data['sequencecheck'] : null;
        if ($seq !== null && $seq !== (int)$qa->get_sequence_check_count()) {
            throw new moodle_exception('concurrentchange', 'local_fastgrade');
        }
        $comment = clean_text((string)($data['feedback'] ?? ''), FORMAT_HTML);

        $prefix = $qa->get_field_prefix();
        $post = [
            'slots' => (string)$slot,
            $prefix . ':sequencecheck' => $qa->get_sequence_check_count(),
            $prefix . '-comment' => $comment,
            // Core reads the comment through a (here empty) draft file area; without one it ignores the mark.
            $prefix . '-comment:itemid' => file_get_unused_draft_itemid(),
            $prefix . '-commentformat' => FORMAT_HTML,
        ];
        if ($markvalue !== null) {
            $post[$prefix . '-mark'] = $markvalue;
            $post[$prefix . '-maxmark'] = $maxmark;
            $post[$prefix . ':minfraction'] = $qa->get_min_fraction();
            $post[$prefix . ':maxfraction'] = $qa->get_max_fraction();
        }
        $transaction = $DB->start_delegated_transaction();
        $attemptobj->process_submitted_actions(time(), false, $post);
        $transaction->allow_commit();

        \mod_quiz\event\question_manually_graded::create(
            [
                'objectid' => $qa->get_question_id(),
                'courseid' => $attemptobj->get_courseid(),
                'context' => $this->context,
                'other' => ['quizid' => $attemptobj->get_quizid(), 'attemptid' => $attemptobj->get_attemptid(), 'slot' => $slot],
            ]
        )->trigger();

        $mark = $this->get_mark_record($userid, $attempt, $slot);
        $DB->update_record(
            'local_fastgrade_mark',
            (object)[
                'id' => $mark->id,
                'fillingjson' => json_encode($filling),
                'draftjson' => null,
            ]
        );
        $this->touch_graded($mark);
        $mark = $this->get_mark_record($userid, $attempt, $slot);
        $fresh = quiz_attempt::create($attempt);
        return $this->get_grade_state($fresh, $slot, $mark);
    }

    /**
     * The criteria panel for a question, if any.
     *
     * @param int $questionid
     * @return array
     */
    public function get_criteria(int $questionid): array {
        global $DB;
        $json = $DB->get_field(
            'local_fastgrade_qcrit',
            'definitionjson',
            [
                'cmid' => $this->cm->id,
                'questionid' => $questionid,
            ]
        );
        $def = $json ? json_decode($json, true) : [];
        return is_array($def) ? $def : [];
    }

    /**
     * Save the criteria panel for a question.
     *
     * @param int $questionid
     * @param array $criteria list of ['id', 'description', 'maxscore']
     * @return array
     */
    public function save_criteria(int $questionid, array $criteria): array {
        global $DB, $USER;
        $clean = [];
        $n = 1;
        foreach (array_slice($criteria, 0, 20) as $c) {
            $desc = trim(clean_param((string)($c['description'] ?? ''), PARAM_TEXT));
            $max = max(0, min(1000, (float)($c['maxscore'] ?? 0)));
            if ($desc === '' || $max <= 0) {
                continue;
            }
            $id = (int)($c['id'] ?? 0) ?: $n;
            $clean[] = ['id' => $id, 'description' => \core_text::substr($desc, 0, 500), 'maxscore' => $max];
            $n = max($n, $id) + 1;
        }
        $existing = $DB->get_record('local_fastgrade_qcrit', ['cmid' => $this->cm->id, 'questionid' => $questionid]);
        $rec = (object)[
            'cmid' => $this->cm->id,
            'questionid' => $questionid,
            'definitionjson' => json_encode($clean),
            'usermodified' => $USER->id,
            'timemodified' => time(),
        ];
        if ($existing) {
            $rec->id = $existing->id;
            $DB->update_record('local_fastgrade_qcrit', $rec);
        } else {
            $DB->insert_record('local_fastgrade_qcrit', $rec);
        }
        return $clean;
    }

    /**
     * Work out the question mark from a criteria filling.
     *
     * @param array $criteria
     * @param array $filling list of ['criterionid', 'score', 'remark']
     * @param float $maxmark
     * @return array [mark, cleaned filling]
     */
    protected function mark_from_criteria(array $criteria, array $filling, float $maxmark): array {
        $bycid = [];
        foreach ($filling as $f) {
            $bycid[(int)($f['criterionid'] ?? 0)] = $f;
        }
        $total = 0.0;
        $max = 0.0;
        $clean = [];
        foreach ($criteria as $c) {
            $max += (float)$c['maxscore'];
            $f = $bycid[(int)$c['id']] ?? null;
            if ($f === null || !isset($f['score']) || $f['score'] === '' || $f['score'] === null) {
                throw new moodle_exception('criteriaincomplete', 'local_fastgrade');
            }
            $score = max(0, min((float)$c['maxscore'], (float)$f['score']));
            $total += $score;
            $clean[] = [
                'criterionid' => (int)$c['id'],
                'score' => $score,
                'remark' => clean_param((string)($f['remark'] ?? ''), PARAM_TEXT),
            ];
        }
        $mark = $max > 0 ? round($total / $max * $maxmark, 5) : 0;
        return [$mark, $clean];
    }

    /**
     * Answers as plain text with the marks already given (for the rule test bench and grouping).
     *
     * @param int $slot quiz slot, 0 for assignments
     * @param bool $all include answers not yet marked
     * @return array
     */
    public function get_corpus(int $slot, bool $all): array {
        global $DB;
        $rows = array_values(array_filter($this->load_rows(0), fn($r) => (int)$r->slot === $slot));
        if (!$rows) {
            return [];
        }
        $qaids = array_map(fn($r) => (int)$r->qaid, $rows);
        [$insql, $params] = $DB->get_in_or_equal($qaids, SQL_PARAMS_NAMED);
        $sql = "SELECT qas.questionattemptid, qasd.value, qas.sequencenumber
                  FROM {question_attempt_steps} qas
                  JOIN {question_attempt_step_data} qasd ON qasd.attemptstepid = qas.id AND qasd.name = 'answer'
                 WHERE qas.questionattemptid $insql
              ORDER BY qas.questionattemptid, qas.sequencenumber";
        $answers = [];
        $rs = $DB->get_recordset_sql($sql, $params);
        foreach ($rs as $a) {
            $answers[$a->questionattemptid] = $a->value;
        }
        $rs->close();
        $users = $this->users_for($rows);
        $anon = $this->is_anonymous();
        $out = [];
        foreach (array_slice($rows, 0, 500) as $r) {
            $graded = !self::needs($r->state) && $r->fraction !== null;
            if (!$graded && !$all) {
                continue;
            }
            $u = $users[$r->userid] ?? null;
            $out[] = [
                'key' => $r->userid . ':' . $r->attemptid . ':' . $r->slot,
                'userid' => (int)$r->userid,
                'attempt' => (int)$r->attemptid,
                'slot' => (int)$r->slot,
                'name' => $anon ? $this->alias((int)$r->userid) : ($u ? fullname($u) : ''),
                'text' => trim(html_to_text((string)($answers[$r->qaid] ?? ''), 0, false)),
                'graded' => $graded,
                'fraction' => $graded ? (float)$r->fraction : null,
                'gradedisplay' => $graded ? format_float((float)$r->fraction * (float)$r->maxmark, 2, true, true) . ' / ' .
                    format_float((float)$r->maxmark, 2, true, true) : '',
                'filling' => [],
            ];
        }
        return $out;
    }

    /**
     * Every essay answer as files for one ZIP download.
     *
     * @param bool $allversions every finished attempt, or only each student's latest
     * @param int $slot one question, or 0 for every essay question
     * @param int $groupid 0 for everyone the marker can see
     * @return array archive path => stored_file or [content string]
     */
    public function bundle(bool $allversions, int $slot, int $groupid): array {
        global $DB;
        $rows = $this->load_rows($groupid);
        if ($slot) {
            $rows = array_values(array_filter($rows, fn($r) => (int)$r->slot === $slot));
        }
        if (!$allversions) {
            $latest = [];
            foreach ($rows as $r) {
                $k = $r->userid . ':' . $r->slot;
                if (!isset($latest[$k]) || $r->attemptno > $latest[$k]->attemptno) {
                    $latest[$k] = $r;
                }
            }
            $rows = array_values($latest);
        }
        $anon = $this->is_anonymous();
        $users = $rows ? $DB->get_records_list('user', 'id', array_unique(array_map(fn($r) => $r->userid, $rows))) : [];
        $attempts = [];
        $out = [];
        $slotnames = [];
        foreach ($rows as $r) {
            if (!isset($attempts[$r->attemptid])) {
                $attempts[$r->attemptid] = quiz_attempt::create($r->attemptid);
            }
            $qa = $attempts[$r->attemptid]->get_question_attempt((int)$r->slot);
            $question = $qa->get_question();
            if (!isset($slotnames[$r->slot])) {
                $num = $attempts[$r->attemptid]->get_question_number((int)$r->slot);
                $slotnames[$r->slot] = clean_filename(
                    get_string('questionn', 'local_fastgrade', $num) . ' - ' .
                    \core_text::substr(format_string($question->name), 0, 60)
                );
            }
            $user = $users[$r->userid];
            $base = $slotnames[$r->slot] . '/' . $this->folder_name($user, $anon, $this->alias((int)$r->userid)) . '/';
            if ($allversions) {
                $base .= get_string('attemptn', 'local_fastgrade', $r->attemptno) . '/';
            }
            $answer = $qa->get_last_qt_var('answer');
            if ($answer !== null && $answer !== '') {
                $format = (int)$qa->get_last_qt_var('answerformat', FORMAT_HTML);
                $html = in_array($question->responseformat ?? '', ['plain', 'monospaced']) ?
                    '<pre style="white-space:pre-wrap;font:inherit">' . s($answer) . '</pre>' :
                    format_text($answer, $format, ['context' => $this->context, 'filter' => false]);
                $out[$base . clean_filename(get_string('response', 'local_fastgrade')) . '.html'] =
                    $this->html_page(format_string($question->name), $html);
            }
            foreach ($qa->get_last_qt_files('attachments', $this->context->id) as $f) {
                $out[$base . $f->get_filename()] = $f;
            }
        }
        return $out;
    }

    /**
     * Everything the report needs for this quiz's essay questions: one row per student, attempt and question.
     *
     * @return array ['meta' => [...], 'rows' => [...]]
     */
    public function report_dataset(): array {
        global $DB;
        $cmid = (int)$this->cm->id;
        $quiz = $this->quizobj->get_quiz();
        $anon = $this->is_anonymous();
        $visible = report_facts::visible_groups($this->cm, $this->context);
        [$members, $groupnames] = report_facts::groups($this->cm);
        if ($visible !== null) {
            $groupnames = array_intersect_key($groupnames, array_flip($visible));
        }
        $info = $this->get_info();
        $rows = $this->load_rows(0);
        if ($visible !== null) {
            $rows = array_values(array_filter($rows, fn($r) => array_intersect($members[(int)$r->userid] ?? [], $visible)));
        }
        $criteria = [];
        foreach ($DB->get_records('local_fastgrade_qcrit', ['cmid' => $cmid]) as $q) {
            $def = json_decode((string)$q->definitionjson, true);
            if (is_array($def) && $def) {
                $criteria[(int)$q->questionid] = array_map(
                    fn($c) => [
                        'id' => (int)($c['id'] ?? 0),
                        'name' => clean_param((string)($c['description'] ?? ''), PARAM_TEXT),
                        'max' => (float)($c['maxscore'] ?? 0),
                        'levels' => [],
                    ],
                    $def
                );
            }
        }
        $meta = [
            'kind' => 'quiz',
            'cmid' => $cmid,
            'name' => format_string($quiz->name, true, ['context' => $this->context]),
            'course' => format_string($this->course->shortname, true, ['context' => $this->context]),
            'slots' => $info['slots'],
            'quizmax' => (float)$quiz->sumgrades,
            'criteria' => (object)$criteria,
            'anonymous' => $anon,
            'groups' => (object)$groupnames,
            'sla' => (int)(get_config('local_fastgrade', 'sladays') ?: 14),
            'calculated' => time(),
            'graderurl' => (new \moodle_url('/local/fastgrade/grade.php', ['id' => $cmid]))->out(false),
            'activityurl' => (new \moodle_url('/mod/quiz/view.php', ['id' => $cmid]))->out(false),
            'markers' => (object)[],
        ];
        if (!$rows) {
            return ['meta' => $meta, 'rows' => []];
        }
        $qaids = array_map(fn($r) => (int)$r->qaid, $rows);
        [$in, $params] = $DB->get_in_or_equal($qaids, SQL_PARAMS_NAMED);
        // Who marked, and when: the newest manual-grading step.
        $graded = [];
        $sql = "SELECT id, questionattemptid, userid, timecreated
                  FROM {question_attempt_steps}
                 WHERE questionattemptid $in AND state LIKE 'mangr%'
              ORDER BY sequencenumber ASC";
        $rs = $DB->get_recordset_sql($sql, $params);
        foreach ($rs as $st) {
            $graded[(int)$st->questionattemptid] = $st;
        }
        $rs->close();
        // Marker comment and the answer itself (newest value of each).
        $comments = [];
        $answers = [];
        $sql = "SELECT d.id, s.questionattemptid, d.name, d.value
                  FROM {question_attempt_step_data} d
                  JOIN {question_attempt_steps} s ON s.id = d.attemptstepid
                 WHERE s.questionattemptid $in AND d.name IN ('-comment', 'answer')
              ORDER BY s.sequencenumber ASC";
        $rs = $DB->get_recordset_sql($sql, $params);
        foreach ($rs as $d) {
            if ($d->name === '-comment') {
                $comments[(int)$d->questionattemptid] = report_facts::words($d->value);
            } else {
                $answers[(int)$d->questionattemptid] = report_facts::words($d->value);
            }
        }
        $rs->close();
        $attemptids = array_unique(array_map(fn($r) => (int)$r->attemptid, $rows));
        $sums = $DB->get_records_list('quiz_attempts', 'id', $attemptids, '', 'id, sumgrades');
        $users = $DB->get_records_list(
            'user',
            'id',
            array_unique(array_map(fn($r) => (int)$r->userid, $rows)),
            '',
            implode(',', array_merge(['id'], \core_user\fields::get_name_fields()))
        );
        $latest = [];
        $count = [];
        foreach ($rows as $r) {
            $k = $r->userid . ':' . $r->slot;
            $latest[$k] = max($latest[$k] ?? 0, (int)$r->attemptno);
            $count[$k] = ($count[$k] ?? 0) + 1;
        }
        $marks = report_facts::marks($cmid);
        $annots = report_facts::annotations($cmid);
        $integrity = report_facts::integrity($cmid);
        $qnames = [];
        foreach ($info['slots'] as $s) {
            foreach ($s['variants'] as $v) {
                $qnames[$v['questionid']] = $v['name'];
            }
        }
        $out = [];
        $markerids = [];
        foreach ($rows as $r) {
            $uid = (int)$r->userid;
            $qaid = (int)$r->qaid;
            $max = (float)$r->maxmark;
            $hasmark = $r->fraction !== null && strpos((string)$r->state, 'mangr') === 0;
            $markv = $hasmark ? round((float)$r->fraction * $max, 5) : null;
            $step = $graded[$qaid] ?? null;
            $mark = $marks[$uid . ':' . $r->attemptid . ':' . $r->slot] ?? null;
            $ann = $mark && isset($annots[$mark->id]) ? $annots[$mark->id] : report_facts::no_annotations();
            $marker = $step ? (int)$step->userid : ($mark ? (int)$mark->markerid : 0);
            if ($marker) {
                $markerids[] = $marker;
            }
            $sum = isset($sums[$r->attemptid]) && $sums[$r->attemptid]->sumgrades !== null ?
                (float)$sums[$r->attemptid]->sumgrades : null;
            $scores = [];
            if ($mark) {
                foreach ((array)json_decode((string)$mark->fillingjson, true) as $f) {
                    if (isset($f['criterionid']) && is_numeric($f['score'] ?? null)) {
                        $scores[(int)$f['criterionid']] = (float)$f['score'];
                    }
                }
            }
            $eg = $integrity['eg'][$uid . ':qa_' . $r->attemptid . ':' . $r->slot] ??
                ($integrity['eg'][$uid . ':qa_' . $r->attemptid . ':0'] ?? null);
            $auto = report_facts::auto($mark);
            $user = $users[$uid] ?? null;
            $out[] = [
                'key' => $uid . ':' . $r->attemptid . ':' . $r->slot,
                'uid' => $uid,
                'name' => $anon ? $this->alias($uid) : ($user ? fullname($user) : ''),
                'sort' => $anon ? $this->alias($uid)
                    : ($user ? \core_text::strtolower($user->lastname . ' ' . $user->firstname) : ''),
                'groups' => $members[$uid] ?? [],
                'slot' => (int)$r->slot,
                'questionid' => (int)$r->questionid,
                'question' => $qnames[(int)$r->questionid] ?? '',
                'attempt' => (int)$r->attemptno,
                'attemptid' => (int)$r->attemptid,
                'attempts' => $count[$uid . ':' . $r->slot],
                'latest' => (int)$r->attemptno === $latest[$uid . ':' . $r->slot],
                'status' => $hasmark ? 'graded' : 'needsgrading',
                'submitted' => (int)$r->timefinish,
                'graded' => $hasmark,
                'grade' => $markv,
                'max' => $max,
                'pct' => $hasmark && $max > 0 ? round(100 * $markv / $max, 2) : null,
                'outcome' => '',
                'rest' => $sum !== null && $hasmark ? round($sum - $markv, 5) : null,
                'total' => $sum,
                'marker' => $marker,
                'gradedat' => $step ? (int)$step->timecreated : 0,
                'turnaround' => $step && $r->timefinish ? max(0, (int)$step->timecreated - (int)$r->timefinish) : null,
                'released' => $hasmark,
                'active' => $mark ? (int)$mark->activesecs : 0,
                'levels' => (object)[],
                'scores' => (object)$scores,
                'remarks' => 0,
                'fbwords' => $comments[$qaid] ?? 0,
                'words' => $answers[$qaid] ?? 0,
                'ann' => $ann,
                'eg' => $eg['level'] ?? '',
                'egscore' => $eg['score'] ?? null,
                'dg' => '',
                'dgscore' => null,
                'auto' => $auto ? ['grade' => $auto['grade'], 'levels' => (object)[], 'points' => $auto['points'] ?? []] : null,
            ];
        }
        $meta['markers'] = (object)report_facts::names($markerids);
        return ['meta' => $meta, 'rows' => $out];
    }
}
