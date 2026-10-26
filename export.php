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
 * Download a report table (the current filtered view, or a pivot) as Excel, ODS, CSV or JSON.
 *
 * The browser sends the table it is showing, so the file matches the screen exactly; the
 * capability check makes sure only people who may see the report can turn it into a file.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

require_once(__DIR__ . '/../../config.php');

$cmid = required_param('id', PARAM_INT);
$format = required_param('format', PARAM_ALPHA);
$filename = clean_filename(optional_param('filename', 'fast-grade-report', PARAM_TEXT));
$payload = required_param('table', PARAM_RAW); // pipeline-ignore: PARAM_RAW — JSON, cells cleaned.

[$course, $cm] = get_course_and_cm_from_cmid($cmid);
require_login($course, false, $cm);
require_sesskey();
$context = context_module::instance($cmid);
require_capability('local/fastgrade:viewreport', $context);

if (!in_array($format, ['excel', 'ods', 'csv', 'json'], true)) {
    throw new moodle_exception('invalidparameter', 'debug');
}
$table = json_decode($payload, true);
if (!is_array($table) || !isset($table['columns'], $table['rows']) || !is_array($table['columns'])) {
    throw new moodle_exception('invalidparameter', 'debug');
}
$columns = array_map(fn($c) => clean_param((string)$c, PARAM_TEXT), $table['columns']);
$rows = (function () use ($table, $columns) {
    foreach ($table['rows'] as $row) {
        $out = [];
        foreach (array_values((array)$row) as $i => $v) {
            if ($i >= count($columns)) {
                break;
            }
            $out[] = is_numeric($v) ? $v + 0 : clean_param((string)$v, PARAM_TEXT);
        }
        yield $out;
    }
})();
\local_fastgrade\event\report_exported::create(['context' => $context, 'other' => ['format' => $format]])->trigger();
\core\dataformat::download_data($filename, $format, $columns, $rows);
die();
