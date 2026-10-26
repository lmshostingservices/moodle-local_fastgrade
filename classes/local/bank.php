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
 * The comment bank (QuickMarks): personal, course and site comments.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class bank {
    /**
     * Comments the current user can use in a course.
     *
     * @param int $courseid
     * @return array
     */
    public static function list_for(int $courseid): array {
        global $DB, $USER;
        $sql = "SELECT * FROM {local_fastgrade_bank}
                 WHERE (scope = 'personal' AND userid = :userid)
                    OR (scope = 'course' AND courseid = :courseid)
                    OR scope = 'site'
              ORDER BY usagecount DESC, id ASC";
        $rows = $DB->get_records_sql($sql, ['userid' => $USER->id, 'courseid' => $courseid]);
        $coursectx = \context_course::instance($courseid);
        $sysctx = \context_system::instance();
        $out = [];
        foreach ($rows as $r) {
            $canedit = ($r->scope === 'personal' && (int)$r->userid === (int)$USER->id)
                || ($r->scope === 'course' && has_capability('local/fastgrade:managecoursebank', $coursectx))
                || ($r->scope === 'site' && has_capability('local/fastgrade:managesitebank', $sysctx));
            $out[] = [
                'id' => (int)$r->id,
                'scope' => $r->scope,
                'polarity' => $r->polarity,
                'title' => (string)$r->title,
                'text' => (string)$r->text,
                'usagecount' => (int)$r->usagecount,
                'canedit' => $canedit,
            ];
        }
        return $out;
    }

    /**
     * Create or update a comment.
     *
     * @param int $courseid
     * @param array $data
     * @return int id
     */
    public static function save(int $courseid, array $data): int {
        global $DB, $USER;
        $scope = in_array($data['scope'] ?? '', ['personal', 'course', 'site']) ? $data['scope'] : 'personal';
        if ($scope === 'course') {
            require_capability('local/fastgrade:managecoursebank', \context_course::instance($courseid));
        } else if ($scope === 'site') {
            require_capability('local/fastgrade:managesitebank', \context_system::instance());
        }
        $text = trim(clean_param((string)($data['text'] ?? ''), PARAM_TEXT));
        if ($text === '') {
            throw new \moodle_exception('emptycomment', 'local_fastgrade');
        }
        $rec = (object)[
            'scope' => $scope,
            'courseid' => $scope === 'course' ? $courseid : 0,
            'polarity' => in_array($data['polarity'] ?? '', annotations::POLARITIES) ? $data['polarity'] : 'neutral',
            'title' => \core_text::substr(clean_param((string)($data['title'] ?? ''), PARAM_TEXT), 0, 255),
            'text' => $text,
            'timemodified' => time(),
        ];
        $id = (int)($data['id'] ?? 0);
        if ($id) {
            $existing = $DB->get_record('local_fastgrade_bank', ['id' => $id], '*', MUST_EXIST);
            self::require_edit($existing, $courseid);
            $rec->id = $id;
            $DB->update_record('local_fastgrade_bank', $rec);
            return $id;
        }
        $rec->userid = $USER->id;
        $rec->usagecount = 0;
        $rec->timecreated = time();
        return (int)$DB->insert_record('local_fastgrade_bank', $rec);
    }

    /**
     * Delete a comment.
     *
     * @param int $courseid
     * @param int $id
     */
    public static function delete(int $courseid, int $id): void {
        global $DB;
        $existing = $DB->get_record('local_fastgrade_bank', ['id' => $id], '*', MUST_EXIST);
        self::require_edit($existing, $courseid);
        $DB->delete_records('local_fastgrade_bank', ['id' => $id]);
    }

    /**
     * Count a use of a comment.
     *
     * @param int $id
     */
    public static function used(int $id): void {
        global $DB;
        $DB->execute('UPDATE {local_fastgrade_bank} SET usagecount = usagecount + 1 WHERE id = ?', [$id]);
    }

    /**
     * Throw unless the current user may change this comment.
     *
     * @param \stdClass $r
     * @param int $courseid
     */
    protected static function require_edit(\stdClass $r, int $courseid): void {
        global $USER;
        if ($r->scope === 'personal') {
            if ((int)$r->userid !== (int)$USER->id) {
                throw new \required_capability_exception(
                    \context_system::instance(),
                    'local/fastgrade:managesitebank',
                    'nopermissions',
                    ''
                );
            }
        } else if ($r->scope === 'course') {
            if ((int)$r->courseid !== $courseid) {
                throw new \moodle_exception('invalidrecord', 'error');
            }
            require_capability('local/fastgrade:managecoursebank', \context_course::instance($courseid));
        } else {
            require_capability('local/fastgrade:managesitebank', \context_system::instance());
        }
    }
}
