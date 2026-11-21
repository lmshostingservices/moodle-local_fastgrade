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
 * Teachers: set up Instant Feedback, try answers and see the practice report.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require_once(__DIR__ . '/../../config.php');

use local_fastgrade\local\instant\config;
use local_fastgrade\local\instant\questions;

$cmid = required_param('id', PARAM_INT);
$qbeid = optional_param('qbeid', 0, PARAM_INT);
[$course, $cm] = get_course_and_cm_from_cmid($cmid);
require_login($course, false, $cm);
$context = context_module::instance($cm->id);
require_capability('local/fastgrade:managecriteria', $context);
if (!in_array($cm->modname, ['quiz', 'assign'], true)) {
    throw new moodle_exception('unsupportedactivity', 'local_fastgrade');
}

$PAGE->set_url(new moodle_url('/local/fastgrade/instant.php', ['id' => $cmid]));
$PAGE->set_context($context);
$PAGE->set_pagelayout('incourse');
$PAGE->set_title(get_string('if_navtitle', 'local_fastgrade') . ': ' . format_string($cm->name));
$PAGE->set_heading(format_string($course->fullname));

echo $OUTPUT->header();
echo $OUTPUT->heading(get_string('if_navtitle', 'local_fastgrade'));

if (!config::teachers_may_enable()) {
    echo $OUTPUT->notification(get_string(config::site_enabled() ? 'if_teachersoff' : 'if_siteoff', 'local_fastgrade'), 'info');
    echo $OUTPUT->footer();
    die;
}
\local_fastgrade\local\entitlement::require_access();

$questionsout = [];
if ($cm->modname === 'quiz') {
    foreach (questions::essays($cm) as $q) {
        $set = config::get((int)$cm->id, $q['qbeid']);
        $questionsout[] = $q + ['enabled' => $set ? (bool)$set->enabled : false];
    }
} else {
    $assign = $DB->get_record('assign', ['id' => $cm->instance], '*', MUST_EXIST);
    $onlinetext = $DB->get_field('assign_plugin_config', 'value', ['assignment' => $assign->id, 'plugin' => 'onlinetext',
        'subtype' => 'assignsubmission', 'name' => 'enabled']);
    if (!$onlinetext) {
        echo $OUTPUT->notification(get_string('if_noonlinetext_teacher', 'local_fastgrade'), 'warning');
    }
}

$resources = [];
foreach (get_fast_modinfo($course)->get_cms() as $other) {
    if ($other->id != $cm->id && $other->uservisible && $other->url && !$other->deletioninprogress) {
        $resources[] = ['id' => (int)$other->id, 'name' => format_string($other->name, true, ['context' => $context])];
    }
}
$strings = [];
foreach (get_string_manager()->load_component_strings('local_fastgrade', current_language()) as $k => $v) {
    if (preg_match('/^(if_|ifs_|ai_col|ai_agree|ai_disagree|lf_v|lf_unit|lf_valueabout)/', $k)) {
        $strings[$k] = $v;
    }
}
$ai = \local_fastgrade\local\aitext::enabled_for('student');
$boot = [
    'cmid' => (int)$cm->id,
    'kind' => $cm->modname,
    'qbeid' => $qbeid,
    'questions' => $questionsout,
    'resources' => $resources,
    'sitemax' => config::site_max_attempts(),
    'ai' => ['allowed' => $ai, 'credits' => \local_fastgrade\local\aitext::CREDITS],
    'strings' => $strings,
];
echo html_writer::tag('p', get_string('if_page_intro', 'local_fastgrade'), ['class' => 'text-muted']);
echo html_writer::tag(
    'script',
    json_encode($boot, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT),
    ['type' => 'application/json', 'id' => 'fg-ifs-boot']
);
echo html_writer::div('', 'fg-ifs-root', ['id' => 'fg-ifs']);
$PAGE->requires->js_call_amd('local_fastgrade/instant/setup', 'init', ['#fg-ifs-boot']);
echo $OUTPUT->footer();
