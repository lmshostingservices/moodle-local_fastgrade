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

namespace local_fastgrade;

/**
 * Removes Fast Grade data that belonged to deleted activities and courses.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class observer {
    /**
     * An activity was deleted.
     *
     * @param \core\event\course_module_deleted $event
     */
    public static function course_module_deleted(\core\event\course_module_deleted $event): void {
        self::delete_for_cms([(int)$event->objectid]);
    }

    /**
     * A course was deleted.
     *
     * @param \core\event\course_deleted $event
     */
    public static function course_deleted(\core\event\course_deleted $event): void {
        global $DB;
        $courseid = (int)$event->objectid;
        $cmids = $DB->get_fieldset_select('local_fastgrade_mark', 'DISTINCT cmid', 'courseid = ?', [$courseid]);
        self::delete_for_cms(array_map('intval', $cmids));
        $DB->delete_records('local_fastgrade_bank', ['scope' => 'course', 'courseid' => $courseid]);
        $DB->delete_records('local_fastgrade_fbitem', ['courseid' => $courseid]);
    }

    /**
     * Delete everything stored against some activities.
     *
     * @param int[] $cmids
     */
    public static function delete_for_cms(array $cmids): void {
        global $DB;
        if (!$cmids) {
            return;
        }
        [$in, $params] = $DB->get_in_or_equal($cmids);
        $DB->delete_records_select(
            'local_fastgrade_fbitem',
            "markid IN (SELECT id FROM {local_fastgrade_mark} WHERE cmid $in)",
            $params
        );
        foreach (['annot', 'mark', 'lookfor', 'qcrit', 'note', 'view'] as $t) {
            $DB->delete_records_select('local_fastgrade_' . $t, "cmid $in", $params);
        }
    }
}
