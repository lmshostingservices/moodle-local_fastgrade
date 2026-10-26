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
 * Everything needed to mark one student.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class get_item extends external_api {
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
                'userid' => new external_value(PARAM_INT, 'userid'),
                'attempt' => new external_value(PARAM_INT, 'attempt', VALUE_DEFAULT, -1),
                'slot' => new external_value(PARAM_INT, 'slot', VALUE_DEFAULT, 0),
            ]
        );
    }

    /**
     * Run.
     *
     * @param mixed $cmid
     * @param mixed $userid
     * @param mixed $attempt
     * @param mixed $slot
     * @return array
     */
    public static function execute($cmid, $userid, $attempt, $slot): array {
        $p = self::validate_parameters(
            self::execute_parameters(),
            [
                'cmid' => $cmid,
                'userid' => $userid,
                'attempt' => $attempt,
                'slot' => $slot,
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
        $item = $source->get_item($p['userid'], $p['attempt'], $p['slot']);
        $item['annotations'] = \local_fastgrade\local\annotations::for_mark($item['markid']);
        $item['note'] = \local_fastgrade\local\notes::get($p['cmid'], $p['userid']);
        $item['integrations'] = \local_fastgrade\local\integrations::item_info($source, $item);
        return $item;
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
