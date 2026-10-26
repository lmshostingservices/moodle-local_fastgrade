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
 * Reads EssayGuard and DocGuard results for the marking screen. Each integration is optional and
 * is skipped silently when its plugin is missing, disabled, or the marker cannot see its reports.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class integrations {
    /**
     * Whether a plugin is installed and its table exists.
     *
     * @param string $component
     * @param string $table
     * @return bool
     */
    protected static function installed(string $component, string $table): bool {
        global $DB;
        static $cache = [];
        if (!isset($cache[$component])) {
            [$type, $name] = \core_component::normalize_component($component);
            $dir = \core_component::get_plugin_directory($type, $name);
            $cache[$component] = $dir && is_dir($dir) && get_config($component, 'version') &&
                $DB->get_manager()->table_exists($table);
        }
        return $cache[$component];
    }

    /**
     * Whether EssayGuard results can be shown here.
     *
     * @param \context $context
     * @return bool
     */
    public static function essayguard_available(\context $context): bool {
        return self::installed('plagiarism_essayguard', 'plagiarism_essayguard_sc')
            && has_capability('plagiarism/essayguard:viewreport', $context);
    }

    /**
     * Whether DocGuard results can be shown here.
     *
     * @param \context $context
     * @return bool
     */
    public static function docguard_available(\context $context): bool {
        return self::installed('plagiarism_docguard', 'plagiarism_docguard_sub')
            && has_capability('plagiarism/docguard:viewreport', $context);
    }

    /**
     * Activity-level information.
     *
     * @param source $source
     * @return array
     */
    public static function activity_info(source $source): array {
        $ctx = $source->get_context();
        $cmid = (int)$source->get_cm()->id;
        $eg = self::essayguard_available($ctx);
        $dg = $source->get_cm()->modname === 'assign' && self::docguard_available($ctx);
        return [
            'essayguard' => $eg,
            'docguard' => $dg,
            'essayguardreport' => $eg ? (new \moodle_url('/plagiarism/essayguard/report.php', ['cmid' => $cmid]))->out(false) : '',
            'docguardreport' => $dg ? (new \moodle_url('/plagiarism/docguard/report.php', ['cmid' => $cmid]))->out(false) : '',
            'beacon' => self::installed('local_beacon', 'local_beacon_metric_cache'),
        ];
    }

    /**
     * EssayGuard band from a 0-100 score.
     *
     * @param float $score100
     * @return string
     */
    protected static function eg_band(float $score100): string {
        if ($score100 >= 66) {
            return 'high';
        }
        return $score100 >= 30 ? 'medium' : 'low';
    }

    /**
     * Export one EssayGuard score row.
     *
     * @param \stdClass $row
     * @param int $cmid
     * @param int $userid
     * @return array
     */
    protected static function eg_export(\stdClass $row, int $cmid, int $userid): array {
        $score = round((float)$row->riskscore * 100);
        $explanations = json_decode((string)($row->explanationsjson ?? ''), true);
        $lines = [];
        if (is_array($explanations)) {
            array_walk_recursive(
                $explanations,
                function ($v) use (&$lines) {
                    if (is_string($v) && trim($v) !== '' && count($lines) < 8) {
                        $lines[] = clean_param($v, PARAM_TEXT);
                    }
                }
            );
        }
        return [
            'score' => (int)$score,
            'level' => in_array($row->risklevel, ['low', 'medium', 'high']) ? $row->risklevel : self::eg_band($score),
            'pastes' => (int)($row->paste_events ?? 0),
            'explanations' => $lines,
            'url' => (new \moodle_url('/plagiarism/essayguard/student.php', ['cmid' => $cmid, 'userid' => $userid]))->out(false),
        ];
    }

    /**
     * EssayGuard result for a student, per quiz slot when given an attempt.
     *
     * @param int $cmid
     * @param int $userid
     * @param int $quizattemptid 0 for assignments
     * @return array|null
     */
    public static function essayguard_for(int $cmid, int $userid, int $quizattemptid = 0): ?array {
        global $DB;
        try {
            $params = ['cmid' => $cmid, 'userid' => $userid];
            $select = 'cmid = :cmid AND userid = :userid';
            if ($quizattemptid) {
                $select .= ' AND attemptkey = :akey';
                $params['akey'] = 'qa_' . $quizattemptid;
            }
            $rows = $DB->get_records_select('plagiarism_essayguard_sc', $select, $params, 'timemodified DESC, id DESC');
            $pending = false;
            if (
                class_exists('\plagiarism_essayguard\task\score_attempt') &&
                    method_exists('\plagiarism_essayguard\task\score_attempt', 'is_pending')
            ) {
                $pending = \plagiarism_essayguard\task\score_attempt::is_pending($cmid, $userid);
            }
            if (!$rows) {
                return $pending ? ['pending' => true] : null;
            }
            // Keep the newest attempt key, one row per slot.
            $rows = array_values($rows);
            $current = $rows[0]->attemptkey;
            $byslot = [];
            foreach ($rows as $r) {
                if ($r->attemptkey === $current && !isset($byslot[(int)$r->qslot])) {
                    $byslot[(int)$r->qslot] = $r;
                }
            }
            $overall = $byslot[0] ?? null;
            if (!$overall) {
                $max = null;
                foreach ($byslot as $r) {
                    if (!$max || $r->riskscore > $max->riskscore) {
                        $max = $r;
                    }
                }
                $overall = $max;
            }
            $slots = [];
            foreach ($byslot as $slot => $r) {
                if ($slot > 0) {
                    $slots[$slot] = self::eg_export($r, $cmid, $userid);
                }
            }
            return ['pending' => $pending, 'overall' => self::eg_export($overall, $cmid, $userid), 'slots' => $slots];
        } catch (\Throwable $e) {
            debugging('Fast Grade: EssayGuard lookup failed: ' . $e->getMessage(), DEBUG_DEVELOPER);
            return null;
        }
    }

    /**
     * DocGuard results per file content hash.
     *
     * @param int $cmid
     * @param int $userid
     * @return array contenthash => result
     */
    public static function docguard_for(int $cmid, int $userid): array {
        global $DB;
        try {
            $rows = $DB->get_records('plagiarism_docguard_sub', ['cmid' => $cmid, 'userid' => $userid], 'id DESC');
            $out = [];
            foreach ($rows as $r) {
                if (isset($out[$r->contenthash])) {
                    continue;
                }
                $analysis = json_decode((string)$r->analysisjson, true) ?: [];
                $findings = [];
                $order = ['strong' => 0, 'notable' => 1, 'context' => 2];
                foreach (($analysis['authenticity']['findings'] ?? []) as $f) {
                    $findings[] = [
                        'label' => clean_param((string)($f['label'] ?? ''), PARAM_TEXT),
                        'severity' => (string)($f['severity'] ?? 'context'),
                        'matched' => clean_param(\core_text::substr((string)($f['matched'] ?? ''), 0, 200), PARAM_TEXT),
                    ];
                }
                usort($findings, fn($a, $b) => ($order[$a['severity']] ?? 3) <=> ($order[$b['severity']] ?? 3));
                $score = (int)round((float)$r->overall_riskscore);
                $out[$r->contenthash] = [
                    'status' => (string)$r->status,
                    'score' => $score,
                    'level' => in_array($r->overall_risklevel, ['low', 'medium', 'high']) ? $r->overall_risklevel :
                        ($score >= 65 ? 'high' : ($score >= 35 ? 'medium' : 'low')),
                    'findings' => array_slice($findings, 0, 10),
                    'url' => (new \moodle_url('/plagiarism/docguard/student_report.php', ['subid' => $r->id]))->out(false),
                ];
            }
            return $out;
        } catch (\Throwable $e) {
            debugging('Fast Grade: DocGuard lookup failed: ' . $e->getMessage(), DEBUG_DEVELOPER);
            return [];
        }
    }

    /**
     * Item-level information.
     *
     * @param source $source
     * @param array $item
     * @return array
     */
    public static function item_info(source $source, array $item): array {
        $ctx = $source->get_context();
        $cmid = (int)$source->get_cm()->id;
        $userid = (int)$item['userid'];
        $out = ['essayguard' => null, 'docguard' => []];
        if (self::essayguard_available($ctx)) {
            $out['essayguard'] = self::essayguard_for($cmid, $userid, (int)($item['quizattemptid'] ?? 0));
        }
        if ($source->get_cm()->modname === 'assign' && self::docguard_available($ctx)) {
            $out['docguard'] = self::docguard_for($cmid, $userid);
        }
        return $out;
    }
}
