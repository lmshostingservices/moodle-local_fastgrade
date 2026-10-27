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

namespace local_fastgrade;

use local_fastgrade\local\source;

/**
 * Hook callbacks: send markers to Fast Grade when it is the default grader, and show the
 * "Fast Grade" button on assignment and quiz pages.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class hook_callbacks {
    /**
     * Whether the page is the core grader for an activity Fast Grade handles, for a marker.
     *
     * @return string|null 'assign' or 'quiz' when it is
     */
    protected static function core_grader_page(): ?string {
        global $PAGE;
        if (during_initial_install() || !isloggedin() || isguestuser() || !$PAGE->has_set_url() || !$PAGE->cm) {
            return null;
        }
        $path = $PAGE->url->get_path();
        $cm = $PAGE->cm;
        if (
            $cm->modname === 'assign' && preg_match('#/mod/assign/view\.php$#', $path) &&
                $PAGE->url->get_param('action') === 'grader'
        ) {
            return 'assign';
        }
        if (
            $cm->modname === 'quiz' && preg_match('#/mod/quiz/report\.php$#', $path) &&
                $PAGE->url->get_param('mode') === 'grading'
        ) {
            return 'quiz';
        }
        return null;
    }

    /**
     * Whether the current user can mark this activity in Fast Grade.
     *
     * @return bool
     */
    protected static function can_mark(): bool {
        global $PAGE;
        if (!$PAGE->cm || !source::is_enabled_for($PAGE->cm->modname)) {
            return false;
        }
        $ctx = \context_module::instance($PAGE->cm->id);
        $cap = $PAGE->cm->modname === 'quiz' ? 'mod/quiz:grade' : 'mod/assign:grade';
        return has_capability('local/fastgrade:grade', $ctx) && has_capability($cap, $ctx);
    }

    /**
     * When Fast Grade is the default, open it instead of the core grader.
     *
     * @param \core\hook\output\before_http_headers $hook
     */
    public static function before_http_headers(\core\hook\output\before_http_headers $hook): void {
        global $PAGE;
        try {
            $mod = self::core_grader_page();
            if (!$mod || !get_config('local_fastgrade', 'defaultgrader')) {
                return;
            }
            if (optional_param('classic', 0, PARAM_BOOL) || !self::can_mark() || headers_sent()) {
                return;
            }
            // Never redirect away from core grading when paid access cannot be verified.
            try {
                \local_fastgrade\local\entitlement::require_access();
            } catch (\moodle_exception $e) {
                return;
            }
            $params = ['id' => $PAGE->cm->id];
            $userid = optional_param('userid', 0, PARAM_INT);
            if ($userid) {
                $params['userid'] = $userid;
            }
            $url = new \moodle_url('/local/fastgrade/grade.php', $params);
            header('Location: ' . $url->out(false));
            exit;
        } catch (\Throwable $e) {
            debugging('Fast Grade redirect skipped: ' . $e->getMessage(), DEBUG_DEVELOPER);
        }
    }

    /**
     * Floating "Fast Grade" button on assignment and quiz pages for markers.
     *
     * @param \core\hook\output\before_standard_top_of_body_html_generation $hook
     */
    public static function before_standard_top_of_body_html_generation(
        \core\hook\output\before_standard_top_of_body_html_generation $hook
    ): void {
        global $PAGE;
        try {
            if (during_initial_install() || !isloggedin() || isguestuser() || !$PAGE->cm) {
                return;
            }
            if (
                !in_array($PAGE->cm->modname, source::supported_modules()) ||
                    !preg_match('#^mod-(assign|quiz)-#', (string)$PAGE->pagetype)
            ) {
                return;
            }
            if (self::can_mark()) {
                if (get_config('local_fastgrade', 'showfab') === '0') {
                    return;
                }
                $url = new \moodle_url('/local/fastgrade/grade.php', ['id' => $PAGE->cm->id]);
                $label = get_string('openfastgrade', 'local_fastgrade');
                $tip = get_string('openfastgrade_help', 'local_fastgrade');
                $hook->add_html(
                    \html_writer::link(
                        $url,
                        \html_writer::span('', 'fg-fab-dot') . s($label),
                        [
                            'class' => 'fg-fab',
                            'title' => $tip,
                            'aria-label' => $tip,
                            'data-fg' => 'fab',
                        ]
                    )
                );
                return;
            }
            // Students: link to annotated feedback once released.
            if ($PAGE->pagetype === 'mod-assign-view' || $PAGE->pagetype === 'mod-quiz-view') {
                $html = \local_fastgrade\local\student_feedback::banner($PAGE->cm);
                if ($html) {
                    $hook->add_html($html);
                }
            }
        } catch (\Throwable $e) {
            debugging('Fast Grade button skipped: ' . $e->getMessage(), DEBUG_DEVELOPER);
        }
    }
}
