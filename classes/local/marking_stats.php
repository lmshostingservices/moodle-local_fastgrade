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
 * Marking facts kept for the activity report: active marking time and what the auto-marker suggested.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class marking_stats {
    /** Longest active time one save may add (4 hours). */
    const MAXSECS = 14400;

    /**
     * Record a save.
     *
     * @param \stdClass $mark
     * @param array $data what the marking screen sent: activesecs, autosummary
     */
    public static function record(\stdClass $mark, array $data): void {
        global $DB;
        $upd = ['id' => $mark->id];
        $secs = max(0, min(self::MAXSECS, (int)($data['activesecs'] ?? 0)));
        if ($secs) {
            $upd['activesecs'] = (int)$mark->activesecs + $secs;
        }
        if (!empty($data['autosummary']) && is_array($data['autosummary'])) {
            $s = $data['autosummary'];
            $points = [];
            foreach (array_slice((array)($s['points'] ?? []), 0, 40) as $p) {
                $points[] = [
                    'crit' => clean_param((string)($p['crit'] ?? ''), PARAM_ALPHANUMEXT),
                    'point' => clean_param(\core_text::substr((string)($p['point'] ?? ''), 0, 200), PARAM_TEXT),
                    'status' => in_array($p['status'] ?? '', ['covered', 'partial', 'missing']) ? $p['status'] : 'missing',
                ];
            }
            $levels = [];
            foreach ((array)($s['levels'] ?? []) as $crit => $level) {
                $levels[(int)$crit] = is_numeric($level) ? $level + 0 : 0;
            }
            $upd['autojson'] = json_encode(
                [
                    'points' => $points,
                    'levels' => $levels,
                    'grade' => isset($s['grade']) && is_numeric($s['grade']) ? (float)$s['grade'] : null,
                    'made' => (int)($s['made'] ?? 0),
                ]
            );
        }
        if (count($upd) > 1) {
            $DB->update_record('local_fastgrade_mark', (object)$upd);
        }
    }
}
