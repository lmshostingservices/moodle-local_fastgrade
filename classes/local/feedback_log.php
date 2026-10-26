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

namespace local_fastgrade\local;

/**
 * Records each piece of feedback written, for reports (voice or typed, improvement or positive).
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class feedback_log {
    /** Speech engines that may be recorded. */
    const PROVIDERS = ['ondevice', 'cloud', 'localmodel', 'clip', 'os', ''];

    /**
     * Add an entry.
     *
     * @param \stdClass $mark
     * @param string $target annotation, overall or criterion
     * @param string $mode voice or typed
     * @param string $polarity
     * @param string $text
     * @param int $seconds
     * @param string $provider
     */
    public static function add(
        \stdClass $mark,
        string $target,
        string $mode,
        string $polarity,
        string $text,
        int $seconds = 0,
        string $provider = ''
    ): void {
        global $DB, $USER;
        $DB->insert_record(
            'local_fastgrade_fbitem',
            (object)[
                'markid' => $mark->id,
                'courseid' => $mark->courseid,
                'markerid' => $USER->id,
                'target' => in_array($target, ['annotation', 'overall', 'criterion']) ? $target : 'annotation',
                'mode' => $mode === 'voice' ? 'voice' : 'typed',
                'polarity' => in_array($polarity, annotations::POLARITIES) ? $polarity : 'neutral',
                'provider' => in_array($provider, self::PROVIDERS) ? $provider : '',
                'durationsec' => max(0, min($seconds, 3600)),
                'words' => count_words($text),
                'timecreated' => time(),
            ]
        );
    }
}
