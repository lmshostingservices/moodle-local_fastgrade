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

use local_fastgrade\local\source;

/**
 * Marking and reporting for assignments.
 *
 * @package    local_fastgrade
 * @category   test
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 * @covers     \local_fastgrade\local\assign_source
 * @covers     \local_fastgrade\local\report_facts
 */
final class assign_source_test extends \advanced_testcase {
    /**
     * An assignment with a three-level rubric, a teacher and two students who submitted online text.
     *
     * @return array [course, cm, teacher, students]
     */
    private function setup_assignment(): array {
        global $CFG, $DB;
        require_once($CFG->dirroot . '/mod/assign/locallib.php');
        require_once($CFG->dirroot . '/grade/grading/lib.php');
        $gen = $this->getDataGenerator();
        $course = $gen->create_course();
        $teacher = $gen->create_and_enrol($course, 'editingteacher');
        $students = [$gen->create_and_enrol($course, 'student'), $gen->create_and_enrol($course, 'student')];
        $rec = $gen->create_module(
            'assign',
            [
                'course' => $course->id,
                'assignsubmission_onlinetext_enabled' => 1,
                'assignfeedback_comments_enabled' => 1,
                'grade' => 100,
                'duedate' => time() - DAYSECS,
            ]
        );
        $cm = get_coursemodule_from_instance('assign', $rec->id);
        $context = \context_module::instance($cm->id);
        $gm = get_grading_manager($context, 'mod_assign', 'submissions');
        $gm->set_active_method('rubric');
        $levels = fn() => [
            'NEWID1' => ['score' => 0, 'definition' => 'None', 'definitionformat' => FORMAT_HTML],
            'NEWID2' => ['score' => 5, 'definition' => 'Some', 'definitionformat' => FORMAT_HTML],
            'NEWID3' => ['score' => 10, 'definition' => 'All', 'definitionformat' => FORMAT_HTML],
        ];
        $gm->get_controller('rubric')->update_definition(
            (object)[
                'name' => 'Rubric',
                'description_editor' => ['text' => '', 'format' => FORMAT_HTML],
                'rubric' => [
                    'criteria' => [
                        'NEWID1' => [
                            'description' => 'Legislation',
                            'descriptionformat' => FORMAT_HTML,
                            'sortorder' => 1,
                            'levels' => $levels(),
                        ],
                        'NEWID2' => [
                            'description' => 'Controls',
                            'descriptionformat' => FORMAT_HTML,
                            'sortorder' => 2,
                            'levels' => $levels(),
                        ],
                    ],
                    'options' => \gradingform_rubric_controller::get_default_options(),
                ],
                'status' => \gradingform_controller::DEFINITION_STATUS_READY,
            ]
        );
        $assign = new \assign($context, $cm, $course);
        foreach ($students as $s) {
            $sub = $assign->get_user_submission($s->id, true);
            $DB->insert_record(
                'assignsubmission_onlinetext',
                (object)[
                    'assignment' => $rec->id,
                    'submission' => $sub->id,
                    'onlinetext' => '<p>Under the Work Health and Safety Act 2011 the PCBU has a duty of care.</p>',
                    'onlineformat' => FORMAT_HTML,
                ]
            );
            $sub->status = ASSIGN_SUBMISSION_STATUS_SUBMITTED;
            $sub->timemodified = time() - 2 * DAYSECS;
            $DB->update_record('assign_submission', $sub);
        }
        return [$course, $cm, $teacher, $students];
    }

    /**
     * Saving a rubric grade writes the grade, the rubric filling and the feedback, and the report sees it.
     */
    public function test_save_grade_and_report(): void {
        $this->resetAfterTest();
        [, $cm, $teacher, $students] = $this->setup_assignment();
        $this->setUser($teacher);
        $source = source::for_cmid($cm->id);
        $def = $source->get_info()['definition'];
        $filling = [];
        foreach ($def['criteria'] as $c) {
            $filling[] = ['criterionid' => $c['id'], 'levelid' => end($c['levels'])['id'], 'remark' => 'Good'];
        }
        $state = $source->save_grade(
            $students[0]->id,
            0,
            0,
            [
                'filling' => $filling,
                'feedback' => '<p>Well done</p>',
                'notify' => false,
            ]
        );
        $this->assertEquals(100.0, (float)$state['grade']);

        $data = $source->report_dataset();
        $this->assertCount(2, $data['rows']);
        $rows = array_column($data['rows'], null, 'uid');
        $graded = $rows[$students[0]->id];
        $this->assertTrue($graded['graded']);
        $this->assertEquals(100.0, $graded['pct']);
        $this->assertEquals((int)$teacher->id, $graded['marker']);
        $this->assertCount(2, (array)$graded['levels']);
        foreach ((array)$graded['levels'] as $li) {
            $this->assertSame(2, $li);
        }
        $this->assertSame(2, $graded['fbwords']);
        $this->assertFalse($rows[$students[1]->id]['graded']);
        $this->assertSame('submitted', $rows[$students[1]->id]['status']);
        $this->assertSame('rubric', $data['meta']['method']);
    }

    /**
     * The download bundle has one folder per student with their online text.
     */
    public function test_bundle(): void {
        $this->resetAfterTest();
        [, $cm, $teacher] = $this->setup_assignment();
        $this->setUser($teacher);
        $files = source::for_cmid($cm->id)->bundle(false, 0, 0);
        $this->assertCount(2, $files);
        foreach (array_keys($files) as $path) {
            $this->assertMatchesRegularExpression('~^[^/]+_\d+/.+\.html$~', $path);
        }
    }

    /**
     * Deleting the activity removes Fast Grade's data for it.
     */
    public function test_deleting_activity_cleans_up(): void {
        global $DB;
        $this->resetAfterTest();
        [, $cm, $teacher, $students] = $this->setup_assignment();
        $this->setUser($teacher);
        $mark = source::for_cmid($cm->id)->get_mark_record($students[0]->id, 0, 0);
        $DB->insert_record(
            'local_fastgrade_annot',
            (object)[
                'markid' => $mark->id,
                'cmid' => $cm->id,
                'userid' => $students[0]->id,
                'docref' => 'onlinetext',
                'clientid' => 'x1',
                'type' => 'border',
                'polarity' => 'positive',
                'anchorjson' => '{}',
                'stylejson' => '{}',
                'comment' => 'Good',
                'source' => 'typed',
                'status' => 'active',
                'timecreated' => time(),
                'timemodified' => time(),
            ]
        );
        course_delete_module($cm->id);
        $this->assertFalse($DB->record_exists('local_fastgrade_mark', ['cmid' => $cm->id]));
        $this->assertFalse($DB->record_exists('local_fastgrade_annot', ['cmid' => $cm->id]));
    }

    /**
     * A student cannot use the grading web service.
     *
     * @covers \local_fastgrade\external\save_grade
     */
    public function test_student_cannot_save(): void {
        $this->resetAfterTest();
        [, $cm, , $students] = $this->setup_assignment();
        $this->setUser($students[0]);
        $this->expectException(\required_capability_exception::class);
        \local_fastgrade\external\save_grade::execute($cm->id, $students[1]->id, 0, 0, json_encode(['grade' => 100]));
    }
}
