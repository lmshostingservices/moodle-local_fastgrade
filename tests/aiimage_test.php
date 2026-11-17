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

use local_fastgrade\local\aiimage;

defined('MOODLE_INTERNAL') || die();

global $CFG;
require_once(__DIR__ . '/fixtures/aiimage_fake.php');

/**
 * Optional AI image analysis: what is sent, what is kept and what is charged.
 *
 * @package    local_fastgrade
 * @category   test
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 * @covers     \local_fastgrade\local\aiimage
 */
final class aiimage_test extends \advanced_testcase {
    /**
     * A small JPEG owned by a student in an assignment.
     *
     * @param int $contextid
     * @param int $userid
     * @return \stored_file
     */
    protected function photo(int $contextid, int $userid): \stored_file {
        $img = imagecreatetruecolor(2400, 1800);
        imagefill($img, 0, 0, imagecolorallocate($img, 200, 120, 80));
        ob_start();
        imagejpeg($img, null, 80);
        $bytes = ob_get_clean();
        return get_file_storage()->create_file_from_string([
            'contextid' => $contextid, 'component' => 'assignsubmission_file', 'filearea' => 'submission_files',
            'itemid' => 1, 'filepath' => '/', 'filename' => 'dish.jpg', 'userid' => $userid,
        ], $bytes);
    }

    /**
     * Off unless both the switch and the permission box are on.
     */
    public function test_enabled(): void {
        $this->resetAfterTest();
        $this->assertFalse(aiimage::enabled());
        set_config('aiimages', 1, 'local_fastgrade');
        $this->assertFalse(aiimage::enabled());
        set_config('aiimages_consent', 1, 'local_fastgrade');
        $this->assertTrue(aiimage::enabled());
    }

    /**
     * Criteria and results are cleaned to the expected shape.
     */
    public function test_cleaning(): void {
        $crit = aiimage::clean_criteria([
            ['id' => 'c0', 'label' => 'Presentation <b>', 'lookfor' => ['Salmon centred', '', str_repeat('a', 400)]],
            ['id' => 'c1', 'label' => '', 'lookfor' => []],
        ]);
        $this->assertCount(1, $crit);
        $this->assertSame('Presentation', $crit[0]['label']);
        $this->assertCount(2, $crit[0]['lookFor']);
        $this->assertSame(300, \core_text::strlen($crit[0]['lookFor'][1]));
        $res = aiimage::clean_result(['criteria' => [
            ['id' => 'c0', 'verdict' => 'brilliant', 'confidence' => 4, 'lookFor' => [['text' => 'x', 'seen' => 'yes']]],
            ['id' => 'zz', 'verdict' => 'met'],
        ], 'summary' => 'A dish.'], $crit);
        $this->assertCount(1, $res['criteria']);
        $this->assertSame('unclear', $res['criteria'][0]['verdict']);
        $this->assertSame(1.0, $res['criteria'][0]['confidence']);
        $this->assertSame('yes', $res['criteria'][0]['lookFor'][0]['seen']);
    }

    /**
     * One request per new photo, nothing personal sent, the result kept, and no second charge.
     */
    public function test_analyse_keeps_result(): void {
        $this->resetAfterTest();
        $course = $this->getDataGenerator()->create_course();
        $student = $this->getDataGenerator()->create_user(['firstname' => 'Wei', 'lastname' => 'Ling']);
        $assign = $this->getDataGenerator()->create_module('assign', ['course' => $course->id]);
        $cm = get_coursemodule_from_instance('assign', $assign->id);
        $file = $this->photo(\context_module::instance($cm->id)->id, (int)$student->id);
        $crit = aiimage::clean_criteria([['id' => 'c0', 'label' => 'Presentation', 'lookfor' => ['Salmon centred']]]);
        set_config('aiimages_age', 'under18', 'local_fastgrade');
        aiimage_fake::$sent = [];
        aiimage_fake::$answer = [200, ['creditsCharged' => 2, 'balance' => 98, 'result' => ['criteria' => [
            ['id' => 'c0', 'verdict' => 'met', 'confidence' => 0.9, 'evidence' => 'Centred.', 'lookFor' => []],
        ]]]];
        $one = aiimage_fake::analyse((int)$cm->id, (int)$student->id, $file, $crit, 'criteria', 'Plate the dish.');
        $this->assertSame(2, $one['credits']);
        $this->assertSame('met', $one['criteria'][0]['verdict']);
        $this->assertCount(1, aiimage_fake::$sent);
        $body = aiimage_fake::$sent[0]['body'];
        $this->assertSame('/api/ai/image-analysis', aiimage_fake::$sent[0]['path']);
        $this->assertSame('under18', $body['learnerAge']);
        $this->assertSame(64, strlen($body['requestId']));
        // The photo is resized and nothing about the student is sent.
        $size = getimagesizefromstring(base64_decode($body['image']['data']));
        $this->assertSame(1600, max($size[0], $size[1]));
        $json = json_encode($body);
        $this->assertStringNotContainsString('Wei', $json);
        $this->assertStringNotContainsString('"userid"', $json);
        // Asking again uses the kept result.
        $two = aiimage_fake::analyse((int)$cm->id, (int)$student->id, $file, $crit, 'criteria', 'Plate the dish.');
        $this->assertSame(0, $two['credits']);
        // A file that is not part of a submission belongs to no student, so it is never sent.
        $this->assertSame(0, aiimage::owner_of($file));
        $this->assertTrue($two['cached']);
        $this->assertCount(1, aiimage_fake::$sent);
    }

    /**
     * A photo the marker turned is sent turned, as a new request; an unturned photo keeps its old kept result.
     */
    public function test_marker_turn(): void {
        $this->resetAfterTest();
        $course = $this->getDataGenerator()->create_course();
        $student = $this->getDataGenerator()->create_user();
        $assign = $this->getDataGenerator()->create_module('assign', ['course' => $course->id]);
        $cm = get_coursemodule_from_instance('assign', $assign->id);
        $file = $this->photo(\context_module::instance($cm->id)->id, (int)$student->id);
        // The photo is landscape (2400 x 1800): a quarter turn makes it portrait.
        $size = getimagesizefromstring(aiimage::prepare($file, 90));
        $this->assertSame([1200, 1600], [$size[0], $size[1]]);
        $size = getimagesizefromstring(aiimage::prepare($file, 180));
        $this->assertSame([1600, 1200], [$size[0], $size[1]]);
        $size = getimagesizefromstring(aiimage::prepare($file));
        $this->assertSame([1600, 1200], [$size[0], $size[1]]);

        $crit = aiimage::clean_criteria([['id' => 'c0', 'label' => 'Method', 'lookfor' => ['Each step shown']]]);
        aiimage_fake::$sent = [];
        aiimage_fake::$answer = [200, ['creditsCharged' => 2, 'result' => ['criteria' => [
            ['id' => 'c0', 'verdict' => 'met', 'confidence' => 0.9, 'evidence' => 'Shown.', 'lookFor' => []],
        ]]]];
        $plain = aiimage_fake::analyse((int)$cm->id, (int)$student->id, $file, $crit, 'criteria', 'Solve.');
        $turned = aiimage_fake::analyse((int)$cm->id, (int)$student->id, $file, $crit, 'criteria', 'Solve.', 90);
        $this->assertFalse($plain['cached']);
        $this->assertFalse($turned['cached']);
        $this->assertCount(2, aiimage_fake::$sent);
        $this->assertNotSame(aiimage_fake::$sent[0]['body']['requestId'], aiimage_fake::$sent[1]['body']['requestId']);
        $sent = getimagesizefromstring(base64_decode(aiimage_fake::$sent[1]['body']['image']['data']));
        $this->assertGreaterThan($sent[0], $sent[1]);
        // Turned back, the first kept result is used: no new charge.
        $again = aiimage_fake::analyse((int)$cm->id, (int)$student->id, $file, $crit, 'criteria', 'Solve.', 360);
        $this->assertTrue($again['cached']);
        $this->assertCount(2, aiimage_fake::$sent);
        // The free peek says what is kept, so the marker is only asked about credits that will be spent.
        $this->assertTrue(aiimage::is_kept((int)$cm->id, $file, $crit, 'criteria', 'Solve.', 0));
        $this->assertTrue(aiimage::is_kept((int)$cm->id, $file, $crit, 'criteria', 'Solve.', 90));
        $this->assertFalse(aiimage::is_kept((int)$cm->id, $file, $crit, 'criteria', 'Solve.', 180));
        $this->assertFalse(aiimage::is_kept((int)$cm->id, $file, $crit, 'transcribe', 'Solve.', 0));
        $this->assertFalse(aiimage::is_kept((int)$cm->id + 1, $file, $crit, 'criteria', 'Solve.', 0));
        $this->assertCount(2, aiimage_fake::$sent);
    }

    /**
     * No credits: a clear error and nothing kept. Refused: nothing kept, nothing charged.
     */
    public function test_errors(): void {
        global $DB;
        $this->resetAfterTest();
        $course = $this->getDataGenerator()->create_course();
        $student = $this->getDataGenerator()->create_user();
        $assign = $this->getDataGenerator()->create_module('assign', ['course' => $course->id]);
        $cm = get_coursemodule_from_instance('assign', $assign->id);
        $file = $this->photo(\context_module::instance($cm->id)->id, (int)$student->id);
        $crit = aiimage::clean_criteria([['id' => 'c0', 'label' => 'Presentation', 'lookfor' => ['Salmon centred']]]);
        aiimage_fake::$answer = [422, ['error' => 'image_refused']];
        $res = aiimage_fake::analyse((int)$cm->id, (int)$student->id, $file, $crit, 'criteria', '');
        $this->assertTrue($res['refused']);
        $this->assertSame(0, $res['credits']);
        aiimage_fake::$answer = [402, ['error' => 'insufficient_credits']];
        try {
            aiimage_fake::analyse((int)$cm->id, (int)$student->id, $file, $crit, 'criteria', '');
            $this->fail('Expected no credits');
        } catch (\moodle_exception $e) {
            $this->assertSame('ai_nocredits', $e->errorcode);
        }
        $this->assertSame(0, $DB->count_records('local_fastgrade_aiimage'));
    }
}
