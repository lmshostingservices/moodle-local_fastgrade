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

use core_external\external_single_structure;
use core_external\external_value;
use local_fastgrade\local\source;

/**
 * Shared helpers for Fast Grade web services.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
trait base {
    /**
     * Load the activity and check the user may mark in it.
     *
     * @param int $cmid
     * @param string $capability check this capability instead of the marking ones
     * @return source
     */
    protected static function source(int $cmid, string $capability = ''): source {
        $context = \context_module::instance($cmid);
        self::validate_context($context);
        $source = source::for_cmid($cmid);
        if ($capability !== '') {
            // Report-only access (heads of department, compliance) does not need marking rights.
            require_capability($capability, $context);
        } else {
            require_capability('local/fastgrade:grade', $context);
            require_capability(self::grade_capability($source), $context);
        }
        if (!source::is_enabled_for($source->get_cm()->modname)) {
            throw new \moodle_exception('disabledforactivity', 'local_fastgrade');
        }
        return $source;
    }

    /**
     * The activity's own marking capability.
     *
     * @param source $source
     * @return string
     */
    protected static function grade_capability(source $source): string {
        return $source->get_cm()->modname === 'quiz' ? 'mod/quiz:grade' : 'mod/assign:grade';
    }

    /**
     * Decode JSON data from the browser.
     *
     * @param string $json
     * @return array
     */
    protected static function decode(string $json): array {
        $data = json_decode($json, true);
        if ($json !== '' && $data === null && json_last_error() !== JSON_ERROR_NONE) {
            throw new \invalid_parameter_exception('Invalid JSON');
        }
        return is_array($data) ? $data : [];
    }

    /**
     * Every function returns one JSON document.
     *
     * @return external_single_structure
     */
    protected static function json_returns(): external_single_structure {
        return new external_single_structure(
            [
            'json' => new external_value(PARAM_RAW, 'JSON result'), // pipeline-ignore: PARAM_RAW — output only.
            ]
        );
    }
}
