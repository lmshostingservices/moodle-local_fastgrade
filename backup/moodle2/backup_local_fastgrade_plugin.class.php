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
 * Backup of Fast Grade data that belongs to an activity.
 *
 * Always: auto-marking look-fors and quiz criteria panels. With user data: marks in progress,
 * annotations, the feedback log and private marker notes.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class backup_local_fastgrade_plugin extends backup_local_plugin {
    /**
     * Data stored with the activity.
     *
     * @return backup_plugin_element
     */
    protected function define_module_plugin_structure() {
        $plugin = $this->get_plugin_element();
        $wrapper = new backup_nested_element($this->get_recommended_name());
        $plugin->add_child($wrapper);

        $lookfors = new backup_nested_element('lookfors');
        $lookfor = new backup_nested_element(
            'lookfor',
            ['id'],
            [
                'criterionkey',
                'kind',
                'configjson',
                'sortorder',
                'timemodified',
            ]
        );
        $qcrits = new backup_nested_element('qcrits');
        $qcrit = new backup_nested_element('qcrit', ['id'], ['questionid', 'definitionjson', 'timemodified']);
        $wrapper->add_child($lookfors);
        $lookfors->add_child($lookfor);
        $wrapper->add_child($qcrits);
        $qcrits->add_child($qcrit);
        $lookfor->set_source_table('local_fastgrade_lookfor', ['cmid' => backup::VAR_MODID], 'sortorder ASC');
        $qcrit->set_source_table('local_fastgrade_qcrit', ['cmid' => backup::VAR_MODID]);

        if ($this->get_setting_value('userinfo')) {
            $marks = new backup_nested_element('marks');
            $mark = new backup_nested_element(
                'mark',
                ['id'],
                [
                    'modname',
                    'userid',
                    'attempt',
                    'slot',
                    'markerid',
                    'fillingjson',
                    'timesubmitted',
                    'timefirstopened',
                    'timegraded',
                    'timemodified',
                ]
            );
            $annots = new backup_nested_element('annots');
            $annot = new backup_nested_element(
                'annot',
                ['id'],
                [
                    'userid',
                    'docref',
                    'clientid',
                    'page',
                    'type',
                    'polarity',
                    'anchorjson',
                    'stylejson',
                    'comment',
                    'source',
                    'status',
                    'criterionid',
                    'authorid',
                    'decidedby',
                    'decision',
                    'timecreated',
                    'timemodified',
                ]
            );
            $fbitems = new backup_nested_element('fbitems');
            $fbitem = new backup_nested_element(
                'fbitem',
                ['id'],
                [
                    'markerid',
                    'target',
                    'mode',
                    'polarity',
                    'provider',
                    'durationsec',
                    'words',
                    'timecreated',
                ]
            );
            $notes = new backup_nested_element('notes');
            $note = new backup_nested_element('note', ['id'], ['userid', 'authorid', 'note', 'timemodified']);

            $wrapper->add_child($marks);
            $marks->add_child($mark);
            $mark->add_child($annots);
            $annots->add_child($annot);
            $mark->add_child($fbitems);
            $fbitems->add_child($fbitem);
            $wrapper->add_child($notes);
            $notes->add_child($note);

            $mark->set_source_table('local_fastgrade_mark', ['cmid' => backup::VAR_MODID]);
            $annot->set_source_table('local_fastgrade_annot', ['markid' => backup::VAR_PARENTID]);
            $fbitem->set_source_table('local_fastgrade_fbitem', ['markid' => backup::VAR_PARENTID]);
            $note->set_source_table('local_fastgrade_note', ['cmid' => backup::VAR_MODID]);

            $mark->annotate_ids('user', 'userid');
            $mark->annotate_ids('user', 'markerid');
            $annot->annotate_ids('user', 'authorid');
            $annot->annotate_ids('user', 'decidedby');
            $fbitem->annotate_ids('user', 'markerid');
            $note->annotate_ids('user', 'userid');
            $note->annotate_ids('user', 'authorid');
        }
        return $plugin;
    }
}
