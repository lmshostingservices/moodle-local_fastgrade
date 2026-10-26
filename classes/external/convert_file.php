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
 * Start or check conversion of a submitted file to PDF.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class convert_file extends external_api {
    use base;

    /**
     * Parameters.
     *
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters(
            [
                'cmid' => new external_value(PARAM_INT, 'cmid'),
                'fileid' => new external_value(PARAM_INT, 'fileid'),
                'retry' => new external_value(PARAM_BOOL, 'retry', VALUE_DEFAULT, false),
            ]
        );
    }

    /**
     * Run.
     *
     * @param mixed $cmid
     * @param mixed $fileid
     * @param mixed $retry
     * @return array
     */
    public static function execute($cmid, $fileid, $retry): array {
        $p = self::validate_parameters(
            self::execute_parameters(),
            [
                'cmid' => $cmid,
                'fileid' => $fileid,
                'retry' => $retry,
            ]
        );
        return ['json' => json_encode(self::run($p))];
    }

    /**
     * Do the work.
     *
     * @param array $p validated parameters
     * @return array
     */
    private static function run(array $p): array {
        $source = self::source($p['cmid']);
        $file = get_file_storage()->get_file_by_id($p['fileid']);
        if (!$file || (int)$file->get_contextid() !== (int)$source->get_context()->id) {
            throw new \moodle_exception('invalidfile', 'local_fastgrade');
        }
        $status = \local_fastgrade\local\files::convert($file, (bool)$p['retry']);
        return ['status' => $status, 'pdfurl' => $status === 'done' ? \local_fastgrade\local\files::converted_url($file) : ''];
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
