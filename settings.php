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
 * Admin settings.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

if ($hassiteconfig) {
    $settings = new admin_settingpage('local_fastgrade', get_string('pluginname', 'local_fastgrade'));
    $ADMIN->add('localplugins', $settings);

    if ($ADMIN->fulltree) {
        $c = 'local_fastgrade';

        $settings->add(new admin_setting_heading("$c/general", get_string('settings_general', $c), ''));
        $settings->add(
            new admin_setting_configcheckbox(
                "$c/enable_assign",
                get_string('enable_assign', $c),
                get_string('enable_assign_desc', $c),
                1
            )
        );
        $settings->add(
            new admin_setting_configcheckbox(
                "$c/enable_quiz",
                get_string('enable_quiz', $c),
                get_string('enable_quiz_desc', $c),
                1
            )
        );
        $settings->add(
            new admin_setting_configcheckbox(
                "$c/defaultgrader",
                get_string('defaultgrader', $c),
                get_string('defaultgrader_desc', $c),
                0
            )
        );
        $settings->add(
            new admin_setting_configcheckbox(
                "$c/showfab",
                get_string('showfab', $c),
                get_string('showfab_desc', $c),
                1
            )
        );

        $settings->add(
            new admin_setting_heading(
                "$c/speech",
                get_string('settings_speech', $c),
                get_string('settings_speech_desc', $c)
            )
        );
        $settings->add(
            new admin_setting_configselect(
                "$c/speechmode",
                get_string('speechmode', $c),
                get_string('speechmode_desc', $c),
                'ondevice',
                [
                    'ondevice' => get_string('speechmode_ondevice', $c),
                    'browser' => get_string('speechmode_browser', $c),
                    'off' => get_string('speechmode_off', $c),
                ]
            )
        );
        $settings->add(
            new admin_setting_configtext(
                "$c/speechlang",
                get_string('speechlang', $c),
                get_string('speechlang_desc', $c),
                '',
                PARAM_TEXT,
                8
            )
        );
        $settings->add(
            new admin_setting_configtextarea(
                "$c/speechphrases",
                get_string('speechphrases', $c),
                get_string('speechphrases_desc', $c),
                ''
            )
        );
        $settings->add(
            new admin_setting_configtext(
                "$c/silencesecs",
                get_string('silencesecs', $c),
                get_string('silencesecs_desc', $c),
                8,
                PARAM_INT,
                4
            )
        );

        $settings->add(new admin_setting_heading("$c/appearance", get_string('settings_appearance', $c), ''));
        $settings->add(
            new admin_setting_configselect(
                "$c/defaulttheme",
                get_string('defaulttheme', $c),
                get_string('defaulttheme_desc', $c),
                'system',
                [
                    'system' => get_string('theme_system', $c),
                    'light' => get_string('theme_light', $c),
                    'dark' => get_string('theme_dark', $c),
                ]
            )
        );
        $settings->add(
            new admin_setting_configselect(
                "$c/defaultdensity",
                get_string('defaultdensity', $c),
                get_string('defaultdensity_desc', $c),
                'comfortable',
                [
                    'comfortable' => get_string('density_comfortable', $c),
                    'compact' => get_string('density_compact', $c),
                ]
            )
        );
        $settings->add(
            new admin_setting_configcheckbox(
                "$c/lockintegrity",
                get_string('lockintegrity', $c),
                get_string('lockintegrity_desc', $c),
                0
            )
        );

        $settings->add(
            new admin_setting_heading(
                "$c/automark",
                get_string('settings_automark', $c),
                get_string('settings_automark_desc', $c)
            )
        );
        $settings->add(
            new admin_setting_configcheckbox(
                "$c/autograde",
                get_string('autograde', $c),
                get_string('autograde_desc', $c),
                1
            )
        );
        $settings->add(
            new admin_setting_configcheckbox(
                "$c/precedents",
                get_string('precedents', $c),
                get_string('precedents_desc', $c),
                0
            )
        );

        $settings->add(
            new admin_setting_heading(
                "$c/reporting",
                get_string('settings_report', $c),
                get_string('settings_report_desc', $c)
            )
        );
        $settings->add(
            new admin_setting_configtext(
                "$c/sladays",
                get_string('sladays', $c),
                get_string('sladays_desc', $c),
                14,
                PARAM_INT
            )
        );
        $settings->add(
            new admin_setting_configtext(
                "$c/minmarkern",
                get_string('minmarkern', $c),
                get_string('minmarkern_desc', $c),
                10,
                PARAM_INT
            )
        );
    }
}
