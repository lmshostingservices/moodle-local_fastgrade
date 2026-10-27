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

defined('MOODLE_INTERNAL') || die();

global $CFG;
require_once($CFG->dirroot . '/mod/assign/locallib.php');

/**
 * Assignment marking, through mod_assign's public API.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class assign_source extends source {
    /** @var \assign */
    protected \assign $assign;

    /** @var advanced_grading */
    protected advanced_grading $grading;

    /**
     * Constructor.
     *
     * @param \cm_info $cm
     */
    protected function __construct(\cm_info $cm) {
        parent::__construct($cm);
        $this->assign = new \assign($this->context, $cm, $this->course);
        $this->grading = new advanced_grading($this->context, 'mod_assign', 'submissions');
    }

    /**
     * The assign object.
     *
     * @return \assign
     */
    public function get_assign(): \assign {
        return $this->assign;
    }

    /**
     * The activity's own capability needed for marking.
     *
     * @return string
     */
    protected function activity_grade_capability(): string {
        return 'mod/assign:grade';
    }

    /**
     * Whether names are hidden (blind marking not yet revealed).
     *
     * @return bool
     */
    public function is_anonymous(): bool {
        return $this->assign->is_blind_marking();
    }

    /**
     * Whether an assignment feedback plugin is enabled and visible.
     *
     * @param string $type
     * @return bool
     */
    protected function feedback_enabled(string $type): bool {
        $plugin = $this->assign->get_feedback_plugin_by_type($type);
        return $plugin && $plugin->is_enabled() && $plugin->is_visible();
    }

    /**
     * Whether a submission plugin is enabled.
     *
     * @param string $type
     * @return bool
     */
    protected function submission_enabled(string $type): bool {
        $plugin = $this->assign->get_submission_plugin_by_type($type);
        return $plugin && $plugin->is_enabled() && $plugin->is_visible();
    }

    /**
     * Activity information for the app bootstrap.
     *
     * @return array
     */
    public function get_info(): array {
        $instance = $this->assign->get_instance();
        $gradetype = 'none';
        $scaleitems = [];
        if ($instance->grade > 0) {
            $gradetype = 'point';
        } else if ($instance->grade < 0) {
            $gradetype = 'scale';
            $menu = make_grades_menu($instance->grade);
            foreach ($menu as $value => $label) {
                $scaleitems[] = ['value' => (int)$value, 'label' => $label];
            }
        }
        $states = [];
        if ($instance->markingworkflow) {
            foreach ($this->assign->get_marking_workflow_states_for_current_user() as $key => $label) {
                $states[] = ['value' => $key, 'label' => $label];
            }
        }
        $intro = format_module_intro('assign', $instance, $this->cm->id);
        return [
            'modname' => 'assign',
            'cmid' => (int)$this->cm->id,
            'name' => format_string($instance->name, true, ['context' => $this->context]),
            'coursename' => format_string($this->course->fullname, true, ['context' => $this->context]),
            'courseshortname' => format_string($this->course->shortname, true, ['context' => $this->context]),
            'activityurl' => (new \moodle_url('/mod/assign/view.php', ['id' => $this->cm->id]))->out(false),
            'classicurl' => (new \moodle_url(
                '/mod/assign/view.php',
                [
                    'id' => $this->cm->id,
                    'action' => 'grader',
                    'classic' => 1,
                ]
            ))->out(false),
            'intro' => $intro,
            'instructions' => $this->activity_instructions(),
            'introfiles' => $this->intro_files(),
            'otherform' => $this->other_grading_form(),
            'wordlimit' => $this->submission_enabled('onlinetext') ?
                (int)(
                    $this->assign->get_submission_plugin_by_type('onlinetext')->get_config('wordlimitenabled') ?
                    $this->assign->get_submission_plugin_by_type('onlinetext')->get_config('wordlimit') : 0
                ) : 0,
            'gradetype' => $gradetype,
            'maxgrade' => $gradetype === 'point' ? (float)$instance->grade : 0,
            'scaleitems' => $scaleitems,
            'method' => $this->grading->get_method(),
            'definition' => $this->grading->export_definition(),
            'anonymous' => $this->is_anonymous(),
            'markingworkflow' => (bool)$instance->markingworkflow,
            'workflowstates' => $states,
            'teamsubmission' => (bool)$instance->teamsubmission,
            'feedbackcomments' => $this->feedback_enabled('comments'),
            'feedbackfiles' => $this->feedback_enabled('file'),
            'attemptreopenmethod' => (string)$instance->attemptreopenmethod,
            'maxattempts' => (int)$instance->maxattempts,
            'duedate' => (int)$instance->duedate,
            'cutoffdate' => (int)$instance->cutoffdate,
            'sendnotifications' => (bool)$instance->sendstudentnotifications,
            'groups' => $this->get_group_info(),
        ];
    }

    /**
     * The "Activity instructions" field (Moodle 4.0 and later), shown to students once they start.
     *
     * @return string HTML
     */
    protected function activity_instructions(): string {
        $instance = $this->assign->get_instance();
        if (empty($instance->activity)) {
            return '';
        }
        $text = file_rewrite_pluginfile_urls(
            $instance->activity,
            'pluginfile.php',
            $this->context->id,
            'mod_assign',
            'activityattachment',
            0
        );
        return format_text($text, $instance->activityformat ?? FORMAT_HTML, ['context' => $this->context]);
    }

    /**
     * Files attached to the assignment description, such as an assessment brief, for the checks to read.
     *
     * @return array [{filename, url, mimetype}]
     */
    protected function intro_files(): array {
        $out = [];
        $fs = get_file_storage();
        foreach (['introattachment', 'activityattachment'] as $area) {
            foreach ($fs->get_area_files($this->context->id, 'mod_assign', $area, 0, 'filename', false) as $f) {
                if (count($out) >= 5 || $f->get_filesize() > 20 * 1024 * 1024) {
                    continue;
                }
                $out[] = [
                    'filename' => $f->get_filename(),
                    'mimetype' => $f->get_mimetype(),
                    'url' => \moodle_url::make_pluginfile_url(
                        $f->get_contextid(),
                        $f->get_component(),
                        $f->get_filearea(),
                        $f->get_itemid(),
                        $f->get_filepath(),
                        $f->get_filename()
                    )->out(false),
                ];
            }
        }
        return $out;
    }

    /**
     * Another advanced grading form in use (for example Assignment Benchmarks): its name and the text of its
     * preview, read through Moodle's grading form API so any grading plugin can supply criteria.
     *
     * @return array {method, name, text}
     */
    protected function other_grading_form(): array {
        global $PAGE;
        $manager = get_grading_manager($this->context, 'mod_assign', 'submissions');
        $method = $manager->get_active_method();
        if (!$method || in_array($method, ['rubric', 'guide'])) {
            return [];
        }
        try {
            $controller = $manager->get_controller($method);
            if (!$controller || !$controller->is_form_defined()) {
                return [];
            }
            $definition = $controller->get_definition();
            $html = (string)$controller->render_preview($PAGE);
            $text = trim(html_to_text($html, 0, false));
            if (!empty($definition->description)) {
                $text = trim(html_to_text($definition->description, 0, false)) . "\n" . $text;
            }
            return [
                'method' => $method,
                'name' => get_string('pluginname', 'gradingform_' . $method),
                'text' => \core_text::substr($text, 0, 20000),
            ];
        } catch (\Throwable $e) {
            debugging('Fast Grade could not read the ' . $method . ' grading form: ' . $e->getMessage(), DEBUG_DEVELOPER);
            return [];
        }
    }

    /**
     * Effective due date for a user (overrides, then extension).
     *
     * @param int $userid
     * @param array $flags userid => flags record
     * @return array [duedate, extensionduedate]
     */
    protected function due_for(int $userid, array $flags): array {
        $instance = $this->assign->get_instance($userid);
        $due = (int)$instance->duedate;
        $override = $this->assign->override_exists($userid);
        if (!empty($override->duedate)) {
            $due = (int)$override->duedate;
        }
        $ext = isset($flags[$userid]) ? (int)$flags[$userid]->extensionduedate : 0;
        return [$due, $ext];
    }

    /**
     * The list of people to mark.
     *
     * @param int $groupid
     * @return array
     */
    public function get_participants(int $groupid): array {
        global $DB;
        $instance = $this->assign->get_instance();
        $users = $this->assign->list_participants($groupid, false);
        if (!$users) {
            return [];
        }
        $ids = array_keys($users);
        [$insql, $params] = $DB->get_in_or_equal($ids, SQL_PARAMS_NAMED);
        $params['assign'] = $instance->id;

        // Latest individual submissions.
        $subs = [];
        $rs = $DB->get_recordset_sql(
            "SELECT * FROM {assign_submission}
                                       WHERE assignment = :assign AND latest = 1 AND groupid = 0 AND userid $insql",
            $params
        );
        foreach ($rs as $s) {
            $subs[$s->userid] = $s;
        }
        $rs->close();

        $grades = [];
        $rs = $DB->get_recordset_sql(
            "SELECT * FROM {assign_grades} WHERE assignment = :assign AND userid $insql
                                    ORDER BY attemptnumber ASC",
            $params
        );
        foreach ($rs as $g) {
            $grades[$g->userid][(int)$g->attemptnumber] = $g;
        }
        $rs->close();

        $flags = $DB->get_records_select(
            'assign_user_flags',
            "assignment = :assign AND userid $insql",
            $params,
            '',
            'userid, extensionduedate, workflowstate, locked'
        );

        $marks = $DB->get_records_select(
            'local_fastgrade_mark',
            "cmid = :cmid AND userid $insql AND slot = 0",
            $params + ['cmid' => $this->cm->id],
            '',
            'id, userid, attempt, draftjson, timegraded'
        );
        $drafts = [];
        foreach ($marks as $m) {
            if (!empty($m->draftjson)) {
                $drafts[$m->userid . ':' . $m->attempt] = true;
            }
        }

        $anon = $this->is_anonymous();
        $out = [];
        foreach ($users as $user) {
            $uid = (int)$user->id;
            $sub = $subs[$uid] ?? null;
            if ($instance->teamsubmission) {
                $sub = $this->assign->get_group_submission($uid, 0, false) ?: $sub;
            }
            $attempt = $sub ? (int)$sub->attemptnumber : 0;
            $grade = $grades[$uid][$attempt] ?? null;
            $status = $sub ? (string)$sub->status : 'new';
            $submitted = $status === ASSIGN_SUBMISSION_STATUS_SUBMITTED;
            $hasgrade = $grade && $grade->grade !== null && (float)$grade->grade >= 0;
            $workflow = isset($flags[$uid]) ? (string)$flags[$uid]->workflowstate : '';
            $graded = $hasgrade || ($instance->markingworkflow && in_array($workflow, ['readyforrelease', 'released']));
            $needsgrading = $submitted && (!$graded || ($grade && (int)$sub->timemodified > (int)$grade->timemodified));
            [$due, $ext] = $this->due_for($uid, $flags);
            $submittedtime = $sub && $status !== 'new' ? (int)$sub->timemodified : 0;
            $late = 0;
            $limit = max($due, $ext);
            if ($submitted && $limit && $submittedtime > $limit) {
                $late = $submittedtime - $limit;
            }
            $alias = $anon ? get_string('hiddenuser', 'assign') . $this->assign->get_uniqueid_for_user($uid) : '';
            $gradedisplay = '';
            if ($hasgrade) {
                $gradedisplay = $this->format_grade((float)$grade->grade);
            }
            $out[] = [
                'person' => $this->export_person($user, $anon, $alias),
                'sortname' => $anon ? sprintf('%08d', $this->assign->get_uniqueid_for_user($uid)) :
                    \core_text::strtolower($user->lastname . ' ' . $user->firstname),
                'status' => $status,
                'submitted' => $submitted,
                'needsgrading' => $needsgrading,
                'graded' => (bool)$graded,
                'hasdraft' => isset($drafts[$uid . ':' . $attempt]),
                'late' => $late,
                'extension' => $ext,
                'duedate' => $due,
                'timesubmitted' => $submittedtime,
                'attempt' => $attempt,
                'workflowstate' => $workflow,
                'grade' => $gradedisplay,
                'locked' => isset($flags[$uid]) ? (bool)$flags[$uid]->locked : false,
            ];
        }
        return $out;
    }

    /**
     * A grade as shown in lists.
     *
     * @param float $grade
     * @return string
     */
    protected function format_grade(float $grade): string {
        $instance = $this->assign->get_instance();
        if ($instance->grade < 0) {
            $menu = make_grades_menu($instance->grade);
            return $menu[(int)$grade] ?? '';
        }
        return format_float($grade, 2, true, true) . ' / ' . format_float($instance->grade, 2, true, true);
    }

    /**
     * Load the submission for a user and attempt.
     *
     * @param int $userid
     * @param int $attempt -1 for the latest
     * @return \stdClass|null
     */
    protected function load_submission(int $userid, int $attempt): ?\stdClass {
        if ($this->assign->get_instance()->teamsubmission) {
            $sub = $this->assign->get_group_submission($userid, 0, false, $attempt);
        } else {
            $sub = $this->assign->get_user_submission($userid, false, $attempt);
        }
        return $sub ?: null;
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
        $instance = $this->assign->get_instance();
        $user = $DB->get_record('user', ['id' => $userid], '*', MUST_EXIST);
        if (
            !is_enrolled($this->context, $user, 'mod/assign:submit') &&
                !$DB->record_exists('assign_submission', ['assignment' => $instance->id, 'userid' => $userid])
        ) {
            throw new moodle_exception('usernotfound', 'local_fastgrade');
        }
        $sub = $this->load_submission($userid, $attempt);
        $attemptnumber = $sub ? (int)$sub->attemptnumber : max(0, $attempt);

        // All attempts.
        $attempts = [];
        if ($instance->teamsubmission && $sub && $sub->groupid) {
            $rows = $DB->get_records(
                'assign_submission',
                [
                    'assignment' => $instance->id,
                    'groupid' => $sub->groupid,
                    'userid' => 0,
                ],
                'attemptnumber ASC',
                'id, attemptnumber, status, timemodified'
            );
        } else {
            $rows = $DB->get_records(
                'assign_submission',
                [
                    'assignment' => $instance->id,
                    'userid' => $userid,
                    'groupid' => 0,
                ],
                'attemptnumber ASC',
                'id, attemptnumber, status, timemodified'
            );
        }
        foreach ($rows as $r) {
            $attempts[] = ['number' => (int)$r->attemptnumber, 'status' => $r->status, 'timemodified' => (int)$r->timemodified];
        }

        $docs = $sub ? $this->build_docs($sub) : [];

        // Grade.
        $mark = $this->get_mark_record($userid, $attemptnumber, 0, $sub ? (int)$sub->id : 0);
        $this->touch_opened($mark, $sub && $sub->status === ASSIGN_SUBMISSION_STATUS_SUBMITTED ? (int)$sub->timemodified : 0);

        $flags = $DB->get_records(
            'assign_user_flags',
            ['assignment' => $instance->id, 'userid' => $userid],
            '',
            'userid, extensionduedate, workflowstate, locked'
        );
        [$due, $ext] = $this->due_for($userid, $flags);
        $late = 0;
        if (
            $sub && $sub->status === ASSIGN_SUBMISSION_STATUS_SUBMITTED && max($due, $ext) &&
                (int)$sub->timemodified > max($due, $ext)
        ) {
            $late = (int)$sub->timemodified - max($due, $ext);
        }
        $anon = $this->is_anonymous();
        $alias = $anon ? get_string('hiddenuser', 'assign') . $this->assign->get_uniqueid_for_user($userid) : '';

        return [
            'userid' => $userid,
            'person' => $this->export_person($user, $anon, $alias),
            'attempt' => $attemptnumber,
            'attempts' => $attempts,
            'status' => $sub ? (string)$sub->status : 'new',
            'timesubmitted' => $sub ? (int)$sub->timemodified : 0,
            'duedate' => $due,
            'extension' => $ext,
            'late' => $late,
            'locked' => !empty($flags[$userid]->locked),
            'docs' => $docs,
            'gradestate' => $this->get_grade_state($userid, $attemptnumber),
            'markid' => (int)$mark->id,
            'draft' => $mark->draftjson ? json_decode($mark->draftjson, true) : null,
        ];
    }

    /**
     * The documents in a submission.
     *
     * @param \stdClass $sub
     * @return array
     */
    public function build_docs(\stdClass $sub): array {
        global $DB;
        $docs = [];
        if ($this->submission_enabled('onlinetext')) {
            $ot = $DB->get_record('assignsubmission_onlinetext', ['submission' => $sub->id]);
            if ($ot && trim(strip_tags($ot->onlinetext, '<img><video><audio>')) !== '') {
                $text = file_rewrite_pluginfile_urls(
                    $ot->onlinetext,
                    'pluginfile.php',
                    $this->context->id,
                    'assignsubmission_onlinetext',
                    'submissions_onlinetext',
                    $sub->id
                );
                $html = format_text(
                    $text,
                    $ot->onlineformat,
                    [
                        'context' => $this->context,
                        'noclean' => false,
                        'para' => false,
                        'filter' => false,
                    ]
                );
                $docs[] = [
                    'docref' => 'onlinetext',
                    'kind' => 'text',
                    'filename' => get_string('onlinetext', 'local_fastgrade'),
                    'html' => $html,
                    'wordcount' => count_words($ot->onlinetext),
                ];
            }
        }
        if ($this->submission_enabled('file')) {
            $fs = get_file_storage();
            $files = $fs->get_area_files(
                $this->context->id,
                'assignsubmission_file',
                'submission_files',
                $sub->id,
                'filepath, filename',
                false
            );
            foreach ($files as $file) {
                $docs[] = files::export($file);
            }
        }
        return files::sort_docs($docs);
    }

    /**
     * Annotated feedback for the current student (read only).
     *
     * @param int $userid
     * @return array|null
     */
    public function get_student_feedback(int $userid): ?array {
        $marks = student_feedback::assign_marks($this->cm, $userid);
        if (!$marks || !student_feedback::assign_released($this->assign, $userid)) {
            return null;
        }
        $mark = $marks[0];
        $sub = $this->load_submission($userid, (int)$mark->attempt);
        if (!$sub) {
            return null;
        }
        $annotations = array_values(
            array_filter(
                annotations::for_mark((int)$mark->id),
                fn($a) => $a['status'] === 'active'
            )
        );
        return [
            'docs' => $this->build_docs($sub),
            'annotations' => $annotations,
            'attempt' => (int)$mark->attempt,
            'gradestate' => $this->get_grade_state($userid, (int)$mark->attempt),
        ];
    }

    /**
     * Current grade, filling and feedback for a user's attempt.
     *
     * @param int $userid
     * @param int $attemptnumber
     * @return array
     */
    public function get_grade_state(int $userid, int $attemptnumber): array {
        global $DB;
        $grade = $this->assign->get_user_grade($userid, false, $attemptnumber);
        $feedback = '';
        if ($grade && $this->feedback_enabled('comments')) {
            $fc = $DB->get_record('assignfeedback_comments', ['grade' => $grade->id]);
            if ($fc) {
                $feedback = file_rewrite_pluginfile_urls(
                    $fc->commenttext,
                    'pluginfile.php',
                    $this->context->id,
                    'assignfeedback_comments',
                    'feedback',
                    $grade->id
                );
                if ((int)$fc->commentformat !== FORMAT_HTML) {
                    $feedback = format_text($feedback, $fc->commentformat, ['context' => $this->context]);
                }
            }
        }
        $flags = $this->assign->get_user_flags($userid, false);
        $value = null;
        if ($grade && $grade->grade !== null && (float)$grade->grade >= 0) {
            $value = (float)$grade->grade;
        }
        $grader = '';
        if ($grade && $grade->grader > 0) {
            $u = \core_user::get_user($grade->grader);
            $grader = $u ? fullname($u) : '';
        }
        return [
            'grade' => $value,
            'gradedisplay' => $value === null ? '' : $this->format_grade($value),
            'filling' => $grade ? $this->grading->export_filling((int)$grade->id) : [],
            'feedback' => $feedback,
            'workflowstate' => $flags ? (string)$flags->workflowstate : '',
            'timemodified' => $grade ? (int)$grade->timemodified : 0,
            'grader' => $grader,
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
        $instance = $this->assign->get_instance();
        if ($this->assign->grading_disabled($userid, false)) {
            throw new moodle_exception('gradinglocked', 'local_fastgrade');
        }
        $formdata = new \stdClass();
        $formdata->attemptnumber = $attempt;
        $formdata->addattempt = !empty($data['addattempt']);
        $formdata->applytoall = !empty($data['applytoall']);
        $formdata->sendstudentnotifications = isset($data['notify']) ? (bool)$data['notify'] :
            (bool)$instance->sendstudentnotifications;

        $method = $this->grading->get_method();
        if ($method) {
            $formdata->advancedgrading = $this->grading->build_form_data($data['filling'] ?? []);
            if (
                !empty($formdata->advancedgrading['criteria']) &&
                    !$this->grading->is_complete($formdata->advancedgrading)
            ) {
                throw new moodle_exception('criteriaincomplete', 'local_fastgrade');
            }
        } else {
            $grade = $data['grade'] ?? null;
            if ($grade === null || $grade === '') {
                $formdata->grade = -1;
            } else {
                $grade = (float)unformat_float((string)$grade);
                if ($instance->grade > 0 && ($grade < 0 || $grade > (float)$instance->grade)) {
                    throw new moodle_exception(
                        'gradeoutofrange',
                        'local_fastgrade',
                        '',
                        format_float(
                            $instance->grade,
                            2,
                            true,
                            true
                        )
                    );
                }
                if ($instance->grade < 0) {
                    $menu = make_grades_menu($instance->grade);
                    if (!isset($menu[(int)$grade])) {
                        throw new moodle_exception('gradeoutofrange', 'local_fastgrade', '', '');
                    }
                    $grade = (int)$grade;
                }
                $formdata->grade = $grade;
            }
        }
        if ($instance->markingworkflow && !empty($data['workflowstate'])) {
            $allowed = array_keys($this->assign->get_marking_workflow_states_for_current_user());
            $current = $this->assign->get_user_flags($userid, false);
            if (in_array($data['workflowstate'], $allowed) || ($current && $current->workflowstate === $data['workflowstate'])) {
                $formdata->workflowstate = $data['workflowstate'];
            }
        }
        if ($this->feedback_enabled('comments')) {
            $text = clean_text((string)($data['feedback'] ?? ''), FORMAT_HTML);
            // Store links to this grade's own feedback files in the portable form.
            $existing = $this->assign->get_user_grade($userid, false, $attempt);
            if ($existing) {
                $base = \moodle_url::make_pluginfile_url(
                    $this->context->id,
                    'assignfeedback_comments',
                    'feedback',
                    $existing->id,
                    '/',
                    ''
                )->out(false);
                $text = str_replace($base, '@@PLUGINFILE@@/', $text);
            }
            $formdata->assignfeedbackcomments_editor = ['text' => $text, 'format' => FORMAT_HTML];
        }

        $this->assign->save_grade($userid, $formdata);

        $mark = $this->get_mark_record($userid, $attempt, 0);
        $this->touch_graded($mark);
        $this->clear_draft($mark);
        return $this->get_grade_state($userid, $attempt);
    }

    /**
     * Remove the autosaved draft after a commit.
     *
     * @param \stdClass $mark
     */
    protected function clear_draft(\stdClass $mark): void {
        global $DB;
        $DB->set_field('local_fastgrade_mark', 'draftjson', null, ['id' => $mark->id]);
    }

    /**
     * Release grades (marking workflow) for a list of users.
     *
     * @param int[] $userids
     * @return int number released
     */
    public function release(array $userids): int {
        $instance = $this->assign->get_instance();
        if (!$instance->markingworkflow) {
            return 0;
        }
        require_capability('mod/assign:releasegrades', $this->context);
        $n = 0;
        foreach ($userids as $userid) {
            $flags = $this->assign->get_user_flags($userid, true);
            if ($flags->workflowstate === ASSIGN_MARKING_WORKFLOW_STATE_RELEASED) {
                continue;
            }
            $data = new \stdClass();
            $data->workflowstate = ASSIGN_MARKING_WORKFLOW_STATE_RELEASED;
            $data->attemptnumber = -1;
            $sub = $this->load_submission($userid, -1);
            if ($sub) {
                $data->attemptnumber = (int)$sub->attemptnumber;
            }
            $grade = $this->assign->get_user_grade($userid, false, $data->attemptnumber);
            if (!$grade) {
                continue;
            }
            $flags->workflowstate = ASSIGN_MARKING_WORKFLOW_STATE_RELEASED;
            if ($this->assign->update_user_flags($flags)) {
                $this->assign->update_grade($grade);
                $user = \core_user::get_user($userid, '*', MUST_EXIST);
                \mod_assign\event\workflow_state_updated::create_from_user(
                    $this->assign,
                    $user,
                    ASSIGN_MARKING_WORKFLOW_STATE_RELEASED
                )->trigger();
                $n++;
            }
        }
        return $n;
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
        $instance = $this->assign->get_instance();
        if (!$this->submission_enabled('onlinetext')) {
            return [];
        }
        $sql = "SELECT s.id, s.userid, s.attemptnumber, ot.onlinetext, g.id AS gradeid, g.grade
                  FROM {assign_submission} s
                  JOIN {assignsubmission_onlinetext} ot ON ot.submission = s.id
             LEFT JOIN {assign_grades} g ON g.assignment = s.assignment AND g.userid = s.userid
                       AND g.attemptnumber = s.attemptnumber
                 WHERE s.assignment = :assign AND s.latest = 1 AND s.status = :status AND s.userid > 0";
        $rows = $DB->get_records_sql($sql, ['assign' => $instance->id, 'status' => ASSIGN_SUBMISSION_STATUS_SUBMITTED], 0, 500);
        $anon = $this->is_anonymous();
        $users = $rows ? $DB->get_records_list(
            'user',
            'id',
            array_map(fn($r) => $r->userid, $rows),
            '',
            'id, firstname, lastname, firstnamephonetic, lastnamephonetic, middlename, alternatename'
        ) : [];
        $out = [];
        foreach ($rows as $r) {
            $graded = $r->grade !== null && (float)$r->grade >= 0;
            if (!$graded && !$all) {
                continue;
            }
            $name = $anon ? get_string('hiddenuser', 'assign') . $this->assign->get_uniqueid_for_user($r->userid) :
                (isset($users[$r->userid]) ? fullname($users[$r->userid]) : '');
            $out[] = [
                'key' => $r->userid . ':' . $r->attemptnumber . ':0',
                'userid' => (int)$r->userid,
                'attempt' => (int)$r->attemptnumber,
                'slot' => 0,
                'name' => $name,
                'text' => trim(html_to_text($r->onlinetext, 0, false)),
                'graded' => $graded,
                'fraction' => $graded && $instance->grade > 0 ? (float)$r->grade / (float)$instance->grade : null,
                'gradedisplay' => $graded ? $this->format_grade((float)$r->grade) : '',
                'filling' => $graded && $r->gradeid ? $this->grading->export_filling((int)$r->gradeid) : [],
            ];
        }
        return $out;
    }

    /**
     * Every submission as files for one ZIP download.
     *
     * @param bool $allversions every attempt, or only each student's latest
     * @param int $slot unused
     * @param int $groupid 0 for everyone the marker can see
     * @return array archive path => stored_file or [content string]
     */
    public function bundle(bool $allversions, int $slot, int $groupid): array {
        global $DB;
        $anon = $this->is_anonymous();
        $users = $this->assign->list_participants($groupid, false);
        $fs = get_file_storage();
        $out = [];
        if (!$users) {
            return $out;
        }
        [$in, $params] = $DB->get_in_or_equal(array_keys($users), SQL_PARAMS_NAMED);
        $params['assignment'] = $this->assign->get_instance()->id;
        $params['new'] = ASSIGN_SUBMISSION_STATUS_NEW;
        $where = "assignment = :assignment AND userid $in AND status <> :new" . ($allversions ? '' : ' AND latest = 1');
        $subs = $DB->get_records_select('assign_submission', $where, $params, 'userid, attemptnumber');
        foreach ($subs as $sub) {
            $user = $users[$sub->userid];
            $alias = $anon ? get_string('hiddenuser', 'assign') . $this->assign->get_uniqueid_for_user($sub->userid) : '';
            $base = $this->folder_name($user, $anon, $alias) . '/';
            if ($allversions) {
                $base .= get_string('attemptn', 'local_fastgrade', $sub->attemptnumber + 1) . '/';
            }
            if ($this->submission_enabled('onlinetext')) {
                $ot = $DB->get_record('assignsubmission_onlinetext', ['submission' => $sub->id]);
                if ($ot && trim(strip_tags($ot->onlinetext, '<img>')) !== '') {
                    $html = format_text($ot->onlinetext, $ot->onlineformat, ['context' => $this->context, 'filter' => false]);
                    $out[$base . clean_filename(get_string('onlinetext', 'local_fastgrade')) . '.html'] =
                        $this->html_page(get_string('onlinetext', 'local_fastgrade'), $html);
                    $embedded = $fs->get_area_files(
                        $this->context->id,
                        'assignsubmission_onlinetext',
                        'submissions_onlinetext',
                        $sub->id,
                        'filepath, filename',
                        false
                    );
                    foreach ($embedded as $f) {
                        $out[$base . 'online-text-files' . $f->get_filepath() . $f->get_filename()] = $f;
                    }
                }
            }
            if ($this->submission_enabled('file')) {
                $files = $fs->get_area_files(
                    $this->context->id,
                    'assignsubmission_file',
                    'submission_files',
                    $sub->id,
                    'filepath, filename',
                    false
                );
                foreach ($files as $f) {
                    $out[$base . ltrim($f->get_filepath(), '/') . $f->get_filename()] = $f;
                }
            }
        }
        return $out;
    }

    /**
     * Everything the activity report needs: one row per student per attempt, plus the activity's facts.
     *
     * @return array ['meta' => [...], 'rows' => [...]]
     */
    public function report_dataset(): array {
        global $DB, $CFG;
        require_once($CFG->libdir . '/gradelib.php');
        require_once($CFG->dirroot . '/grade/grading/form/lib.php');
        $instance = $this->assign->get_instance();
        $cmid = (int)$this->cm->id;
        $anon = $this->is_anonymous();
        $visible = report_facts::visible_groups($this->cm, $this->context);
        [$members, $groupnames] = report_facts::groups($this->cm);

        $users = $this->assign->list_participants(0, false);
        if ($visible !== null) {
            $users = array_filter($users, fn($u) => array_intersect($members[(int)$u->id] ?? [], $visible));
            $groupnames = array_intersect_key($groupnames, array_flip($visible));
        }
        $rows = [];
        $meta = $this->report_meta($groupnames, $anon);
        if (!$users) {
            return ['meta' => $meta, 'rows' => []];
        }
        [$in, $params] = $DB->get_in_or_equal(array_keys($users), SQL_PARAMS_NAMED);
        $params['assign'] = $instance->id;
        $subs = [];
        $records = $DB->get_records_select(
            'assign_submission',
            "assignment = :assign AND userid $in AND groupid = 0",
            $params,
            'attemptnumber ASC'
        );
        foreach ($records as $s) {
            $subs[(int)$s->userid][(int)$s->attemptnumber] = $s;
        }
        $grades = [];
        $gradeids = [];
        foreach ($DB->get_records_select('assign_grades', "assignment = :assign AND userid $in", $params) as $g) {
            $grades[(int)$g->userid][(int)$g->attemptnumber] = $g;
            $gradeids[] = (int)$g->id;
        }
        $flags = $DB->get_records_select(
            'assign_user_flags',
            "assignment = :assign AND userid $in",
            $params,
            '',
            'userid, workflowstate, extensionduedate, locked'
        );
        $feedback = [];
        if ($gradeids && $DB->get_manager()->table_exists('assignfeedback_comments')) {
            [$gin, $gparams] = $DB->get_in_or_equal($gradeids, SQL_PARAMS_NAMED);
            foreach ($DB->get_records_select('assignfeedback_comments', "grade $gin", $gparams, '', 'grade, commenttext') as $f) {
                $feedback[(int)$f->grade] = report_facts::words($f->commenttext);
            }
        }
        // Rubric levels or guide scores, from the active grading instance of each grade.
        $fillings = [];
        $defid = $this->grading->get_definition_id();
        $method = $this->grading->get_method();
        if ($defid && in_array($method, ['rubric', 'guide'])) {
            $table = $method === 'rubric' ? 'gradingform_rubric_fillings' : 'gradingform_guide_fillings';
            $cols = $method === 'rubric' ? 'f.levelid, NULL AS score' : 'NULL AS levelid, f.score';
            $sql = "SELECT f.id, gi.itemid, f.criterionid, $cols, f.remark
                      FROM {grading_instances} gi
                      JOIN {{$table}} f ON f.instanceid = gi.id
                     WHERE gi.definitionid = :def AND gi.status = :active";
            $rs = $DB->get_recordset_sql($sql, ['def' => $defid, 'active' => \gradingform_instance::INSTANCE_STATUS_ACTIVE]);
            foreach ($rs as $f) {
                $fillings[(int)$f->itemid][(int)$f->criterionid] = $f;
            }
            $rs->close();
        }
        $levelindex = [];
        foreach ($meta['criteria'] as $c) {
            foreach ($c['levels'] as $i => $l) {
                $levelindex[$l['id']] = $i;
            }
        }
        $marks = report_facts::marks($cmid);
        $annots = report_facts::annotations($cmid);
        $integrity = report_facts::integrity($cmid);
        $markerids = [];
        $max = (float)$instance->grade;
        $gradepass = (float)$meta['gradepass'];
        $scale = $meta['scale'];

        foreach ($users as $user) {
            $uid = (int)$user->id;
            [$due, $ext] = $this->due_for($uid, $flags);
            $limit = max($due, $ext);
            $usubs = $subs[$uid] ?? [];
            $ugrades = $grades[$uid] ?? [];
            $attemptnos = array_unique(array_merge(array_keys($usubs), array_keys($ugrades)));
            sort($attemptnos);
            if (!$attemptnos) {
                $attemptnos = [0];
            }
            $latestno = max($attemptnos);
            $alias = $anon ? get_string('hiddenuser', 'assign') . $this->assign->get_uniqueid_for_user($uid) : '';
            $flag = $flags[$uid] ?? null;
            foreach ($attemptnos as $no) {
                $sub = $usubs[$no] ?? null;
                $g = $ugrades[$no] ?? null;
                $status = $sub ? (string)$sub->status : 'new';
                $submitted = $status === ASSIGN_SUBMISSION_STATUS_SUBMITTED;
                $subtime = $sub && $status !== 'new' ? (int)$sub->timemodified : 0;
                $hasgrade = $g && $g->grade !== null && (float)$g->grade >= 0;
                $grade = $hasgrade ? (float)$g->grade : null;
                $workflow = $no === $latestno && $flag ? (string)$flag->workflowstate : '';
                $pct = null;
                $outcome = '';
                if ($grade !== null) {
                    if ($max > 0) {
                        $pct = round(100 * $grade / $max, 2);
                    } else if ($scale) {
                        $n = count($scale);
                        $pct = $n > 1 ? round(100 * ((int)$grade - 1) / ($n - 1), 2) : 100;
                        $outcome = $scale[(int)$grade - 1] ?? '';
                    }
                    if ($gradepass > 0) {
                        $outcome = $outcome ?: ($grade >= $gradepass ? 'pass' : 'fail');
                        if ($scale) {
                            $outcome = ($grade >= $gradepass ? 'pass|' : 'fail|') . $outcome;
                        }
                    }
                }
                $gradedtime = $hasgrade ? (int)$g->timemodified : 0;
                $mark = $marks[$uid . ':' . $no . ':0'] ?? null;
                $ann = $mark && isset($annots[$mark->id]) ? $annots[$mark->id] : report_facts::no_annotations();
                $levels = [];
                $scores = [];
                $remarks = 0;
                foreach ($g ? ($fillings[(int)$g->id] ?? []) : [] as $cid => $f) {
                    if ($f->levelid !== null && isset($levelindex[(int)$f->levelid])) {
                        $levels[$cid] = $levelindex[(int)$f->levelid];
                    }
                    if ($f->score !== null) {
                        $scores[$cid] = (float)$f->score;
                    }
                    if (trim((string)$f->remark) !== '') {
                        $remarks++;
                    }
                }
                $marker = $g && $g->grader > 0 ? (int)$g->grader : ($mark ? (int)$mark->markerid : 0);
                if ($marker) {
                    $markerids[] = $marker;
                }
                $auto = report_facts::auto($mark);
                $eg = $integrity['eg']['u' . $uid] ?? null;
                $dg = $integrity['dg'][$uid] ?? null;
                $rows[] = [
                    'key' => $uid . ':' . $no,
                    'uid' => $uid,
                    'name' => $anon ? $alias : fullname($user),
                    'sort' => $anon ? sprintf('%08d', $this->assign->get_uniqueid_for_user($uid)) :
                        \core_text::strtolower($user->lastname . ' ' . $user->firstname),
                    'groups' => $members[$uid] ?? [],
                    'attempt' => $no + 1,
                    'attempts' => count($attemptnos),
                    'latest' => $no === $latestno,
                    'status' => $status === 'new' ? 'notsubmitted' : $status,
                    'submitted' => $subtime,
                    'due' => $limit,
                    'late' => $submitted && $limit && $subtime > $limit ? $subtime - $limit : 0,
                    'ext' => $ext > 0,
                    'graded' => $hasgrade,
                    'grade' => $grade,
                    'pct' => $pct,
                    'outcome' => $outcome,
                    'marker' => $marker,
                    'gradedat' => $gradedtime,
                    'turnaround' => $hasgrade && $subtime && $gradedtime >= $subtime ? $gradedtime - $subtime : null,
                    'released' => $hasgrade && (!$instance->markingworkflow || $workflow === 'released' || $no < $latestno),
                    'workflow' => $workflow,
                    'active' => $mark ? (int)$mark->activesecs : 0,
                    'levels' => (object)$levels,
                    'scores' => (object)$scores,
                    'remarks' => $remarks,
                    'fbwords' => $g ? ($feedback[(int)$g->id] ?? 0) : 0,
                    'ann' => $ann,
                    'eg' => $eg['level'] ?? '',
                    'egscore' => $eg['score'] ?? null,
                    'dg' => $dg['level'] ?? '',
                    'dgscore' => $dg['score'] ?? null,
                    'auto' => $auto ? [
                        'grade' => $auto['grade'],
                        'levels' => (object)array_map(fn($l) => $levelindex[(int)$l] ?? null, $auto['levels'] ?? []),
                        'points' => $auto['points'] ?? [],
                    ] : null,
                ];
            }
        }
        $meta['markers'] = (object)report_facts::names($markerids);
        return ['meta' => $meta, 'rows' => $rows];
    }

    /**
     * Facts about the activity for the report.
     *
     * @param array $groupnames
     * @param bool $anon
     * @return array
     */
    protected function report_meta(array $groupnames, bool $anon): array {
        $instance = $this->assign->get_instance();
        $gi = \grade_item::fetch(
            [
                'itemtype' => 'mod',
                'itemmodule' => 'assign',
                'iteminstance' => $instance->id,
                'itemnumber' => 0,
                'courseid' => $this->cm->course,
            ]
        );
        $scale = [];
        if ((float)$instance->grade < 0) {
            $scale = array_values(make_grades_menu((int)$instance->grade));
        }
        $def = $this->grading->export_definition();
        $method = $this->grading->get_method();
        $criteria = [];
        foreach (($def['criteria'] ?? []) as $c) {
            $criteria[] = [
                'id' => (int)$c['id'],
                'name' => trim(html_to_text($method === 'guide' ? ($c['shortname'] ?? '') : ($c['description'] ?? ''), 0, false)),
                'levels' => array_map(
                    fn($l) => [
                        'id' => $l['id'],
                        'score' => $l['score'],
                        'name' => trim(html_to_text($l['definition'], 0, false)),
                    ],
                    $c['levels'] ?? []
                ),
                'max' => isset($c['maxscore']) ? (float)$c['maxscore'] : null,
            ];
        }
        return [
            'kind' => 'assign',
            'cmid' => (int)$this->cm->id,
            'name' => format_string($instance->name, true, ['context' => $this->context]),
            'course' => format_string(get_course($this->cm->course)->shortname),
            'method' => $method ?: 'simple',
            'rubricname' => $def['name'] ?? '',
            'criteria' => $criteria,
            'maxgrade' => max(0, (float)$instance->grade),
            'scale' => $scale,
            'gradepass' => $gi ? (float)$gi->gradepass : 0,
            'due' => (int)$instance->duedate,
            'workflow' => (bool)$instance->markingworkflow,
            'anonymous' => $anon,
            'groups' => (object)$groupnames,
            'sla' => (int)(get_config('local_fastgrade', 'sladays') ?: 14),
            'calculated' => time(),
            'graderurl' => (new \moodle_url('/local/fastgrade/grade.php', ['id' => $this->cm->id]))->out(false),
            'activityurl' => (new \moodle_url('/mod/assign/view.php', ['id' => $this->cm->id]))->out(false),
        ];
    }
}
