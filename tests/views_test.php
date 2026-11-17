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

use local_fastgrade\local\views;

/**
 * Turned photos and pages, kept with the marking record.
 *
 * @package    local_fastgrade
 * @category   test
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 * @covers     \local_fastgrade\local\views
 */
final class views_test extends \advanced_testcase {
    /**
     * A marking record.
     *
     * @return \stdClass
     */
    protected function mark(): \stdClass {
        global $DB;
        $mark = (object)['courseid' => 1, 'cmid' => 5, 'modname' => 'quiz', 'userid' => 7, 'attempt' => 3, 'slot' => 1,
            'itemid' => 9, 'timemodified' => 100];
        $mark->id = $DB->insert_record('local_fastgrade_mark', $mark);
        return $mark;
    }

    /**
     * Quarter turns only, whatever is sent.
     */
    public function test_norm(): void {
        $this->assertSame(0, views::norm(0));
        $this->assertSame(90, views::norm(90));
        $this->assertSame(270, views::norm(-90));
        $this->assertSame(180, views::norm(540));
        $this->assertSame(90, views::norm(80));
        $this->assertSame(0, views::norm('nonsense'));
    }

    /**
     * Turns are saved per document and page, turning back to upright forgets the page, and bad input is dropped.
     */
    public function test_apply(): void {
        global $DB;
        $this->resetAfterTest();
        $mark = $this->mark();
        $this->assertSame([], views::for_mark((int)$mark->id));

        $kept = views::apply($mark, [
            'rfile:abc' => ['rot' => ['1' => 90]],
            'file:def' => ['rot' => ['2' => -90, '3' => 0, '0' => 90, 'x' => 90]],
            str_repeat('z', 150) => ['rot' => ['1' => 90]],
        ]);
        $this->assertSame(['rfile:abc' => ['rot' => ['1' => 90]], 'file:def' => ['rot' => ['2' => 270]]], $kept);
        $this->assertSame($kept, views::for_mark((int)$mark->id));
        // The marking record's own time is left alone (reports use it).
        $this->assertEquals(100, $DB->get_field('local_fastgrade_mark', 'timemodified', ['id' => $mark->id]));

        // Other documents are kept when one changes; back to upright removes it.
        $kept = views::apply($mark, ['rfile:abc' => ['rot' => ['1' => 0]]]);
        $this->assertSame(['file:def' => ['rot' => ['2' => 270]]], $kept);
        $kept = views::apply($mark, ['file:def' => []]);
        $this->assertSame([], $kept);
        $this->assertNull($DB->get_field('local_fastgrade_mark', 'viewjson', ['id' => $mark->id]));

        // Damaged stored data reads as nothing turned.
        $DB->set_field('local_fastgrade_mark', 'viewjson', '{not json', ['id' => $mark->id]);
        $this->assertSame([], views::for_mark((int)$mark->id));
    }

    /**
     * The turn is saved in the same request as the marks moved with it, and comes back with the item.
     */
    public function test_saved_with_annotations(): void {
        $this->resetAfterTest();
        $mark = $this->mark();
        $this->setAdminUser();
        \local_fastgrade\local\annotations::apply($mark, [[
            'clientid' => 'a1', 'docref' => 'rfile:abc', 'page' => 1, 'type' => 'stamp', 'polarity' => 'positive',
            'anchor' => ['x' => 900, 'y' => 40], 'style' => ['stamp' => 'mark', 'code' => 'M1'],
        ]], []);
        views::apply($mark, ['rfile:abc' => ['rot' => ['1' => 90]]]);
        $anns = \local_fastgrade\local\annotations::for_mark((int)$mark->id);
        $this->assertCount(1, $anns);
        $this->assertSame(['rfile:abc' => ['rot' => ['1' => 90]]], views::for_mark((int)$mark->id));
        $this->assertSame('{"rfile:abc":{"rot":{"1":90}}}', json_encode((object)views::for_mark((int)$mark->id)));
    }
}
