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
 * Fast Grade marking screen.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require_once(__DIR__ . '/../../config.php');

$cmid = required_param('id', PARAM_INT);
$userid = optional_param('userid', 0, PARAM_INT);
$slot = optional_param('slot', 0, PARAM_INT);

[$course, $cm] = get_course_and_cm_from_cmid($cmid);
require_login($course, false, $cm);
$source = \local_fastgrade\local\source::for_cmid($cmid);
$context = $source->get_context();
require_capability('local/fastgrade:grade', $context);
$source->require_grade_access();

$url = new moodle_url('/local/fastgrade/grade.php', ['id' => $cmid]);
$PAGE->set_url($url);
$PAGE->set_context($context);
$PAGE->set_pagelayout('embedded');
$PAGE->activityheader->disable();
$PAGE->set_title(get_string('pagetitle', 'local_fastgrade', format_string($cm->name, true, ['context' => $context])));
$PAGE->set_heading(format_string($course->fullname, true, ['context' => $context]));
$PAGE->add_body_class('fg-body');

$boot = \local_fastgrade\local\boot::data($source, $userid, $slot);

$PAGE->requires->js_call_amd('local_fastgrade/app', 'init', ['#fg-boot']);

echo $OUTPUT->header();
echo html_writer::start_div('fg-root', ['id' => 'fg-root']);
echo html_writer::tag(
    'script',
    json_encode($boot, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT),
    ['type' => 'application/json', 'id' => 'fg-boot']
);
echo html_writer::div(
    html_writer::div('', 'fg-splash-logo') .
    html_writer::div(get_string('loading', 'local_fastgrade'), 'fg-splash-text'),
    'fg-splash',
    ['id' => 'fg-app', 'aria-busy' => 'true']
);
echo html_writer::end_div();
echo $OUTPUT->footer();
