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
 * Fast Grade activity report: one assignment, or the essay questions of one quiz.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require_once(__DIR__ . '/../../config.php');

$cmid = required_param('id', PARAM_INT);

[$course, $cm] = get_course_and_cm_from_cmid($cmid);
require_login($course, false, $cm);
$context = context_module::instance($cmid);
require_capability('local/fastgrade:viewreport', $context);
$source = \local_fastgrade\local\source::for_cmid($cmid);

$PAGE->set_url(new moodle_url('/local/fastgrade/report.php', ['id' => $cmid]));
$PAGE->set_context($context);
$PAGE->set_pagelayout('embedded');
$PAGE->activityheader->disable();
$PAGE->set_title(get_string('report_pagetitle', 'local_fastgrade', format_string($cm->name, true, ['context' => $context])));
$PAGE->set_heading(format_string($course->fullname, true, ['context' => $context]));
$PAGE->add_body_class('fg-body fg-report-page');

$dataset = $source->report_dataset();
$cangrade = has_capability('local/fastgrade:grade', $context) &&
    has_capability($cm->modname === 'quiz' ? 'mod/quiz:grade' : 'mod/assign:grade', $context);
$boot = [
    'cmid' => (int)$cmid,
    'courseid' => (int)$course->id,
    'courseurl' => (new moodle_url('/course/view.php', ['id' => $course->id]))->out(false),
    'wwwroot' => $CFG->wwwroot,
    'me' => ['id' => (int)$USER->id, 'fullname' => fullname($USER)],
    'cangrade' => $cangrade,
    'minmarkern' => (int)(get_config('local_fastgrade', 'minmarkern') ?: 10),
    'prefs' => \local_fastgrade\local\prefs::get(),
    'views' => \local_fastgrade\local\report_views::list_for($cm),
    'meta' => $dataset['meta'],
    'rows' => $dataset['rows'],
    'strings' => get_string_manager()->load_component_strings('local_fastgrade', current_language()),
];
\local_fastgrade\event\report_viewed::create(['context' => $context])->trigger();

$PAGE->requires->js_call_amd('local_fastgrade/report/app', 'init', ['#fg-report-boot']);

echo $OUTPUT->header();
echo html_writer::start_div('fg-root', ['id' => 'fg-root']);
echo html_writer::tag(
    'script',
    json_encode($boot, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT),
    ['type' => 'application/json', 'id' => 'fg-report-boot']
);
echo html_writer::div(
    html_writer::div('', 'fg-splash-logo') .
    html_writer::div(get_string('report_loading', 'local_fastgrade'), 'fg-splash-text'),
    'fg-splash',
    ['id' => 'fg-app', 'aria-busy' => 'true']
);
echo html_writer::end_div();
echo $OUTPUT->footer();
