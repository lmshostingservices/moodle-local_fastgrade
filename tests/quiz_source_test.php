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
 * Marking quiz essay questions.
 *
 * @package    local_fastgrade
 * @category   test
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 * @covers     \local_fastgrade\local\quiz_source
 */
final class quiz_source_test extends \advanced_testcase {
    /**
     * A quiz with one essay question and one finished attempt.
     *
     * @return array [cm, teacher, student, attemptid]
     */
    private function setup_quiz(): array {
        global $CFG;
        require_once($CFG->dirroot . '/mod/quiz/locallib.php');
        $gen = $this->getDataGenerator();
        $course = $gen->create_course();
        $teacher = $gen->create_and_enrol($course, 'editingteacher');
        $student = $gen->create_and_enrol($course, 'student');
        $quizrec = $gen->create_module(
            'quiz',
            [
                'course' => $course->id,
                'sumgrades' => 0,
                'grade' => 10,
                'preferredbehaviour' => 'deferredfeedback',
            ]
        );
        $cm = get_coursemodule_from_instance('quiz', $quizrec->id);
        $qgen = $gen->get_plugin_generator('core_question');
        $cat = $qgen->create_question_category(['contextid' => \context_module::instance($cm->id)->id]);
        $q = $qgen->create_question('essay', 'plain', ['category' => $cat->id, 'defaultmark' => 10]);
        quiz_add_quiz_question($q->id, $quizrec, 0, 10);
        \mod_quiz\quiz_settings::create($quizrec->id)->get_grade_calculator()->recompute_quiz_sumgrades();
        $this->setUser($student);
        $quizobj = \mod_quiz\quiz_settings::create($quizrec->id, $student->id);
        $quba = \question_engine::make_questions_usage_by_activity('mod_quiz', $quizobj->get_context());
        $quba->set_preferred_behaviour($quizobj->get_quiz()->preferredbehaviour);
        $now = time();
        $attempt = quiz_create_attempt($quizobj, 1, false, $now, false, $student->id);
        quiz_start_new_attempt($quizobj, $quba, $attempt, 1, $now);
        quiz_attempt_save_started($quizobj, $quba, $attempt);
        $attemptobj = \mod_quiz\quiz_attempt::create($attempt->id);
        $attemptobj->process_submitted_actions(
            $now,
            false,
            [
                1 => [
                    'answer' => 'Elimination removes the hazard.',
                    'answerformat' => FORMAT_PLAIN,
                ],
            ]
        );
        if (method_exists($attemptobj, 'process_submit')) {
            $attemptobj->process_submit($now, false);
            $attemptobj->process_grade_submission($now);
        } else {
            $attemptobj->process_finish($now, false);
        }
        return [$cm, $teacher, $student, (int)$attempt->id];
    }

    /**
     * An unmarked essay has no mark yet (core reports 0 for it).
     */
    public function test_unmarked_has_no_grade(): void {
        $this->resetAfterTest();
        [$cm, $teacher, $student, $attemptid] = $this->setup_quiz();
        $this->setUser($teacher);
        $item = source::for_cmid($cm->id)->get_item($student->id, $attemptid, 1);
        $this->assertNull($item['gradestate']['grade']);
    }

    /**
     * Saving a mark and comment really grades the question attempt.
     */
    public function test_save_grade_marks_the_attempt(): void {
        $this->resetAfterTest();
        [$cm, $teacher, $student, $attemptid] = $this->setup_quiz();
        $this->setUser($teacher);
        $source = source::for_cmid($cm->id);
        $state = $source->save_grade($student->id, $attemptid, 1, ['grade' => '7.5', 'feedback' => '<p>Name each level.</p>']);
        $this->assertEquals(7.5, $state['grade']);
        $this->assertStringStartsWith('mangr', $state['state']);
        $qa = \mod_quiz\quiz_attempt::create($attemptid)->get_question_attempt(1);
        $this->assertEqualsWithDelta(0.75, $qa->get_fraction(), 0.0001);
        [$comment] = $qa->get_manual_comment();
        $this->assertStringContainsString('Name each level', $comment);

        $rows = $source->report_dataset()['rows'];
        $this->assertCount(1, $rows);
        $this->assertTrue($rows[0]['graded']);
        $this->assertEquals(75.0, $rows[0]['pct']);
        $this->assertSame((int)$teacher->id, $rows[0]['marker']);
    }

    /**
     * Out-of-range marks are refused.
     */
    public function test_out_of_range(): void {
        $this->resetAfterTest();
        [$cm, $teacher, $student, $attemptid] = $this->setup_quiz();
        $this->setUser($teacher);
        $this->expectException(\moodle_exception::class);
        source::for_cmid($cm->id)->save_grade($student->id, $attemptid, 1, ['grade' => '11']);
    }
}
