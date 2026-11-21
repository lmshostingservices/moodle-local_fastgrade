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

defined('MOODLE_INTERNAL') || die();

global $CFG;
require_once($CFG->dirroot . '/mod/quiz/locallib.php');
require_once($CFG->dirroot . '/mod/assign/locallib.php');
require_once(__DIR__ . '/fixtures/aitext_fake.php');

use local_fastgrade\external\instant_check;
use local_fastgrade\external\instant_manage;
use local_fastgrade\local\instant\config;

/**
 * Instant Feedback: students checking practice answers in quiz essay questions and assignment online
 * text, with the limits, access checks and safeguards the brief requires.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 * @covers     \local_fastgrade\external\instant_check
 * @covers     \local_fastgrade\external\instant_manage
 * @covers     \local_fastgrade\local\instant\practice
 * @covers     \local_fastgrade\local\instant\evaluator
 * @covers     \local_fastgrade\local\instant\config
 * @covers     \local_fastgrade\local\aitext
 */
final class instant_test extends \advanced_testcase {
    /** A set-up as a teacher would send it. */
    const SETUP = [
        'mode' => 'guidance',
        'engine' => 'rules',
        'maxattempts' => 3,
        'allowretry' => 1,
        'namemissing' => 1,
        'showhistory' => 1,
        'when' => 'both',
        'concepts' => [
            ['id' => 'c1', 'label' => 'Inspect the equipment', 'phrases' => ['inspect the equipment | check the machine'],
                'required' => 1, 'found' => 'Good: you inspect first.', 'missing' => 'What do you check before starting?',
                'hints' => ['Think about the machine itself.', 'Look for damage.']],
            ['id' => 'c2', 'label' => 'Wear PPE', 'phrases' => ['wear PPE | personal protective equipment | safety glasses'],
                'required' => 1],
            ['id' => 'c3', 'label' => 'Clear the area', 'phrases' => ['clear the area | keep the work area clear'],
                'required' => 1],
        ],
        'prohibited' => [['id' => 'p1', 'phrases' => ['remove the guard'], 'message' => 'Never remove a guard.']],
    ];

    /**
     * Site on, licence check passed.
     */
    protected function site_on(): void {
        set_config('instant_enable', 1, 'local_fastgrade');
        \cache::make('local_fastgrade', 'entitlement')->set('ok', hash('sha256', $GLOBALS['CFG']->wwwroot . "\0\0"));
        global $SESSION;
        $SESSION->local_fastgrade_entitlement = ['identity' => hash('sha256', $GLOBALS['CFG']->wwwroot . "\0\0"),
            'expires' => time() + 300];
    }

    /**
     * An assignment with online text and an Instant Feedback set-up.
     *
     * @param array $setup
     * @return array [course, cm, teacher, student, student2]
     */
    protected function assignment(array $setup = self::SETUP): array {
        $gen = $this->getDataGenerator();
        $course = $gen->create_course();
        $teacher = $gen->create_and_enrol($course, 'editingteacher');
        $student = $gen->create_and_enrol($course, 'student');
        $student2 = $gen->create_and_enrol($course, 'student');
        $rec = $gen->create_module('assign', ['course' => $course->id, 'assignsubmission_onlinetext_enabled' => 1,
            'intro' => 'Explain three safety precautions taken before operating industrial machinery.']);
        [, $cm] = get_course_and_cm_from_cmid($rec->cmid);
        config::save((int)$cm->id, 0, true, config::clean($setup, $course));
        return [$course, $cm, $teacher, $student, $student2];
    }

    /**
     * A quiz with one essay question and an attempt in progress for the student.
     *
     * @return array [course, cm, teacher, student, attemptid, qbeid, student2]
     */
    protected function quiz(): array {
        $gen = $this->getDataGenerator();
        $course = $gen->create_course();
        $teacher = $gen->create_and_enrol($course, 'editingteacher');
        $student = $gen->create_and_enrol($course, 'student');
        $student2 = $gen->create_and_enrol($course, 'student');
        $quizrec = $gen->create_module('quiz', ['course' => $course->id, 'sumgrades' => 0, 'grade' => 10,
            'preferredbehaviour' => 'deferredfeedback']);
        $cm = get_coursemodule_from_instance('quiz', $quizrec->id);
        $qgen = $gen->get_plugin_generator('core_question');
        $cat = $qgen->create_question_category(['contextid' => \context_module::instance($cm->id)->id]);
        $q = $qgen->create_question('essay', 'plain', ['category' => $cat->id, 'defaultmark' => 10,
            'questiontext' => ['text' => 'Explain three precautions before operating machinery.', 'format' => FORMAT_HTML]]);
        quiz_add_quiz_question($q->id, $quizrec, 0, 10);
        \mod_quiz\quiz_settings::create($quizrec->id)->get_grade_calculator()->recompute_quiz_sumgrades();
        $qbeid = \local_fastgrade\local\instant\questions::qbeid((int)$q->id);
        [, $cminfo] = get_course_and_cm_from_cmid($cm->id);
        config::save((int)$cm->id, $qbeid, true, config::clean(self::SETUP, $course));
        $this->setUser($student);
        $quizobj = \mod_quiz\quiz_settings::create($quizrec->id, $student->id);
        $quba = \question_engine::make_questions_usage_by_activity('mod_quiz', $quizobj->get_context());
        $quba->set_preferred_behaviour($quizobj->get_quiz()->preferredbehaviour);
        $now = time();
        $attempt = quiz_create_attempt($quizobj, 1, false, $now, false, $student->id);
        quiz_start_new_attempt($quizobj, $quba, $attempt, 1, $now);
        quiz_attempt_save_started($quizobj, $quba, $attempt);
        return [$course, $cminfo, $teacher, $student, (int)$attempt->id, $qbeid, $student2];
    }

    /**
     * Call the student service.
     *
     * @param int $cmid
     * @param string $text
     * @param array $more attemptid, slot, source, action
     * @return array
     */
    protected function check(int $cmid, string $text, array $more = []): array {
        $r = instant_check::execute(
            $cmid,
            $more['action'] ?? 'check',
            $more['attemptid'] ?? 0,
            $more['slot'] ?? 0,
            $more['source'] ?? 'draft',
            $text
        );
        return json_decode($r['json'], true);
    }

    /**
     * States by item id.
     *
     * @param array $view
     * @return array
     */
    protected static function states(array $view): array {
        return array_column($view['result']['items'], 'state', 'id');
    }

    /**
     * Assignment online text: a good answer, a negated one, and nothing secret sent back.
     */
    public function test_assign_check(): void {
        $this->resetAfterTest();
        $this->site_on();
        [, $cm, , $student] = $this->assignment();
        $this->setUser($student);
        // The browser sends plain text (it turns the editor's HTML into text first); HTML is refused.
        $v = $this->check((int)$cm->id, "Before starting I inspect the equipment so that faults are found.\n" .
            'I wear safety glasses because chips fly, and I clear the area to prevent trips.');
        $this->assertSame(['c1' => 'detected', 'c2' => 'detected', 'c3' => 'detected'], self::states($v));
        try {
            $this->check((int)$cm->id, '<p>I inspect the equipment.</p>');
            $this->fail('HTML should be refused');
        } catch (\invalid_parameter_exception $e) {
            $this->assertStringContainsString('response', $e->getMessage());
        }
        $this->assertSame(3, $v['result']['summary']['detected']);
        $this->assertSame(2, $v['attemptsleft']);
        $json = json_encode($v);
        // The wording looked for is never sent to the student.
        $this->assertStringNotContainsString('personal protective equipment', $json);
        $this->assertStringNotContainsString('check the machine', $json);
        $this->assertStringNotContainsString('remove the guard', $json);

        $v = $this->check((int)$cm->id, 'Do not inspect the equipment. Never wear PPE. There is no need to clear the area.');
        $this->assertSame(['c1' => 'uncertain', 'c2' => 'uncertain', 'c3' => 'uncertain'], self::states($v));
        $this->assertTrue($v['result']['uncertain']);
        $this->assertSame(0, $v['result']['summary']['detected']);
    }

    /**
     * Limits are kept on the server; the same answer twice uses no check.
     */
    public function test_limits(): void {
        $this->resetAfterTest();
        $this->site_on();
        [, $cm, , $student] = $this->assignment();
        $this->setUser($student);
        $this->check((int)$cm->id, 'I inspect the equipment.');
        $again = $this->check((int)$cm->id, 'I inspect the equipment.');
        $this->assertTrue($again['repeat']);
        $this->assertSame(2, $again['attemptsleft']);
        $this->check((int)$cm->id, 'I inspect the equipment and wear PPE.');
        $third = $this->check((int)$cm->id, 'I inspect the equipment, wear PPE and clear the area.');
        $this->assertSame(0, $third['attemptsleft']);
        $fourth = $this->check((int)$cm->id, 'Something new entirely about guards.');
        $this->assertTrue($fourth['limitreached']);
        global $DB;
        $this->assertSame(3, $DB->count_records('local_fastgrade_ifattempt', ['cmid' => $cm->id, 'userid' => $student->id]));
    }

    /**
     * Hints only: no idea names for what is missing, hints in turn.
     */
    public function test_hints_mode(): void {
        $this->resetAfterTest();
        $this->site_on();
        $setup = self::SETUP;
        $setup['mode'] = 'hints';
        [, $cm, , $student] = $this->assignment($setup);
        $this->setUser($student);
        $v = $this->check((int)$cm->id, 'I wear PPE and tie my hair back before I start.');
        $byid = array_column($v['result']['items'], null, 'id');
        $this->assertSame('', $byid['c1']['label']);
        $this->assertSame('Think about the machine itself.', $byid['c1']['hint']);
        $this->assertSame('Wear PPE', $byid['c2']['label']);
        $v = $this->check((int)$cm->id, 'I wear PPE and tie my hair back before I start the lathe.');
        $byid = array_column($v['result']['items'], null, 'id');
        $this->assertSame('Look for damage.', $byid['c1']['hint']);
    }

    /**
     * Unsafe statements are flagged; the same statement said safely is not.
     */
    public function test_prohibited(): void {
        $this->resetAfterTest();
        $this->site_on();
        [, $cm, , $student] = $this->assignment();
        $this->setUser($student);
        $v = $this->check((int)$cm->id, 'If it jams, remove the guard and clear it by hand.');
        $this->assertSame('Never remove a guard.', $v['result']['warnings'][0]['message']);
        $v = $this->check((int)$cm->id, 'If it jams, never remove the guard; isolate it first.');
        $this->assertSame([], $v['result']['warnings']);
    }

    /**
     * Nonsense, blank and keyword-list answers are not given credit.
     */
    public function test_cannot_assess(): void {
        $this->resetAfterTest();
        $this->site_on();
        [, $cm, , $student] = $this->assignment();
        $this->setUser($student);
        $v = $this->check((int)$cm->id, '');
        $this->assertSame('empty', $v['result']['status']);
        $v = $this->check((int)$cm->id, 'asdfgh qwrtzp kkkkk xcvbnm sdfghj');
        $this->assertSame('review', $v['result']['status']);
        $v = $this->check((int)$cm->id, 'inspect equipment, PPE glasses, clear area');
        $this->assertNotContains('detected', self::states($v));
        $this->assertContains('keywords', array_column($v['result']['notices'], 'code'));
    }

    /**
     * Quiz essay: a check during the attempt changes nothing in the attempt; others cannot use it.
     */
    public function test_quiz_check(): void {
        global $DB;
        $this->resetAfterTest();
        $this->site_on();
        [, $cm, , $student, $attemptid, , $student2] = $this->quiz();
        $this->setUser($student);
        $before = $DB->get_record('quiz_attempts', ['id' => $attemptid]);
        $steps = $DB->count_records('question_attempt_steps');
        $v = $this->check((int)$cm->id, 'I inspect the equipment and wear PPE.', ['attemptid' => $attemptid, 'slot' => 1]);
        $this->assertSame(['c1' => 'detected', 'c2' => 'detected', 'c3' => 'missing'], self::states($v));
        $after = $DB->get_record('quiz_attempts', ['id' => $attemptid]);
        $this->assertSame($before->state, $after->state);
        $this->assertSame($before->sumgrades, $after->sumgrades);
        $this->assertSame($steps, $DB->count_records('question_attempt_steps'));

        // Someone else's attempt.
        $this->setUser($student2);
        try {
            $this->check((int)$cm->id, 'I inspect the equipment.', ['attemptid' => $attemptid, 'slot' => 1]);
            $this->fail('Another student checked an attempt that is not theirs');
        } catch (\moodle_exception $e) {
            $this->assertSame('if_notyours', $e->errorcode);
        }

        // A finished attempt.
        $this->setUser($student);
        $attemptobj = \mod_quiz\quiz_attempt::create($attemptid);
        $attemptobj->process_submit(time(), false);
        try {
            $this->check((int)$cm->id, 'I inspect the equipment.', ['attemptid' => $attemptid, 'slot' => 1]);
            $this->fail('A finished attempt was checked');
        } catch (\moodle_exception $e) {
            $this->assertSame('if_attemptclosed', $e->errorcode);
        }
    }

    /**
     * Secure quizzes never offer it.
     */
    public function test_secure_quiz(): void {
        global $DB;
        $this->resetAfterTest();
        $this->site_on();
        [, $cm, , $student, $attemptid] = $this->quiz();
        $DB->set_field('quiz', 'browsersecurity', 'securewindow', ['id' => $cm->instance]);
        $this->setUser($student);
        $this->expectException(\moodle_exception::class);
        $this->check((int)$cm->id, 'I inspect the equipment.', ['attemptid' => $attemptid, 'slot' => 1]);
    }

    /**
     * Switched off on the site or in the activity: nothing works.
     */
    public function test_off(): void {
        $this->resetAfterTest();
        $this->site_on();
        [$course, $cm, , $student] = $this->assignment();
        config::save((int)$cm->id, 0, false, config::clean(self::SETUP, $course));
        $this->setUser($student);
        try {
            $this->check((int)$cm->id, 'I inspect the equipment.');
            $this->fail('Disabled set-up was used');
        } catch (\moodle_exception $e) {
            $this->assertSame('if_off', $e->errorcode);
        }
        config::save((int)$cm->id, 0, true, config::clean(self::SETUP, $course));
        set_config('instant_enable', 0, 'local_fastgrade');
        $this->expectException(\moodle_exception::class);
        $this->check((int)$cm->id, 'I inspect the equipment.');
    }

    /**
     * Grades are never touched; submitted work can be checked after submission when allowed.
     */
    public function test_submitted_and_grades(): void {
        global $DB;
        $this->resetAfterTest();
        $this->site_on();
        [$course, $cm, , $student] = $this->assignment();
        $this->setUser($student);
        $assign = new \assign(\context_module::instance($cm->id), $cm, $course);
        $sub = $assign->get_user_submission($student->id, true);
        $data = (object)['onlinetext_editor' => ['text' => '<p>I inspect the equipment and wear PPE.</p>',
            'format' => FORMAT_HTML, 'itemid' => file_get_unused_draft_itemid()]];
        $assign->save_submission($data, $notices);
        $assign->submit_for_grading((object)['submissionstatement' => 1], []);
        $v = $this->check((int)$cm->id, 'ignored: the submission is read on the server', ['source' => 'submitted']);
        $this->assertSame(['c1' => 'detected', 'c2' => 'detected', 'c3' => 'missing'], self::states($v));
        $this->assertSame(0, $DB->count_records('assign_grades', ['assignment' => $cm->instance]));
        $this->assertNotEmpty($sub);
    }

    /**
     * Students cannot read or change set-ups; teachers can, and can try answers.
     */
    public function test_manage(): void {
        $this->resetAfterTest();
        $this->site_on();
        [, $cm, $teacher, $student] = $this->assignment();
        $this->setUser($student);
        try {
            instant_manage::execute((int)$cm->id, 'get', 0, '');
            $this->fail('A student read the set-up');
        } catch (\required_capability_exception $e) {
            $this->assertSame('nopermissions', $e->errorcode);
        }
        $this->setUser($teacher);
        $this->site_on();
        $got = json_decode(instant_manage::execute((int)$cm->id, 'get', 0, '')['json'], true);
        $this->assertTrue($got['enabled']);
        $this->assertCount(3, $got['config']['concepts']);
        $prev = json_decode(instant_manage::execute((int)$cm->id, 'preview', 0, json_encode(['config' => $got['config'],
            'text' => 'I wear PPE.']))['json'], true);
        $this->assertSame('detected', array_column($prev['rules']['items'], 'state', 'id')['c2']);
        $this->assertNull($prev['ai']);
        // A teacher choosing AI where the site does not allow it gets the free rules.
        $got['config']['engine'] = 'ai';
        $saved = json_decode(instant_manage::execute((int)$cm->id, 'save', 0, json_encode(['enabled' => 1,
            'config' => $got['config']]))['json'], true);
        $this->assertSame('rules', $saved['config']['engine']);
    }

    /**
     * AI chosen but unavailable: the student gets the free rules, and nothing is charged.
     */
    public function test_ai_fallback(): void {
        global $DB;
        $this->resetAfterTest();
        $this->site_on();
        set_config('aitext_students', 1, 'local_fastgrade');
        set_config('aitext_consent', 1, 'local_fastgrade');
        $setup = self::SETUP;
        $setup['engine'] = 'ai';
        [, $cm, , $student] = $this->assignment($setup);
        $this->setUser($student);
        $v = $this->check((int)$cm->id, 'I inspect the equipment and wear PPE.');
        $this->assertSame('rules', $v['result']['engine']);
        $this->assertContains('aifallback', array_column($v['result']['notices'], 'code'));
        $rec = $DB->get_record('local_fastgrade_ifattempt', ['cmid' => $cm->id, 'userid' => $student->id]);
        $this->assertSame('fallback', $rec->engine);
        $this->assertSame(0, (int)$rec->credits);
    }

    /**
     * AI marking: the request sent, the result kept (no second charge) and the daily cap for students.
     */
    public function test_aitext(): void {
        global $DB;
        $this->resetAfterTest();
        set_config('aitext', 1, 'local_fastgrade');
        set_config('aitext_students', 1, 'local_fastgrade');
        set_config('aitext_consent', 1, 'local_fastgrade');
        set_config('aitext_dailycap', 1, 'local_fastgrade');
        [, $cm, , $student] = $this->assignment();
        $this->setUser($student);
        $crit = \local_fastgrade\local\aitext::clean_text_criteria([['id' => 'c1', 'label' => 'Inspect', 'lookFor' =>
            ['inspect the equipment']], ['id' => 'c2', 'label' => 'PPE']]);
        aitext_fake::$sent = [];
        aitext_fake::$answer = [200, ['creditsCharged' => 1, 'balance' => 9, 'result' => ['summary' => 'Good start.',
            'criteria' => [['id' => 'c1', 'status' => 'met', 'evidence' => 'I inspect', 'feedback' => 'Well done.'],
                ['id' => 'zz', 'status' => 'met']]]]];
        $one = aitext_fake::mark((int)$cm->id, (int)$student->id, 'student', 'Q?', 'I inspect the equipment.', $crit);
        $this->assertCount(1, aitext_fake::$sent);
        $this->assertSame('/api/ai/text-marking', aitext_fake::$sent[0]['path']);
        $this->assertSame('student', aitext_fake::$sent[0]['body']['audience']);
        $this->assertArrayNotHasKey('userid', aitext_fake::$sent[0]['body']);
        $this->assertSame(['c1' => 'met', 'c2' => 'unsure'], array_column($one['criteria'], 'status', 'id'));
        // Same answer: kept result, no charge, no request.
        $two = aitext_fake::mark((int)$cm->id, (int)$student->id, 'student', 'Q?', 'I inspect the equipment.', $crit);
        $this->assertTrue($two['cached']);
        $this->assertCount(1, aitext_fake::$sent);
        // Daily cap of 1 credit reached.
        try {
            aitext_fake::mark((int)$cm->id, (int)$student->id, 'student', 'Q?', 'Something else.', $crit);
            $this->fail('Cap not applied');
        } catch (\moodle_exception $e) {
            $this->assertSame('ai_dailycap', $e->errorcode);
        }
        // Markers are not capped.
        aitext_fake::mark((int)$cm->id, (int)$student->id, 'marker', 'Q?', 'Something else.', $crit);
        $this->assertSame(2, $DB->count_records('local_fastgrade_aitext'));
        // Without consent nothing is sent.
        set_config('aitext_consent', 0, 'local_fastgrade');
        $this->expectException(\moodle_exception::class);
        aitext_fake::mark((int)$cm->id, (int)$student->id, 'marker', 'Q?', 'Third.', $crit);
    }

    /**
     * Suggestions come from what the activity already has.
     */
    public function test_suggest(): void {
        $this->resetAfterTest();
        [, $cm] = $this->assignment();
        \local_fastgrade\local\lookfors::save((int)$cm->id, 'all', [['kind' => 'anyof', 'config' => ['terms' =>
            ['hierarchy of controls', 'isolation | lockout']]], ['kind' => 'mustnot', 'config' => ['terms' => ['OHS Act'],
            'comment' => 'Replaced by the WHS Act.']]]);
        $s = config::suggest($cm, 0);
        $this->assertSame(['hierarchy of controls', 'isolation'], array_column($s['concepts'], 'label'));
        $this->assertSame('Replaced by the WHS Act.', $s['prohibited'][0]['message']);
    }

    /**
     * Privacy: practice checks are exported and deleted with the student's data.
     */
    public function test_privacy(): void {
        global $DB;
        $this->resetAfterTest();
        $this->site_on();
        [, $cm, , $student] = $this->assignment();
        $this->setUser($student);
        $this->check((int)$cm->id, 'I inspect the equipment.');
        $ctx = \context_module::instance($cm->id);
        $list = \local_fastgrade\privacy\provider::get_contexts_for_userid((int)$student->id);
        $this->assertContains((int)$ctx->id, array_map('intval', $list->get_contextids()));
        \local_fastgrade\privacy\provider::delete_data_for_user(new \core_privacy\local\request\approved_contextlist(
            $student,
            'local_fastgrade',
            [$ctx->id]
        ));
        $this->assertSame(0, $DB->count_records('local_fastgrade_ifattempt', ['userid' => $student->id]));
    }
}
