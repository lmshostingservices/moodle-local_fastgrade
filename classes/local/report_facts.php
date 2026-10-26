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
 * Bulk lookups shared by the assignment and quiz reports. Every query here covers a whole activity,
 * so the report costs a handful of queries however many students there are.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class report_facts {
    /**
     * Fast Grade's mark records for an activity, keyed "userid:attempt:slot".
     *
     * @param int $cmid
     * @return array
     */
    public static function marks(int $cmid): array {
        global $DB;
        $out = [];
        $fields = 'id, userid, attempt, slot, markerid, activesecs, autojson, fillingjson, timefirstopened, timegraded';
        foreach ($DB->get_records('local_fastgrade_mark', ['cmid' => $cmid], '', $fields) as $m) {
            $out[$m->userid . ':' . $m->attempt . ':' . $m->slot] = $m;
        }
        return $out;
    }

    /**
     * Annotation counts per mark record.
     *
     * @param int $cmid
     * @return array markid => counts
     */
    public static function annotations(int $cmid): array {
        global $DB;
        $sql = "SELECT markid,
                       SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS total,
                       SUM(CASE WHEN status = 'active' AND polarity = 'improvement' THEN 1 ELSE 0 END) AS improvement,
                       SUM(CASE WHEN status = 'active' AND polarity = 'positive' THEN 1 ELSE 0 END) AS positive,
                       SUM(CASE WHEN status = 'active' AND polarity NOT IN ('improvement', 'positive') THEN 1 ELSE 0 END)
                           AS neutral,
                       SUM(CASE WHEN status = 'active' AND source = 'voice' THEN 1 ELSE 0 END) AS voice,
                       SUM(CASE WHEN status = 'active' AND source = 'typed' THEN 1 ELSE 0 END) AS typed,
                       SUM(CASE WHEN status = 'active' AND source = 'bank' THEN 1 ELSE 0 END) AS bank,
                       SUM(CASE WHEN status = 'active' AND criterionid > 0 THEN 1 ELSE 0 END) AS linked,
                       SUM(CASE WHEN source = 'auto' THEN 1 ELSE 0 END) AS autosuggested,
                       SUM(CASE WHEN source = 'auto' AND decision = 'accepted' THEN 1 ELSE 0 END) AS autoaccepted,
                       SUM(CASE WHEN source = 'auto' AND decision = 'edited' THEN 1 ELSE 0 END) AS autoedited,
                       SUM(CASE WHEN source = 'auto' AND (decision = 'rejected' OR status = 'rejected') THEN 1 ELSE 0 END)
                           AS autorejected
                  FROM {local_fastgrade_annot}
                 WHERE cmid = :cmid
              GROUP BY markid";
        $out = [];
        foreach ($DB->get_records_sql($sql, ['cmid' => $cmid]) as $r) {
            $out[$r->markid] = array_map('intval', (array)$r);
        }
        return $out;
    }

    /**
     * Empty annotation counts.
     *
     * @return array
     */
    public static function no_annotations(): array {
        return [
            'total' => 0,
            'improvement' => 0,
            'positive' => 0,
            'neutral' => 0,
            'voice' => 0,
            'typed' => 0,
            'bank' => 0,
            'linked' => 0,
            'autosuggested' => 0,
            'autoaccepted' => 0,
            'autoedited' => 0,
            'autorejected' => 0,
        ];
    }

    /**
     * Group names per user for a course (respecting the activity's grouping).
     *
     * @param \cm_info|\stdClass $cm
     * @return array [userid => [groupid,...], groups => [id => name]]
     */
    public static function groups($cm): array {
        $groups = groups_get_all_groups($cm->course, 0, $cm->groupingid ?? 0, 'g.id, g.name');
        $members = [];
        $names = [];
        if ($groups) {
            $names = array_map(fn($g) => format_string($g->name), $groups);
            global $DB;
            [$in, $params] = $DB->get_in_or_equal(array_keys($groups), SQL_PARAMS_NAMED);
            $rs = $DB->get_recordset_select('groups_members', "groupid $in", $params, '', 'id, groupid, userid');
            foreach ($rs as $m) {
                $members[(int)$m->userid][] = (int)$m->groupid;
            }
            $rs->close();
        }
        return [$members, $names];
    }

    /**
     * Groups the viewer may see in this activity, or null for all.
     *
     * @param \stdClass $cm
     * @param \context $context
     * @return int[]|null
     */
    public static function visible_groups($cm, \context $context): ?array {
        global $USER;
        $mode = groups_get_activity_groupmode($cm);
        if ($mode != SEPARATEGROUPS || has_capability('moodle/site:accessallgroups', $context)) {
            return null;
        }
        return array_map('intval', array_keys(groups_get_all_groups($cm->course, $USER->id, $cm->groupingid ?? 0)));
    }

    /**
     * Integrity results for everyone in an activity: the newest EssayGuard and highest DocGuard result per user
     * (and per quiz attempt and slot for EssayGuard).
     *
     * @param int $cmid
     * @return array ['eg' => [key => [level, score]], 'dg' => [userid => [level, score]]]
     */
    public static function integrity(int $cmid): array {
        global $DB;
        $out = ['eg' => [], 'dg' => []];
        $dbman = $DB->get_manager();
        try {
            if ($dbman->table_exists('plagiarism_essayguard_sc')) {
                $rows = $DB->get_records(
                    'plagiarism_essayguard_sc',
                    ['cmid' => $cmid],
                    'timemodified ASC, id ASC',
                    'id, userid, attemptkey, qslot, riskscore, risklevel'
                );
                foreach ($rows as $r) {
                    $score = (int)round((float)$r->riskscore * 100);
                    $level = in_array($r->risklevel, ['low', 'medium', 'high']) ? $r->risklevel :
                        ($score >= 65 ? 'high' : ($score >= 35 ? 'medium' : 'low'));
                    $v = ['level' => $level, 'score' => $score];
                    // Newest row wins (rows come oldest first).
                    $out['eg'][$r->userid . ':' . $r->attemptkey . ':' . (int)$r->qslot] = $v;
                    if (
                        (int)$r->qslot === 0 || !isset($out['eg']['u' . $r->userid]) ||
                            $score > $out['eg']['u' . $r->userid]['score']
                    ) {
                        $out['eg']['u' . $r->userid] = $v;
                    }
                }
            }
            if ($dbman->table_exists('plagiarism_docguard_sub')) {
                $rows = $DB->get_records(
                    'plagiarism_docguard_sub',
                    ['cmid' => $cmid],
                    'id ASC',
                    'id, userid, overall_riskscore, overall_risklevel'
                );
                foreach ($rows as $r) {
                    $score = (int)round((float)$r->overall_riskscore);
                    $level = in_array($r->overall_risklevel, ['low', 'medium', 'high']) ? $r->overall_risklevel :
                        ($score >= 65 ? 'high' : ($score >= 35 ? 'medium' : 'low'));
                    if (!isset($out['dg'][$r->userid]) || $score > $out['dg'][$r->userid]['score']) {
                        $out['dg'][$r->userid] = ['level' => $level, 'score' => $score];
                    }
                }
            }
        } catch (\Throwable $e) {
            debugging('Fast Grade report: integrity lookup failed: ' . $e->getMessage(), DEBUG_DEVELOPER);
        }
        return $out;
    }

    /**
     * Names of users (markers), keyed by id.
     *
     * @param int[] $ids
     * @return array
     */
    public static function names(array $ids): array {
        global $DB;
        $ids = array_values(array_filter(array_unique(array_map('intval', $ids))));
        if (!$ids) {
            return [];
        }
        $out = [];
        $fields = implode(',', array_merge(['id'], \core_user\fields::get_name_fields()));
        foreach ($DB->get_records_list('user', 'id', $ids, '', $fields) as $u) {
            $out[(int)$u->id] = fullname($u);
        }
        return $out;
    }

    /**
     * Word count of some HTML.
     *
     * @param string|null $html
     * @return int
     */
    public static function words(?string $html): int {
        $text = trim(html_to_text((string)$html, 0, false));
        return $text === '' ? 0 : count_words($text);
    }

    /**
     * The auto-marking summary stored with a mark.
     *
     * @param \stdClass|null $mark
     * @return array|null
     */
    public static function auto(?\stdClass $mark): ?array {
        if (!$mark || empty($mark->autojson)) {
            return null;
        }
        $a = json_decode($mark->autojson, true);
        return is_array($a) ? $a : null;
    }
}
