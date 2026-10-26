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
 * Web services used by the Fast Grade app.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

$functions = [
    'local_fastgrade_report_views' => [
        'classname' => 'local_fastgrade\\external\\report_views',
        'description' => 'List, save or delete saved report views.',
        'type' => 'write',
        'ajax' => true,
        'loginrequired' => true,
    ],
    'local_fastgrade_get_activity' => [
        'classname' => 'local_fastgrade\\external\\get_activity',
        'description' => 'Bootstrap data for the marking screen.',
        'type' => 'read',
        'ajax' => true,
        'loginrequired' => true,
    ],
    'local_fastgrade_get_participants' => [
        'classname' => 'local_fastgrade\\external\\get_participants',
        'description' => 'The list of students for a group.',
        'type' => 'read',
        'ajax' => true,
        'loginrequired' => true,
    ],
    'local_fastgrade_get_item' => [
        'classname' => 'local_fastgrade\\external\\get_item',
        'description' => 'Everything needed to mark one student.',
        'type' => 'read',
        'ajax' => true,
        'loginrequired' => true,
    ],
    'local_fastgrade_save_draft' => [
        'classname' => 'local_fastgrade\\external\\save_draft',
        'description' => 'Autosave grade and feedback that are not yet committed.',
        'type' => 'write',
        'ajax' => true,
        'loginrequired' => true,
    ],
    'local_fastgrade_save_grade' => [
        'classname' => 'local_fastgrade\\external\\save_grade',
        'description' => 'Commit a grade and feedback to Moodle.',
        'type' => 'write',
        'ajax' => true,
        'loginrequired' => true,
    ],
    'local_fastgrade_save_annotations' => [
        'classname' => 'local_fastgrade\\external\\save_annotations',
        'description' => 'Save annotation changes.',
        'type' => 'write',
        'ajax' => true,
        'loginrequired' => true,
    ],
    'local_fastgrade_convert_file' => [
        'classname' => 'local_fastgrade\\external\\convert_file',
        'description' => 'Start or check conversion of a submitted file to PDF.',
        'type' => 'write',
        'ajax' => true,
        'loginrequired' => true,
    ],
    'local_fastgrade_bank' => [
        'classname' => 'local_fastgrade\\external\\bank',
        'description' => 'List, save, delete comment bank entries.',
        'type' => 'write',
        'ajax' => true,
        'loginrequired' => true,
    ],
    'local_fastgrade_save_prefs' => [
        'classname' => 'local_fastgrade\\external\\save_prefs',
        'description' => 'Save the marker\'s layout preferences.',
        'type' => 'write',
        'ajax' => true,
        'loginrequired' => true,
    ],
    'local_fastgrade_save_note' => [
        'classname' => 'local_fastgrade\\external\\save_note',
        'description' => 'Save a private marker note.',
        'type' => 'write',
        'ajax' => true,
        'loginrequired' => true,
    ],
    'local_fastgrade_release' => [
        'classname' => 'local_fastgrade\\external\\release',
        'description' => 'Release grades to students (marking workflow).',
        'type' => 'write',
        'ajax' => true,
        'loginrequired' => true,
    ],
    'local_fastgrade_quiz_queue' => [
        'classname' => 'local_fastgrade\\external\\quiz_queue',
        'description' => 'Quiz manual marking queue.',
        'type' => 'read',
        'ajax' => true,
        'loginrequired' => true,
    ],
    'local_fastgrade_save_criteria' => [
        'classname' => 'local_fastgrade\\external\\save_criteria',
        'description' => 'Save quiz criteria panel definition or auto-marking look-fors.',
        'type' => 'write',
        'ajax' => true,
        'loginrequired' => true,
    ],
    'local_fastgrade_corpus' => [
        'classname' => 'local_fastgrade\\external\\corpus',
        'description' => 'Answers in this activity, as text, for the rule test bench, grouping and precedents.',
        'type' => 'read',
        'ajax' => true,
        'loginrequired' => true,
    ],
];
