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
 * Students: annotated feedback on their own work.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require_once(__DIR__ . '/../../config.php');

$cmid = required_param('id', PARAM_INT);
[$course, $cm] = get_course_and_cm_from_cmid($cmid, 'assign');
require_login($course, false, $cm);
$context = context_module::instance($cm->id);
require_capability('local/fastgrade:viewfeedback', $context);

$PAGE->set_url(new moodle_url('/local/fastgrade/feedback.php', ['id' => $cmid]));
$PAGE->set_context($context);
$PAGE->set_pagelayout('incourse');
$PAGE->set_title(get_string('annotatedfeedback', 'local_fastgrade') . ': ' . format_string($cm->name));
$PAGE->set_heading(format_string($course->fullname));
$PAGE->activityheader->disable();

$source = \local_fastgrade\local\source::for_cmid($cmid);
$data = $source instanceof \local_fastgrade\local\assign_source ? $source->get_student_feedback((int)$USER->id) : null;

echo $OUTPUT->header();
echo $OUTPUT->heading(get_string('annotatedfeedback', 'local_fastgrade') . ': ' . format_string($cm->name));
if (!$data) {
    echo $OUTPUT->notification(get_string('nofeedbackyet', 'local_fastgrade'), 'info');
    echo $OUTPUT->continue_button(new moodle_url('/mod/assign/view.php', ['id' => $cmid]));
    echo $OUTPUT->footer();
    die;
}
\local_fastgrade\event\feedback_viewed::create(
    [
        'context' => $context,
        'objectid' => $cm->instance,
        'relateduserid' => $USER->id,
    ]
)->trigger();
$boot = \local_fastgrade\local\boot::data($source, (int)$USER->id, 0);
$boot['feedback'] = $data;
$PAGE->requires->js_call_amd('local_fastgrade/feedback', 'init', ['#fg-boot']);
echo html_writer::tag(
    'script',
    json_encode($boot, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT),
    ['type' => 'application/json', 'id' => 'fg-boot']
);
echo html_writer::div('', 'fg-student-root', ['id' => 'fg-app']);
echo $OUTPUT->footer();
