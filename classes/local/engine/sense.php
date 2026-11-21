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
 * Reading safeguards: negation, spelling variants and slips, and checks on the answer as a whole.
 *
 * Server copy of amd/src/autograde/sense.js. Both are tested against tests/fixtures/engine_spec.json;
 * change them together.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class sense {
    /** Words that turn what follows round. */
    const NEG = ['not', 'no', 'never', 'without', 'cannot', 'cant', 'dont', 'doesnt', 'didnt', 'wont', 'wouldnt', 'shouldnt',
        'mustnt', 'isnt', 'arent', 'wasnt', 'werent', 'hasnt', 'havent', 'hadnt', 'couldnt', 'neither', 'nor', 'avoid',
        'avoids', 'avoided', 'avoiding', 'ignore', 'ignores', 'ignored', 'ignoring', 'skip', 'skips', 'skipped', 'skipping',
        'forget', 'forgets', 'forgot', 'forgetting', 'neglect', 'neglects', 'neglected', 'neglecting', 'omit', 'omits',
        'omitted', 'omitting', 'fail', 'fails', 'failed', 'failing', 'lack', 'lacks', 'lacking', 'refuse', 'refuses',
        'refused', 'refusing', 'nobody', 'nothing', 'none', 'instead', 'rather'];

    /** Words that end the reach of a negation. */
    const BREAK = ['but', 'however', 'although', 'though', 'whereas', 'while', 'yet', 'because', 'since', 'so', 'then', 'that',
        'which', 'who', 'unless', 'except'];

    /** "X is not necessary": the negation reaches back to X. */
    const NEEDWORDS = ['necessary', 'needed', 'need', 'needs', 'required', 'important', 'essential', 'mandatory',
        'compulsory', 'recommended'];

    /** Words that negate what came before them. */
    const BACKNEG = ['unnecessary', 'optional', 'pointless', 'irrelevant', 'useless'];

    /** Linking verbs: "X is not necessary". */
    const COPULA = ['is', 'are', 'was', 'were', 'be', 'been', 'being', 'isnt', 'arent', 'wasnt', 'werent'];

    /** How many content words a negation reaches. */
    const REACH = 5;

    /** The most words a negation reaches in all. */
    const REACHMAX = 10;

    /** Words that start a new clause after "and", "or", "then". */
    const PRONOUN = ['i', 'you', 'we', 'they', 'he', 'she', 'it', 'someone', 'everyone', 'workers', 'people'];

    /** UK spellings with -our. */
    const OUR = ['colour', 'behaviour', 'labour', 'favour', 'honour', 'neighbour', 'harbour', 'rumour', 'humour', 'odour',
        'vapour', 'flavour', 'endeavour', 'saviour', 'armour', 'parlour', 'vigour', 'tumour', 'clamour', 'rigour', 'valour',
        'ardour', 'candour'];

    /** Endings after -our. */
    const OURSUF = ['', 's', 'ed', 'ing', 'ite', 'ites', 'able', 'ably', 'ful', 'less', 'hood', 'er', 'ers'];

    /** Words that end in -ise in every spelling. */
    const ISEKEEP = ['advise', 'advertise', 'apprise', 'arise', 'chastise', 'comprise', 'compromise', 'demise', 'despise',
        'devise', 'disguise', 'enterprise', 'excise', 'exercise', 'expertise', 'franchise', 'improvise', 'incise',
        'merchandise', 'premise', 'promise', 'revise', 'supervise', 'surmise', 'surprise', 'televise', 'treatise', 'wise',
        'rise', 'raise', 'noise', 'praise', 'poise', 'cruise', 'bruise', 'concise', 'precise', 'paradise', 'otherwise',
        'likewise', 'clockwise', 'circumcise', 'anise', 'valise', 'reprise'];

    /** Single words spelt differently. */
    const WORDS = ['programme' => 'program', 'programmes' => 'programs', 'aluminium' => 'aluminum', 'mould' => 'mold',
        'moulds' => 'molds', 'plough' => 'plow', 'grey' => 'gray', 'judgement' => 'judgment', 'judgements' => 'judgments',
        'ageing' => 'aging', 'enrolment' => 'enrollment', 'enrolments' => 'enrollments', 'fulfil' => 'fulfill',
        'fulfilment' => 'fulfillment', 'skilful' => 'skillful', 'instalment' => 'installment', 'kerb' => 'curb',
        'tyre' => 'tire', 'tyres' => 'tires', 'cheque' => 'check', 'cheques' => 'checks', 'sceptical' => 'skeptical',
        'practise' => 'practice', 'practised' => 'practiced', 'practising' => 'practicing', 'licence' => 'license',
        'licences' => 'licenses', 'defence' => 'defense', 'offence' => 'offense', 'offences' => 'offenses',
        'pretence' => 'pretense', 'manoeuvre' => 'maneuver', 'manoeuvres' => 'maneuvers', 'oedema' => 'edema',
        'diarrhoea' => 'diarrhea', 'oestrogen' => 'estrogen', 'oesophagus' => 'esophagus', 'storey' => 'story',
        'storeys' => 'stories'];

    /** Function words. */
    const STOPISH = ['a', 'an', 'the', 'and', 'or', 'but', 'if', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from',
        'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these', 'those', 'there',
        'their', 'they', 'them', 'he', 'she', 'his', 'her', 'we', 'our', 'you', 'your', 'i', 'me', 'my', 'not', 'no', 'do',
        'does', 'did', 'can', 'could', 'should', 'would', 'will', 'shall', 'may', 'might', 'must', 'have', 'has', 'had', 'so',
        'such', 'than', 'then', 'also', 'into', 'about', 'over', 'under', 'more', 'most', 'other', 'some', 'any', 'each',
        'which', 'who', 'whom', 'what', 'when', 'where', 'why', 'how', 'all', 'both', 'either', 'neither'];

    /** Text speak. */
    const TEXTSPEAK = ['u', 'ur', 'cos', 'coz', 'cuz', 'gonna', 'wanna', 'gotta', 'lol', 'idk', 'thx', 'pls', 'plz', 'b4', 'ppl',
        'bc', 'tho', 'dunno', 'kinda', 'sorta', 'ya', 'nah', 'yep', 'imo', 'tbh', 'btw', 'omg'];

    /** Number words. */
    const NUMWORDS = ['two' => 2, 'three' => 3, 'four' => 4, 'five' => 5, 'six' => 6, 'seven' => 7, 'eight' => 8, 'nine' => 9,
        'ten' => 10, 'both' => 2];

    /** Words for the things a question counts. */
    const ITEMWORDS = '(?:ways?|precautions?|steps?|hazards?|risks?|reasons?|examples?|controls?|methods?|factors?|types?|' .
        'items?|points?|things?|benefits?|advantages?|disadvantages?|strategies|strategy|measures?|signs?|symptoms?|causes?|' .
        'effects?|responsibilities|duties|requirements?|features?|principles?|stages?|actions?|questions?|differences?|' .
        'tools?|pieces?|sources?|options?|techniques?|skills?|elements?|components?|parts?|key|main|different|common|' .
        'important|possible|safety|specific|workplace|legal|potential)';

    /** A reason given. */
    const REASON = '/\b(because|so that|so as to|in order to|to (?:prevent|avoid|stop|ensure|reduce|protect|keep|make sure|' .
        'minimi[sz]e|lower|limit|control|eliminate)|therefore|as a result|which means|this means|that means|this is why|since|' .
        'due to|otherwise|leads? to|results? in|causes?|so (?:the|that|it|you|they|we|workers|people|there)|reason|why|' .
        'helps?|allows?|enables?)\b/iu';

    /** An example given. */
    const EXAMPLE = '/\b(for example|for instance|e\.?g\.?|such as|example|an instance|like when|including|such a|i\.?e\.?|' .
        'case|when i|once i|at my|in my)\b/iu';

    /** Vague wording. */
    const VAGUE = '/\b(be careful|be safe|stay safe|take care|stuff|things like that|and so on|etc\.?|whatever|something like|' .
        'and stuff|you know|all that|common sense|use common sense|do the right thing|be aware|watch out)\b/iu';

    /** Hedged wording. */
    const HEDGE = "/\\b(i think|i guess|i suppose|maybe|perhaps|not sure|unsure|i don'?t know|dont know|idk|i believe|" .
        "probably|might be|i'?m not certain|no idea)\\b/iu";

    /**
     * Whether token $i is a negation.
     *
     * @param array $tk
     * @param int $i
     * @return bool
     */
    protected static function is_neg(array $tk, int $i): bool {
        $w = $tk[$i]['w'];
        if (!in_array($w, self::NEG, true)) {
            return false;
        }
        $next = $tk[$i + 1]['w'] ?? '';
        if (($w === 'not' && ($next === 'only' || $next === 'just')) || ($w === 'no' && $next === 'matter')) {
            return false;
        }
        if ($w === 'rather') {
            return $next === 'than';
        }
        if ($w === 'instead') {
            return $next === 'of';
        }
        return true;
    }

    /**
     * Whether a clause ends between two tokens.
     *
     * @param string $text
     * @param array $a
     * @param array $b
     * @return bool
     */
    protected static function gap_breaks(string $text, array $a, array $b): bool {
        $gap = substr($text, $a['end'], max(0, $b['start'] - $a['end']));
        return preg_match('/[,;:.!?()\n]/u', $gap) === 1 || in_array($b['w'], self::BREAK, true) ||
            (in_array($a['w'], ['and', 'or', 'then'], true) && in_array($b['w'], self::PRONOUN, true));
    }

    /**
     * Mark each token with neg (an odd number of negations reach it) and negword.
     *
     * @param array $tk tokens (byte offsets into $text)
     * @param string $text
     * @return array
     */
    public static function mark_negation(array $tk, string $text): array {
        $n = count($tk);
        $count = array_fill(0, $n, 0);
        for ($i = 0; $i < $n; $i++) {
            $tk[$i]['negword'] = self::is_neg($tk, $i);
        }
        // Left to right: a negation reaches forward up to the next negation (which it turns round, so "never forget"
        // cancels out), and a negation that has been turned round reaches nothing.
        for ($i = 0; $i < $n; $i++) {
            if (!$tk[$i]['negword'] || $count[$i] % 2 === 1) {
                continue;
            }
            $reach = 0;
            for ($k = $i + 1; $k < $n && $reach < self::REACH && $k - $i <= self::REACHMAX; $k++) {
                if (self::gap_breaks($text, $tk[$k - 1], $tk[$k])) {
                    break;
                }
                $count[$k]++;
                if ($tk[$k]['negword']) {
                    break;
                }
                if (!in_array($tk[$k]['w'], self::STOPISH, true)) {
                    $reach++;
                }
            }
        }
        for ($i = 0; $i < $n; $i++) {
            $w = $tk[$i]['w'];
            $back = in_array($w, self::BACKNEG, true);
            if (!$back && in_array($w, self::NEEDWORDS, true)) {
                for ($k = $i - 1; $k >= max(0, $i - 3); $k--) {
                    if (self::gap_breaks($text, $tk[$k], $tk[$k + 1])) {
                        break;
                    }
                    if ($tk[$k]['negword']) {
                        // Only "X is not necessary" reaches back to X; in "I do not need to..." it already reaches forward.
                        $back = in_array($tk[$k]['w'], self::COPULA, true) ||
                            ($k > 0 && in_array($tk[$k - 1]['w'], self::COPULA, true));
                        break;
                    }
                }
            }
            if (!$back) {
                continue;
            }
            $reach = 0;
            for ($k = $i - 1; $k >= 0 && $reach < self::REACH; $k--) {
                if (self::gap_breaks($text, $tk[$k], $tk[$k + 1])) {
                    break;
                }
                if (!$tk[$k]['negword']) {
                    $count[$k]++;
                    $reach++;
                }
            }
        }
        for ($i = 0; $i < $n; $i++) {
            $tk[$i]['neg'] = $count[$i] % 2 === 1;
        }
        return $tk;
    }

    /**
     * One spelling for words spelt differently in UK and US English.
     *
     * @param string $w lower-case word
     * @return string
     */
    public static function fold(string $w): string {
        if (isset(self::WORDS[$w])) {
            return self::WORDS[$w];
        }
        foreach (self::OUR as $base) {
            if (strpos($w, $base) === 0 && in_array(substr($w, strlen($base)), self::OURSUF, true)) {
                return substr($base, 0, -3) . 'or' . substr($w, strlen($base));
            }
        }
        if (preg_match('/^(cent|met|lit|fib|theat|kilomet|centimet|millimet|calib|lust|somb|spect|sab|meag)re(s|d)?$/', $w, $m)) {
            $suf = $m[2] ?? '';
            return $m[1] . 'er' . ($suf === 'd' ? 'ed' : $suf);
        }
        if (preg_match('/^(\w*?)(anal|paral|catal|electrol|hydrol)ys(e|es|ed|ing|er|ers)$/', $w, $m)) {
            return $m[1] . $m[2] . 'yz' . $m[3];
        }
        if (preg_match('/^(catal|dial|anal|prol|epil|monol)ogue(s)?$/', $w, $m)) {
            return $m[1] . 'og' . ($m[2] ?? '');
        }
        if (preg_match('/^(\w*?)(paed|anaes|haem|orthopaed|leukaem|gynaec|faec|caes)(\w*)$/', $w, $m)) {
            return $m[1] . preg_replace('/ae/', 'e', $m[2], 1) . $m[3];
        }
        if (
            preg_match('/^(\w{3,}?)is(e|es|ed|ing|er|ers|ation|ations|able)$/', $w, $m) &&
                !in_array($m[1] . 'ise', self::ISEKEEP, true) &&
                !preg_match('/^(\w*)(cis|vis|mis|pris|wis|nois|rais)$/', $m[1] . 'is')
        ) {
            return $m[1] . 'iz' . $m[2];
        }
        return $w;
    }

    /**
     * Restricted edit distance (a swap of neighbouring letters counts as one edit).
     *
     * @param string $a
     * @param string $b
     * @return int
     */
    public static function distance(string $a, string $b): int {
        $a = preg_split('//u', $a, -1, PREG_SPLIT_NO_EMPTY);
        $b = preg_split('//u', $b, -1, PREG_SPLIT_NO_EMPTY);
        $la = count($a);
        $lb = count($b);
        $d = [];
        for ($i = 0; $i <= $la; $i++) {
            $d[$i] = [$i];
        }
        for ($j = 0; $j <= $lb; $j++) {
            $d[0][$j] = $j;
        }
        for ($i = 1; $i <= $la; $i++) {
            for ($j = 1; $j <= $lb; $j++) {
                $cost = $a[$i - 1] === $b[$j - 1] ? 0 : 1;
                $d[$i][$j] = min($d[$i - 1][$j] + 1, $d[$i][$j - 1] + 1, $d[$i - 1][$j - 1] + $cost);
                if ($i > 1 && $j > 1 && $a[$i - 1] === $b[$j - 2] && $a[$i - 2] === $b[$j - 1]) {
                    $d[$i][$j] = min($d[$i][$j], $d[$i - 2][$j - 2] + 1);
                }
            }
        }
        return $d[$la][$lb];
    }

    /**
     * Whether a written word is a likely misspelling of an expected word.
     *
     * @param string $written
     * @param string $expected
     * @return bool
     */
    public static function slip(string $written, string $expected): bool {
        $lw = \core_text::strlen($written);
        $le = \core_text::strlen($expected);
        if ($written === $expected || $lw < 7 || $le < 7 || preg_match('/\d/', $written . $expected)) {
            return false;
        }
        if (\core_text::substr($written, 0, 2) !== \core_text::substr($expected, 0, 2) || abs($lw - $le) > 2) {
            return false;
        }
        $long = min($lw, $le) >= 10;
        if (self::distance($written, $expected) > ($long ? 2 : 1)) {
            return false;
        }
        if ($long || $lw !== $le) {
            return true;
        }
        $a = preg_split('//u', $written, -1, PREG_SPLIT_NO_EMPTY);
        $b = preg_split('//u', $expected, -1, PREG_SPLIT_NO_EMPTY);
        $diff = [];
        foreach ($a as $i => $ch) {
            if ($ch !== $b[$i]) {
                $diff[] = $i;
            }
        }
        return count($diff) === 2 && $diff[1] === $diff[0] + 1;
    }

    /**
     * Whether a token matches a phrase term: 0 no, 1 same stem, 2 spelling slip.
     *
     * @param array $tok
     * @param array|string $term
     * @return int
     */
    public static function term_match(array $tok, $term): int {
        if (is_string($term)) {
            return $tok['s'] === $term ? 1 : 0;
        }
        if ($tok['s'] === $term['s']) {
            return 1;
        }
        return self::slip($tok['w'], $term['w']) ? 2 : 0;
    }

    /**
     * How many items a question asks for, or 0.
     *
     * @param string $question
     * @return int
     */
    public static function asked_count(string $question): int {
        $re = '/\b(two|three|four|five|six|seven|eight|nine|ten|both|[2-9]|10)\s+(?:\w+\s+){0,2}?' . self::ITEMWORDS . '\b/iu';
        if (!preg_match($re, $question, $m)) {
            return 0;
        }
        $v = strtolower($m[1]);
        return self::NUMWORDS[$v] ?? (int)$v;
    }

    /**
     * What a question asks for beyond its content.
     *
     * @param string $question
     * @return array [reasons, example, count]
     */
    public static function asks(string $question): array {
        return [
            'reasons' => preg_match('/\b(explain|why|justify|discuss|describe how|how (?:does|do|would|can|could|should)|' .
                'reasons?|evaluate|analy[sz]e|outline why)\b/iu', $question) === 1,
            'example' => preg_match('/\b(example|examples|e\.g\.|for instance|give an instance|illustrate)\b/iu', $question) === 1,
            'count' => self::asked_count($question),
        ];
    }

    /**
     * Whether a word looks like random typing.
     *
     * @param string $w
     * @return bool
     */
    protected static function junk(string $w): bool {
        return \core_text::strlen($w) >= 4 && !preg_match('/\d/', $w) && (!preg_match('/[aeiouy]/u', $w) ||
            preg_match('/[^aeiouy]{5,}/u', $w) || preg_match('/(.)\1\1/u', $w));
    }

    /**
     * Distinct lower-cased matches of a pattern.
     *
     * @param string $re
     * @param string $text
     * @return string[]
     */
    protected static function matches(string $re, string $text): array {
        preg_match_all($re, $text, $m);
        return array_values(array_unique(array_map('core_text::strtolower', $m[0])));
    }

    /**
     * Checks on the answer as a whole.
     *
     * @param string $text
     * @param array $o tokens, sentences, question, questiontokens, templatetokens, topic, items
     * @return array [issues => [[code, level, detail]], words, effectivewords, dupsentences, listy]
     */
    public static function analyse(string $text, array $o): array {
        $tk = $o['tokens'] ?? [];
        $sents = $o['sentences'] ?? [];
        $issues = [];
        $add = function (string $code, string $level, $detail = '') use (&$issues) {
            $issues[] = ['code' => $code, 'level' => $level, 'detail' => (string)$detail];
        };
        $words = count($tk);
        if (!$words) {
            $add('empty', 'review');
            return ['issues' => $issues, 'words' => 0, 'effectivewords' => 0, 'dupsentences' => 0, 'listy' => false];
        }
        $junkn = count(array_filter($tk, fn($x) => self::junk($x['w'])));
        $distinct = count(array_unique(array_column($tk, 's')));
        if (($words >= 3 && $junkn / $words > 0.35) || ($words >= 8 && $distinct / $words < 0.25)) {
            $add('gibberish', 'review');
        }
        $stopn = count(array_filter($tk, fn($x) => in_array($x['w'], self::STOPISH, true)));
        $listy = $words >= 4 && $stopn / $words < 0.12;
        if ($listy) {
            $add('keywords', 'warn');
        }
        $seen = [];
        $dupwords = 0;
        $dups = 0;
        foreach ($sents as $s) {
            $set = [];
            foreach ($s['tk'] ?? [] as $x) {
                if (!in_array($x['w'], self::STOPISH, true)) {
                    $set[$x['s']] = true;
                }
            }
            if (count($set) < 3) {
                continue;
            }
            $twin = false;
            foreach ($seen as $p) {
                $inter = count(array_intersect_key($set, $p));
                if ($inter / (count($set) + count($p) - $inter) >= 0.85) {
                    $twin = true;
                    break;
                }
            }
            if ($twin) {
                $dups++;
                $dupwords += count($s['tk'] ?? []);
            } else {
                $seen[] = $set;
            }
        }
        if ($dups && $dupwords >= 6) {
            $add('repeat', 'warn', $dups);
        }
        $content = fn($x) => !in_array($x['w'], self::STOPISH, true) && \core_text::strlen($x['w']) > 2 &&
            !preg_match('/^\d+$/', $x['w']);
        $set = function (array $list) use ($content): array {
            $out = [];
            foreach ($list as $x) {
                if ($content($x)) {
                    $out[$x['s']] = true;
                }
            }
            return $out;
        };
        $mine = $set($tk);
        $qset = $set($o['questiontokens'] ?? []);
        $tset = $set($o['templatetokens'] ?? []);
        $fresh = array_diff_key($mine, $qset, $tset);
        if ($tset && $mine && count(array_diff_key($mine, $tset)) <= 2) {
            $add('template', 'warn');
        } else if (count($qset) >= 4 && count($mine) >= 4 && (count($fresh) <= 1 || count($fresh) / count($mine) < 0.2)) {
            $add('copied', 'warn');
        }
        $topic = $qset + array_fill_keys($o['topic'] ?? [], true);
        $items = $o['items'] ?? null;
        if (count($topic) >= 3 && $words >= 12 && !(is_numeric($items) && $items > 0)) {
            $shared = count(array_intersect_key($mine, $topic));
            if ($shared / max(1, count($mine)) < 0.08) {
                $add('offtopic', 'review');
            }
        }
        $want = self::asks((string)($o['question'] ?? ''));
        if ($want['reasons'] && $words >= 6 && !preg_match(self::REASON, $text)) {
            $add('noreason', 'warn');
        }
        if ($want['example'] && $words >= 6 && !preg_match(self::EXAMPLE, $text)) {
            $add('noexample', 'warn');
        }
        if ($want['count'] && is_int($items) && $items > 0 && $items < $want['count']) {
            $add('count', 'warn', $items . '/' . $want['count']);
        }
        $vague = self::matches(self::VAGUE, $text);
        if ($vague && (count($vague) >= 2 || $words < 40)) {
            $add('vague', 'info', implode(', ', array_slice($vague, 0, 4)));
        }
        $hedge = self::matches(self::HEDGE, $text);
        $strong = array_filter($hedge, fn($x) => preg_match('/know|idk|sure|idea|certain/', $x));
        if ($strong || count($hedge) >= 2) {
            $add('hedge', 'info', implode(', ', array_slice($hedge, 0, 3)));
        }
        $slang = [];
        foreach ($tk as $x) {
            if (in_array($x['w'], self::TEXTSPEAK, true) && !in_array($x['w'], $slang, true)) {
                $slang[] = $x['w'];
            }
        }
        if ($slang) {
            $add('textspeak', 'info', implode(', ', array_slice($slang, 0, 5)));
        }
        $codes = array_column($issues, 'code');
        if (array_intersect(['gibberish', 'template', 'copied', 'offtopic'], $codes)) {
            $issues = array_values(array_filter($issues, fn($i) =>
                !in_array($i['code'], ['keywords', 'noreason', 'noexample', 'count', 'vague'], true)));
        }
        return ['issues' => $issues, 'words' => $words, 'effectivewords' => $words - $dupwords, 'dupsentences' => $dups,
            'listy' => $listy];
    }

    /**
     * Numbers in a text with the word after them.
     *
     * @param string $text
     * @return array [[n, unit, start, end]]
     */
    public static function numbers(string $text): array {
        $out = [];
        preg_match_all('/(-?\d+(?:[.,]\d+)?)\s?(%|°c|°f|[a-zμ°]+)?/iu', $text, $all, PREG_SET_ORDER | PREG_OFFSET_CAPTURE);
        foreach ($all as $m) {
            $at = $m[0][1];
            $before = $at > 0 ? substr($text, 0, $at) : '';
            if ($before !== '' && preg_match('/\p{L}$/u', $before)) {
                continue;
            }
            $out[] = [
                'n' => (float)str_replace(',', '.', $m[1][0]),
                'unit' => \core_text::strtolower($m[2][0] ?? ''),
                'start' => $at,
                'end' => $at + strlen($m[0][0]),
            ];
        }
        return $out;
    }
}
