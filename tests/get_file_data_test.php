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

use core_external\external_api;
use local_fastgrade\external\get_file_data;

defined('MOODLE_INTERNAL') || die();

global $CFG;
require_once($CFG->dirroot . '/webservice/tests/helpers.php');

/**
 * The file data web service used by the spreadsheet, slide notes, code and zip viewers.
 *
 * @package    local_fastgrade
 * @category   test
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 * @covers     \local_fastgrade\external\get_file_data
 */
final class get_file_data_test extends \externallib_advanced_testcase {
    /**
     * A student's own submitted file, someone else's file, and bad input.
     */
    public function test_access(): void {
        global $DB;
        $this->resetAfterTest();
        $gen = $this->getDataGenerator();
        $course = $gen->create_course();
        $s1 = $gen->create_and_enrol($course, 'student');
        $s2 = $gen->create_and_enrol($course, 'student');
        $rec = $gen->create_module('assign', ['course' => $course->id, 'assignsubmission_file_enabled' => 1,
            'assignsubmission_file_maxfiles' => 1, 'assignsubmission_file_maxsizebytes' => 0]);
        $cm = get_coursemodule_from_instance('assign', $rec->id);
        $context = \context_module::instance($cm->id);
        $subid = $DB->insert_record('assign_submission', (object)['assignment' => $rec->id, 'userid' => $s1->id,
            'status' => 'submitted', 'timecreated' => time(), 'timemodified' => time(), 'attemptnumber' => 0, 'latest' => 1]);
        $file = get_file_storage()->create_file_from_string(['contextid' => $context->id, 'component' => 'assignsubmission_file',
            'filearea' => 'submission_files', 'itemid' => $subid, 'filepath' => '/', 'filename' => 'hello.py',
            'userid' => $s1->id], "print('hello')\r\n");

        // The student who submitted it can read it.
        $this->setUser($s1);
        $res = external_api::clean_returnvalue(
            get_file_data::execute_returns(),
            get_file_data::execute($context->id, $file->get_id(), 'text')
        );
        $data = json_decode($res['json'], true);
        $this->assertSame("print('hello')\n", $data['text']);
        $this->assertSame('py', $data['ext']);

        // An unknown data type is refused.
        try {
            get_file_data::execute($context->id, $file->get_id(), 'other');
            $this->fail('Unknown type accepted');
        } catch (\invalid_parameter_exception $e) {
            $this->assertStringContainsString('Unknown type', $e->getMessage());
        }

        // A file from another context is refused.
        $coursecontext = \context_course::instance($course->id);
        try {
            get_file_data::execute($coursecontext->id, $file->get_id(), 'text');
            $this->fail('Course context accepted');
        } catch (\moodle_exception $e) {
            $this->assertSame('invalidcontext', $e->errorcode);
        }

        // Another student cannot read it.
        $this->setUser($s2);
        $this->expectException(\required_capability_exception::class);
        get_file_data::execute($context->id, $file->get_id(), 'text');
    }
}
