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

defined('MOODLE_INTERNAL') || die();

global $CFG;
require_once($CFG->dirroot . '/mod/assign/locallib.php');

/**
 * What a student may see of their annotated feedback, and when.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class student_feedback {
    /**
     * Whether an assignment grade has been released to the student.
     *
     * @param \assign $assign
     * @param int $userid
     * @return bool
     */
    public static function assign_released(\assign $assign, int $userid): bool {
        $instance = $assign->get_instance();
        if ($instance->markingworkflow) {
            $flags = $assign->get_user_flags($userid, false);
            if (!$flags || $flags->workflowstate !== ASSIGN_MARKING_WORKFLOW_STATE_RELEASED) {
                return false;
            }
        }
        $gradeitem = $assign->get_grade_item();
        if ($gradeitem && $gradeitem->is_hidden()) {
            return false;
        }
        return true;
    }

    /**
     * Marking records with visible annotations for the current user in an assignment.
     *
     * @param \cm_info|\stdClass $cm
     * @param int $userid
     * @return array
     */
    public static function assign_marks($cm, int $userid): array {
        global $DB;
        $sql = "SELECT m.*
                  FROM {local_fastgrade_mark} m
                 WHERE m.cmid = :cmid AND m.userid = :userid AND m.slot = 0
                   AND EXISTS (SELECT 1 FROM {local_fastgrade_annot} a WHERE a.markid = m.id AND a.status = 'active')
              ORDER BY m.attempt DESC";
        return array_values($DB->get_records_sql($sql, ['cmid' => $cm->id, 'userid' => $userid]));
    }

    /**
     * Banner HTML for the activity page, or ''.
     *
     * @param \cm_info $cm
     * @return string
     */
    public static function banner(\cm_info $cm): string {
        global $USER;
        $context = \context_module::instance($cm->id);
        if (!has_capability('local/fastgrade:viewfeedback', $context) || $cm->modname !== 'assign') {
            return '';
        }
        $marks = self::assign_marks($cm, (int)$USER->id);
        if (!$marks) {
            return '';
        }
        $assign = new \assign($context, $cm, $cm->get_course());
        if (!self::assign_released($assign, (int)$USER->id)) {
            return '';
        }
        $url = new \moodle_url('/local/fastgrade/feedback.php', ['id' => $cm->id]);
        $label = get_string('viewannotatedfeedback', 'local_fastgrade');
        return \html_writer::link(
            $url,
            \html_writer::span('', 'fg-fab-dot fg-fab-dot--positive') . s($label),
            ['class' => 'fg-fab fg-fab--student', 'title' => $label]
        );
    }

    /**
     * Whether the current student may open a converted PDF of this file.
     *
     * @param \stdClass|\cm_info $cm
     * @param \context $context
     * @param \stored_file $file
     * @return bool
     */
    public static function can_view_file($cm, \context $context, \stored_file $file): bool {
        global $DB, $USER;
        if ($file->get_component() !== 'assignsubmission_file' || $file->get_filearea() !== 'submission_files') {
            return false;
        }
        $sub = $DB->get_record('assign_submission', ['id' => $file->get_itemid()]);
        if (!$sub) {
            return false;
        }
        $mine = (int)$sub->userid === (int)$USER->id;
        if (!$mine && $sub->groupid) {
            $mine = groups_is_member($sub->groupid, $USER->id);
        }
        if (!$mine) {
            return false;
        }
        [$course, $cminfo] = get_course_and_cm_from_cmid($cm->id);
        $assign = new \assign($context, $cminfo, $course);
        return self::assign_released($assign, (int)$USER->id);
    }
}
