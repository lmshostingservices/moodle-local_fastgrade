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
 * Fast Grade's stat cards, KPIs and reports for Beacon (local_beacon 2.10+, collect_catalogue hook).
 *
 * Everything is worked out from Fast Grade's own tables, so it reflects marking done in Fast Grade.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class beacon {
    /** @var string */
    const C = 'local_fastgrade';

    /**
     * Add Fast Grade's items to Beacon.
     *
     * @param \local_beacon\hook\collect_catalogue $hook
     */
    public static function collect($hook): void {
        $since = fn() => time() - 30 * DAYSECS;

        $hook->add_metric(
            [
                'id' => 'fastgrade_turnaround',
                'kind' => 'stat',
                'family' => 'assessment',
                'component' => self::C,
                'icon' => 'clock',
                'format' => 'number',
                'better' => 'lower',
                'requirestable' => 'local_fastgrade_mark',
                'compute' => function ($DB) use ($since) {
                    $r = $DB->get_record_sql(
                        "SELECT AVG(timegraded - timesubmitted) AS secs, COUNT(1) AS n
                                                FROM {local_fastgrade_mark}
                                               WHERE timegraded >= :since AND timesubmitted > 0
                                                     AND timegraded >= timesubmitted",
                        ['since' => $since()]
                    );
                    return [$r && $r->n ? round($r->secs / DAYSECS, 1) : null, (int)($r->n ?? 0)];
                },
            ]
        );
        $hook->add_metric(
            [
                'id' => 'fastgrade_marked30',
                'kind' => 'stat',
                'family' => 'assessment',
                'component' => self::C,
                'icon' => 'check',
                'format' => 'number',
                'better' => 'higher',
                'requirestable' => 'local_fastgrade_mark',
                'compute' => function ($DB) use ($since) {
                    return [
                        $DB->count_records_select(
                            'local_fastgrade_mark',
                            'timegraded >= :since',
                            ['since' => $since()]
                        ),
                        null,
                    ];
                },
            ]
        );
        $hook->add_metric(
            [
                'id' => 'fastgrade_voice_share',
                'kind' => 'kpi',
                'family' => 'assessment',
                'component' => self::C,
                'icon' => 'gauge',
                'format' => 'percent',
                'better' => 'higher',
                'target' => 50,
                'amber' => 20,
                'green' => 50,
                'requirestable' => 'local_fastgrade_fbitem',
                'compute' => function ($DB) use ($since) {
                    $r = $DB->get_record_sql(
                        "SELECT SUM(CASE WHEN mode = 'voice' THEN 1 ELSE 0 END) AS num, COUNT(1) AS den
                                                FROM {local_fastgrade_fbitem} WHERE timecreated >= :since",
                        ['since' => $since()]
                    );
                    $den = (int)($r->den ?? 0);
                    return [$den ? 100.0 * (int)$r->num / $den : null, $den];
                },
            ]
        );
        $hook->add_metric(
            [
                'id' => 'fastgrade_positive_share',
                'kind' => 'kpi',
                'family' => 'assessment',
                'component' => self::C,
                'icon' => 'gauge',
                'format' => 'percent',
                'better' => 'higher',
                'target' => 40,
                'amber' => 20,
                'green' => 35,
                'requirestable' => 'local_fastgrade_annot',
                'compute' => function ($DB) use ($since) {
                    $r = $DB->get_record_sql(
                        "SELECT SUM(CASE WHEN polarity = 'positive' THEN 1 ELSE 0 END) AS num, COUNT(1) AS den
                                                FROM {local_fastgrade_annot}
                                               WHERE status = 'active' AND polarity IN ('positive', 'improvement')
                                                     AND timecreated >= :since",
                        ['since' => $since()]
                    );
                    $den = (int)($r->den ?? 0);
                    return [$den ? 100.0 * (int)$r->num / $den : null, $den];
                },
            ]
        );

        $hook->add_report(
            [
                'id' => 'fastgrade_workload',
                'family' => 'assessment',
                'icon' => 'users',
                'grain' => 'fgmarker',
                'component' => self::C,
                'requirestable' => 'local_fastgrade_mark',
                'filters' => ['course', 'category', 'daterange'],
                'datelabel' => 'col_graded',
                'columns' => [
                    ['marker', 'bcol_marker', 'text'],
                    ['marked', 'bcol_marked', 'number'],
                    ['turnaround', 'bcol_turnaround', 'number'],
                    ['annotations', 'bcol_annotations', 'number'],
                    ['voice', 'bcol_voice', 'number'],
                    ['positive', 'bcol_positive', 'number'],
                ],
                'run' => function ($DB, $q, $limit) {
                    [$fw, $fp] = $q->where(
                        [
                            'course' => 'm.courseid',
                            'category' => 'm.courseid',
                            'daterange' => ['col' => 'm.timegraded', 'label' => 'col_graded'],
                        ]
                    );
                    $where = "m.timegraded > 0 AND m.markerid > 0 $fw";
                    $sql = "SELECT m.markerid, COUNT(1) AS marked,
                                   AVG(CASE WHEN m.timesubmitted > 0 AND m.timegraded >= m.timesubmitted
                                            THEN m.timegraded - m.timesubmitted END) AS secs
                              FROM {local_fastgrade_mark} m
                             WHERE $where
                          GROUP BY m.markerid
                          ORDER BY COUNT(1) DESC";
                    $recs = $DB->get_records_sql($sql, $fp, 0, $limit);
                    $rows = [];
                    foreach ($recs as $r) {
                        $a = $DB->get_record_sql(
                            "SELECT COUNT(1) AS n,
                                                         SUM(CASE WHEN a.source = 'voice' THEN 1 ELSE 0 END) AS voice,
                                                         SUM(CASE WHEN a.polarity = 'positive' THEN 1 ELSE 0 END) AS pos
                                                    FROM {local_fastgrade_annot} a
                                                    JOIN {local_fastgrade_mark} m ON m.id = a.markid
                                                   WHERE a.status = 'active' AND a.authorid = :marker AND $where",
                            ['marker' => $r->markerid] + $fp
                        );
                        $u = \core_user::get_user($r->markerid);
                        $n = (int)($a->n ?? 0);
                        $rows[] = [
                            \local_beacon\local\cell::text($u ? fullname($u) : '—'),
                            \local_beacon\local\cell::number((int)$r->marked),
                            \local_beacon\local\cell::number(
                                $r->secs === null ? 0 : round($r->secs / DAYSECS, 1),
                                $r->secs === null ? '—' : get_string('ndays', self::C, format_float($r->secs / DAYSECS, 1))
                            ),
                            \local_beacon\local\cell::number($n),
                            \local_beacon\local\cell::number(
                                $n ? round(100 * $a->voice / $n) : 0,
                                $n ? round(100 * $a->voice / $n) . '%' : '—'
                            ),
                            \local_beacon\local\cell::number(
                                $n ? round(100 * $a->pos / $n) : 0,
                                $n ? round(100 * $a->pos / $n) . '%' : '—'
                            ),
                        ];
                    }
                    $total = $DB->count_records_sql(
                        "SELECT COUNT(DISTINCT m.markerid) FROM {local_fastgrade_mark} m WHERE $where",
                        $fp
                    );
                    return [$rows, $total];
                },
            ]
        );

        $hook->add_report(
            [
            'id' => 'fastgrade_feedback', 'family' => 'assessment', 'icon' => 'doc', 'grain' => 'activity',
            'component' => self::C, 'requirestable' => 'local_fastgrade_mark',
            'filters' => ['course', 'category', 'daterange'], 'datelabel' => 'col_graded',
            'columns' => [
                ['activity', 'bcol_activity', 'text'],
                ['course', 'bcol_course', 'text'],
                ['marked', 'bcol_marked', 'number'],
                ['persub', 'bcol_persub', 'number'],
                ['improvement', 'bcol_improvement', 'number'],
                ['positive', 'bcol_positivecount', 'number'],
                ['voice', 'bcol_voicecount', 'number'],
                ['auto', 'bcol_autoaccepted', 'number'],
            ],
            'run' => function ($DB, $q, $limit) {
                [$fw, $fp] = $q->where(
                    [
                        'course' => 'm.courseid',
                        'category' => 'm.courseid',
                        'daterange' => ['col' => 'm.timegraded', 'label' => 'col_graded'],
                    ]
                );
                $where = "m.timegraded > 0 $fw";
                $sql = "SELECT m.cmid, MAX(m.courseid) AS courseid, MAX(m.modname) AS modname, COUNT(DISTINCT m.id) AS marked,
                               COUNT(a.id) AS annots,
                               SUM(CASE WHEN a.polarity = 'improvement' THEN 1 ELSE 0 END) AS imp,
                               SUM(CASE WHEN a.polarity = 'positive' THEN 1 ELSE 0 END) AS pos,
                               SUM(CASE WHEN a.source = 'voice' THEN 1 ELSE 0 END) AS voice,
                               SUM(CASE WHEN a.source = 'auto' THEN 1 ELSE 0 END) AS auto
                          FROM {local_fastgrade_mark} m
                     LEFT JOIN {local_fastgrade_annot} a ON a.markid = m.id AND a.status = 'active'
                         WHERE $where
                      GROUP BY m.cmid
                      ORDER BY COUNT(DISTINCT m.id) DESC";
                $recs = $DB->get_records_sql($sql, $fp, 0, $limit);
                $rows = [];
                foreach ($recs as $r) {
                    $name = '—';
                    $url = null;
                    $course = '—';
                    try {
                        [$c, $cm] = get_course_and_cm_from_cmid($r->cmid);
                        $name = format_string($cm->name);
                        $url = (new \moodle_url('/local/fastgrade/grade.php', ['id' => $r->cmid]))->out(false);
                        $course = format_string($c->shortname);
                    } catch (\Throwable $e) {
                        // Deleted activity.
                        $name = get_string('deletedactivity', self::C);
                    }
                    $per = $r->marked ? round($r->annots / $r->marked, 1) : 0;
                    $rows[] = [
                        \local_beacon\local\cell::text($name, $url),
                        \local_beacon\local\cell::text($course),
                        \local_beacon\local\cell::number((int)$r->marked),
                        \local_beacon\local\cell::number($per, format_float($per, 1)),
                        \local_beacon\local\cell::number((int)$r->imp),
                        \local_beacon\local\cell::number((int)$r->pos),
                        \local_beacon\local\cell::number((int)$r->voice),
                        \local_beacon\local\cell::number((int)$r->auto),
                    ];
                }
                $total = $DB->count_records_sql("SELECT COUNT(DISTINCT m.cmid) FROM {local_fastgrade_mark} m WHERE $where", $fp);
                return [$rows, $total];
            },
            ]
        );
    }
}
