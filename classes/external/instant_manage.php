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
use local_fastgrade\local\instant\questions;
use local_fastgrade\local\instant\report;

/**
 * Teachers: set up Instant Feedback, try answers, and see the practice report.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class instant_manage extends external_api {
    use base;

    /**
     * Parameters.
     *
     * @return external_function_parameters
     */
    public static function execute_parameters(): external_function_parameters {
        return new external_function_parameters([
            'cmid' => new external_value(PARAM_INT, 'Course module id'),
            'action' => new external_value(PARAM_ALPHA, 'get, save, suggest, preview, report or attempts'),
            'qbeid' => new external_value(PARAM_INT, 'Question bank entry (quizzes), 0 for assignments', VALUE_DEFAULT, 0),
            'data' => new external_value(PARAM_RAW, 'JSON', VALUE_DEFAULT, ''), // pipeline-ignore: PARAM_RAW — JSON, cleaned.
        ]);
    }

    /**
     * Run.
     *
     * @param int $cmid
     * @param string $action
     * @param int $qbeid
     * @param string $data
     * @return array
     */
    public static function execute($cmid, $action, $qbeid = 0, $data = ''): array {
        $p = self::validate_parameters(self::execute_parameters(), ['cmid' => $cmid, 'action' => $action,
            'qbeid' => $qbeid, 'data' => $data]);
        $context = \context_module::instance($p['cmid']);
        self::validate_context($context);
        [$course, $cm] = get_course_and_cm_from_cmid($p['cmid']);
        if (!in_array($cm->modname, ['quiz', 'assign'], true)) {
            throw new \moodle_exception('unsupportedactivity', 'local_fastgrade');
        }
        if (!config::teachers_may_enable()) {
            throw new \moodle_exception('if_teachersoff', 'local_fastgrade');
        }
        $reportonly = in_array($p['action'], ['report', 'attempts'], true);
        require_capability($reportonly ? 'local/fastgrade:viewreport' : 'local/fastgrade:managecriteria', $context);
        \local_fastgrade\local\entitlement::require_access();
        $qbeid = $cm->modname === 'quiz' ? $p['qbeid'] : 0;
        if ($cm->modname === 'quiz' && $qbeid && !in_array($qbeid, array_column(questions::essays($cm), 'qbeid'), true)) {
            throw new \moodle_exception('if_notessay', 'local_fastgrade');
        }
        $d = self::decode($p['data']);
        $out = [];
        switch ($p['action']) {
            case 'get':
                $rec = config::get((int)$cm->id, $qbeid);
                $out = ['enabled' => $rec ? (bool)$rec->enabled : false, 'rev' => $rec ? (int)$rec->rev : 0,
                    'config' => $rec ? $rec->config : config::defaults()];
                break;
            case 'save':
                if ($cm->modname === 'quiz' && !$qbeid) {
                    throw new \moodle_exception('if_notessay', 'local_fastgrade');
                }
                $clean = config::clean((array)($d['config'] ?? []), $course);
                if ($clean['engine'] === 'ai' && !\local_fastgrade\local\aitext::enabled_for('student')) {
                    $clean['engine'] = 'rules';
                }
                $rec = config::save((int)$cm->id, $qbeid, !empty($d['enabled']), $clean);
                $out = ['enabled' => (bool)$rec->enabled, 'rev' => (int)$rec->rev, 'config' => $rec->config];
                break;
            case 'suggest':
                $out = ['suggested' => config::suggest($cm, $qbeid)];
                break;
            case 'preview':
                $out = report::preview(
                    $cm,
                    $qbeid,
                    config::clean((array)($d['config'] ?? []), $course),
                    (string)($d['text'] ?? ''),
                    max(1, (int)($d['attemptno'] ?? 1)),
                    !empty($d['ai'])
                );
                break;
            case 'report':
                $out = report::summary((int)$cm->id, $qbeid);
                break;
            case 'attempts':
                $out = report::attempts((int)$cm->id, $qbeid, (int)($d['userid'] ?? 0));
                break;
            default:
                throw new \moodle_exception('unsupportedaction', 'local_fastgrade');
        }
        return ['json' => json_encode($out)];
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
