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

namespace local_fastgrade\external;

use core_external\external_api;
use core_external\external_function_parameters;
use core_external\external_single_structure;
use core_external\external_value;

/**
 * Data for the spreadsheet, slide notes, code and zip viewers.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class get_file_data extends external_api {
    use base;

    /**
     * Parameters.
     *
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters(
            [
                'contextid' => new external_value(PARAM_INT, 'Module context id'),
                'fileid' => new external_value(PARAM_INT, 'Stored file id'),
                'type' => new external_value(PARAM_ALPHA, 'sheet, notes, text or zip'),
            ]
        );
    }

    /**
     * Run.
     *
     * @param int $contextid
     * @param int $fileid
     * @param string $type
     * @return array
     */
    public static function execute($contextid, $fileid, $type): array {
        $p = self::validate_parameters(
            self::execute_parameters(),
            ['contextid' => $contextid, 'fileid' => $fileid, 'type' => $type]
        );
        if (!in_array($p['type'], ['sheet', 'notes', 'text', 'zip'], true)) {
            throw new \invalid_parameter_exception('Unknown type');
        }
        $context = \context::instance_by_id($p['contextid']);
        if ($context->contextlevel != CONTEXT_MODULE) {
            throw new \moodle_exception('invalidcontext');
        }
        self::validate_context($context);
        [, $cm] = get_course_and_cm_from_cmid($context->instanceid);

        $file = get_file_storage()->get_file_by_id($p['fileid']);
        if (!$file || (int)$file->get_contextid() !== (int)$context->id || $file->is_directory()) {
            throw new \moodle_exception('invalidfile', 'local_fastgrade');
        }
        $allowed = has_capability('local/fastgrade:grade', $context) &&
            (has_capability('mod/assign:grade', $context) || has_capability('mod/quiz:grade', $context));
        if ($allowed) {
            \local_fastgrade\local\entitlement::require_access();
        }
        if (!$allowed && has_capability('local/fastgrade:viewfeedback', $context)) {
            $allowed = \local_fastgrade\local\student_feedback::can_view_file($cm, $context, $file);
        }
        if (!$allowed) {
            throw new \required_capability_exception($context, 'local/fastgrade:grade', 'nopermissions', '');
        }
        try {
            $data = \local_fastgrade\local\filedata::get($file, $p['type']);
        } catch (\Throwable $e) {
            debugging($e->getMessage(), DEBUG_DEVELOPER);
            $data = ['error' => get_string('cannotreadfile', 'local_fastgrade')];
        }
        return ['json' => json_encode($data)];
    }

    /**
     * Returns.
     *
     * @return external_single_structure
     */
    public static function execute_returns(): external_single_structure {
        return self::json_returns();
    }
}
