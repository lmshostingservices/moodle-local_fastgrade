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
use local_fastgrade\local\instant\config;
use local_fastgrade\local\instant\practice;

/**
 * Students: check a practice answer with Instant Feedback, or see checks left. The answer is checked on
 * the server; nothing about the set-up is sent back except what the student is meant to see.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class instant_check extends external_api {
    use base;

    /**
     * Parameters.
     *
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'action' => new external_value(PARAM_ALPHA, 'check or state'),
            'attemptid' => new external_value(PARAM_INT, 'Quiz attempt id (quizzes)', VALUE_DEFAULT, 0),
            'slot' => new external_value(PARAM_INT, 'Quiz slot (quizzes)', VALUE_DEFAULT, 0),
            'source' => new external_value(PARAM_ALPHA, 'draft or submitted (assignments)', VALUE_DEFAULT, 'draft'),
            'response' => new external_value(PARAM_TEXT, 'The answer as plain text', VALUE_DEFAULT, ''),
        ]);
    }

    /**
     * Run.
     *
     * @param int $cmid
     * @param string $action
     * @param int $attemptid
     * @param int $slot
     * @param string $source
     * @param string $response
     * @return array
     */
    public static function execute($cmid, $action, $attemptid = 0, $slot = 0, $source = 'draft', $response = ''): array {
        $p = self::validate_parameters(self::execute_parameters(), ['cmid' => $cmid, 'action' => $action,
            'attemptid' => $attemptid, 'slot' => $slot, 'source' => $source, 'response' => $response]);
        $context = \context_module::instance($p['cmid']);
        self::validate_context($context);
        require_capability('local/fastgrade:useinstantfeedback', $context);
        if (!config::site_enabled()) {
            throw new \moodle_exception('if_off', 'local_fastgrade');
        }
        \local_fastgrade\local\entitlement::require_site_access();
        [, $cm] = get_course_and_cm_from_cmid($p['cmid']);
        if ($cm->modname === 'quiz') {
            $target = practice::quiz_target((int)$cm->id, $p['attemptid'], $p['slot']);
        } else if ($cm->modname === 'assign') {
            $target = practice::assign_target((int)$cm->id, $p['source'] === 'submitted' ? 'submitted' : 'draft');
        } else {
            throw new \moodle_exception('unsupportedactivity', 'local_fastgrade');
        }
        if ($p['action'] !== 'check') {
            return ['json' => json_encode(practice::state($target))];
        }
        $text = $p['response'];
        if (preg_match('/<[a-z!\/][^>]*>/i', $text)) {
            $text = html_to_text($text, 0, false);
        }
        return ['json' => json_encode(practice::check($target, (string)$text))];
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
