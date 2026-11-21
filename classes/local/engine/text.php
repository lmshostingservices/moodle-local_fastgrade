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

namespace local_fastgrade\local\engine;

/**
 * Rule-based text checks on the server: words, stems, phrases, key ideas and key points.
 *
 * Server copy of the parts of amd/src/autograde/engine.js that Instant Feedback needs, so the
 * rules never have to be sent to a student's browser. Both copies are tested against
 * tests/fixtures/engine_spec.json; change them together. No AI and no external services.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class text {
    /** Stop words. */
    const STOP = ['a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'as',
        'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these', 'those', 'there', 'their',
        'they', 'them', 'he', 'she', 'his', 'her', 'we', 'our', 'you', 'your', 'i', 'me', 'my', 'not', 'no', 'do', 'does',
        'did', 'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might', 'must', 'have', 'has', 'had', 'so', 'such',
        'than', 'then', 'also', 'into', 'about', 'over', 'under', 'more', 'most', 'other', 'some', 'any', 'each', 'which',
        'who', 'whom', 'what', 'when', 'where', 'why', 'how', 'all', 'both', 'either', 'neither'];

    /** Long forms and their abbreviations. */
    const LONGFORMS = [
        ['/\bwork(?:place)?\s+health\s+(?:and|&)\s+safety\b/u', 'whs'],
        ['/\boccupational\s+health\s+(?:and|&)\s+safety\b/u', 'ohs'],
        ['/\bhealth\s+(?:and|&)\s+safety\s+representatives?\b/u', 'hsr'],
        ['/\bhealth\s+(?:and|&)\s+safety\s+committees?\b/u', 'hsc'],
        ['/\bpersons?\s+conducting\s+(?:a\s+)?business\s+(?:or|and)\s+undertakings?\b/u', 'pcbu'],
        ['/\bpersonal\s+protective\s+equipment\b/u', 'ppe'],
        ['/\b(?:material\s+)?safety\s+data\s+sheets?\b/u', 'sds'],
        ['/\bsafe\s+work\s+method\s+statements?\b/u', 'swms'],
        ['/\bjob\s+safety\s+analys[ie]s\b/u', 'jsa'],
        ['/\bregistered\s+training\s+organi[sz]ations?\b/u', 'rto'],
        ['/\bstandard\s+operating\s+procedures?\b/u', 'sop'],
        ['/\bkey\s+performance\s+indicators?\b/u', 'kpi'],
        ['/\bnational\s+disability\s+insurance\s+scheme\b/u', 'ndis'],
        ['/\boh&s\b/u', 'ohs'],
    ];

    /** Plural abbreviations. */
    const ABBR = ['hsrs' => 'hsr', 'pcbus' => 'pcbu', 'msds' => 'sds', 'kpis' => 'kpi', 'sops' => 'sop', 'rtos' => 'rto'];

    /** Words that mean the same in marking criteria. */
    const CANON = ['act' => 'legisl', 'law' => 'legisl', 'regul' => 'legisl', 'statut' => 'legisl', 'legal' => 'legisl',
        'employe' => 'worker', 'staff' => 'worker', 'employ' => 'worker', 'danger' => 'hazard', 'risk' => 'hazard',
        'discuss' => 'consult', 'meet' => 'consult', 'toolbox' => 'consult', 'feedback' => 'consult',
        'rate' => 'assess', 'evalu' => 'assess', 'analys' => 'assess', 'score' => 'assess',
        'minut' => 'record', 'regist' => 'record', 'log' => 'record', 'document' => 'record',
        'shape' => 'chang', 'influenc' => 'chang', 'modif' => 'chang'];

    /** Instruction words. */
    const METAWORDS = 'identify identifies identified describe describes described explain explains explained apply applies ' .
        'applied relevant correct correctly address addresses addressed mention mentions mentioned discuss discusses outline ' .
        'outlines demonstrate demonstrates show shows provide provides clearly appropriate appropriately incomplete named ' .
        'partly partially fully adequately student learner response answer select selects selected choose chooses use ' .
        'uses using include includes including list lists give gives';

    /** Everyday words for the same idea. */
    const IDEAWORDS = [
        'control' => 'control barrier guard replace eliminate substitute isolate engineering procedure limiter separate fence ' .
            'signage ppe interlock enclosure ventilation',
        'assess' => 'assess rating rated likelihood consequence matrix high medium low likely unlikely major minor moderate ' .
            'extreme catastrophic severity probability',
        'consult' => 'consult consultation hsr committee say concern concerns raise talk feedback toolbox',
        'understand' => 'understand understanding question questions quiz check explain ask confirm',
        'action' => 'action actions follow wear report must procedure steps',
        'record' => 'record records register minutes log document',
        'review' => 'review monitor audit inspect reassess',
        'legisl' => 'legislation act regulation regulations law code codes duty duties',
        'budget' => 'budget cost costs total totals price spend',
        'formula' => 'formula formulas sum calculate calculated calculation',
        'learn' => 'learn learned learnt lesson lessons realise realised realize realized understood discover discovered ' .
            'taught showed insight',
        'apply' => 'apply applied use used practice implement implemented introduce introduced tried put',
        'future' => 'next future will plan plans going intend differently improve',
        'work' => 'work workplace job site shift role',
    ];

    /** Quality words, not ideas. */
    const NOTIDEAWORDS = 'accur accurate content cover covers covered clear clearly support supports delivery deliver ' .
        'relevant detail detailed effective appropriate well good all every most some few main key overall quality ' .
        'complete completed correct justified justify sound strong weak range variety evidence shows show linked link ' .
        'aspect aspects element elements area areas level levels criterion criteria encourage encourages ensure ensures ' .
        'demonstrate demonstrates provide provides use uses using apply applies';

    /** @var array|null */
    protected static $meta = null;
    /** @var array|null */
    protected static $notidea = null;
    /** @var array|null */
    protected static $ideamap = null;

    /**
     * Stem one lower-case word (Porter, 1980; the algorithm is public domain).
     *
     * @param string $w
     * @return string
     */
    public static function stem(string $w): string {
        if (strlen($w) < 3 || !preg_match('/^[a-z]+$/', $w)) {
            return $w;
        }
        $c = '[^aeiou]';
        $v = '[aeiouy]';
        $cc = $c . '[^aeiouy]*';
        $vv = $v . '[aeiou]*';
        $mgr0 = '/^(' . $cc . ')?' . $vv . $cc . '/';
        $meq1 = '/^(' . $cc . ')?' . $vv . $cc . '(' . $vv . ')?$/';
        $mgr1 = '/^(' . $cc . ')?' . $vv . $cc . $vv . $cc . '/';
        $sv = '/^(' . $cc . ')?' . $v . '/';
        $step2 = ['ational' => 'ate', 'tional' => 'tion', 'enci' => 'ence', 'anci' => 'ance', 'izer' => 'ize', 'bli' => 'ble',
            'alli' => 'al', 'entli' => 'ent', 'eli' => 'e', 'ousli' => 'ous', 'ization' => 'ize', 'ation' => 'ate',
            'ator' => 'ate', 'alism' => 'al', 'iveness' => 'ive', 'fulness' => 'ful', 'ousness' => 'ous', 'aliti' => 'al',
            'iviti' => 'ive', 'biliti' => 'ble', 'logi' => 'log', 'isation' => 'ize', 'iser' => 'ize'];
        $step3 = ['icate' => 'ic', 'ative' => '', 'alize' => 'al', 'alise' => 'al', 'iciti' => 'ic', 'ical' => 'ic',
            'ful' => '', 'ness' => ''];
        $firstch = $w[0];
        if ($firstch === 'y') {
            $w = 'Y' . substr($w, 1);
        }
        if (preg_match('/^(.+?)(ss|i)es$/', $w)) {
            $w = preg_replace('/^(.+?)(ss|i)es$/', '$1$2', $w);
        } else if (preg_match('/^(.+?)([^s])s$/', $w)) {
            $w = preg_replace('/^(.+?)([^s])s$/', '$1$2', $w);
        }
        if (preg_match('/^(.+?)eed$/', $w, $m)) {
            if (preg_match($mgr0, $m[1])) {
                $w = substr($w, 0, -1);
            }
        } else if (preg_match('/^(.+?)(ed|ing)$/', $w, $m)) {
            $st = $m[1];
            if (preg_match($sv, $st)) {
                $w = $st;
                if (preg_match('/(at|bl|iz)$/', $w)) {
                    $w .= 'e';
                } else if (preg_match('/([^aeiouylsz])\1$/', $w)) {
                    $w = substr($w, 0, -1);
                } else if (preg_match('/^' . $cc . $v . '[^aeiouwxy]$/', $w)) {
                    $w .= 'e';
                }
            }
        }
        if (preg_match('/^(.+?)y$/', $w, $m)) {
            if (preg_match($sv, $m[1])) {
                $w = $m[1] . 'i';
            }
        }
        $re = '/^(.+?)(ational|tional|enci|anci|izer|iser|bli|alli|entli|eli|ousli|ization|isation|ation|ator|alism|' .
            'iveness|fulness|ousness|aliti|iviti|biliti|logi)$/';
        if (preg_match($re, $w, $m)) {
            if (preg_match($mgr0, $m[1])) {
                $w = $m[1] . $step2[$m[2]];
            }
        }
        if (preg_match('/^(.+?)(icate|ative|alize|alise|iciti|ical|ful|ness)$/', $w, $m)) {
            if (preg_match($mgr0, $m[1])) {
                $w = $m[1] . $step3[$m[2]];
            }
        }
        if (preg_match('/^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize|ise)$/', $w, $m)) {
            if (preg_match($mgr1, $m[1])) {
                $w = $m[1];
            }
        } else if (preg_match('/^(.+?)(s|t)(ion)$/', $w, $m)) {
            $st = $m[1] . $m[2];
            if (preg_match($mgr1, $st)) {
                $w = $st;
            }
        }
        if (preg_match('/^(.+?)e$/', $w, $m)) {
            $st = $m[1];
            if (preg_match($mgr1, $st) || (preg_match($meq1, $st) && !preg_match('/^' . $cc . $v . '[^aeiouwxy]$/', $st))) {
                $w = $st;
            }
        }
        if (preg_match('/ll$/', $w) && preg_match($mgr1, $w)) {
            $w = substr($w, 0, -1);
        }
        if ($firstch === 'y') {
            $w = 'y' . substr($w, 1);
        }
        return $w;
    }

    /**
     * Words with positions (byte offsets).
     *
     * @param string $text
     * @return array [[w, s, start, end]]
     */
    public static function tokens(string $text): array {
        $out = [];
        preg_match_all("/[\\p{L}\\p{N}][\\p{L}\\p{N}'’-]*/u", $text, $all, PREG_OFFSET_CAPTURE);
        foreach ($all[0] as [$word, $at]) {
            $w = \core_text::strtolower($word);
            $w = preg_replace("/['’]s$/u", '', $w);
            $w = preg_replace("/['’]/u", '', $w);
            $out[] = ['w' => $w, 's' => self::stem(sense::fold($w)), 'start' => $at, 'end' => $at + strlen($word)];
        }
        return $out;
    }

    /**
     * Tokens with negation marked.
     *
     * @param string $text
     * @return array
     */
    public static function marked(string $text): array {
        return sense::mark_negation(self::tokens($text), $text);
    }

    /**
     * Sentences with offsets.
     *
     * @param string $text
     * @return array [[start, end, text]]
     */
    public static function sentences(string $text): array {
        $out = [];
        preg_match_all('/[^.!?\n]+(?:[.!?]+(?=\s|\z)|\n|\z)/u', $text, $all, PREG_OFFSET_CAPTURE);
        foreach ($all[0] as [$chunk, $at]) {
            $start = $at;
            $end = $at + strlen($chunk);
            while ($start < $end && preg_match('/\s/', $text[$start])) {
                $start++;
            }
            while ($end > $start && preg_match('/\s/', $text[$end - 1])) {
                $end--;
            }
            if (\core_text::strlen(substr($text, $start, $end - $start)) > 2) {
                $out[] = ['start' => $start, 'end' => $end, 'text' => substr($text, $start, $end - $start)];
            }
        }
        return $out;
    }

    /**
     * A phrase as terms to look for, and whether the phrase itself is negative.
     *
     * @param string $phrase
     * @return array [terms => [[w, s]], neg => bool]
     */
    public static function phrase_terms(string $phrase): array {
        $tk = self::marked($phrase);
        $words = array_values(array_filter($tk, fn($x) => !$x['negword']));
        $content = array_values(array_filter($words, fn($x) => !in_array($x['w'], self::STOP, true)));
        $use = $content ?: $words;
        $neg = false;
        foreach ($use as $x) {
            $neg = $neg || $x['neg'];
        }
        return ['terms' => array_map(fn($x) => ['w' => $x['w'], 's' => $x['s']], $use), 'neg' => $neg];
    }

    /**
     * Find a phrase in a token list.
     *
     * @param array $tk tokens of a sentence (with negation marked)
     * @param array $terms
     * @param bool $phraseneg
     * @return array [[start, end, negated, slip]]
     */
    public static function find_phrase(array $tk, array $terms, bool $phraseneg = false): array {
        $hits = [];
        $nt = count($terms);
        $n = count($tk);
        if (!$nt) {
            return $hits;
        }
        for ($i = 0; $i < $n; $i++) {
            $first = sense::term_match($tk[$i], $terms[0]);
            if (!$first) {
                continue;
            }
            $slip = $first === 2;
            $j = $i;
            $k = 1;
            $gap = 0;
            $matched = [$i];
            while ($k < $nt && $j + 1 < $n) {
                $j++;
                $mt = sense::term_match($tk[$j], $terms[$k]);
                if ($mt) {
                    $slip = $slip || $mt === 2;
                    $matched[] = $j;
                    $k++;
                    $gap = 0;
                } else if (in_array($tk[$j]['w'], self::STOP, true) || !empty($tk[$j]['negword']) || $gap < 2) {
                    $gap++;
                    if ($gap > 3) {
                        break;
                    }
                } else {
                    break;
                }
            }
            if ($k === $nt) {
                $negated = false;
                foreach ($matched as $x) {
                    if (array_key_exists('neg', $tk[$x]) && empty($tk[$x]['negword'])) {
                        $negated = $tk[$x]['neg'] !== $phraseneg;
                        break;
                    }
                }
                $hits[] = ['start' => $tk[$i]['start'], 'end' => $tk[$j]['end'], 'negated' => $negated, 'slip' => $slip];
            }
        }
        return $hits;
    }

    /**
     * A rule's alternatives ("a | b / c").
     *
     * @param array $terms
     * @return array [[label, alts => [phrase_terms]]]
     */
    public static function alternatives(array $terms): array {
        $out = [];
        foreach ($terms as $t) {
            $parts = array_values(array_filter(preg_split('/\s*[|\/]\s*/u', (string)$t), fn($x) => $x !== ''));
            $label = preg_split('/\s*[|\/]\s*/u', (string)$t)[0];
            $out[] = ['label' => $label, 'alts' => array_map([self::class, 'phrase_terms'], $parts)];
        }
        return $out;
    }

    /**
     * Sentences with negation-marked tokens.
     *
     * @param string $text
     * @return array
     */
    public static function marked_sentences(string $text): array {
        return array_map(fn($s) => $s + ['tk' => self::marked($s['text'])], self::sentences($text));
    }

    /**
     * Find every alternative in the sentences, split into hits that count and negated ones.
     *
     * @param array $sents marked sentences
     * @param array $terms
     * @return array [found => [label => [hit]], negated => [label => [hit]]]
     */
    public static function find_alternatives(array $sents, array $terms): array {
        $found = [];
        $negated = [];
        foreach (self::alternatives($terms) as $alt) {
            foreach ($sents as $s) {
                foreach ($alt['alts'] as $st) {
                    foreach (self::find_phrase($s['tk'], $st['terms'], $st['neg']) as $hit) {
                        $rec = ['start' => $s['start'], 'end' => $s['end'], 'at' => $s['start'] + $hit['start'],
                            'label' => $alt['label'], 'slip' => $hit['slip']];
                        if ($hit['negated']) {
                            $negated[$alt['label']][] = $rec;
                        } else {
                            $found[$alt['label']][] = $rec;
                        }
                    }
                }
            }
        }
        return ['found' => $found, 'negated' => $negated];
    }

    /**
     * Rules for 'term', 'anyof', 'mustnot', 'ideas', 'length', 'sequence', 'value' and 'quality' (the
     * kinds Instant Feedback uses), with the same results as the browser engine.
     *
     * @param string $text
     * @param array $rules [[kind, config]]
     * @param array $ctx question, template, topic, items
     * @return array [met, total, notes]
     */
    public static function evaluate(string $text, array $rules, array $ctx = []): array {
        $sents = self::marked_sentences($text);
        $alltk = self::tokens($text);
        $allwords = count($alltk);
        $notes = [];
        $met = 0;
        $total = 0;
        foreach ($rules as $rule) {
            $cfg = (array)($rule['config'] ?? []);
            $min = max(1, (int)($cfg['min'] ?? 1));
            $terms = (array)($cfg['terms'] ?? []);
            switch ($rule['kind'] ?? '') {
                case 'term':
                case 'anyof':
                    $total++;
                    $f = self::find_alternatives($sents, $terms);
                    $contra = array_values(array_intersect(array_keys($f['found']), array_keys($f['negated'])));
                    foreach ($contra as $k) {
                        unset($f['found'][$k]);
                    }
                    $distinct = count($f['found']);
                    $count = array_sum(array_map('count', $f['found']));
                    $ok = $rule['kind'] === 'anyof' ? $distinct >= $min : ($distinct > 0 && $count >= $min);
                    $met += $ok ? 1 : 0;
                    $notes[] = ['kind' => $rule['kind'], 'ok' => $ok, 'found' => array_keys($f['found']),
                        'negated' => array_values(array_diff(array_keys($f['negated']), $contra)), 'contradicted' => $contra];
                    break;
                case 'mustnot':
                    $total++;
                    $f = self::find_alternatives($sents, $terms);
                    $ok = !$f['found'];
                    $met += $ok ? 1 : 0;
                    $notes[] = ['kind' => 'mustnot', 'ok' => $ok, 'found' => array_keys($f['found'])];
                    break;
                case 'ideas':
                    $total++;
                    $res = self::ideas_check($text, $terms);
                    $need = min(count($terms), max(1, (int)($cfg['min'] ?? 0) ?: (int)ceil(count($terms) * 0.8)));
                    $ok = count($res['found']) >= $need;
                    $met += $ok ? 1 : 0;
                    $notes[] = ['kind' => 'ideas', 'ok' => $ok] + $res;
                    break;
                case 'length':
                    $total++;
                    $lo = (int)($cfg['min'] ?? 0);
                    $hi = (int)($cfg['max'] ?? 0);
                    $ok = (!$lo || $allwords >= $lo) && (!$hi || $allwords <= $hi);
                    $met += $ok ? 1 : 0;
                    $notes[] = ['kind' => 'length', 'ok' => $ok, 'words' => $allwords];
                    break;
                case 'sequence':
                    $total++;
                    $res = self::sequence_check($sents, $terms);
                    $met += $res['ok'] ? 1 : 0;
                    $notes[] = ['kind' => 'sequence'] + $res;
                    break;
                case 'value':
                    $total++;
                    $res = self::value_check($sents, $cfg);
                    $met += $res['ok'] ? 1 : 0;
                    $notes[] = ['kind' => 'value'] + $res;
                    break;
                case 'quality':
                    $q = sense::analyse($text, [
                        'tokens' => $alltk,
                        'sentences' => $sents,
                        'question' => (string)($ctx['question'] ?? ''),
                        'questiontokens' => self::tokens((string)($ctx['question'] ?? '')),
                        'templatetokens' => self::tokens((string)($ctx['template'] ?? '')),
                        'topic' => (array)($ctx['topic'] ?? []),
                        'items' => $ctx['items'] ?? null,
                    ]);
                    foreach ($q['issues'] as $is) {
                        $total++;
                        $notes[] = ['kind' => 'quality', 'ok' => false] + $is;
                    }
                    break;
            }
        }
        return ['met' => $met, 'total' => $total, 'notes' => $notes, 'words' => $allwords];
    }

    /**
     * Steps in order.
     *
     * @param array $sents
     * @param array $steps
     * @return array [ok, missing, outoforder]
     */
    public static function sequence_check(array $sents, array $steps): array {
        $at = [];
        $labels = [];
        foreach ($steps as $step) {
            $f = self::find_alternatives($sents, [$step]);
            $pos = [];
            foreach ($f['found'] as $list) {
                foreach ($list as $x) {
                    $pos[] = $x['at'];
                }
            }
            $at[] = $pos ? min($pos) : -1;
            $labels[] = preg_split('/\s*[|\/]\s*/u', (string)$step)[0];
        }
        $missing = [];
        $outoforder = [];
        $last = -1;
        $lastlabel = '';
        foreach ($at as $i => $pos) {
            if ($pos < 0) {
                $missing[] = $labels[$i];
                continue;
            }
            if ($pos < $last) {
                $outoforder[] = $lastlabel . ' → ' . $labels[$i];
            }
            if ($pos > $last) {
                $last = $pos;
                $lastlabel = $labels[$i];
            }
        }
        return ['ok' => $steps && !$missing && !$outoforder, 'missing' => $missing, 'outoforder' => $outoforder];
    }

    /**
     * Values given for a quantity.
     *
     * @param array $sents
     * @param array $cfg terms, unit, vmin, vmax
     * @return array [ok, good => [text], wrong => [text]]
     */
    public static function value_check(array $sents, array $cfg): array {
        $units = array_values(array_filter(preg_split('/\s*[|\/]\s*/u', \core_text::strtolower((string)($cfg['unit'] ?? '')))));
        $lo = ($cfg['vmin'] ?? '') === '' || $cfg['vmin'] === null ? -INF : (float)$cfg['vmin'];
        $hi = ($cfg['vmax'] ?? '') === '' || $cfg['vmax'] === null ? INF : (float)$cfg['vmax'];
        $terms = (array)($cfg['terms'] ?? []);
        $good = [];
        $wrong = [];
        foreach ($sents as $s) {
            if ($terms && !self::find_alternatives([$s], $terms)['found']) {
                continue;
            }
            foreach (sense::numbers($s['text']) as $nm) {
                if ($units && !in_array($nm['unit'], $units, true)) {
                    continue;
                }
                $txt = trim(substr($s['text'], $nm['start'], $nm['end'] - $nm['start']));
                if ($nm['n'] >= $lo && $nm['n'] <= $hi) {
                    $good[] = $txt;
                } else {
                    $wrong[] = $txt;
                }
            }
        }
        return ['ok' => $good && !$wrong, 'good' => $good, 'wrong' => $wrong];
    }

    /**
     * Fold -ise, -ize and -y endings after stemming.
     *
     * @param string $st
     * @return string
     */
    protected static function norm(string $st): string {
        return strlen($st) > 5 ? preg_replace('/(?:is|iz|i)$/', '', $st) : $st;
    }

    /**
     * Instruction words, stemmed.
     *
     * @return array
     */
    protected static function meta(): array {
        if (self::$meta === null) {
            self::$meta = array_fill_keys(array_map(fn($w) => self::norm(self::stem($w)), explode(' ', self::METAWORDS)), true);
        }
        return self::$meta;
    }

    /**
     * Content stems of a text.
     *
     * @param string $text
     * @param string $polarity all, positive or negative
     * @return string[]
     */
    public static function content_stems(string $text, string $polarity = 'all'): array {
        $low = \core_text::strtolower($text);
        foreach (self::LONGFORMS as [$re, $ab]) {
            $low = preg_replace($re, $ab, $low);
        }
        $tk = $polarity === 'all' ? self::tokens($low) : sense::mark_negation(self::tokens($low), $low);
        $meta = self::meta();
        $out = [];
        foreach ($tk as $x) {
            if (($polarity === 'positive' && ($x['neg'] || $x['negword'])) || ($polarity === 'negative' && !$x['neg'])) {
                continue;
            }
            $w = self::ABBR[$x['w']] ?? $x['w'];
            $st = isset(self::ABBR[$x['w']]) ? $w : self::norm($x['s']);
            if (in_array($w, self::STOP, true) || \core_text::strlen($w) < 2 || isset($meta[$st])) {
                continue;
            }
            $out[] = self::CANON[$st] ?? $st;
        }
        return $out;
    }

    /**
     * The ideas in a text.
     *
     * @param string $text
     * @param string $polarity
     * @return string[]
     */
    public static function idea_stems(string $text, string $polarity = 'all'): array {
        if (self::$ideamap === null) {
            self::$ideamap = [];
            foreach (self::IDEAWORDS as $idea => $words) {
                foreach (explode(' ', $words) as $w) {
                    self::$ideamap[self::norm(self::stem($w))] = $idea;
                }
            }
            self::$notidea = array_fill_keys(array_map(
                fn($w) => self::norm(self::stem($w)),
                explode(' ', self::NOTIDEAWORDS)
            ), true);
        }
        $out = [];
        foreach (self::content_stems($text, $polarity) as $st) {
            $st = self::$ideamap[$st] ?? $st;
            if (!isset(self::$notidea[$st])) {
                $out[] = $st;
            }
        }
        return $out;
    }

    /**
     * Which key ideas the text states.
     *
     * @param string $text
     * @param array $ideas
     * @return array [found, missing, negated]
     */
    public static function ideas_check(string $text, array $ideas): array {
        $have = array_fill_keys(self::idea_stems($text, 'positive'), true);
        $against = array_fill_keys(self::idea_stems($text, 'negative'), true);
        $found = [];
        $missing = [];
        $negated = [];
        foreach ($ideas as $w) {
            $parts = preg_split('/\s*[|\/]\s*/u', (string)$w);
            $st = array_filter(array_map(fn($x) => self::idea_stems($x)[0] ?? '', $parts));
            $label = $parts[0];
            if (array_filter($st, fn($x) => isset($have[$x]))) {
                $found[] = $label;
            } else {
                $missing[] = $label;
                if (array_filter($st, fn($x) => isset($against[$x]))) {
                    $negated[] = $label;
                }
            }
        }
        return ['found' => $found, 'missing' => $missing, 'negated' => $negated];
    }

    /**
     * The stretches of text a key point can be found in.
     *
     * @param string $text
     * @return array
     */
    public static function windows(string $text): array {
        $words = fn($s) => count(preg_split('/\s+/u', $s['text']));
        $ends = fn($s) => preg_match('/[.!?:;]["\')\]]?$/u', $s['text']) === 1;
        $one = [];
        $wrapping = false;
        foreach (self::sentences($text) as $s) {
            $lastkey = count($one) - 1;
            if ($wrapping && $lastkey >= 0) {
                $one[$lastkey]['end'] = $s['end'];
                $one[$lastkey]['text'] .= ' ' . $s['text'];
            } else {
                $one[] = $s;
            }
            $wrapping = !$ends($s) && $words($s) >= 12;
        }
        if (count($one) < 3) {
            return $one;
        }
        $isshort = fn($s) => !$ends($s) && $words($s) < 12;
        $out = [];
        $run = [];
        $flush = function ($next) use (&$run, &$out) {
            if ($next && $run) {
                array_pop($run);
            }
            if (count($run) > 3) {
                $out[] = ['start' => $run[0]['start'], 'end' => $run[count($run) - 1]['end'],
                    'text' => implode("\n", array_column($run, 'text')), 'pair' => true];
            }
            $run = [];
        };
        foreach ($one as $i => $s) {
            if ($isshort($s)) {
                $run[] = $s;
                continue;
            }
            $flush($s);
            $out[] = $s;
            $prev = $one[$i - 1] ?? null;
            if ($prev && !$isshort($prev)) {
                $out[] = ['start' => $prev['start'], 'end' => $s['end'], 'text' => $prev['text'] . ' ' . $s['text'],
                    'pair' => true];
            }
        }
        $flush(null);
        return $out;
    }

    /**
     * Which key points the text covers: covered, partial or missing, and whether it says the opposite.
     *
     * @param string $text
     * @param array $points
     * @param string $question
     * @return array [[point, status, negated, score]]
     */
    public static function coverage(string $text, array $points, string $question = ''): array {
        $qstems = array_fill_keys(self::content_stems($question), true);
        $sents = self::windows($text);
        $sstems = array_map(fn($s) => self::content_stems($s['text'], 'positive'), $sents);
        $rawsets = array_map(fn($s) => array_fill_keys(self::content_stems($s['text']), true), $sents);
        $pstems = array_map(fn($p) => self::content_stems((string)$p), $points);
        $docs = array_merge($sstems, $pstems);
        $df = [];
        foreach ($docs as $d) {
            foreach (array_unique($d) as $w) {
                $df[$w] = ($df[$w] ?? 0) + 1;
            }
        }
        $n = count($docs);
        $vec = function (array $stems) use ($df, $n): array {
            $tf = [];
            foreach ($stems as $w) {
                $tf[$w] = ($tf[$w] ?? 0) + 1;
            }
            $v = [];
            $norm = 0.0;
            foreach ($tf as $w => $c) {
                $x = (1 + log($c)) * log(1 + $n / ($df[$w] ?? 1));
                $v[$w] = $x;
                $norm += $x * $x;
            }
            return ['v' => $v, 'norm' => sqrt($norm) ?: 1];
        };
        $svecs = array_map($vec, $sstems);
        $ssets = array_map(fn($st) => array_fill_keys($st, true), $sstems);
        $out = [];
        foreach ($points as $pi => $p) {
            $pset = array_fill_keys($pstems[$pi], true);
            $pv = $vec($pstems[$pi]);
            $best = ['score' => 0.0, 'i' => -1, 'neg' => false];
            foreach ($svecs as $i => $sv) {
                $dot = 0.0;
                $snorm = 0.0;
                foreach ($sv['v'] as $w => $y) {
                    if (!(isset($qstems[$w]) && !isset($pset[$w]))) {
                        $snorm += $y * $y;
                    }
                }
                foreach ($pv['v'] as $w => $x) {
                    if (isset($sv['v'][$w])) {
                        $dot += $x * $sv['v'][$w];
                    }
                }
                $cos = $dot / ($pv['norm'] * (sqrt($snorm) ?: 1));
                $align = $pset ? count(array_intersect_key($pset, $ssets[$i])) / count($pset) : 0;
                $score = (0.5 * min(1, $cos) + 0.5 * min(1, $align)) * (!empty($sents[$i]['pair']) ? 0.92 : 1);
                $neg = false;
                foreach ($pset as $w => $unused) {
                    if (isset($rawsets[$i][$w]) && !isset($ssets[$i][$w])) {
                        $neg = true;
                    }
                }
                if ($neg) {
                    $score *= 0.55;
                }
                if ($score > $best['score']) {
                    $best = ['score' => $score, 'i' => $i, 'neg' => $neg];
                }
            }
            $status = $best['score'] >= 0.5 ? 'covered' : ($best['score'] >= 0.3 ? 'partial' : 'missing');
            $negated = $best['neg'];
            foreach ($rawsets as $i => $set) {
                $align = $pset ? count(array_intersect_key($pset, $set)) / count($pset) : 0;
                $someneg = false;
                foreach ($pset as $w => $unused) {
                    if (isset($set[$w]) && !isset($ssets[$i][$w])) {
                        $someneg = true;
                    }
                }
                if ($align >= 0.6 && $someneg) {
                    $negated = true;
                    if ($best['i'] < 0 || $best['score'] < 0.3) {
                        $best = ['score' => 0.3, 'i' => $i, 'neg' => true];
                    }
                }
            }
            if ($negated) {
                $status = 'partial';
            }
            $out[] = ['point' => $p, 'status' => $status, 'negated' => $negated, 'score' => round($best['score'], 2)];
        }
        return $out;
    }
}
