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

namespace local_fastgrade\local\instant;

/**
 * Instant Feedback set-ups: one per assignment, or one per essay question in a quiz. Set-ups hold the
 * wording to look for and must never be sent to a student's browser.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class config {
    /** Feedback modes. */
    const MODES = ['guidance', 'score', 'hints'];

    /** When assignment feedback is offered. */
    const WHEN = ['practice', 'aftersubmit', 'both'];

    /** Engines. */
    const ENGINES = ['rules', 'ai'];

    /**
     * Whether Instant Feedback is on for the site.
     *
     * @return bool
     */
    public static function site_enabled(): bool {
        return (bool)get_config('local_fastgrade', 'instant_enable');
    }

    /**
     * Whether teachers may switch it on in their activities.
     *
     * @return bool
     */
    public static function teachers_may_enable(): bool {
        return self::site_enabled() && get_config('local_fastgrade', 'instant_teachers') !== '0';
    }

    /**
     * The site's limit on checks per answer (0 = none).
     *
     * @return int
     */
    public static function site_max_attempts(): int {
        $v = get_config('local_fastgrade', 'instant_maxattempts');
        return $v === false ? 10 : max(0, (int)$v);
    }

    /**
     * A blank set-up with the site defaults.
     *
     * @return array
     */
    public static function defaults(): array {
        $mode = (string)get_config('local_fastgrade', 'instant_defaultmode');
        $retry = get_config('local_fastgrade', 'instant_allowretry');
        return [
            'mode' => in_array($mode, self::MODES, true) ? $mode : 'guidance',
            'engine' => 'rules',
            'maxattempts' => 0,
            'allowretry' => $retry === false ? 1 : (int)(bool)$retry,
            'namemissing' => 1,
            'showhistory' => 1,
            'when' => 'practice',
            'minwords' => 0,
            'maxwords' => 0,
            'order' => 0,
            'quality' => 1,
            'intro' => '',
            'modelanswer' => '',
            'concepts' => [],
            'terms' => [],
            'prohibited' => [],
            'values' => [],
        ];
    }

    /**
     * Plain text, trimmed and cut to length.
     *
     * @param mixed $v
     * @param int $max
     * @return string
     */
    protected static function str($v, int $max): string {
        return \core_text::substr(trim(clean_param((string)$v, PARAM_TEXT)), 0, $max);
    }

    /**
     * Lines of wording: one per line, alternatives with |.
     *
     * @param mixed $v
     * @return string[]
     */
    protected static function lines($v): array {
        $list = is_array($v) ? $v : preg_split('/\R/u', (string)$v);
        $out = [];
        foreach ($list as $l) {
            $l = self::str($l, 300);
            if ($l !== '') {
                $out[] = $l;
            }
        }
        return array_slice(array_values(array_unique($out)), 0, 30);
    }

    /**
     * A stable id for a list entry.
     *
     * @param mixed $id
     * @param int $n
     * @return string
     */
    protected static function id($id, int $n): string {
        $id = clean_param((string)$id, PARAM_ALPHANUMEXT);
        return $id !== '' ? \core_text::substr($id, 0, 20) : 'i' . $n;
    }

    /**
     * Clean a set-up sent by the teacher's browser.
     *
     * @param array $c
     * @param \stdClass $course for checking learning resource links
     * @return array
     */
    public static function clean(array $c, \stdClass $course): array {
        $d = self::defaults();
        $out = [
            'mode' => in_array($c['mode'] ?? '', self::MODES, true) ? $c['mode'] : $d['mode'],
            'engine' => in_array($c['engine'] ?? '', self::ENGINES, true) ? $c['engine'] : 'rules',
            'maxattempts' => max(0, min(100, (int)($c['maxattempts'] ?? 0))),
            'allowretry' => !empty($c['allowretry']) ? 1 : 0,
            'namemissing' => !empty($c['namemissing']) ? 1 : 0,
            'showhistory' => !empty($c['showhistory']) ? 1 : 0,
            'when' => in_array($c['when'] ?? '', self::WHEN, true) ? $c['when'] : 'practice',
            'minwords' => max(0, min(20000, (int)($c['minwords'] ?? 0))),
            'maxwords' => max(0, min(20000, (int)($c['maxwords'] ?? 0))),
            'order' => !empty($c['order']) ? 1 : 0,
            'quality' => array_key_exists('quality', $c) ? (int)(bool)$c['quality'] : 1,
            'intro' => self::str($c['intro'] ?? '', 1000),
            'modelanswer' => \core_text::substr(trim(clean_param((string)($c['modelanswer'] ?? ''), PARAM_TEXT)), 0, 5000),
            'concepts' => [],
            'terms' => [],
            'prohibited' => [],
            'values' => [],
        ];
        $modinfo = get_fast_modinfo($course);
        $resource = function ($v) use ($modinfo): int {
            $id = (int)$v;
            return $id && isset($modinfo->cms[$id]) ? $id : 0;
        };
        $n = 1;
        foreach (array_slice((array)($c['concepts'] ?? []), 0, 25) as $x) {
            $x = (array)$x;
            $label = self::str($x['label'] ?? '', 150);
            $phrases = self::lines($x['phrases'] ?? []);
            if ($label === '' && !$phrases) {
                continue;
            }
            $out['concepts'][] = [
                'id' => self::id($x['id'] ?? '', $n++),
                'label' => $label !== '' ? $label : preg_split('/\s*[|\/]\s*/u', $phrases[0])[0],
                'phrases' => $phrases ?: [$label],
                'required' => array_key_exists('required', $x) ? (int)(bool)$x['required'] : 1,
                'found' => self::str($x['found'] ?? '', 500),
                'missing' => self::str($x['missing'] ?? '', 500),
                'partial' => self::str($x['partial'] ?? '', 500),
                'hints' => array_slice(array_values(array_filter(array_map(
                    fn($h) => self::str($h, 300),
                    (array)($x['hints'] ?? [])
                ), fn($h) => $h !== '')), 0, 3),
                'resource' => $resource($x['resource'] ?? 0),
            ];
        }
        foreach (array_slice((array)($c['terms'] ?? []), 0, 25) as $x) {
            $x = (array)$x;
            $phrases = self::lines($x['phrases'] ?? ($x['label'] ?? ''));
            if (!$phrases) {
                continue;
            }
            $out['terms'][] = [
                'id' => self::id($x['id'] ?? '', $n++),
                'label' => self::str($x['label'] ?? '', 150) ?: preg_split('/\s*[|\/]\s*/u', $phrases[0])[0],
                'phrases' => $phrases,
                'missing' => self::str($x['missing'] ?? '', 500),
                'resource' => $resource($x['resource'] ?? 0),
            ];
        }
        foreach (array_slice((array)($c['prohibited'] ?? []), 0, 25) as $x) {
            $x = (array)$x;
            $phrases = self::lines($x['phrases'] ?? []);
            if (!$phrases) {
                continue;
            }
            $out['prohibited'][] = [
                'id' => self::id($x['id'] ?? '', $n++),
                'phrases' => $phrases,
                'message' => self::str($x['message'] ?? '', 500),
            ];
        }
        foreach (array_slice((array)($c['values'] ?? []), 0, 10) as $x) {
            $x = (array)$x;
            $lo = ($x['vmin'] ?? '') === '' ? '' : (float)$x['vmin'];
            $hi = ($x['vmax'] ?? '') === '' ? '' : (float)$x['vmax'];
            if ($lo === '' && $hi === '') {
                continue;
            }
            $out['values'][] = [
                'id' => self::id($x['id'] ?? '', $n++),
                'label' => self::str($x['label'] ?? '', 150),
                'phrases' => self::lines($x['phrases'] ?? []),
                'unit' => self::str($x['unit'] ?? '', 60),
                'vmin' => $lo,
                'vmax' => $hi,
                'wrong' => self::str($x['wrong'] ?? '', 500),
                'missing' => self::str($x['missing'] ?? '', 500),
            ];
        }
        return $out;
    }

    /**
     * The set-up for an activity or question, or null.
     *
     * @param int $cmid
     * @param int $qbeid
     * @return \stdClass|null record with ->config decoded
     */
    public static function get(int $cmid, int $qbeid = 0): ?\stdClass {
        global $DB;
        $rec = $DB->get_record('local_fastgrade_ifset', ['cmid' => $cmid, 'qbeid' => $qbeid]);
        if (!$rec) {
            return null;
        }
        $rec->config = array_merge(self::defaults(), json_decode($rec->configjson, true) ?: []);
        return $rec;
    }

    /**
     * The set-up students may use: switched on here and on the site.
     *
     * @param int $cmid
     * @param int $qbeid
     * @return \stdClass|null
     */
    public static function live(int $cmid, int $qbeid = 0): ?\stdClass {
        if (!self::site_enabled()) {
            return null;
        }
        $rec = self::get($cmid, $qbeid);
        return $rec && $rec->enabled && self::has_checks($rec->config) ? $rec : null;
    }

    /**
     * Whether a set-up has anything to check.
     *
     * @param array $config
     * @return bool
     */
    public static function has_checks(array $config): bool {
        return !empty($config['concepts']) || !empty($config['terms']) || !empty($config['values']) ||
            ($config['engine'] === 'ai' && trim($config['modelanswer']) !== '');
    }

    /**
     * Save a set-up. A change to what is checked starts a new version.
     *
     * @param int $cmid
     * @param int $qbeid
     * @param bool $enabled
     * @param array $config cleaned
     * @return \stdClass
     */
    public static function save(int $cmid, int $qbeid, bool $enabled, array $config): \stdClass {
        global $DB, $USER;
        $json = json_encode($config);
        $rec = $DB->get_record('local_fastgrade_ifset', ['cmid' => $cmid, 'qbeid' => $qbeid]);
        if ($rec) {
            if ($rec->configjson !== $json) {
                $rec->rev = (int)$rec->rev + 1;
            }
            $rec->configjson = $json;
            $rec->enabled = $enabled ? 1 : 0;
            $rec->usermodified = $USER->id;
            $rec->timemodified = time();
            $DB->update_record('local_fastgrade_ifset', $rec);
        } else {
            $rec = (object)['cmid' => $cmid, 'qbeid' => $qbeid, 'enabled' => $enabled ? 1 : 0, 'configjson' => $json,
                'rev' => 1, 'usermodified' => $USER->id, 'timemodified' => time()];
            $rec->id = $DB->insert_record('local_fastgrade_ifset', $rec);
        }
        return self::get($cmid, $qbeid);
    }

    /**
     * Checks per answer allowed for a set-up: its own limit, never above the site's (0 = none).
     *
     * @param array $config
     * @return int
     */
    public static function max_attempts(array $config): int {
        if (empty($config['allowretry'])) {
            return 1;
        }
        $site = self::site_max_attempts();
        $own = (int)$config['maxattempts'];
        if (!$site) {
            return $own;
        }
        return $own ? min($own, $site) : $site;
    }

    /**
     * Ready-made concepts from what the activity already has, for the teacher to edit: the essay's
     * grader information, the rubric or marking guide, and Fast Grade auto-marking checks.
     *
     * @param \cm_info $cm
     * @param int $qbeid
     * @return array partial set-up
     */
    public static function suggest(\cm_info $cm, int $qbeid): array {
        $points = [];
        $mustnot = [];
        $minwords = 0;
        $maxwords = 0;
        $model = '';
        $lookfors = \local_fastgrade\local\lookfors::for_cm((int)$cm->id);
        if ($cm->modname === 'quiz' && $qbeid) {
            $q = questions::latest($qbeid);
            if ($q) {
                $model = trim(html_to_text((string)($q->graderinfo ?? ''), 0, false));
                $minwords = (int)($q->minwordlimit ?? 0);
                $maxwords = (int)($q->maxwordlimit ?? 0);
                foreach (['q' . $q->id, 'qall' . $q->id] as $key) {
                    foreach ($lookfors[$key] ?? [] as $r) {
                        self::from_rule($r, $points, $mustnot);
                    }
                }
            }
        } else if ($cm->modname === 'assign') {
            $context = \context_module::instance($cm->id);
            $def = (new \local_fastgrade\local\advanced_grading($context, 'mod_assign', 'submissions'))->export_definition();
            foreach ($def['criteria'] ?? [] as $c) {
                $text = trim(html_to_text((string)($c['shortname'] ?? '') . ' ' . (string)($c['description'] ?? ''), 0, false));
                if ($text !== '') {
                    $points[] = ['label' => \core_text::substr($text, 0, 150), 'phrases' => []];
                }
            }
            foreach ($lookfors as $key => $rules) {
                foreach ($rules as $r) {
                    self::from_rule($r, $points, $mustnot);
                }
            }
        }
        if ($model !== '' && !$points) {
            foreach (\local_fastgrade\local\engine\text::sentences($model) as $s) {
                $points[] = ['label' => \core_text::substr($s['text'], 0, 150), 'phrases' => []];
            }
        }
        $concepts = [];
        $n = 1;
        foreach (array_slice($points, 0, 12) as $p) {
            $phrases = $p['phrases'] ?: self::key_phrases($p['label']);
            $concepts[] = ['id' => 's' . $n++, 'label' => $p['label'], 'phrases' => $phrases, 'required' => 1,
                'found' => '', 'missing' => '', 'partial' => '', 'hints' => [], 'resource' => 0];
        }
        $prohibited = [];
        foreach (array_slice($mustnot, 0, 10) as $m) {
            $prohibited[] = ['id' => 's' . $n++, 'phrases' => $m['phrases'], 'message' => $m['message']];
        }
        return ['concepts' => $concepts, 'prohibited' => $prohibited, 'minwords' => $minwords, 'maxwords' => $maxwords,
            'modelanswer' => \core_text::substr($model, 0, 5000)];
    }

    /**
     * Turn an auto-marking rule into concepts or banned statements.
     *
     * @param array $r
     * @param array $points
     * @param array $mustnot
     */
    protected static function from_rule(array $r, array &$points, array &$mustnot): void {
        $cfg = (array)($r['config'] ?? []);
        $terms = array_values(array_filter((array)($cfg['terms'] ?? [])));
        switch ($r['kind'] ?? '') {
            case 'term':
            case 'anyof':
            case 'ideas':
                foreach ($terms as $t) {
                    $points[] = ['label' => preg_split('/\s*[|\/]\s*/u', $t)[0], 'phrases' => [$t]];
                }
                break;
            case 'keypoints':
                foreach ($terms as $t) {
                    $points[] = ['label' => \core_text::substr($t, 0, 150), 'phrases' => []];
                }
                break;
            case 'mustnot':
                if ($terms) {
                    $mustnot[] = ['phrases' => $terms, 'message' => (string)($cfg['comment'] ?? '')];
                }
                break;
        }
    }

    /**
     * Wording to look for in a key point: its two to three main content words as one phrase, and the
     * rarest single word as an alternative. The teacher should check these.
     *
     * @param string $point
     * @return string[]
     */
    public static function key_phrases(string $point): array {
        $tk = array_values(array_filter(\local_fastgrade\local\engine\text::tokens($point), fn($x) =>
            !in_array($x['w'], \local_fastgrade\local\engine\text::STOP, true) && \core_text::strlen($x['w']) > 3 &&
            !preg_match('/^(identify|describe|explain|outline|discuss|student|learner|should|must|correct|relevant|' .
                'appropriate|answer|response|include|including|example)/', $x['w'])));
        if (!$tk) {
            return [$point];
        }
        $words = array_slice(array_column($tk, 'w'), 0, 3);
        $alts = [implode(' ', $words)];
        if (count($words) > 1) {
            usort($words, fn($a, $b) => strlen($b) <=> strlen($a));
            $alts[] = $words[0] . ' ' . ($words[1] ?? '');
        }
        return [implode(' | ', array_unique(array_map('trim', $alts)))];
    }
}
