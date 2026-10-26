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

namespace local_fastgrade\privacy;

use core_privacy\local\metadata\collection;
use core_privacy\local\request\approved_userlist;
use core_privacy\local\request\userlist;

/**
 * Privacy provider.
 *
 * @package    local_fastgrade
 * @category   test
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 * @covers     \local_fastgrade\privacy\provider
 */
final class provider_test extends \core_privacy\tests\provider_testcase {
    /**
     * Every table holding personal data is described.
     */
    public function test_metadata(): void {
        $items = provider::get_metadata(new collection('local_fastgrade'))->get_collection();
        $names = array_map(fn($i) => $i->get_name(), $items);
        $tables = [
            'local_fastgrade_mark',
            'local_fastgrade_annot',
            'local_fastgrade_fbitem',
            'local_fastgrade_bank',
            'local_fastgrade_note',
            'local_fastgrade_view',
        ];
        foreach ($tables as $t) {
            $this->assertContains($t, $names);
        }
    }

    /**
     * A student's marking data is found and deleted in the activity context.
     */
    public function test_find_and_delete(): void {
        global $DB;
        $this->resetAfterTest();
        $gen = $this->getDataGenerator();
        $course = $gen->create_course();
        $student = $gen->create_and_enrol($course, 'student');
        $rec = $gen->create_module('assign', ['course' => $course->id]);
        $cm = get_coursemodule_from_instance('assign', $rec->id);
        $ctx = \context_module::instance($cm->id);
        $DB->insert_record(
            'local_fastgrade_mark',
            (object)[
                'courseid' => $course->id,
                'cmid' => $cm->id,
                'modname' => 'assign',
                'userid' => $student->id,
                'attempt' => 0,
                'slot' => 0,
                'timemodified' => time(),
            ]
        );
        $contextids = provider::get_contexts_for_userid($student->id)->get_contextids();
        $this->assertContains((int)$ctx->id, array_map('intval', $contextids));
        $list = new userlist($ctx, 'local_fastgrade');
        provider::get_users_in_context($list);
        $this->assertContains((int)$student->id, array_map('intval', $list->get_userids()));
        provider::delete_data_for_users(new approved_userlist($ctx, 'local_fastgrade', [$student->id]));
        $this->assertFalse($DB->record_exists('local_fastgrade_mark', ['userid' => $student->id]));
    }
}
