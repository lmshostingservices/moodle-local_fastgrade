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
use local_fastgrade\local\aitext;

/**
 * Markers: mark the answer on screen with LMS Labs AI, to compare with the free rules. Uses credits;
 * the marking screen asks first.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class ai_compare extends external_api {
    use base;

    /**
     * Parameters.
     *
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'userid' => new external_value(PARAM_INT, 'Student'),
            'data' => new external_value(PARAM_RAW, 'JSON'), // pipeline-ignore: PARAM_RAW — JSON, cleaned.
        ]);
    }

    /**
     * Run.
     *
     * @param int $cmid
     * @param int $userid
     * @param string $data
     * @return array
     */
    public static function execute($cmid, $userid, $data): array {
        $p = self::validate_parameters(self::execute_parameters(), ['cmid' => $cmid, 'userid' => $userid, 'data' => $data]);
        $source = self::source($p['cmid']);
        if (!aitext::enabled_for('marker')) {
            throw new \moodle_exception('ai_textoff', 'local_fastgrade');
        }
        $d = self::decode($p['data']);
        if (!empty($d['status'])) {
            return ['json' => json_encode(aitext::text_status(!empty($d['fresh'])))];
        }
        $text = \core_text::substr(clean_param((string)($d['text'] ?? ''), PARAM_TEXT), 0, aitext::MAXCHARS);
        if (trim($text) === '') {
            throw new \moodle_exception('ai_notext', 'local_fastgrade');
        }
        $criteria = aitext::clean_text_criteria((array)($d['criteria'] ?? []));
        if (!$criteria) {
            throw new \moodle_exception('ai_nocriteria', 'local_fastgrade');
        }
        $res = aitext::mark(
            (int)$source->get_cm()->id,
            $p['userid'],
            'marker',
            clean_param((string)($d['question'] ?? ''), PARAM_TEXT),
            $text,
            $criteria,
            clean_param((string)($d['model'] ?? ''), PARAM_TEXT)
        );
        return ['json' => json_encode($res)];
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
