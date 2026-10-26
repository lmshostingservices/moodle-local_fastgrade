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

use cm_info;
use context_module;
use moodle_exception;

/**
 * A gradable activity that Fast Grade can mark.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
abstract class source {
    /** @var cm_info */
    protected cm_info $cm;

    /** @var context_module */
    protected context_module $context;

    /** @var \stdClass */
    protected \stdClass $course;

    /**
     * Constructor.
     *
     * @param cm_info $cm
     */
    protected function __construct(cm_info $cm) {
        $this->cm = $cm;
        $this->context = context_module::instance($cm->id);
        $this->course = get_course($cm->course);
    }

    /**
     * Supported module names.
     *
     * @return string[]
     */
    public static function supported_modules(): array {
        return ['assign', 'quiz'];
    }

    /**
     * Build the source for a course module.
     *
     * @param int $cmid
     * @return source
     */
    public static function for_cmid(int $cmid): source {
        [$course, $cm] = get_course_and_cm_from_cmid($cmid);
        switch ($cm->modname) {
            case 'assign':
                return new assign_source($cm);
            case 'quiz':
                return new quiz_source($cm);
        }
        throw new moodle_exception('unsupportedactivity', 'local_fastgrade');
    }

    /**
     * Whether Fast Grade is switched on for this kind of activity.
     *
     * @param string $modname
     * @return bool
     */
    public static function is_enabled_for(string $modname): bool {
        if (!in_array($modname, self::supported_modules())) {
            return false;
        }
        $value = get_config('local_fastgrade', 'enable_' . $modname);
        return $value === false ? true : (bool)$value;
    }

    /**
     * The course module.
     *
     * @return cm_info
     */
    public function get_cm(): cm_info {
        return $this->cm;
    }

    /**
     * The module context.
     *
     * @return context_module
     */
    public function get_context(): context_module {
        return $this->context;
    }

    /**
     * The course record.
     *
     * @return \stdClass
     */
    public function get_course(): \stdClass {
        return $this->course;
    }

    /**
     * Throw unless the current user may mark in this activity.
     */
    public function require_grade_access(): void {
        require_login($this->course, false, $this->cm);
        require_capability('local/fastgrade:grade', $this->context);
        require_capability($this->activity_grade_capability(), $this->context);
        if (!self::is_enabled_for($this->cm->modname)) {
            throw new moodle_exception('disabledforactivity', 'local_fastgrade');
        }
    }

    /**
     * Whether the current user may mark in this activity.
     *
     * @return bool
     */
    public function can_grade(): bool {
        return self::is_enabled_for($this->cm->modname)
            && has_capability('local/fastgrade:grade', $this->context)
            && has_capability($this->activity_grade_capability(), $this->context);
    }

    /**
     * The activity's own capability needed for marking.
     *
     * @return string
     */
    abstract protected function activity_grade_capability(): string;

    /**
     * Activity information for the app bootstrap.
     *
     * @return array
     */
    abstract public function get_info(): array;

    /**
     * The list of people to mark.
     *
     * @param int $groupid
     * @return array
     */
    abstract public function get_participants(int $groupid): array;

    /**
     * Everything the marking screen needs for one student.
     *
     * @param int $userid
     * @param int $attempt
     * @param int $slot
     * @return array
     */
    abstract public function get_item(int $userid, int $attempt, int $slot = 0): array;

    /**
     * Save a grade and feedback.
     *
     * @param int $userid
     * @param int $attempt
     * @param int $slot
     * @param array $data
     * @return array Fresh grade state.
     */
    abstract public function save_grade(int $userid, int $attempt, int $slot, array $data): array;

    /**
     * Answers as plain text with the marks already given (for the rule test bench and grouping).
     *
     * @param int $slot quiz slot, 0 for assignments
     * @param bool $all include answers not yet marked
     * @return array
     */
    abstract public function get_corpus(int $slot, bool $all): array;

    /**
     * Every submission as files for one ZIP download.
     *
     * @param bool $allversions every attempt, or only each student's latest
     * @param int $slot quiz slot, 0 for all essay questions (ignored for assignments)
     * @param int $groupid 0 for everyone the marker can see
     * @return array archive path => stored_file or [content string]
     */
    abstract public function bundle(bool $allversions, int $slot, int $groupid): array;

    /**
     * Data for the activity report.
     *
     * @return array ['meta' => [...], 'rows' => [...]]
     */
    abstract public function report_dataset(): array;

    /**
     * A folder name for a student: their name and id, or their alias when names are hidden.
     *
     * @param \stdClass $user
     * @param bool $anonymous
     * @param string $alias
     * @return string
     */
    protected function folder_name(\stdClass $user, bool $anonymous, string $alias): string {
        $name = $anonymous ? $alias : fullname($user) . '_' . $user->id;
        return clean_filename(str_replace(['/', '\\'], '-', $name));
    }

    /**
     * A small standalone HTML page around submitted text.
     *
     * @param string $title
     * @param string $html
     * @return array [content]
     */
    protected function html_page(string $title, string $html): array {
        return [
            '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' . s($title) . '</title>' .
            '<style>body{font:16px/1.6 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem;color:#1f2328}' .
            'h1{font-size:1.2rem}</style></head><body><h1>' . s($title) . '</h1>' . $html . '</body></html>',
        ];
    }

    /**
     * The groups the current user can choose between, plus the active group.
     *
     * @return array
     */
    public function get_group_info(): array {
        $mode = groups_get_activity_groupmode($this->cm);
        if (!$mode) {
            return ['mode' => 0, 'active' => 0, 'groups' => []];
        }
        $aag = has_capability('moodle/site:accessallgroups', $this->context);
        $groups = groups_get_activity_allowed_groups($this->cm);
        $active = (int)groups_get_activity_group($this->cm, true);
        $list = [];
        if ($aag || $mode == VISIBLEGROUPS) {
            $list[] = ['id' => 0, 'name' => get_string('allparticipants')];
        }
        foreach ($groups as $g) {
            $list[] = ['id' => (int)$g->id, 'name' => format_string($g->name, true, ['context' => $this->context])];
        }
        return ['mode' => (int)$mode, 'active' => $active, 'groups' => $list];
    }

    /**
     * Get (and optionally create) the marking record for an item.
     *
     * @param int $userid
     * @param int $attempt
     * @param int $slot
     * @param int $itemid
     * @param bool $create
     * @return \stdClass|null
     */
    public function get_mark_record(int $userid, int $attempt, int $slot, int $itemid = 0, bool $create = true): ?\stdClass {
        global $DB;
        $params = ['cmid' => $this->cm->id, 'userid' => $userid, 'attempt' => $attempt, 'slot' => $slot];
        $rec = $DB->get_record('local_fastgrade_mark', $params);
        if ($rec || !$create) {
            if ($rec && $itemid && (int)$rec->itemid !== $itemid) {
                $rec->itemid = $itemid;
                $DB->set_field('local_fastgrade_mark', 'itemid', $itemid, ['id' => $rec->id]);
            }
            return $rec ?: null;
        }
        $rec = (object)($params + [
            'courseid' => $this->course->id,
            'modname' => $this->cm->modname,
            'itemid' => $itemid,
            'markerid' => 0,
            'timesubmitted' => 0,
            'timefirstopened' => 0,
            'timegraded' => 0,
            'timemodified' => time(),
        ]);
        try {
            $id = $DB->insert_record('local_fastgrade_mark', $rec);
            // Read it back so every column (and its default) is present.
            $rec = $DB->get_record('local_fastgrade_mark', ['id' => $id], '*', MUST_EXIST);
        } catch (\dml_write_exception $e) {
            // Created by a concurrent request.
            $rec = $DB->get_record('local_fastgrade_mark', $params, '*', MUST_EXIST);
        }
        return $rec;
    }

    /**
     * Note that the marker opened an item (first time only), and record when it was submitted.
     *
     * @param \stdClass $mark
     * @param int $timesubmitted
     */
    protected function touch_opened(\stdClass $mark, int $timesubmitted): void {
        global $DB;
        $update = [];
        if (!$mark->timefirstopened) {
            $update['timefirstopened'] = time();
        }
        if ($timesubmitted && (int)$mark->timesubmitted !== $timesubmitted) {
            $update['timesubmitted'] = $timesubmitted;
        }
        if ($update) {
            $update['id'] = $mark->id;
            $DB->update_record('local_fastgrade_mark', (object)$update);
        }
    }

    /**
     * Record that an item was graded.
     *
     * @param \stdClass $mark
     */
    protected function touch_graded(\stdClass $mark): void {
        global $DB, $USER;
        $DB->update_record(
            'local_fastgrade_mark',
            (object)[
                'id' => $mark->id,
                'timegraded' => time(),
                'markerid' => $USER->id,
                'timemodified' => time(),
            ]
        );
    }

    /**
     * Picture and name data for a user.
     *
     * @param \stdClass $user
     * @param bool $anonymous
     * @param string $alias
     * @return array
     */
    protected function export_person(\stdClass $user, bool $anonymous, string $alias): array {
        global $PAGE;
        if ($anonymous) {
            return ['id' => (int)$user->id, 'fullname' => $alias, 'initials' => '#', 'picture' => '', 'email' => ''];
        }
        $pic = new \user_picture($user);
        $pic->size = 64;
        $initials = \core_text::substr($user->firstname ?? '', 0, 1) . \core_text::substr($user->lastname ?? '', 0, 1);
        return [
            'id' => (int)$user->id,
            'fullname' => fullname($user),
            'initials' => \core_text::strtoupper($initials),
            'picture' => $pic->get_url($PAGE)->out(false),
            'email' => '',
        ];
    }
}
