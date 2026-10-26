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
 * Private marker notes about a student in an activity.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class notes {
    /**
     * The note text.
     *
     * @param int $cmid
     * @param int $userid
     * @return string
     */
    public static function get(int $cmid, int $userid): string {
        global $DB;
        return (string)$DB->get_field('local_fastgrade_note', 'note', ['cmid' => $cmid, 'userid' => $userid]);
    }

    /**
     * Save the note (empty deletes it).
     *
     * @param int $cmid
     * @param int $userid
     * @param string $note
     */
    public static function set(int $cmid, int $userid, string $note): void {
        global $DB, $USER;
        $note = trim(clean_param($note, PARAM_TEXT));
        $existing = $DB->get_record('local_fastgrade_note', ['cmid' => $cmid, 'userid' => $userid]);
        if ($note === '') {
            if ($existing) {
                $DB->delete_records('local_fastgrade_note', ['id' => $existing->id]);
            }
            return;
        }
        if ($existing) {
            $DB->update_record(
                'local_fastgrade_note',
                (object)[
                    'id' => $existing->id,
                    'note' => $note,
                    'authorid' => $USER->id,
                    'timemodified' => time(),
                ]
            );
        } else {
            $DB->insert_record(
                'local_fastgrade_note',
                (object)[
                    'cmid' => $cmid,
                    'userid' => $userid,
                    'note' => $note,
                    'authorid' => $USER->id,
                    'timemodified' => time(),
                ]
            );
        }
    }
}
