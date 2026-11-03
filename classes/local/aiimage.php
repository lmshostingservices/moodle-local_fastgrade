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
 * Optional AI image analysis through LMS Labs AI, paid for with LMS Labs credits.
 *
 * Off by default. Nothing is sent until a site administrator turns it on and confirms the school's permission, a
 * teacher turns it on for the activity, and a marker presses Analyse. Results are suggestions only. Each analysed
 * image costs AIIMAGE_CREDITS credits, charged by LMS Labs; a result is kept so the same image and criteria are
 * never charged twice.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class aiimage {
    /** Credits per analysed image (LMS Labs charges this; the server's figure is the one that counts). */
    const CREDITS = 2;

    /** Largest side of the image sent, in pixels. */
    const MAXSIDE = 1600;

    /** Largest original file read, in bytes. */
    const MAXBYTES = 25 * 1024 * 1024;

    /** Most images in one request from the marking screen. */
    const MAXIMAGES = 10;

    /** LMS Labs API base. Sites cannot change it in the admin pages; tests force it in config.php. */
    const BASE = 'https://lms-labs.com';

    /**
     * Whether the site has the feature on and has confirmed permission to send student images.
     *
     * @return bool
     */
    public static function enabled(): bool {
        return (bool)get_config('local_fastgrade', 'aiimages') && (bool)get_config('local_fastgrade', 'aiimages_consent');
    }

    /**
     * The API base URL.
     *
     * @return string
     */
    protected static function base(): string {
        $forced = (string)get_config('local_fastgrade', 'aiendpoint');
        return $forced !== '' ? rtrim($forced, '/') : self::BASE;
    }

    /**
     * Shared LMS Labs credentials.
     *
     * @return array [siteid, apikey]
     */
    protected static function credentials(): array {
        if (class_exists('\\local_aiconfig\\config')) {
            $siteid = \local_aiconfig\config::get_site_id();
            $apikey = \local_aiconfig\config::get_api_key();
            if ($siteid !== '' && $apikey !== '') {
                return [$siteid, $apikey];
            }
        }
        return [
            trim((string)get_config('local_fastgrade', 'siteid')),
            trim((string)get_config('local_fastgrade', 'apikey')),
        ];
    }

    /**
     * POST JSON to LMS Labs. The API key goes in the Authorization header only, never in a URL or a log.
     *
     * @param string $path
     * @param array $body
     * @param int $timeout seconds
     * @return array [http code, decoded body or null]
     */
    protected static function post(string $path, array $body, int $timeout = 60): array {
        global $CFG;
        require_once($CFG->libdir . '/filelib.php');
        [$siteid, $apikey] = static::credentials();
        if ($siteid === '' || $apikey === '') {
            return [0, null];
        }
        $body = ['pluginId' => 'fastgrade', 'siteId' => $siteid] + $body;
        $curl = new \curl();
        $response = $curl->post(
            static::base() . $path,
            json_encode($body),
            [
                'CURLOPT_HTTPHEADER' => [
                    'Content-Type: application/json',
                    'Accept: application/json',
                    'Authorization: Bearer ' . $apikey,
                ],
                'CURLOPT_CONNECTTIMEOUT' => 5,
                'CURLOPT_TIMEOUT' => $timeout,
                'CURLOPT_FOLLOWLOCATION' => 0,
                'CURLOPT_SSL_VERIFYPEER' => 1,
                'CURLOPT_SSL_VERIFYHOST' => 2,
            ]
        );
        $info = $curl->get_info();
        $code = $curl->get_errno() ? 0 : (int)($info['http_code'] ?? 0);
        $data = is_string($response) ? json_decode($response, true) : null;
        return [$code, is_array($data) ? $data : null];
    }

    /**
     * Connection status for the settings page and the marking screen.
     *
     * @param bool $fresh skip the short cache
     * @return array {connected: bool, balance: int|null, credits: int, message: string}
     */
    public static function status(bool $fresh = false): array {
        $cache = \cache::make('local_fastgrade', 'aistatus');
        if (!$fresh && ($hit = $cache->get('status'))) {
            return $hit;
        }
        [$code, $data] = static::post('/api/ai/status', ['feature' => 'image-analysis'], 15);
        $out = [
            'connected' => $code === 200 && !empty($data['connected']),
            // A negative balance from LMS Labs means unknown, so it is not shown.
            'balance' => isset($data['balance']) && (int)$data['balance'] >= 0 ? (int)$data['balance'] : null,
            'credits' => isset($data['creditsPerImage']) ? (int)$data['creditsPerImage'] : self::CREDITS,
            'code' => $code,
        ];
        $cache->set('status', $out);
        return $out;
    }

    /**
     * The image bytes to send: JPEG, longest side at most MAXSIDE, EXIF orientation applied, metadata dropped.
     *
     * @param \stored_file $file
     * @return string
     */
    public static function prepare(\stored_file $file): string {
        if ($file->get_filesize() > self::MAXBYTES) {
            throw new \moodle_exception('ai_toolarge', 'local_fastgrade');
        }
        $raw = $file->get_content();
        $img = function_exists('imagecreatefromstring') ? @imagecreatefromstring($raw) : false;
        if (!$img) {
            throw new \moodle_exception('ai_notimage', 'local_fastgrade');
        }
        if (function_exists('exif_read_data') && $file->get_mimetype() === 'image/jpeg') {
            $exif = @exif_read_data('data://image/jpeg;base64,' . base64_encode($raw));
            $turn = [3 => 180, 6 => -90, 8 => 90][(int)($exif['Orientation'] ?? 1)] ?? 0;
            if ($turn) {
                $img = imagerotate($img, $turn, 0);
            }
        }
        $w = imagesx($img);
        $h = imagesy($img);
        $k = min(1, self::MAXSIDE / max($w, $h));
        $out = imagecreatetruecolor(max(1, (int)round($w * $k)), max(1, (int)round($h * $k)));
        imagefill($out, 0, 0, imagecolorallocate($out, 255, 255, 255));
        imagecopyresampled($out, $img, 0, 0, 0, 0, imagesx($out), imagesy($out), $w, $h);
        ob_start();
        imagejpeg($out, null, 85);
        return (string)ob_get_clean();
    }

    /**
     * Clean the criteria sent from the marking screen.
     *
     * @param array $criteria [{id, label, lookfor: [string]}]
     * @return array
     */
    public static function clean_criteria(array $criteria): array {
        $out = [];
        foreach (array_slice($criteria, 0, 20) as $c) {
            $c = (array)$c;
            $look = [];
            foreach (array_slice((array)($c['lookfor'] ?? []), 0, 12) as $l) {
                $l = \core_text::substr(trim(clean_param((string)$l, PARAM_TEXT)), 0, 300);
                if ($l !== '') {
                    $look[] = $l;
                }
            }
            $label = \core_text::substr(trim(clean_param((string)($c['label'] ?? ''), PARAM_TEXT)), 0, 200);
            if ($label === '' && !$look) {
                continue;
            }
            $out[] = [
                'id' => clean_param((string)($c['id'] ?? ''), PARAM_ALPHANUMEXT),
                'label' => $label,
                'lookFor' => $look ?: [$label],
            ];
        }
        return $out;
    }

    /**
     * Analyse one image against the criteria (or read the handwriting in it), using a kept result if there is one.
     *
     * @param int $cmid
     * @param int $userid student
     * @param \stored_file $file
     * @param array $criteria cleaned criteria
     * @param string $mode 'criteria' or 'transcribe'
     * @param string $task the question or task, as plain text
     * @return array result {criteria: [...], transcription, summary, credits, cached}
     */
    public static function analyse(
        int $cmid,
        int $userid,
        \stored_file $file,
        array $criteria,
        string $mode,
        string $task
    ): array {
        global $DB, $USER;
        $mode = $mode === 'transcribe' ? 'transcribe' : 'criteria';
        $task = \core_text::substr(trim($task), 0, 2000);
        $key = hash('sha256', implode("\0", [$file->get_contenthash(), $mode, $task, json_encode($criteria)]));
        if ($kept = $DB->get_record('local_fastgrade_aiimage', ['requestkey' => $key, 'cmid' => $cmid])) {
            $res = json_decode($kept->resultjson, true) ?: [];
            return ['credits' => 0, 'cached' => true] + $res;
        }
        $age = (string)get_config('local_fastgrade', 'aiimages_age');
        $body = [
            'requestId' => $key,
            'mode' => $mode,
            'learnerAge' => $age === 'under18' ? 'under18' : 'adult',
            'task' => $task,
            'criteria' => $criteria,
            'image' => [
                'mimeType' => 'image/jpeg',
                'data' => base64_encode(static::prepare($file)),
            ],
        ];
        [$code, $data] = static::post('/api/ai/image-analysis', $body, 90);
        if ($code === 402) {
            throw new \moodle_exception('ai_nocredits', 'local_fastgrade');
        }
        if ($code === 401 || $code === 403) {
            throw new \moodle_exception('ai_notconnected', 'local_fastgrade');
        }
        if ($code === 422 && ($data['error'] ?? '') === 'image_refused') {
            // Refused by the safety check: nothing is charged and nothing is kept.
            return ['refused' => true, 'credits' => 0, 'criteria' => [], 'transcription' => '', 'summary' => ''];
        }
        if ($code !== 200 || !is_array($data) || !isset($data['result'])) {
            throw new \moodle_exception('ai_failed', 'local_fastgrade');
        }
        $res = static::clean_result((array)$data['result'], $criteria);
        $DB->insert_record('local_fastgrade_aiimage', (object)[
            'cmid' => $cmid,
            'userid' => $userid,
            'fileid' => (int)$file->get_id(),
            'requestkey' => $key,
            'mode' => $mode,
            'resultjson' => json_encode($res),
            'credits' => (int)($data['creditsCharged'] ?? self::CREDITS),
            'usermodified' => $USER->id,
            'timecreated' => time(),
        ]);
        \cache::make('local_fastgrade', 'aistatus')->delete('status');
        return $res + ['credits' => (int)($data['creditsCharged'] ?? self::CREDITS), 'cached' => false,
            'balance' => isset($data['balance']) && (int)$data['balance'] >= 0 ? (int)$data['balance'] : null];
    }

    /**
     * Keep only what the marking screen shows, in the shape it expects.
     *
     * @param array $r
     * @param array $criteria
     * @return array
     */
    public static function clean_result(array $r, array $criteria): array {
        $ids = array_column($criteria, 'id');
        $out = [];
        foreach ((array)($r['criteria'] ?? []) as $c) {
            $c = (array)$c;
            $id = clean_param((string)($c['id'] ?? ''), PARAM_ALPHANUMEXT);
            if (!in_array($id, $ids, true)) {
                continue;
            }
            $verdict = in_array($c['verdict'] ?? '', ['met', 'partly', 'notmet', 'unclear'], true) ? $c['verdict'] : 'unclear';
            $items = [];
            foreach (array_slice((array)($c['lookFor'] ?? []), 0, 12) as $l) {
                $l = (array)$l;
                $items[] = [
                    'text' => \core_text::substr(clean_param((string)($l['text'] ?? ''), PARAM_TEXT), 0, 300),
                    'seen' => in_array($l['seen'] ?? '', ['yes', 'partly', 'no', 'unclear'], true) ? $l['seen'] : 'unclear',
                    'evidence' => \core_text::substr(clean_param((string)($l['evidence'] ?? ''), PARAM_TEXT), 0, 400),
                ];
            }
            $out[] = [
                'id' => $id,
                'verdict' => $verdict,
                'confidence' => (float)max(0, min(1, (float)($c['confidence'] ?? 0))),
                'evidence' => \core_text::substr(clean_param((string)($c['evidence'] ?? ''), PARAM_TEXT), 0, 600),
                'improve' => \core_text::substr(clean_param((string)($c['improve'] ?? ''), PARAM_TEXT), 0, 600),
                'lookFor' => $items,
            ];
        }
        return [
            'criteria' => $out,
            // Maths needs < and > kept, so no tag stripping; the browser shows it as text, never as HTML.
            'transcription' => \core_text::substr(trim(str_replace("\0", '', (string)($r['transcription'] ?? ''))), 0, 8000),
            'summary' => \core_text::substr(clean_param((string)($r['summary'] ?? ''), PARAM_TEXT), 0, 600),
            'model' => \core_text::substr(clean_param((string)($r['model'] ?? ''), PARAM_TEXT), 0, 60),
        ];
    }

    /**
     * The student a submitted file belongs to, from its submission or quiz attempt step (a file's own userid can be
     * empty for quiz response files).
     *
     * @param \stored_file $file
     * @return int user id, or 0 when the file is not a student submission
     */
    public static function owner_of(\stored_file $file): int {
        global $DB;
        $component = $file->get_component();
        if (strpos($component, 'assignsubmission_') === 0) {
            return (int)$DB->get_field('assign_submission', 'userid', ['id' => $file->get_itemid()]);
        }
        if ($component === 'question' && strpos($file->get_filearea(), 'response_') === 0) {
            return (int)$DB->get_field('question_attempt_steps', 'userid', ['id' => $file->get_itemid()]);
        }
        return 0;
    }

    /**
     * The LMS Labs AI connection light for the settings page: green with the balance, or amber.
     *
     * @return string HTML
     */
    public static function status_html(): string {
        $c = 'local_fastgrade';
        try {
            $st = static::status(true);
        } catch (\Throwable $e) {
            $st = ['connected' => false, 'balance' => null];
        }
        if (!empty($st['connected'])) {
            $text = $st['balance'] !== null ? get_string('ai_connected_balance', $c, $st['balance']) :
                get_string('ai_connected', $c);
            $colour = '#15803d';
        } else {
            $text = get_string('ai_notconnected_light', $c);
            $colour = '#b45309';
        }
        return \html_writer::div(
            \html_writer::span('', '', ['style' => "display:inline-block;width:10px;height:10px;border-radius:50%;" .
                "background:$colour;margin-right:8px;vertical-align:middle", 'aria-hidden' => 'true']) .
            \html_writer::span(s($text), '', ['style' => "font-weight:600;color:$colour;vertical-align:middle"]),
            '',
            ['style' => 'margin:0 0 12px', 'role' => 'status']
        );
    }
}
