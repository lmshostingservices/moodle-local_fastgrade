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
 * Per-marker layout and behaviour preferences, stored as Moodle user preferences.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class prefs {
    /** Name of the user preference. */
    const NAME = 'local_fastgrade_prefs';

    /** Defaults and allowed values. A list means one of; a bool or int means that type. */
    const SCHEMA = [
        'theme' => ['system', 'light', 'dark'],
        'density' => ['comfortable', 'compact'],
        'focus' => false,
        'zen' => false,
        'rail' => ['open', 'mini', 'hidden'],
        'panel' => ['open', 'mini', 'hidden'],
        'toolbar' => ['docked', 'floating', 'auto'],
        'margin' => ['cards', 'pins', 'hidden'],
        'tooltips' => true,
        'shortcuts' => true,
        'autoadvance' => true,
        'showstatus' => true,
        'showprogress' => true,
        'showintegrity' => true,
        'shownotes' => true,
        'showbank' => true,
        'railwidth' => 260,
        'panelwidth' => 400,
        'speechlang' => '',
        'filter' => ['needsgrading', 'all', 'submitted', 'notsubmitted', 'graded', 'late', 'draft'],
        'sort' => ['name', 'submitted', 'status', 'random'],
        'cloudnotice' => false,
        'zoom' => 0,
    ];

    /**
     * The defaults.
     *
     * @return array
     */
    public static function defaults(): array {
        $out = [];
        foreach (self::SCHEMA as $key => $rule) {
            $out[$key] = is_array($rule) ? $rule[0] : $rule;
        }
        // Site defaults.
        $sitetheme = get_config('local_fastgrade', 'defaulttheme');
        if ($sitetheme && in_array($sitetheme, self::SCHEMA['theme'])) {
            $out['theme'] = $sitetheme;
        }
        $sitedensity = get_config('local_fastgrade', 'defaultdensity');
        if ($sitedensity && in_array($sitedensity, self::SCHEMA['density'])) {
            $out['density'] = $sitedensity;
        }
        return $out;
    }

    /**
     * The current user's preferences, merged over the defaults.
     *
     * @return array
     */
    public static function get(): array {
        $saved = json_decode((string)get_user_preferences(self::NAME, '{}'), true);
        $prefs = self::defaults();
        if (is_array($saved)) {
            foreach ($saved as $k => $v) {
                $clean = self::clean($k, $v);
                if ($clean !== null) {
                    $prefs[$k] = $clean;
                }
            }
        }
        // Admin locks.
        if (get_config('local_fastgrade', 'lockintegrity')) {
            $prefs['showintegrity'] = true;
        }
        return $prefs;
    }

    /**
     * Validate one value.
     *
     * @param string $key
     * @param mixed $value
     * @return mixed|null null when invalid
     */
    public static function clean(string $key, $value) {
        if (!array_key_exists($key, self::SCHEMA)) {
            return null;
        }
        $rule = self::SCHEMA[$key];
        if (is_array($rule)) {
            return in_array($value, $rule, true) ? $value : null;
        }
        if (is_bool($rule)) {
            return (bool)$value;
        }
        if (is_int($rule)) {
            return max(0, min(2000, (int)$value));
        }
        if ($key === 'speechlang') {
            return preg_match('/^[a-z]{2,3}(-[A-Z]{2})?$/', (string)$value) ? (string)$value : '';
        }
        return null;
    }

    /**
     * Save some preferences.
     *
     * @param array $changes
     * @return array the full set
     */
    public static function set(array $changes): array {
        $saved = json_decode((string)get_user_preferences(self::NAME, '{}'), true);
        if (!is_array($saved)) {
            $saved = [];
        }
        foreach ($changes as $k => $v) {
            $clean = self::clean((string)$k, $v);
            if ($clean !== null) {
                $saved[$k] = $clean;
            }
        }
        set_user_preference(self::NAME, json_encode($saved));
        return self::get();
    }
}
