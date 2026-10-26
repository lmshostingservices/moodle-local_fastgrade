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
 * Quiz manual marking queue.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class quiz_queue extends external_api {
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
                'mode' => new external_value(PARAM_ALPHANUMEXT, 'mode', VALUE_DEFAULT, 'question'),
                'key' => new external_value(PARAM_INT, 'key', VALUE_DEFAULT, 0),
                'groupid' => new external_value(PARAM_INT, 'groupid', VALUE_DEFAULT, 0),
            ]
        );
    }

    /**
     * Run.
     *
     * @param mixed $cmid
     * @param mixed $mode
     * @param mixed $key
     * @param mixed $groupid
     * @return array
     */
    public static function execute($cmid, $mode, $key, $groupid): array {
        $p = self::validate_parameters(
            self::execute_parameters(),
            [
                'cmid' => $cmid,
                'mode' => $mode,
                'key' => $key,
                'groupid' => $groupid,
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
        if (!$source instanceof \local_fastgrade\local\quiz_source) {
            throw new \moodle_exception('unsupportedaction', 'local_fastgrade');
        }
        return $source->get_queue((string)$p['mode'], (int)$p['key'], (int)$p['groupid']);
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
