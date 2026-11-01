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

use local_fastgrade\local\files;
use local_fastgrade\local\lookfors;

/**
 * Maths marking: the maths working rule and quiz response file links.
 *
 * @package    local_fastgrade
 * @category   test
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 * @covers     \local_fastgrade\local\lookfors
 * @covers     \local_fastgrade\local\files
 */
final class maths_test extends \advanced_testcase {
    /**
     * A maths rule keeps its model answer and working setting, cleaned.
     */
    public function test_maths_rule(): void {
        $this->resetAfterTest();
        $this->setAdminUser();
        $course = $this->getDataGenerator()->create_course();
        $assign = $this->getDataGenerator()->create_module('assign', ['course' => $course->id]);
        $cm = get_coursemodule_from_instance('assign', $assign->id);
        lookfors::save((int)$cm->id, 'all', [
            ['kind' => 'maths', 'config' => ['answer' => 'x = -1/2 or x = 3 <b>', 'working' => 1]],
            ['kind' => 'maths', 'config' => ['answer' => str_repeat('x', 300), 'working' => 0]],
            ['kind' => 'nonsense', 'config' => []],
        ]);
        $rules = lookfors::for_cm((int)$cm->id)['all'];
        $this->assertCount(2, $rules);
        $this->assertSame('maths', $rules[0]['kind']);
        $this->assertSame('x = -1/2 or x = 3', $rules[0]['config']['answer']);
        $this->assertSame(1, $rules[0]['config']['working']);
        $this->assertSame(200, \core_text::strlen($rules[1]['config']['answer']));
        $this->assertSame(0, $rules[1]['config']['working']);
    }

    /**
     * Quiz response files are linked through their usage and slot, as question_pluginfile expects.
     */
    public function test_response_file_url(): void {
        $this->resetAfterTest();
        $user = $this->getDataGenerator()->create_user();
        $fs = get_file_storage();
        $file = $fs->create_file_from_string(['contextid' => \context_user::instance($user->id)->id, 'component' => 'question',
            'filearea' => 'response_attachments', 'itemid' => 9, 'filepath' => '/', 'filename' => 'working.jpg'], 'x');
        $plain = files::export($file, 'rfile');
        $this->assertStringContainsString('/question/response_attachments/9/working.jpg', $plain['url']);
        $quiz = files::export($file, 'rfile', '41/4/9');
        $this->assertStringContainsString('/question/response_attachments/41/4/9/working.jpg', $quiz['url']);
        $this->assertStringContainsString('/41/4/9/working.jpg', $quiz['downloadurl']);
        $this->assertSame('image', $quiz['kind']);
    }
}
