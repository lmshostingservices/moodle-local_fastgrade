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

/**
 * Adds "Check my answer" to the pages where students write: a quiz attempt (only essay questions that a
 * teacher has set up), an assignment's online text while editing, and the assignment page after
 * submitting when the teacher allows it. Nothing about the set-up is put on the page.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class page {
    /** Page types handled. */
    const PAGETYPES = ['mod-quiz-attempt', 'mod-assign-editsubmission', 'mod-assign-view'];

    /**
     * Add the student script to the current page when Instant Feedback applies.
     *
     * @param \cm_info $cm
     * @param string $pagetype
     * @return string HTML to add at the top of the page (the script's data), or ''
     */
    public static function inject(\cm_info $cm, string $pagetype): string {
        global $PAGE, $USER;
        if (!in_array($pagetype, self::PAGETYPES, true) || !config::site_enabled()) {
            return '';
        }
        $context = \context_module::instance($cm->id);
        if (!has_capability('local/fastgrade:useinstantfeedback', $context)) {
            return '';
        }
        $args = ['cmid' => (int)$cm->id, 'kind' => $cm->modname, 'targets' => []];
        if ($pagetype === 'mod-quiz-attempt') {
            $attemptid = optional_param('attempt', 0, PARAM_INT);
            if (!$attemptid) {
                return '';
            }
            $attemptobj = \mod_quiz\quiz_attempt::create($attemptid);
            if (
                (int)$attemptobj->get_userid() !== (int)$USER->id ||
                    $attemptobj->get_state() !== \mod_quiz\quiz_attempt::IN_PROGRESS
            ) {
                return '';
            }
            $quiz = $attemptobj->get_quiz();
            if (!empty($quiz->browsersecurity) && $quiz->browsersecurity !== '-') {
                return '';
            }
            $page = optional_param('page', 0, PARAM_INT);
            foreach ($attemptobj->get_slots($page) as $slot) {
                $question = $attemptobj->get_question_attempt($slot)->get_question();
                if ($question->get_type_name() !== 'essay') {
                    continue;
                }
                if (config::live((int)$cm->id, questions::qbeid((int)$question->id))) {
                    $args['targets'][] = ['slot' => (int)$slot, 'attemptid' => $attemptid,
                        'usageid' => (int)$attemptobj->get_uniqueid()];
                }
            }
        } else {
            $set = config::live((int)$cm->id, 0);
            if (!$set) {
                return '';
            }
            [$course] = get_course_and_cm_from_cmid($cm->id);
            $assign = new \assign($context, $cm, $course);
            $plugin = $assign->get_submission_plugin_by_type('onlinetext');
            if (!$plugin || !$plugin->is_enabled()) {
                return '';
            }
            $when = $set->config['when'];
            if ($pagetype === 'mod-assign-editsubmission' && in_array($when, ['practice', 'both'], true)) {
                $args['targets'][] = ['source' => 'draft'];
            } else if (
                $pagetype === 'mod-assign-view' && in_array($when, ['aftersubmit', 'both'], true) &&
                    in_array(optional_param('action', '', PARAM_ALPHA), ['', 'view'], true)
            ) {
                $sub = $assign->get_instance()->teamsubmission ? $assign->get_group_submission($USER->id, 0, false) :
                    $assign->get_user_submission($USER->id, false);
                if ($sub && $sub->status === ASSIGN_SUBMISSION_STATUS_SUBMITTED) {
                    $args['targets'][] = ['source' => 'submitted'];
                }
            }
        }
        if (!$args['targets']) {
            return '';
        }
        $args['strings'] = self::strings();
        // The data goes in the page, not in the script call, which has a size limit.
        $PAGE->requires->js_call_amd('local_fastgrade/instant/student', 'init', ['#fg-if-boot']);
        return \html_writer::tag(
            'script',
            json_encode($args, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT),
            ['type' => 'application/json', 'id' => 'fg-if-boot']
        );
    }

    /**
     * Strings the student script needs.
     *
     * @return array
     */
    public static function strings(): array {
        $keys = ['if_ui_check', 'if_ui_checking', 'if_ui_checksubmitted', 'if_ui_title', 'if_ui_detected', 'if_ui_partial',
            'if_ui_missing', 'if_ui_uncertain', 'if_ui_wrong', 'if_ui_left', 'if_ui_leftone', 'if_ui_unlimited',
            'if_ui_nomore', 'if_ui_repeat', 'if_ui_score', 'if_ui_count', 'if_ui_suggestions', 'if_ui_found',
            'if_ui_review', 'if_ui_hint', 'if_ui_resource', 'if_ui_history', 'if_ui_attempt', 'if_ui_error',
            'if_ui_warnings', 'if_ui_checks', 'if_ui_ai', 'if_ui_nextstep', 'if_ui_tryagain', 'if_ui_empty',
            'if_ui_uncertainnote', 'if_ui_close', 'if_ui_hidden', 'if_disclaimer', 'if_ui_mentioned', 'if_ui_order'];
        $out = [];
        foreach ($keys as $k) {
            $out[$k] = get_string($k, 'local_fastgrade');
        }
        return $out;
    }
}
