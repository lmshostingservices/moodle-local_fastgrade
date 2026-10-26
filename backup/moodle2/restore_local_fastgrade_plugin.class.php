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

/**
 * Restore of Fast Grade data that belongs to an activity.
 *
 * Ids that point at other restored things (users, quiz attempts, rubric and guide criteria,
 * questions) are mapped once the whole activity has been restored.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class restore_local_fastgrade_plugin extends restore_local_plugin {
    /**
     * Paths to restore.
     *
     * @return restore_path_element[]
     */
    protected function define_module_plugin_structure() {
        $paths = [
            new restore_path_element('fastgrade_lookfor', $this->get_pathfor('/lookfors/lookfor')),
            new restore_path_element('fastgrade_qcrit', $this->get_pathfor('/qcrits/qcrit')),
        ];
        if ($this->get_setting_value('userinfo')) {
            $paths[] = new restore_path_element('fastgrade_mark', $this->get_pathfor('/marks/mark'));
            $paths[] = new restore_path_element('fastgrade_annot', $this->get_pathfor('/marks/mark/annots/annot'));
            $paths[] = new restore_path_element('fastgrade_fbitem', $this->get_pathfor('/marks/mark/fbitems/fbitem'));
            $paths[] = new restore_path_element('fastgrade_note', $this->get_pathfor('/notes/note'));
        }
        return $paths;
    }

    /**
     * A look-for rule.
     *
     * @param array $data
     */
    public function process_fastgrade_lookfor($data) {
        global $DB, $USER;
        $data = (object)$data;
        unset($data->id);
        $data->cmid = $this->task->get_moduleid();
        $data->usermodified = $USER->id;
        $DB->insert_record('local_fastgrade_lookfor', $data);
    }

    /**
     * A quiz criteria panel (question id mapped later).
     *
     * @param array $data
     */
    public function process_fastgrade_qcrit($data) {
        global $DB, $USER;
        $data = (object)$data;
        unset($data->id);
        $data->cmid = $this->task->get_moduleid();
        $data->usermodified = $USER->id;
        $DB->insert_record('local_fastgrade_qcrit', $data);
    }

    /**
     * A mark record (quiz attempt mapped later).
     *
     * @param array $data
     */
    public function process_fastgrade_mark($data) {
        global $DB;
        $data = (object)$data;
        $oldid = $data->id;
        unset($data->id);
        $data->userid = $this->get_mappingid('user', $data->userid);
        if (!$data->userid) {
            return;
        }
        $data->markerid = $this->get_mappingid('user', $data->markerid, 0);
        $data->cmid = $this->task->get_moduleid();
        $data->courseid = $this->task->get_courseid();
        $data->itemid = 0;
        $data->draftjson = null;
        $newid = $DB->insert_record('local_fastgrade_mark', $data);
        $this->set_mapping('fastgrade_mark', $oldid, $newid);
    }

    /**
     * An annotation.
     *
     * @param array $data
     */
    public function process_fastgrade_annot($data) {
        global $DB;
        $data = (object)$data;
        unset($data->id);
        $data->markid = $this->get_new_parentid('fastgrade_mark');
        if (!$data->markid) {
            return;
        }
        $data->cmid = $this->task->get_moduleid();
        $data->userid = $this->get_mappingid('user', $data->userid, 0);
        $data->authorid = $this->get_mappingid('user', $data->authorid, 0);
        $data->decidedby = $this->get_mappingid('user', $data->decidedby, 0);
        $DB->insert_record('local_fastgrade_annot', $data);
    }

    /**
     * A feedback log line.
     *
     * @param array $data
     */
    public function process_fastgrade_fbitem($data) {
        global $DB;
        $data = (object)$data;
        unset($data->id);
        $data->markid = $this->get_new_parentid('fastgrade_mark');
        if (!$data->markid) {
            return;
        }
        $data->courseid = $this->task->get_courseid();
        $data->markerid = $this->get_mappingid('user', $data->markerid, 0);
        $DB->insert_record('local_fastgrade_fbitem', $data);
    }

    /**
     * A private marker note.
     *
     * @param array $data
     */
    public function process_fastgrade_note($data) {
        global $DB;
        $data = (object)$data;
        unset($data->id);
        $data->userid = $this->get_mappingid('user', $data->userid);
        $data->authorid = $this->get_mappingid('user', $data->authorid);
        if (!$data->userid || !$data->authorid) {
            return;
        }
        $data->cmid = $this->task->get_moduleid();
        $DB->insert_record('local_fastgrade_note', $data);
    }

    /**
     * Point ids at the restored attempts, criteria, levels and questions.
     */
    public function after_restore_module() {
        global $DB;
        $cmid = $this->task->get_moduleid();
        $crit = fn($old) => $this->get_mappingid('gradingform_rubric_criterion', $old, 0) ?:
            $this->get_mappingid('gradingform_guide_criterion', $old, 0);
        $level = fn($old) => $this->get_mappingid('gradingform_rubric_level', $old, 0);

        foreach ($DB->get_records('local_fastgrade_mark', ['cmid' => $cmid]) as $m) {
            $upd = ['id' => $m->id];
            if ($m->modname === 'quiz') {
                $new = $this->get_mappingid('quiz_attempt', $m->attempt, 0);
                if (!$new) {
                    $DB->delete_records('local_fastgrade_annot', ['markid' => $m->id]);
                    $DB->delete_records('local_fastgrade_fbitem', ['markid' => $m->id]);
                    $DB->delete_records('local_fastgrade_mark', ['id' => $m->id]);
                    continue;
                }
                $upd['attempt'] = $new;
            }
            $filling = $m->fillingjson ? json_decode($m->fillingjson, true) : null;
            if (is_array($filling) && $m->modname !== 'quiz') {
                foreach ($filling as &$f) {
                    $f['criterionid'] = $crit($f['criterionid'] ?? 0);
                    if (!empty($f['levelid'])) {
                        $f['levelid'] = $level($f['levelid']);
                    }
                }
                unset($f);
                $upd['fillingjson'] = json_encode(array_values(array_filter($filling, fn($f) => $f['criterionid'])));
            }
            if (count($upd) > 1) {
                $DB->update_record('local_fastgrade_mark', (object)$upd);
            }
        }
        foreach ($DB->get_records_select('local_fastgrade_annot', 'cmid = ? AND criterionid > 0', [$cmid]) as $a) {
            $DB->set_field('local_fastgrade_annot', 'criterionid', $crit($a->criterionid), ['id' => $a->id]);
        }
        foreach ($DB->get_records('local_fastgrade_lookfor', ['cmid' => $cmid]) as $l) {
            if (preg_match('/^c(\d+)$/', $l->criterionkey, $mm)) {
                $new = $crit((int)$mm[1]);
                $new ? $DB->set_field('local_fastgrade_lookfor', 'criterionkey', 'c' . $new, ['id' => $l->id]) :
                    $DB->delete_records('local_fastgrade_lookfor', ['id' => $l->id]);
            } else if (preg_match('/^q(\d+)$/', $l->criterionkey, $mm)) {
                $new = $this->get_mappingid('question', (int)$mm[1], 0);
                if ($new) {
                    $DB->set_field('local_fastgrade_lookfor', 'criterionkey', 'q' . $new, ['id' => $l->id]);
                }
            }
        }
        foreach ($DB->get_records('local_fastgrade_qcrit', ['cmid' => $cmid]) as $q) {
            $new = $this->get_mappingid('question', $q->questionid, 0);
            if ($new) {
                $DB->set_field('local_fastgrade_qcrit', 'questionid', $new, ['id' => $q->id]);
            }
        }
    }
}
