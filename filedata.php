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
 * Data for the spreadsheet, slide notes, code and zip viewers.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

define('AJAX_SCRIPT', true);

require_once(__DIR__ . '/../../config.php');

$contextid = required_param('contextid', PARAM_INT);
$fileid = required_param('fileid', PARAM_INT);
$type = required_param('type', PARAM_ALPHA);

$context = context::instance_by_id($contextid);
if ($context->contextlevel != CONTEXT_MODULE) {
    throw new moodle_exception('invalidcontext');
}
[$course, $cm] = get_course_and_cm_from_cmid($context->instanceid);
require_login($course, false, $cm);

$file = get_file_storage()->get_file_by_id($fileid);
if (!$file || (int)$file->get_contextid() !== (int)$context->id || $file->is_directory()) {
    throw new moodle_exception('invalidfile', 'local_fastgrade');
}
$allowed = has_capability('local/fastgrade:grade', $context) &&
    (has_capability('mod/assign:grade', $context) || has_capability('mod/quiz:grade', $context));
if (!$allowed && has_capability('local/fastgrade:viewfeedback', $context)) {
    $allowed = \local_fastgrade\local\student_feedback::can_view_file($cm, $context, $file);
}
if (!$allowed) {
    throw new required_capability_exception($context, 'local/fastgrade:grade', 'nopermissions', '');
}
\core\session\manager::write_close();

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, max-age=300');
try {
    $data = \local_fastgrade\local\filedata::get($file, $type);
} catch (\Throwable $e) {
    $data = ['error' => get_string('cannotreadfile', 'local_fastgrade')];
    debugging($e->getMessage(), DEBUG_DEVELOPER);
}
echo json_encode($data);
