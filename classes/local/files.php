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

use stored_file;

/**
 * Works out how each submitted file is shown, and handles conversion to PDF.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class files {
    /** File kinds by extension. */
    const KINDS = [
        'pdf' => ['pdf'],
        'image' => ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'],
        'office' => ['doc', 'docx', 'odt', 'rtf', 'heic', 'tif', 'tiff'],
        'slides' => ['ppt', 'pptx', 'odp', 'pps', 'ppsx'],
        'sheet' => ['xls', 'xlsx', 'ods', 'csv'],
        'audio' => ['mp3', 'm4a', 'wav', 'ogg', 'oga', 'aac', 'flac', 'opus'],
        'video' => ['mp4', 'mov', 'webm', 'm4v', 'ogv', 'avi', 'mkv'],
        'code' => [
            'txt',
            'md',
            'py',
            'java',
            'js',
            'ts',
            'php',
            'c',
            'h',
            'cpp',
            'cs',
            'rb',
            'go',
            'rs',
            'swift',
            'kt',
            'sql',
            'json',
            'xml',
            'yml',
            'yaml',
            'html',
            'htm',
            'css',
            'scss',
            'sh',
            'r',
            'm',
            'ipynb',
            'log',
            'ini',
        ],
        'zip' => ['zip'],
    ];

    /**
     * Put the written work first: the document a marker reads (and the auto-marker checks) opens
     * first, spreadsheets, media and archives after it.
     *
     * @param array $docs exported documents
     * @return array
     */
    public static function sort_docs(array $docs): array {
        $rank = [
            'text' => 0,
            'office' => 1,
            'pdf' => 1,
            'code' => 2,
            'slides' => 3,
            'sheet' => 4,
            'image' => 5,
            'audio' => 6,
            'video' => 6,
            'zip' => 7,
        ];
        $i = 0;
        foreach ($docs as &$d) {
            $d['_order'] = [($rank[$d['kind'] ?? ''] ?? 8), $i++];
        }
        unset($d);
        usort($docs, fn($a, $b) => $a['_order'] <=> $b['_order']);
        return array_map(
            function ($d) {
                unset($d['_order']);
                return $d;
            },
            $docs
        );
    }

    /**
     * The kind of a file name.
     *
     * @param string $filename
     * @return string
     */
    public static function kind_of(string $filename): string {
        $ext = \core_text::strtolower(pathinfo($filename, PATHINFO_EXTENSION));
        foreach (self::KINDS as $kind => $exts) {
            if (in_array($ext, $exts)) {
                return $kind;
            }
        }
        return 'other';
    }

    /**
     * Whether a kind needs conversion to PDF to be annotated.
     *
     * @param string $kind
     * @return bool
     */
    public static function needs_conversion(string $kind): bool {
        return in_array($kind, ['office', 'slides']);
    }

    /**
     * Whether Moodle has a working document converter for this file.
     *
     * @param stored_file $file
     * @return bool
     */
    public static function can_convert(stored_file $file): bool {
        $converter = new \core_files\converter();
        return $converter->can_convert_storedfile_to($file, 'pdf');
    }

    /**
     * Export one stored file for the app.
     *
     * @param stored_file $file
     * @param string $docprefix 'file' or 'rfile'
     * @return array
     */
    public static function export(stored_file $file, string $docprefix = 'file'): array {
        $kind = self::kind_of($file->get_filename());
        $url = \moodle_url::make_pluginfile_url(
            $file->get_contextid(),
            $file->get_component(),
            $file->get_filearea(),
            $file->get_itemid(),
            $file->get_filepath(),
            $file->get_filename(),
            false
        );
        $download = \moodle_url::make_pluginfile_url(
            $file->get_contextid(),
            $file->get_component(),
            $file->get_filearea(),
            $file->get_itemid(),
            $file->get_filepath(),
            $file->get_filename(),
            true
        );
        $out = [
            'docref' => $docprefix . ':' . $file->get_contenthash(),
            'fileid' => (int)$file->get_id(),
            'filename' => $file->get_filename(),
            'mimetype' => (string)$file->get_mimetype(),
            'filesize' => (int)$file->get_filesize(),
            'kind' => $kind,
            'url' => $url->out(false),
            'downloadurl' => $download->out(false),
            'pdfurl' => '',
            'conversion' => 'none',
            'dataurl' => '',
        ];
        if ($kind === 'pdf') {
            $out['pdfurl'] = $out['url'];
        } else if (self::needs_conversion($kind)) {
            $out['conversion'] = self::conversion_status($file);
            if ($out['conversion'] === 'done') {
                $out['pdfurl'] = self::converted_url($file);
            }
        }
        if (in_array($kind, ['sheet', 'slides', 'code', 'zip'])) {
            $out['dataurl'] = (new \moodle_url(
                '/local/fastgrade/filedata.php',
                [
                    'contextid' => $file->get_contextid(),
                    'fileid' => $file->get_id(),
                ]
            ))->out(false);
        }
        return $out;
    }

    /**
     * URL of the converted PDF, served through this plugin.
     *
     * @param stored_file $file
     * @return string
     */
    public static function converted_url(stored_file $file): string {
        return \moodle_url::make_pluginfile_url(
            $file->get_contextid(),
            'local_fastgrade',
            'converted',
            $file->get_id(),
            '/',
            pathinfo($file->get_filename(), PATHINFO_FILENAME) . '.pdf',
            false
        )->out(false);
    }

    /**
     * Current conversion state without starting one: none, pending, done, failed, unsupported.
     *
     * @param stored_file $file
     * @return string
     */
    public static function conversion_status(stored_file $file): string {
        $conversions = \core_files\conversion::get_conversions_for_file($file, 'pdf');
        foreach ($conversions as $conversion) {
            $status = (int)$conversion->get('status');
            if ($status === \core_files\conversion::STATUS_COMPLETE && $conversion->get_destfile()) {
                return 'done';
            }
            if ($status === \core_files\conversion::STATUS_FAILED) {
                return 'failed';
            }
            return 'pending';
        }
        return self::can_convert($file) ? 'none' : 'unsupported';
    }

    /**
     * Start or poll a conversion. Runs synchronously when the converter allows.
     *
     * @param stored_file $file
     * @param bool $retry
     * @return string status
     */
    public static function convert(stored_file $file, bool $retry = false): string {
        if (!self::can_convert($file)) {
            return 'unsupported';
        }
        $converter = new \core_files\converter();
        $conversion = $converter->start_conversion($file, 'pdf', $retry);
        $status = (int)$conversion->get('status');
        if ($status === \core_files\conversion::STATUS_COMPLETE && $conversion->get_destfile()) {
            return 'done';
        }
        if ($status === \core_files\conversion::STATUS_FAILED) {
            return 'failed';
        }
        return 'pending';
    }

    /**
     * The converted PDF stored file, if any.
     *
     * @param stored_file $file
     * @return stored_file|null
     */
    public static function get_converted(stored_file $file): ?stored_file {
        $conversions = \core_files\conversion::get_conversions_for_file($file, 'pdf');
        foreach ($conversions as $conversion) {
            if ((int)$conversion->get('status') === \core_files\conversion::STATUS_COMPLETE) {
                $dest = $conversion->get_destfile();
                if ($dest) {
                    return $dest;
                }
            }
        }
        return null;
    }
}
