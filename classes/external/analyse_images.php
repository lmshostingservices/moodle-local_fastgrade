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
use local_fastgrade\local\aiimage;

/**
 * Optional AI image analysis of a student's photos through LMS Labs AI (2 credits per image).
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class analyse_images extends external_api {
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
                'userid' => new external_value(PARAM_INT, 'student'),
                'fileids' => new external_value(PARAM_SEQUENCE, 'comma-separated file ids'),
                'mode' => new external_value(PARAM_ALPHA, 'criteria, transcribe or status', VALUE_DEFAULT, 'criteria'),
                'task' => new external_value(PARAM_TEXT, 'the question or task', VALUE_DEFAULT, ''),
                'criteriajson' => new external_value(PARAM_RAW, 'JSON', VALUE_DEFAULT, '[]'), // pipeline-ignore: PARAM_RAW — JSON.
            ]
        );
    }

    /**
     * Run.
     *
     * @param mixed $cmid
     * @param mixed $userid
     * @param mixed $fileids
     * @param mixed $mode
     * @param mixed $task
     * @param mixed $criteriajson
     * @return array
     */
    public static function execute($cmid, $userid, $fileids, $mode, $task, $criteriajson): array {
        $p = self::validate_parameters(
            self::execute_parameters(),
            [
                'cmid' => $cmid,
                'userid' => $userid,
                'fileids' => $fileids,
                'mode' => $mode,
                'task' => $task,
                'criteriajson' => $criteriajson,
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
        if (!aiimage::enabled()) {
            throw new \moodle_exception('ai_off', 'local_fastgrade');
        }
        if ($p['mode'] === 'status') {
            return aiimage::status();
        }
        $context = $source->get_context();
        $criteria = aiimage::clean_criteria(self::decode($p['criteriajson']));
        if ($p['mode'] !== 'transcribe' && !$criteria) {
            throw new \invalid_parameter_exception('criteria');
        }
        $ids = array_slice(array_unique(array_filter(array_map('intval', explode(',', $p['fileids'])))), 0, aiimage::MAXIMAGES);
        $fs = get_file_storage();
        $out = ['images' => [], 'credits' => 0, 'balance' => null];
        foreach ($ids as $id) {
            $file = $fs->get_file_by_id($id);
            // Only the student's own uploaded images in this activity.
            if (
                !$file || $file->is_directory() || (int)$file->get_contextid() !== (int)$context->id
                    || aiimage::owner_of($file) !== (int)$p['userid']
                    || strpos((string)$file->get_mimetype(), 'image/') !== 0
            ) {
                $out['images'][] = ['fileid' => $id, 'error' => get_string('ai_notimage', 'local_fastgrade')];
                continue;
            }
            try {
                $res = aiimage::analyse(
                    (int)$source->get_cm()->id,
                    (int)$p['userid'],
                    $file,
                    $criteria,
                    $p['mode'],
                    $p['task']
                );
            } catch (\moodle_exception $e) {
                $out['images'][] = ['fileid' => $id, 'error' => $e->getMessage(), 'code' => $e->errorcode];
                if (in_array($e->errorcode, ['ai_nocredits', 'ai_notconnected'])) {
                    break;
                }
                continue;
            }
            $out['credits'] += (int)$res['credits'];
            if (isset($res['balance'])) {
                $out['balance'] = $res['balance'];
            }
            $out['images'][] = ['fileid' => $id, 'filename' => $file->get_filename()] + $res;
        }
        return $out;
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
