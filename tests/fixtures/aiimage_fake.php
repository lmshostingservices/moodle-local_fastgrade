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

/**
 * Test fixture: a fake LMS Labs AI client.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace local_fastgrade;

use local_fastgrade\local\aiimage;

/**
 * A stand-in for LMS Labs AI that records requests instead of sending them.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class aiimage_fake extends aiimage {
    /** @var array requests made */
    public static $sent = [];
    /** @var array [code, body] to answer with */
    public static $answer = [200, null];

    /**
     * Record the request and answer from $answer.
     *
     * @param string $path
     * @param array $body
     * @param int $timeout
     * @return array
     */
    protected static function post(string $path, array $body, int $timeout = 60): array {
        self::$sent[] = ['path' => $path, 'body' => $body];
        return self::$answer;
    }
}
