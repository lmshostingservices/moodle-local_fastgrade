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

namespace local_fastgrade\privacy;

use core_privacy\local\metadata\collection;
use core_privacy\local\request\approved_contextlist;
use core_privacy\local\request\approved_userlist;
use core_privacy\local\request\contextlist;
use core_privacy\local\request\userlist;
use core_privacy\local\request\transform;
use core_privacy\local\request\writer;

/**
 * Privacy provider.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class provider implements
    \core_privacy\local\metadata\provider,
    \core_privacy\local\request\core_userlist_provider,
    \core_privacy\local\request\plugin\provider,
    \core_privacy\local\request\user_preference_provider {
    /**
     * Describe stored data.
     *
     * @param collection $c
     * @return collection
     */
    public static function get_metadata(collection $c): collection {
        $c->add_database_table(
            'local_fastgrade_mark',
            [
                'userid' => 'privacy:metadata:mark:userid',
                'markerid' => 'privacy:metadata:mark:markerid',
                'draftjson' => 'privacy:metadata:mark:draftjson',
                'fillingjson' => 'privacy:metadata:mark:fillingjson',
                'timesubmitted' => 'privacy:metadata:mark:timesubmitted',
                'timegraded' => 'privacy:metadata:mark:timegraded',
                'activesecs' => 'privacy:metadata:mark:activesecs',
                'autojson' => 'privacy:metadata:mark:autojson',
            ],
            'privacy:metadata:mark'
        );
        $c->add_database_table(
            'local_fastgrade_view',
            [
                'userid' => 'privacy:metadata:view:userid',
                'name' => 'privacy:metadata:view:name',
                'configjson' => 'privacy:metadata:view:configjson',
                'shared' => 'privacy:metadata:view:shared',
            ],
            'privacy:metadata:view'
        );
        $c->add_database_table(
            'local_fastgrade_annot',
            [
                'userid' => 'privacy:metadata:annot:userid',
                'authorid' => 'privacy:metadata:annot:authorid',
                'comment' => 'privacy:metadata:annot:comment',
                'anchorjson' => 'privacy:metadata:annot:anchorjson',
                'timemodified' => 'privacy:metadata:timemodified',
            ],
            'privacy:metadata:annot'
        );
        $c->add_database_table(
            'local_fastgrade_fbitem',
            [
                'markerid' => 'privacy:metadata:fbitem:markerid',
                'mode' => 'privacy:metadata:fbitem:mode',
                'durationsec' => 'privacy:metadata:fbitem:durationsec',
            ],
            'privacy:metadata:fbitem'
        );
        $c->add_database_table(
            'local_fastgrade_bank',
            [
                'userid' => 'privacy:metadata:bank:userid',
                'text' => 'privacy:metadata:bank:text',
            ],
            'privacy:metadata:bank'
        );
        $c->add_database_table(
            'local_fastgrade_note',
            [
                'userid' => 'privacy:metadata:note:userid',
                'authorid' => 'privacy:metadata:note:authorid',
                'note' => 'privacy:metadata:note:note',
            ],
            'privacy:metadata:note'
        );
        $c->add_database_table(
            'local_fastgrade_lookfor',
            ['usermodified' => 'privacy:metadata:usermodified'],
            'privacy:metadata:lookfor'
        );
        $c->add_database_table(
            'local_fastgrade_qcrit',
            ['usermodified' => 'privacy:metadata:usermodified'],
            'privacy:metadata:qcrit'
        );
        $c->add_user_preference(\local_fastgrade\local\prefs::NAME, 'privacy:metadata:preference');
        $c->add_external_location_link(
            'lms_labs',
            [
                'siteid' => 'privacy:metadata:lmslabs:siteid',
                'apikey' => 'privacy:metadata:lmslabs:apikey',
            ],
            'privacy:metadata:lmslabs'
        );
        $c->add_external_location_link(
            'browser_speech_service',
            [
                'audio' => 'privacy:metadata:speech:audio',
            ],
            'privacy:metadata:speech'
        );
        return $c;
    }

    /**
     * Contexts with data for a user.
     *
     * @param int $userid
     * @return contextlist
     */
    public static function get_contexts_for_userid(int $userid): contextlist {
        $list = new contextlist();
        $sql = "SELECT ctx.id
                  FROM {context} ctx
                  JOIN {course_modules} cm ON cm.id = ctx.instanceid AND ctx.contextlevel = :lvl
                 WHERE cm.id IN (SELECT cmid FROM {local_fastgrade_mark} WHERE userid = :u1 OR markerid = :u2)
                    OR cm.id IN (SELECT cmid FROM {local_fastgrade_annot} WHERE authorid = :u3)
                    OR cm.id IN (SELECT cmid FROM {local_fastgrade_note} WHERE userid = :u4 OR authorid = :u5)";
        $list->add_from_sql(
            $sql,
            [
                'lvl' => CONTEXT_MODULE,
                'u1' => $userid,
                'u2' => $userid,
                'u3' => $userid,
                'u4' => $userid,
                'u5' => $userid,
            ]
        );
        $list->add_from_sql(
            "SELECT ctx.id FROM {context} ctx WHERE ctx.contextlevel = :lvl AND ctx.instanceid = :u
                              AND (EXISTS (SELECT 1 FROM {local_fastgrade_bank} b WHERE b.userid = :u2)
                                   OR EXISTS (SELECT 1 FROM {local_fastgrade_view} v WHERE v.userid = :u3))",
            ['lvl' => CONTEXT_USER, 'u' => $userid, 'u2' => $userid, 'u3' => $userid]
        );
        return $list;
    }

    /**
     * Users with data in a context.
     *
     * @param userlist $userlist
     */
    public static function get_users_in_context(userlist $userlist) {
        $ctx = $userlist->get_context();
        if ($ctx->contextlevel == CONTEXT_USER) {
            $userlist->add_from_sql(
                'userid',
                'SELECT userid FROM {local_fastgrade_bank} WHERE userid = :u',
                ['u' => $ctx->instanceid]
            );
            $userlist->add_from_sql(
                'userid',
                'SELECT userid FROM {local_fastgrade_view} WHERE userid = :u',
                ['u' => $ctx->instanceid]
            );
            return;
        }
        if ($ctx->contextlevel != CONTEXT_MODULE) {
            return;
        }
        $p = ['cmid' => $ctx->instanceid];
        $userlist->add_from_sql('userid', 'SELECT userid FROM {local_fastgrade_mark} WHERE cmid = :cmid', $p);
        $userlist->add_from_sql('markerid', 'SELECT markerid FROM {local_fastgrade_mark} WHERE cmid = :cmid', $p);
        $userlist->add_from_sql('authorid', 'SELECT authorid FROM {local_fastgrade_annot} WHERE cmid = :cmid', $p);
        $userlist->add_from_sql('userid', 'SELECT userid FROM {local_fastgrade_note} WHERE cmid = :cmid', $p);
    }

    /**
     * Export.
     *
     * @param approved_contextlist $contextlist
     */
    public static function export_user_data(approved_contextlist $contextlist) {
        global $DB;
        $userid = $contextlist->get_user()->id;
        foreach ($contextlist->get_contexts() as $ctx) {
            if ($ctx->contextlevel == CONTEXT_USER) {
                $bank = $DB->get_records('local_fastgrade_bank', ['userid' => $userid], '', 'id, scope, polarity, title, text');
                writer::with_context($ctx)->export_data(
                    [
                        get_string('pluginname', 'local_fastgrade'),
                        get_string('tab_bank', 'local_fastgrade'),
                    ],
                    (object)['comments' => array_values($bank)]
                );
                $views = $DB->get_records('local_fastgrade_view', ['userid' => $userid], '', 'id, name, cmid, configjson, shared');
                if ($views) {
                    writer::with_context($ctx)->export_data(
                        [
                            get_string('pluginname', 'local_fastgrade'),
                            get_string('rp_myviews', 'local_fastgrade'),
                        ],
                        (object)['views' => array_values($views)]
                    );
                }
                continue;
            }
            if ($ctx->contextlevel != CONTEXT_MODULE) {
                continue;
            }
            $cmid = $ctx->instanceid;
            $marks = $DB->get_records_select(
                'local_fastgrade_mark',
                'cmid = :cmid AND (userid = :u OR markerid = :m)',
                ['cmid' => $cmid, 'u' => $userid, 'm' => $userid]
            );
            $out = [];
            foreach ($marks as $m) {
                $anns = $DB->get_records(
                    'local_fastgrade_annot',
                    ['markid' => $m->id],
                    'id',
                    'id, docref, page, type, polarity, ' .
                    'comment, source, status, timemodified'
                );
                $out[] = [
                    'role' => (int)$m->userid === (int)$userid ? 'student' : 'marker',
                    'attempt' => $m->attempt,
                    'slot' => $m->slot,
                    'timegraded' => $m->timegraded ? transform::datetime($m->timegraded) : '',
                    'annotations' => array_values(
                        array_map(
                            fn($a) => [
                                'document' => $a->docref,
                                'page' => $a->page,
                                'type' => $a->type,
                                'polarity' => $a->polarity,
                                'comment' => $a->comment,
                                'source' => $a->source,
                                'status' => $a->status,
                                'time' => transform::datetime($a->timemodified),
                            ],
                            $anns
                        )
                    ),
                ];
            }
            $note = $DB->get_record('local_fastgrade_note', ['cmid' => $cmid, 'userid' => $userid]);
            writer::with_context($ctx)->export_data(
                [get_string('pluginname', 'local_fastgrade')],
                (object)[
                    'marking' => $out,
                    'note' => $note ? $note->note : '',
                ]
            );
        }
        $prefs = get_user_preferences(\local_fastgrade\local\prefs::NAME, null, $userid);
        if ($prefs !== null) {
            writer::export_user_preference(
                'local_fastgrade',
                \local_fastgrade\local\prefs::NAME,
                $prefs,
                get_string('privacy:metadata:preference', 'local_fastgrade')
            );
        }
    }

    /**
     * Export preferences.
     *
     * @param int $userid
     */
    public static function export_user_preferences(int $userid) {
        $prefs = get_user_preferences(\local_fastgrade\local\prefs::NAME, null, $userid);
        if ($prefs !== null) {
            writer::export_user_preference(
                'local_fastgrade',
                \local_fastgrade\local\prefs::NAME,
                $prefs,
                get_string('privacy:metadata:preference', 'local_fastgrade')
            );
        }
    }

    /**
     * Delete everything in a context.
     *
     * @param \context $ctx
     */
    public static function delete_data_for_all_users_in_context(\context $ctx) {
        global $DB;
        if ($ctx->contextlevel != CONTEXT_MODULE) {
            return;
        }
        $cmid = $ctx->instanceid;
        $DB->delete_records_select(
            'local_fastgrade_fbitem',
            'markid IN (SELECT id FROM {local_fastgrade_mark} WHERE cmid = ?)',
            [$cmid]
        );
        $DB->delete_records('local_fastgrade_annot', ['cmid' => $cmid]);
        $DB->delete_records('local_fastgrade_mark', ['cmid' => $cmid]);
        $DB->delete_records('local_fastgrade_note', ['cmid' => $cmid]);
    }

    /**
     * Delete one user's data.
     *
     * @param approved_contextlist $contextlist
     */
    public static function delete_data_for_user(approved_contextlist $contextlist) {
        $userid = (int)$contextlist->get_user()->id;
        foreach ($contextlist->get_contexts() as $ctx) {
            self::delete_users($ctx, [$userid]);
        }
    }

    /**
     * Delete several users' data.
     *
     * @param approved_userlist $userlist
     */
    public static function delete_data_for_users(approved_userlist $userlist) {
        self::delete_users($userlist->get_context(), $userlist->get_userids());
    }

    /**
     * Delete for users in a context: students' records go; markers are anonymised.
     *
     * @param \context $ctx
     * @param int[] $userids
     */
    protected static function delete_users(\context $ctx, array $userids) {
        global $DB;
        if (!$userids) {
            return;
        }
        [$in, $p] = $DB->get_in_or_equal($userids, SQL_PARAMS_NAMED);
        if ($ctx->contextlevel == CONTEXT_USER) {
            $DB->delete_records_select('local_fastgrade_bank', "userid $in AND scope = 'personal'", $p);
            $DB->set_field_select('local_fastgrade_bank', 'userid', 0, "userid $in", $p);
            $DB->delete_records_select('local_fastgrade_view', "userid $in", $p);
            return;
        }
        if ($ctx->contextlevel != CONTEXT_MODULE) {
            return;
        }
        $p['cmid'] = $ctx->instanceid;
        $markids = $DB->get_fieldset_select('local_fastgrade_mark', 'id', "cmid = :cmid AND userid $in", $p);
        if ($markids) {
            [$min, $mp] = $DB->get_in_or_equal($markids, SQL_PARAMS_NAMED);
            $DB->delete_records_select('local_fastgrade_annot', "markid $min", $mp);
            $DB->delete_records_select('local_fastgrade_fbitem', "markid $min", $mp);
            $DB->delete_records_select('local_fastgrade_mark', "id $min", $mp);
        }
        $DB->delete_records_select('local_fastgrade_note', "cmid = :cmid AND userid $in", $p);
        $DB->set_field_select('local_fastgrade_mark', 'markerid', 0, "cmid = :cmid AND markerid $in", $p);
        $DB->set_field_select('local_fastgrade_annot', 'authorid', 0, "cmid = :cmid AND authorid $in", $p);
        $DB->set_field_select('local_fastgrade_note', 'authorid', 0, "cmid = :cmid AND authorid $in", $p);
    }
}
