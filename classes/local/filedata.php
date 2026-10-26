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
 * Reads spreadsheets, slide notes, text and zip listings for the viewers.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class filedata {
    /** Limits. */
    const MAXROWS = 2000;
    /** Columns. */
    const MAXCOLS = 60;
    /** Sheets. */
    const MAXSHEETS = 12;
    /** Text bytes. */
    const MAXTEXT = 400000;

    /**
     * Data for a viewer.
     *
     * @param \stored_file $file
     * @param string $type sheet, notes, text or zip
     * @return array
     */
    public static function get(\stored_file $file, string $type): array {
        switch ($type) {
            case 'sheet':
                return self::sheet($file);
            case 'notes':
                return self::notes($file);
            case 'text':
                return self::text($file);
            case 'zip':
                return self::zip($file);
        }
        throw new \moodle_exception('invalidparameter', 'debug');
    }

    /**
     * A temporary copy of the file.
     *
     * @param \stored_file $file
     * @return string path
     */
    protected static function tempcopy(\stored_file $file): string {
        $dir = make_request_directory();
        $path = $dir . '/' . clean_filename($file->get_filename());
        $file->copy_content_to($path);
        return $path;
    }

    /**
     * Spreadsheet cells with values and formulas.
     *
     * @param \stored_file $file
     * @return array
     */
    protected static function sheet(\stored_file $file): array {
        $path = self::tempcopy($file);
        $reader = \PhpOffice\PhpSpreadsheet\IOFactory::createReaderForFile($path);
        if (method_exists($reader, 'setReadEmptyCells')) {
            $reader->setReadEmptyCells(false);
        }
        $book = $reader->load($path);
        $sheets = [];
        foreach ($book->getWorksheetIterator() as $i => $ws) {
            if ($i >= self::MAXSHEETS) {
                break;
            }
            $maxrow = min($ws->getHighestDataRow(), self::MAXROWS);
            $maxcol = min(
                \PhpOffice\PhpSpreadsheet\Cell\Coordinate::columnIndexFromString($ws->getHighestDataColumn()),
                self::MAXCOLS
            );
            $rows = [];
            for ($r = 1; $r <= $maxrow; $r++) {
                $row = [];
                for ($c = 1; $c <= $maxcol; $c++) {
                    $coord = \PhpOffice\PhpSpreadsheet\Cell\Coordinate::stringFromColumnIndex($c) . $r;
                    if (!$ws->cellExists($coord)) {
                        $row[] = null;
                        continue;
                    }
                    $cell = $ws->getCell($coord);
                    $raw = $cell->getValue();
                    $formula = null;
                    $value = $raw;
                    if (is_string($raw) && strlen($raw) > 1 && $raw[0] === '=') {
                        $formula = substr($raw, 1);
                        $value = $cell->getOldCalculatedValue();
                        if ($value === null || $value === '') {
                            try {
                                $value = $cell->getCalculatedValue();
                            } catch (\Throwable $e) {
                                $value = '#ERR';
                            }
                        }
                    } else {
                        try {
                            $value = $cell->getFormattedValue();
                        } catch (\Throwable $e) {
                            $value = (string)$raw;
                        }
                    }
                    if ($value instanceof \PhpOffice\PhpSpreadsheet\RichText\RichText) {
                        $value = $value->getPlainText();
                    }
                    if (is_float($value)) {
                        $value = round($value, 10);
                    }
                    $row[] = ['v' => is_scalar($value) || $value === null ? $value : (string)$value, 'f' => $formula];
                }
                // Trim trailing empty cells.
                while ($row && end($row) === null) {
                    array_pop($row);
                }
                $rows[] = $row;
            }
            $sheets[] = [
                'name' => $ws->getTitle(),
                'cols' => $maxcol,
                'rows' => $rows,
                'truncated' => $ws->getHighestDataRow() > self::MAXROWS,
            ];
        }
        $book->disconnectWorksheets();
        return ['sheets' => $sheets];
    }

    /**
     * Speaker notes for each slide of a PowerPoint file, in slide order.
     *
     * @param \stored_file $file
     * @return array
     */
    protected static function notes(\stored_file $file): array {
        $ext = strtolower(pathinfo($file->get_filename(), PATHINFO_EXTENSION));
        if (!in_array($ext, ['pptx', 'ppsx'])) {
            return ['notes' => []];
        }
        $zip = new \ZipArchive();
        if ($zip->open(self::tempcopy($file)) !== true) {
            return ['notes' => []];
        }
        $rels = self::rels($zip, 'ppt/_rels/presentation.xml.rels');
        $pres = self::xml($zip, 'ppt/presentation.xml');
        $slides = [];
        if ($pres) {
            $xp = new \DOMXPath($pres);
            $xp->registerNamespace('p', 'http://schemas.openxmlformats.org/presentationml/2006/main');
            $xp->registerNamespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships');
            foreach ($xp->query('//p:sldIdLst/p:sldId') as $node) {
                $rid = $node->getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
                if (isset($rels[$rid])) {
                    $slides[] = 'ppt/' . ltrim($rels[$rid], '/');
                }
            }
        }
        $notes = [];
        foreach (array_slice($slides, 0, 500) as $slide) {
            $text = '';
            $srels = self::rels($zip, dirname($slide) . '/_rels/' . basename($slide) . '.rels');
            foreach ($srels as $target) {
                if (strpos($target, 'notesSlide') !== false) {
                    $path = self::resolve(dirname($slide), $target);
                    $doc = self::xml($zip, $path);
                    if ($doc) {
                        $xp = new \DOMXPath($doc);
                        $xp->registerNamespace('p', 'http://schemas.openxmlformats.org/presentationml/2006/main');
                        $xp->registerNamespace('a', 'http://schemas.openxmlformats.org/drawingml/2006/main');
                        $paras = [];
                        foreach ($xp->query('//p:sp') as $sp) {
                            $ph = $xp->query('.//p:nvPr/p:ph', $sp)->item(0);
                            if ($ph && in_array($ph->getAttribute('type'), ['sldNum', 'sldImg', 'dt', 'ftr', 'hdr'])) {
                                continue;
                            }
                            foreach ($xp->query('.//a:p', $sp) as $p) {
                                $line = '';
                                foreach ($xp->query('.//a:t', $p) as $t) {
                                    $line .= $t->textContent;
                                }
                                $paras[] = $line;
                            }
                        }
                        $text = trim(implode("\n", $paras));
                    }
                }
            }
            $notes[] = $text;
        }
        $zip->close();
        return ['notes' => $notes];
    }

    /**
     * Relationship targets by id.
     *
     * @param \ZipArchive $zip
     * @param string $path
     * @return array
     */
    protected static function rels(\ZipArchive $zip, string $path): array {
        $doc = self::xml($zip, $path);
        $out = [];
        if ($doc) {
            foreach ($doc->getElementsByTagName('Relationship') as $r) {
                $out[$r->getAttribute('Id')] = $r->getAttribute('Target');
            }
        }
        return $out;
    }

    /**
     * Resolve a relative target.
     *
     * @param string $base
     * @param string $target
     * @return string
     */
    protected static function resolve(string $base, string $target): string {
        $parts = explode('/', $base . '/' . $target);
        $out = [];
        foreach ($parts as $p) {
            if ($p === '..') {
                array_pop($out);
            } else if ($p !== '.' && $p !== '') {
                $out[] = $p;
            }
        }
        return implode('/', $out);
    }

    /**
     * Load XML from the zip safely.
     *
     * @param \ZipArchive $zip
     * @param string $path
     * @return \DOMDocument|null
     */
    protected static function xml(\ZipArchive $zip, string $path): ?\DOMDocument {
        $content = $zip->getFromName($path);
        if ($content === false || strlen($content) > 20000000) {
            return null;
        }
        $doc = new \DOMDocument();
        $ok = @$doc->loadXML($content, LIBXML_NONET);
        return $ok ? $doc : null;
    }

    /**
     * A text or code file.
     *
     * @param \stored_file $file
     * @return array
     */
    protected static function text(\stored_file $file): array {
        $size = $file->get_filesize();
        $content = $size > self::MAXTEXT ? substr($file->get_content(), 0, self::MAXTEXT) : $file->get_content();
        $ext = strtolower(pathinfo($file->get_filename(), PATHINFO_EXTENSION));
        if ($ext === 'ipynb') {
            $nb = json_decode($content, true);
            if (is_array($nb) && isset($nb['cells'])) {
                $parts = [];
                foreach ($nb['cells'] as $i => $cell) {
                    $src = is_array($cell['source'] ?? '') ? implode('', $cell['source']) : (string)($cell['source'] ?? '');
                    $parts[] = '# --- [' . ($cell['cell_type'] ?? 'cell') . ' ' . ($i + 1) . '] ---' . "\n" . $src;
                }
                $content = implode("\n\n", $parts);
            }
        }
        if (!mb_check_encoding($content, 'UTF-8')) {
            $content = \core_text::convert($content, 'windows-1252', 'utf-8');
        }
        return ['text' => str_replace("\r\n", "\n", $content), 'truncated' => $size > self::MAXTEXT, 'ext' => $ext];
    }

    /**
     * Zip contents.
     *
     * @param \stored_file $file
     * @return array
     */
    protected static function zip(\stored_file $file): array {
        $zip = new \ZipArchive();
        if ($zip->open(self::tempcopy($file)) !== true) {
            return ['error' => get_string('cannotreadfile', 'local_fastgrade')];
        }
        $entries = [];
        for ($i = 0; $i < min($zip->numFiles, 2000); $i++) {
            $st = $zip->statIndex($i);
            $entries[] = [
                'name' => clean_param($st['name'], PARAM_PATH),
                'size' => (int)$st['size'],
                'dir' => substr($st['name'], -1) === '/',
            ];
        }
        $zip->close();
        return ['entries' => $entries, 'count' => $zip->numFiles];
    }
}
