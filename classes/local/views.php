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
 * How each document of a submission is shown, kept with its marking record: for now, which photos or PDF pages a
 * marker turned. Marks are stored on the page as shown, so the turn is saved with them and every marker and the
 * student see the page the same way.
 *
 * Stored in local_fastgrade_mark.viewjson as {docref: {rot: {page: degrees}}}.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class views {
    /** Most documents kept for one marking record. */
    const MAXDOCS = 50;

    /** Most pages with a turn kept for one document. */
    const MAXPAGES = 2000;

    /**
     * A turn as 0, 90, 180 or 270.
     *
     * @param mixed $deg
     * @return int
     */
    public static function norm($deg): int {
        $q = (int)round(((float)$deg) / 90);
        return (($q % 4) + 4) % 4 * 90;
    }

    /**
     * Clean the view of one document.
     *
     * @param mixed $view
     * @return array {rot: {page: degrees}} with only turned pages, or [] when nothing is turned
     */
    protected static function clean_view($view): array {
        $rot = [];
        $view = is_array($view) ? $view : [];
        foreach (array_slice((array)($view['rot'] ?? []), 0, self::MAXPAGES, true) as $page => $deg) {
            $page = (int)$page;
            $deg = self::norm($deg);
            if ($page >= 1 && $page <= 100000 && $deg) {
                $rot[(string)$page] = $deg;
            }
        }
        return $rot ? ['rot' => $rot] : [];
    }

    /**
     * Clean a document reference.
     *
     * @param mixed $docref
     * @return string '' when unusable
     */
    protected static function clean_docref($docref): string {
        $docref = clean_param((string)$docref, PARAM_TEXT);
        return \core_text::strlen($docref) > 100 ? '' : $docref;
    }

    /**
     * The views kept for a marking record.
     *
     * @param \stdClass|null $mark marking record (with viewjson), or null
     * @return array {docref: {rot: {page: degrees}}}
     */
    public static function from_mark(?\stdClass $mark): array {
        if (!$mark || empty($mark->viewjson)) {
            return [];
        }
        $data = json_decode((string)$mark->viewjson, true);
        if (!is_array($data)) {
            return [];
        }
        $out = [];
        foreach ($data as $docref => $view) {
            $docref = self::clean_docref($docref);
            $view = self::clean_view($view);
            if ($docref !== '' && $view) {
                $out[$docref] = $view;
            }
        }
        return $out;
    }

    /**
     * The views kept for a marking record id.
     *
     * @param int $markid
     * @return array
     */
    public static function for_mark(int $markid): array {
        global $DB;
        if (!$markid) {
            return [];
        }
        $mark = $DB->get_record('local_fastgrade_mark', ['id' => $markid], 'id, viewjson');
        return self::from_mark($mark ?: null);
    }

    /**
     * Save changed views from the marking screen. Each document sent replaces what was kept for it.
     *
     * @param \stdClass $mark marking record
     * @param array $changes {docref: {rot: {page: degrees}}}
     * @return array the views now kept
     */
    public static function apply(\stdClass $mark, array $changes): array {
        global $DB;
        if (!$changes) {
            return self::for_mark((int)$mark->id);
        }
        $current = self::for_mark((int)$mark->id);
        foreach (array_slice($changes, 0, self::MAXDOCS, true) as $docref => $view) {
            $docref = self::clean_docref($docref);
            if ($docref === '') {
                continue;
            }
            $view = self::clean_view($view);
            if ($view) {
                $current[$docref] = $view;
            } else {
                unset($current[$docref]);
            }
        }
        $current = array_slice($current, 0, self::MAXDOCS, true);
        $DB->update_record('local_fastgrade_mark', (object)[
            'id' => $mark->id,
            'viewjson' => $current ? json_encode($current) : null,
        ]);
        return $current;
    }
}
