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
 * Stores and loads annotations.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class annotations {
    /** Allowed annotation types. */
    const TYPES = [
        'highlight',
        'underline',
        'strike',
        'squiggly',
        'comment',
        'border',
        'stamp',
        'ink',
        'rect',
        'ellipse',
        'line',
        'arrow',
        'text',
        'area',
        'cell',
        'timecomment',
        'linecomment',
    ];

    /** Allowed polarities. */
    const POLARITIES = ['improvement', 'positive', 'neutral'];

    /** Allowed sources. */
    const SOURCES = ['typed', 'voice', 'bank', 'auto'];

    /** Allowed statuses. */
    const STATUSES = ['active', 'suggested', 'rejected'];

    /**
     * Export a record for the app.
     *
     * @param \stdClass $r
     * @return array
     */
    public static function export(\stdClass $r): array {
        return [
            'clientid' => $r->clientid,
            'docref' => $r->docref,
            'page' => (int)$r->page,
            'type' => $r->type,
            'polarity' => $r->polarity,
            'anchor' => $r->anchorjson ? json_decode($r->anchorjson, true) : null,
            'style' => $r->stylejson ? json_decode($r->stylejson, true) : null,
            'comment' => (string)$r->comment,
            'source' => $r->source,
            'status' => $r->status,
            'criterionid' => (int)$r->criterionid,
            'authorid' => (int)$r->authorid,
            'decision' => (string)$r->decision,
            'timemodified' => (int)$r->timemodified,
        ];
    }

    /**
     * All annotations for a marking record.
     *
     * @param int $markid
     * @param bool $includerejected
     * @return array
     */
    public static function for_mark(int $markid, bool $includerejected = false): array {
        global $DB;
        $select = 'markid = :markid';
        if (!$includerejected) {
            $select .= " AND status <> 'rejected'";
        }
        $rows = $DB->get_records_select('local_fastgrade_annot', $select, ['markid' => $markid], 'page, id');
        return array_values(array_map([self::class, 'export'], $rows));
    }

    /**
     * Clean one annotation coming from the browser.
     *
     * @param array $a
     * @return array
     */
    protected static function clean(array $a): array {
        $type = in_array($a['type'] ?? '', self::TYPES) ? $a['type'] : 'comment';
        $polarity = in_array($a['polarity'] ?? '', self::POLARITIES) ? $a['polarity'] : 'neutral';
        $source = in_array($a['source'] ?? '', self::SOURCES) ? $a['source'] : 'typed';
        $status = in_array($a['status'] ?? '', self::STATUSES) ? $a['status'] : 'active';
        $anchor = $a['anchor'] ?? null;
        $style = $a['style'] ?? null;
        $anchorjson = $anchor === null ? null : json_encode($anchor);
        $stylejson = $style === null ? null : json_encode($style);
        if ($anchorjson !== null && strlen($anchorjson) > 200000) {
            throw new \moodle_exception('annotationtoolarge', 'local_fastgrade');
        }
        return [
            'clientid' => clean_param((string)($a['clientid'] ?? ''), PARAM_ALPHANUMEXT),
            'docref' => clean_param((string)($a['docref'] ?? ''), PARAM_TEXT),
            'page' => max(0, (int)($a['page'] ?? 0)),
            'type' => $type,
            'polarity' => $polarity,
            'anchorjson' => $anchorjson,
            'stylejson' => $stylejson,
            'comment' => clean_param((string)($a['comment'] ?? ''), PARAM_TEXT),
            'source' => $source,
            'status' => $status,
            'criterionid' => (int)($a['criterionid'] ?? 0),
        ];
    }

    /**
     * Apply a batch of changes from the browser.
     *
     * @param \stdClass $mark marking record
     * @param array $upserts
     * @param array $deletes client ids
     * @param array $meta clientid => ['dictationsecs' => int, 'provider' => string]
     * @return array saved client ids
     */
    public static function apply(\stdClass $mark, array $upserts, array $deletes, array $meta = []): array {
        global $DB, $USER;
        $now = time();
        $saved = [];
        $transaction = $DB->start_delegated_transaction();
        foreach ($upserts as $raw) {
            $a = self::clean($raw);
            if ($a['clientid'] === '' || $a['docref'] === '') {
                continue;
            }
            $existing = $DB->get_record('local_fastgrade_annot', ['markid' => $mark->id, 'clientid' => $a['clientid']]);
            if ($existing) {
                $rec = (object)($a + ['id' => $existing->id, 'timemodified' => $now]);
                // Decisions on suggestions.
                if ($existing->status === 'suggested' && $a['status'] === 'active') {
                    $rec->decidedby = $USER->id;
                    $rec->decision = (trim((string)$existing->comment) === trim($a['comment'])) ? 'accepted' : 'edited';
                } else if ($existing->status === 'suggested' && $a['status'] === 'rejected') {
                    $rec->decidedby = $USER->id;
                    $rec->decision = 'rejected';
                }
                $DB->update_record('local_fastgrade_annot', $rec);
                $firstcomment = trim((string)$existing->comment) === '' && $a['comment'] !== '';
            } else {
                $rec = (object)($a + [
                    'markid' => $mark->id,
                    'cmid' => $mark->cmid,
                    'userid' => $mark->userid,
                    'authorid' => $USER->id,
                    'decidedby' => 0,
                    'timecreated' => $now,
                    'timemodified' => $now,
                ]);
                $rec->id = $DB->insert_record('local_fastgrade_annot', $rec);
                $firstcomment = $a['comment'] !== '' && $a['status'] === 'active';
            }
            if (!empty($firstcomment) && $a['source'] !== 'auto') {
                $m = $meta[$a['clientid']] ?? [];
                feedback_log::add(
                    $mark,
                    'annotation',
                    $a['source'] === 'voice' ? 'voice' : 'typed',
                    $a['polarity'],
                    $a['comment'],
                    (int)($m['dictationsecs'] ?? 0),
                    (string)($m['provider'] ?? '')
                );
            }
            $saved[] = $a['clientid'];
        }
        if ($deletes) {
            $deletes = array_map(fn($d) => clean_param($d, PARAM_ALPHANUMEXT), $deletes);
            [$insql, $params] = $DB->get_in_or_equal($deletes, SQL_PARAMS_NAMED);
            $params['markid'] = $mark->id;
            $DB->delete_records_select('local_fastgrade_annot', "markid = :markid AND clientid $insql", $params);
        }
        $transaction->allow_commit();
        return $saved;
    }
}
