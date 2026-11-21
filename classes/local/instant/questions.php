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
 * Essay questions in a quiz. Set-ups are kept per question bank entry, so they carry on working when a
 * teacher saves a new version of the question.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class questions {
    /**
     * Essay questions placed directly in a quiz (random questions are left out).
     *
     * @param \cm_info $cm
     * @return array [[slot, number, qbeid, questionid, name, text]]
     */
    public static function essays(\cm_info $cm): array {
        global $DB;
        $context = \context_module::instance($cm->id);
        $sql = "SELECT s.id AS slotid, s.slot, s.page, qr.questionbankentryid AS qbeid, qr.version
                  FROM {quiz_slots} s
                  JOIN {question_references} qr ON qr.itemid = s.id AND qr.component = 'mod_quiz'
                       AND qr.questionarea = 'slot' AND qr.usingcontextid = :ctx
                 WHERE s.quizid = :quizid
              ORDER BY s.slot";
        $rows = $DB->get_records_sql($sql, ['quizid' => $cm->instance, 'ctx' => $context->id]);
        $out = [];
        $number = 0;
        foreach ($rows as $r) {
            $q = $r->version ? self::version((int)$r->qbeid, (int)$r->version) : self::latest((int)$r->qbeid);
            if (!$q || $q->qtype === 'description') {
                continue;
            }
            $number++;
            if ($q->qtype !== 'essay') {
                continue;
            }
            $out[] = [
                'slot' => (int)$r->slot,
                'number' => $number,
                'qbeid' => (int)$r->qbeid,
                'questionid' => (int)$q->id,
                'name' => format_string($q->name, true, ['context' => $context]),
                'text' => \core_text::substr(trim(html_to_text((string)$q->questiontext, 0, false)), 0, 400),
            ];
        }
        return $out;
    }

    /**
     * The newest ready version of a question bank entry, with essay options.
     *
     * @param int $qbeid
     * @return \stdClass|null
     */
    public static function latest(int $qbeid): ?\stdClass {
        global $DB;
        $sql = "SELECT q.*
                  FROM {question_versions} qv
                  JOIN {question} q ON q.id = qv.questionid
                 WHERE qv.questionbankentryid = :qbeid AND qv.status = 'ready'
              ORDER BY qv.version DESC";
        $q = $DB->get_records_sql($sql, ['qbeid' => $qbeid], 0, 1);
        return $q ? self::with_options(reset($q)) : null;
    }

    /**
     * A given version of a question bank entry.
     *
     * @param int $qbeid
     * @param int $version
     * @return \stdClass|null
     */
    public static function version(int $qbeid, int $version): ?\stdClass {
        global $DB;
        $sql = "SELECT q.*
                  FROM {question_versions} qv
                  JOIN {question} q ON q.id = qv.questionid
                 WHERE qv.questionbankentryid = :qbeid AND qv.version = :v";
        $q = $DB->get_record_sql($sql, ['qbeid' => $qbeid, 'v' => $version]);
        return $q ? self::with_options($q) : null;
    }

    /**
     * Add essay options to a question record.
     *
     * @param \stdClass $q
     * @return \stdClass
     */
    protected static function with_options(\stdClass $q): \stdClass {
        global $DB;
        if ($q->qtype === 'essay') {
            $opt = $DB->get_record('qtype_essay_options', ['questionid' => $q->id]);
            if ($opt) {
                foreach (
                    ['graderinfo', 'graderinfoformat', 'responsetemplate', 'responsetemplateformat', 'minwordlimit',
                        'maxwordlimit', 'responseformat'] as $f
                ) {
                    $q->$f = $opt->$f ?? null;
                }
            }
        }
        return $q;
    }

    /**
     * The question bank entry of a question.
     *
     * @param int $questionid
     * @return int
     */
    public static function qbeid(int $questionid): int {
        global $DB;
        return (int)$DB->get_field('question_versions', 'questionbankentryid', ['questionid' => $questionid]);
    }
}
