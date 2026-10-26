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

namespace local_fastgrade\local;

/**
 * Saved report views: a marker's own, plus views others shared with the course.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class report_views {
    /**
     * Views the current user can use in this activity.
     *
     * @param \stdClass|\cm_info $cm
     * @return array
     */
    public static function list_for($cm): array {
        global $DB, $USER;
        $kind = $cm->modname === 'quiz' ? 'quiz' : 'assign';
        $sql = "SELECT * FROM {local_fastgrade_view}
                 WHERE kind = :kind AND (cmid = 0 OR cmid = :cmid)
                       AND (userid = :userid OR (shared = 1 AND courseid = :courseid))
              ORDER BY name ASC";
        $out = [];
        $rows = $DB->get_records_sql(
            $sql,
            [
                'kind' => $kind,
                'cmid' => $cm->id,
                'userid' => $USER->id,
                'courseid' => $cm->course,
            ]
        );
        $names = report_facts::names(array_map(fn($r) => (int)$r->userid, $rows));
        foreach ($rows as $r) {
            $out[] = [
                'id' => (int)$r->id,
                'name' => format_string($r->name),
                'config' => json_decode($r->configjson, true) ?: [],
                'shared' => (bool)$r->shared,
                'allactivities' => (int)$r->cmid === 0,
                'mine' => (int)$r->userid === (int)$USER->id,
                'owner' => $names[(int)$r->userid] ?? '',
            ];
        }
        return $out;
    }

    /**
     * Save (create or update) a view the user owns.
     *
     * @param \stdClass|\cm_info $cm
     * @param array $data id, name, config, shared, allactivities
     */
    public static function save($cm, array $data): void {
        global $DB, $USER;
        $name = trim(clean_param((string)($data['name'] ?? ''), PARAM_TEXT));
        if ($name === '') {
            throw new \invalid_parameter_exception('name');
        }
        $config = json_encode($data['config'] ?? []);
        if (strlen($config) > 65000) {
            throw new \invalid_parameter_exception('config');
        }
        $rec = (object)[
            'userid' => $USER->id,
            'courseid' => $cm->course,
            'cmid' => !empty($data['allactivities']) ? 0 : $cm->id,
            'kind' => $cm->modname === 'quiz' ? 'quiz' : 'assign',
            'name' => \core_text::substr($name, 0, 100),
            'configjson' => $config,
            'shared' => !empty($data['shared']) ? 1 : 0,
            'timemodified' => time(),
        ];
        $id = (int)($data['id'] ?? 0);
        if ($id && $DB->record_exists('local_fastgrade_view', ['id' => $id, 'userid' => $USER->id])) {
            $rec->id = $id;
            $DB->update_record('local_fastgrade_view', $rec);
        } else {
            $rec->timecreated = time();
            $DB->insert_record('local_fastgrade_view', $rec);
        }
    }

    /**
     * Delete one of the user's own views.
     *
     * @param int $id
     */
    public static function delete(int $id): void {
        global $DB, $USER;
        $DB->delete_records('local_fastgrade_view', ['id' => $id, 'userid' => $USER->id]);
    }
}
