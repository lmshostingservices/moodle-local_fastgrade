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
 * Download every submission (latest or all versions) as one ZIP.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require(__DIR__ . '/../../config.php');
require_once($CFG->libdir . '/filelib.php');

$cmid = required_param('id', PARAM_INT);
$versions = optional_param('versions', 'latest', PARAM_ALPHA);
$slot = optional_param('slot', 0, PARAM_INT);
$groupid = optional_param('group', 0, PARAM_INT);

$source = \local_fastgrade\local\source::for_cmid($cmid);
$cm = get_coursemodule_from_id('', $cmid, 0, false, MUST_EXIST);
require_login($cm->course, false, $cm);
require_sesskey();
$context = context_module::instance($cmid);
require_capability('local/fastgrade:grade', $context);
$source->require_grade_access();
if ($groupid) {
    $groups = $source->get_group_info();
    $allowed = array_map(fn($g) => (int)$g['id'], $groups['groups'] ?? []);
    if (!in_array($groupid, $allowed, true)) {
        throw new moodle_exception('nopermissions', 'error', '', 'group');
    }
}
core_php_time_limit::raise();
raise_memory_limit(MEMORY_EXTRA);

$files = $source->bundle($versions === 'all', $slot, $groupid);
if (!$files) {
    redirect(
        new moodle_url('/local/fastgrade/grade.php', ['id' => $cmid]),
        get_string('download_none', 'local_fastgrade'),
        null,
        \core\output\notification::NOTIFY_INFO
    );
}
$name = clean_filename(
    format_string($cm->name) . ' - ' .
    get_string($versions === 'all' ? 'download_allversions' : 'download_latest', 'local_fastgrade') . '.zip'
);
$tmp = make_request_directory() . '/submissions.zip';
$packer = get_file_packer('application/zip');
if (!$packer->archive_to_pathname($files, $tmp)) {
    throw new moodle_exception('download_failed', 'local_fastgrade');
}
\local_fastgrade\event\submissions_downloaded::create(
    [
        'context' => context_module::instance($cmid),
        'other' => ['versions' => $versions === 'all' ? 'all' : 'latest', 'slot' => $slot, 'files' => count($files)],
    ]
)->trigger();
send_temp_file($tmp, $name);
