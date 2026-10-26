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

use local_fastgrade\local\report_views;

/**
 * Saved report views.
 *
 * @package    local_fastgrade
 * @category   test
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 * @covers     \local_fastgrade\local\report_views
 */
final class report_views_test extends \advanced_testcase {
    /**
     * Own views, shared views and who may change them.
     */
    public function test_views(): void {
        $this->resetAfterTest();
        $gen = $this->getDataGenerator();
        $course = $gen->create_course();
        $a = $gen->create_and_enrol($course, 'editingteacher');
        $b = $gen->create_and_enrol($course, 'editingteacher');
        $rec = $gen->create_module('assign', ['course' => $course->id]);
        $cm = get_coursemodule_from_instance('assign', $rec->id);

        $this->setUser($a);
        report_views::save($cm, ['name' => 'Mine', 'config' => ['tab' => 'markers']]);
        report_views::save($cm, ['name' => 'Team', 'config' => ['tab' => 'criteria'], 'shared' => true]);
        $mine = report_views::list_for($cm);
        $this->assertCount(2, $mine);
        $this->assertSame('markers', $mine[0]['config']['tab']);

        $this->setUser($b);
        $theirs = report_views::list_for($cm);
        $this->assertCount(1, $theirs);
        $this->assertSame('Team', $theirs[0]['name']);
        $this->assertFalse($theirs[0]['mine']);
        // B cannot delete or overwrite A's view.
        report_views::delete($theirs[0]['id']);
        report_views::save($cm, ['id' => $theirs[0]['id'], 'name' => 'Hijack', 'config' => []]);
        $this->setUser($a);
        $names = array_column(report_views::list_for($cm), 'name');
        $this->assertContains('Team', $names);
        $this->assertNotContains('Hijack', $names);
    }
}
