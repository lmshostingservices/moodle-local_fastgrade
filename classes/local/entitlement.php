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

namespace local_fastgrade\local;

/**
 * Verify site access without ever acquiring or charging for an unlock.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class entitlement {
    /**
     * Read the shared credentials, or explicitly configured plugin credentials.
     *
     * @return array
     */
    protected static function credentials(): array {
        if (class_exists('\\local_aiconfig\\config')) {
            $siteid = \local_aiconfig\config::get_site_id();
            $apikey = \local_aiconfig\config::get_api_key();
            if ($siteid !== '' && $apikey !== '') {
                return [$siteid, $apikey];
            }
        }
        return [
            trim((string)get_config('local_fastgrade', 'siteid')),
            trim((string)get_config('local_fastgrade', 'apikey')),
        ];
    }

    /**
     * Make a check-only POST. Credentials must not appear in URLs or logs.
     *
     * @param array $credentials
     * @return bool
     */
    protected static function verify(array $credentials): bool {
        global $CFG;
        require_once($CFG->libdir . '/filelib.php');
        $curl = new \curl();
        $curl->setHeader('Content-Type: application/json');
        $response = $curl->post(
            'https://lms-labs.com/api/plugin-unlock/verify',
            json_encode([
                'pluginId' => 'fastgrade',
                'siteId' => $credentials[0],
                'apiKey' => $credentials[1],
            ]),
            [
                'CURLOPT_CONNECTTIMEOUT' => 5,
                'CURLOPT_TIMEOUT' => 15,
                'CURLOPT_FOLLOWLOCATION' => false,
            ]
        );
        $info = $curl->get_info();
        if ($curl->get_errno() || (int)($info['http_code'] ?? 0) !== 200) {
            return false;
        }
        $data = json_decode($response, true);
        return is_array($data) && ($data['unlocked'] ?? null) === true;
    }

    /**
     * Require a recent positive verification bound to this site and credentials.
     *
     * @return void
     */
    public static function require_access(): void {
        global $CFG, $SESSION;
        $credentials = static::credentials();
        $fingerprint = hash('sha256', $CFG->wwwroot . "\0" . implode("\0", $credentials));
        $cached = $SESSION->local_fastgrade_entitlement ?? null;
        if (is_array($cached) && ($cached['identity'] ?? '') === $fingerprint
                && ($cached['expires'] ?? 0) > time()) {
            return;
        }
        unset($SESSION->local_fastgrade_entitlement);
        if ($credentials[0] !== '' && $credentials[1] !== '' && static::verify($credentials)) {
            $SESSION->local_fastgrade_entitlement = [
                'identity' => $fingerprint,
                'expires' => time() + 300,
            ];
            return;
        }
        throw new \moodle_exception(
            'unlockrequired',
            'local_fastgrade',
            new \moodle_url('/admin/settings.php', ['section' => 'local_fastgrade'])
        );
    }
}
