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

/**
 * Library callbacks.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

/**
 * Add "Fast Grade" to the activity's navigation for markers.
 *
 * @param settings_navigation $nav
 * @param context $context
 */
function local_fastgrade_extend_settings_navigation(settings_navigation $nav, context $context) {
    global $PAGE;
    if ($context->contextlevel != CONTEXT_MODULE || !$PAGE->cm) {
        return;
    }
    $modname = $PAGE->cm->modname;
    if (!\local_fastgrade\local\source::is_enabled_for($modname)) {
        return;
    }
    $modnode = $nav->find('modulesettings', navigation_node::TYPE_SETTING);
    if (!$modnode) {
        return;
    }
    $cap = $modname === 'quiz' ? 'mod/quiz:grade' : 'mod/assign:grade';
    if (has_capability('local/fastgrade:grade', $context) && has_capability($cap, $context)) {
        $url = new moodle_url('/local/fastgrade/grade.php', ['id' => $PAGE->cm->id]);
        $node = $modnode->add(
            get_string('pluginname', 'local_fastgrade'),
            $url,
            navigation_node::TYPE_SETTING,
            null,
            'local_fastgrade',
            new pix_icon('i/grades', '')
        );
        $node->showinflatnavigation = true;
        $node->set_force_into_more_menu(false);
    }
    if (has_capability('local/fastgrade:viewreport', $context)) {
        $url = new moodle_url('/local/fastgrade/report.php', ['id' => $PAGE->cm->id]);
        $node = $modnode->add(
            get_string('report_navtitle', 'local_fastgrade'),
            $url,
            navigation_node::TYPE_SETTING,
            null,
            'local_fastgrade_report',
            new pix_icon('i/report', '')
        );
        $node->set_force_into_more_menu(false);
    }
}

/**
 * Serve converted PDFs and student feedback files.
 *
 * @param stdClass $course
 * @param stdClass $cm
 * @param context $context
 * @param string $filearea
 * @param array $args
 * @param bool $forcedownload
 * @param array $options
 * @return bool
 */
function local_fastgrade_pluginfile($course, $cm, $context, $filearea, $args, $forcedownload, array $options = []) {
    if ($context->contextlevel != CONTEXT_MODULE) {
        return false;
    }
    require_login($course, false, $cm);
    if ($filearea === 'converted') {
        $fileid = (int)array_shift($args);
        $source = get_file_storage()->get_file_by_id($fileid);
        if (!$source || (int)$source->get_contextid() !== (int)$context->id) {
            return false;
        }
        $allowed = has_capability('local/fastgrade:grade', $context);
        if ($allowed) {
            \local_fastgrade\local\entitlement::require_access();
        }
        if (!$allowed && has_capability('local/fastgrade:viewfeedback', $context)) {
            $allowed = \local_fastgrade\local\student_feedback::can_view_file($cm, $context, $source);
        }
        if (!$allowed) {
            return false;
        }
        $pdf = \local_fastgrade\local\files::get_converted($source);
        if (!$pdf) {
            return false;
        }
        send_stored_file($pdf, DAYSECS, 0, $forcedownload, $options);
    }
    return false;
}
