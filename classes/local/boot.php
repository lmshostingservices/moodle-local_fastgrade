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
 * Data embedded in the marking page for the app to start from.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class boot {
    /**
     * Build it.
     *
     * @param source $source
     * @param int $userid student to open first, 0 for the first that needs marking
     * @param int $slot quiz slot to open first
     * @return array
     */
    public static function data(source $source, int $userid, int $slot): array {
        global $CFG, $USER;
        $base = $CFG->wwwroot . '/local/fastgrade/thirdparty';
        $strings = get_string_manager()->load_component_strings('local_fastgrade', current_language());
        return [
            'cmid' => (int)$source->get_cm()->id,
            'modname' => $source->get_cm()->modname,
            'courseid' => (int)$source->get_course()->id,
            'courseurl' => (new \moodle_url('/course/view.php', ['id' => $source->get_course()->id]))->out(false),
            'startuserid' => $userid,
            'startslot' => $slot,
            'wwwroot' => $CFG->wwwroot,
            'me' => ['id' => (int)$USER->id, 'fullname' => fullname($USER)],
            'version' => get_config('local_fastgrade', 'release') ?: '',
            'autograde' => get_config('local_fastgrade', 'autograde') === false ? true :
                (bool)get_config('local_fastgrade', 'autograde'),
            'precedents' => (bool)get_config('local_fastgrade', 'precedents'),
            'libs' => [
                'pdfjs' => $base . '/pdfjs/pdf.min.js',
                'pdfworker' => $base . '/pdfjs/pdf.worker.min.js',
                'cmaps' => $base . '/pdfjs/cmaps/',
                'fonts' => $base . '/pdfjs/standard_fonts/',
                'wasm' => $base . '/pdfjs/wasm/',
                'iccs' => $base . '/pdfjs/iccs/',
                'pdflib' => $base . '/pdflib/pdf-lib.min.js',
            ],
            'strings' => $strings,
        ];
    }
}
