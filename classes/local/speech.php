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
 * Speech-to-text settings sent to the browser.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class speech {
    /** Admin choices. */
    const MODES = ['ondevice', 'browser', 'off'];

    /**
     * Settings for the app.
     *
     * @return array
     */
    public static function settings(): array {
        $mode = get_config('local_fastgrade', 'speechmode');
        if (!in_array($mode, self::MODES)) {
            $mode = 'ondevice';
        }
        $lang = get_config('local_fastgrade', 'speechlang') ?: self::default_lang();
        $phrases = [];
        foreach (preg_split('/[\r\n,]+/', (string)get_config('local_fastgrade', 'speechphrases')) as $phrase) {
            $phrase = trim($phrase);
            if ($phrase !== '') {
                $phrases[] = \core_text::substr($phrase, 0, 60);
            }
        }
        return [
            'mode' => $mode,
            'lang' => $lang,
            'phrases' => array_slice($phrases, 0, 200),
            'keepclips' => (bool)get_config('local_fastgrade', 'keepclips'),
            'silencesecs' => max(3, (int)(get_config('local_fastgrade', 'silencesecs') ?: 8)),
        ];
    }

    /**
     * A BCP-47 tag from the current Moodle language.
     *
     * @return string
     */
    public static function default_lang(): string {
        $lang = current_language();
        $map = [
            'en' => 'en-AU',
            'en_us' => 'en-US',
            'en_au' => 'en-AU',
            'en_za' => 'en-ZA',
            'en_gb' => 'en-GB',
            'af' => 'af-ZA',
            'de' => 'de-DE',
            'fr' => 'fr-FR',
            'es' => 'es-ES',
            'it' => 'it-IT',
            'pt' => 'pt-PT',
            'pt_br' => 'pt-BR',
            'ja' => 'ja-JP',
            'ko' => 'ko-KR',
            'zh_cn' => 'zh-CN',
            'th' => 'th-TH',
        ];
        return $map[$lang] ?? 'en-AU';
    }
}
