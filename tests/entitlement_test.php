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
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle. If not, see <http://www.gnu.org/licenses/>.

namespace local_fastgrade;

use local_fastgrade\local\entitlement;

/**
 * Real Moodle access checks with deterministic check-only HTTP responses.
 *
 * @package    local_fastgrade
 * @category   test
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 * @covers     \local_fastgrade\local\entitlement
 */
final class entitlement_test extends \advanced_testcase {
    /** Configure a fictitious site; no customer credentials or live debit. */
    protected function setUp(): void {
        global $CFG, $SESSION;
        parent::setUp();
        $this->resetAfterTest();
        require_once($CFG->libdir . '/filelib.php');
        $this->setAdminUser();
        set_config('siteid', 'fixture-site', 'local_fastgrade');
        set_config('apikey', 'fixture-key', 'local_fastgrade');
        unset($SESSION->local_fastgrade_entitlement);
    }

    /** A verified purchase unlocks and caches only a credential-bound fingerprint. */
    public function test_verified_access_and_cache(): void {
        global $SESSION;
        \curl::mock_response('{"unlocked":true,"entitlementSource":"purchase"}');
        entitlement::require_access();
        $this->assertGreaterThan(time(), $SESSION->local_fastgrade_entitlement['expires']);
        $this->assertStringNotContainsString('fixture-key', json_encode($SESSION->local_fastgrade_entitlement));
        entitlement::require_access();
        $this->assertCount(2, $SESSION->local_fastgrade_entitlement);
    }

    /** A denied result is not cached and a subsequent verified purchase works. */
    public function test_locked_then_unlocked(): void {
        global $SESSION;
        \curl::mock_response('{"unlocked":false,"credits":500}');
        try {
            entitlement::require_access();
            $this->fail('A credit balance alone must not unlock the plugin.');
        } catch (\moodle_exception $e) {
            $this->assertSame('unlockrequired', $e->errorcode);
        }
        $this->assertFalse(isset($SESSION->local_fastgrade_entitlement));
        \curl::mock_response('{"unlocked":true}');
        entitlement::require_access();
        $this->assertTrue(isset($SESSION->local_fastgrade_entitlement));
    }

    /** Changing credentials invalidates a successful verification. */
    public function test_credentials_change_invalidates_cache(): void {
        \curl::mock_response('{"unlocked":true}');
        entitlement::require_access();
        set_config('apikey', 'different-fixture-key', 'local_fastgrade');
        \curl::mock_response('{"unlocked":false}');
        $this->expectException(\moodle_exception::class);
        entitlement::require_access();
    }

    /** A cloned Moodle URL must not inherit the original site's cached access. */
    public function test_site_change_invalidates_cache(): void {
        global $CFG;
        \curl::mock_response('{"unlocked":true}');
        entitlement::require_access();
        $CFG->wwwroot .= '/cloned-site';
        \curl::mock_response('{"unlocked":false}');
        $this->expectException(\moodle_exception::class);
        entitlement::require_access();
    }

    /** Expired access requires fresh confirmation, not a permanent unlock flag. */
    public function test_expired_cache(): void {
        global $SESSION;
        \curl::mock_response('{"unlocked":true}');
        entitlement::require_access();
        $SESSION->local_fastgrade_entitlement['expires'] = time() - 1;
        \curl::mock_response('{"unlocked":false}');
        $this->expectException(\moodle_exception::class);
        entitlement::require_access();
    }

    /** Optional credentials do not grant access when missing. */
    public function test_missing_credentials(): void {
        set_config('apikey', '', 'local_fastgrade');
        $this->expectException(\moodle_exception::class);
        entitlement::require_access();
    }

    /** Malformed provider replies and truthy strings must fail closed. */
    public function test_invalid_responses(): void {
        foreach (['not-json', 'null', '[]', '{"unlocked":"true"}', '{"success":true}'] as $response) {
            \curl::mock_response($response);
            try {
                entitlement::require_access();
                $this->fail('Invalid verification must not grant access.');
            } catch (\moodle_exception $e) {
                $this->assertSame('unlockrequired', $e->errorcode);
            }
        }
    }

    /** Even a site administrator must have a verified entitlement to open the grader. */
    public function test_grading_entry_requires_unlock(): void {
        $course = $this->getDataGenerator()->create_course();
        $assign = $this->getDataGenerator()->create_module('assign', ['course' => $course->id]);
        $cm = get_coursemodule_from_instance('assign', $assign->id);
        \curl::mock_response('{"unlocked":false}');
        $this->expectException(\moodle_exception::class);
        \local_fastgrade\local\source::for_cmid($cm->id)->require_grade_access();
    }

    /** AJAX activity access cannot bypass the same entitlement check. */
    public function test_ajax_entry_requires_unlock(): void {
        $course = $this->getDataGenerator()->create_course();
        $assign = $this->getDataGenerator()->create_module('assign', ['course' => $course->id]);
        $cm = get_coursemodule_from_instance('assign', $assign->id);
        \curl::mock_response('{"unlocked":false}');
        $this->expectException(\moodle_exception::class);
        \local_fastgrade\external\get_activity::execute($cm->id);
    }
}
