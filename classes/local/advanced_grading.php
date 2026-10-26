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
 * Reads rubric and marking guide definitions and fillings, and turns the app's data back into
 * what Moodle's grading form controllers expect.
 *
 * @package    local_fastgrade
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class advanced_grading {
    /** @var \gradingform_controller|null */
    protected $controller = null;

    /** @var string */
    protected string $method = '';

    /** @var \context */
    protected \context $context;

    /**
     * Constructor.
     *
     * @param \context $context
     * @param string $component
     * @param string $area
     */
    public function __construct(\context $context, string $component, string $area) {
        global $CFG;
        require_once($CFG->dirroot . '/grade/grading/lib.php');
        $this->context = $context;
        $manager = get_grading_manager($context, $component, $area);
        $method = $manager->get_active_method();
        if ($method && in_array($method, ['rubric', 'guide'])) {
            $controller = $manager->get_controller($method);
            if ($controller->is_form_available()) {
                $this->controller = $controller;
                $this->method = $method;
            }
        }
    }

    /**
     * Rubric or guide, or an empty string when no advanced grading is in use.
     *
     * @return string
     */
    public function get_method(): string {
        return $this->method;
    }

    /**
     * The controller.
     *
     * @return \gradingform_controller|null
     */
    public function get_controller() {
        return $this->controller;
    }

    /**
     * Id of the active rubric or marking guide definition, 0 when there is none.
     *
     * @return int
     */
    public function get_definition_id(): int {
        if (!$this->controller) {
            return 0;
        }
        $def = $this->controller->get_definition();
        return $def ? (int)$def->id : 0;
    }

    /**
     * Export the definition for the app.
     *
     * @return array
     */
    public function export_definition(): array {
        if (!$this->controller) {
            return [];
        }
        $def = $this->controller->get_definition();
        $fmt = fn($text) => format_text((string)$text, FORMAT_HTML, ['context' => $this->context, 'para' => false]);
        $out = ['name' => format_string($def->name ?? '', true, ['context' => $this->context]), 'criteria' => [], 'comments' => []];
        if ($this->method === 'rubric') {
            $criteria = $def->rubric_criteria ?? [];
            uasort($criteria, fn($a, $b) => $a['sortorder'] <=> $b['sortorder']);
            foreach ($criteria as $cid => $c) {
                $levels = [];
                foreach ($c['levels'] as $lid => $l) {
                    $levels[] = ['id' => (int)$lid, 'score' => (float)$l['score'], 'definition' => $fmt($l['definition'])];
                }
                usort($levels, fn($a, $b) => $a['score'] <=> $b['score']);
                $out['criteria'][] = ['id' => (int)$cid, 'description' => $fmt($c['description']), 'levels' => $levels];
            }
        } else {
            $criteria = $def->guide_criteria ?? [];
            uasort($criteria, fn($a, $b) => $a['sortorder'] <=> $b['sortorder']);
            foreach ($criteria as $cid => $c) {
                $out['criteria'][] = [
                    'id' => (int)$cid,
                    'shortname' => format_string($c['shortname'], true, ['context' => $this->context]),
                    'description' => $fmt($c['description']),
                    'descriptionmarkers' => $fmt($c['descriptionmarkers']),
                    'maxscore' => (float)$c['maxscore'],
                ];
            }
            foreach (($def->guide_comments ?? []) as $id => $comment) {
                $out['comments'][] = [
                    'id' => (int)$id,
                    'text' => format_string(
                        $comment['description'],
                        true,
                        ['context' => $this->context]
                    ),
                ];
            }
        }
        return $out;
    }

    /**
     * Current filling for a gradebook item (assign_grades.id).
     *
     * @param int $itemid
     * @return array criterionid => ['levelid' => int|null, 'score' => float|null, 'remark' => string]
     */
    public function export_filling(int $itemid): array {
        if (!$this->controller || !$itemid) {
            return [];
        }
        $instances = $this->controller->get_active_instances($itemid);
        $instance = $instances ? reset($instances) : null;
        if (!$instance) {
            return [];
        }
        $filling = $this->method === 'rubric' ? $instance->get_rubric_filling() : $instance->get_guide_filling();
        $out = [];
        foreach (($filling['criteria'] ?? []) as $cid => $f) {
            $out[] = [
                'criterionid' => (int)$cid,
                'levelid' => isset($f['levelid']) ? (int)$f['levelid'] : 0,
                'score' => isset($f['score']) ? (float)$f['score'] : null,
                'remark' => (string)($f['remark'] ?? ''),
            ];
        }
        return $out;
    }

    /**
     * Turn the app's filling into the array the controller's instance expects.
     *
     * @param array $filling list of ['criterionid', 'levelid', 'score', 'remark']
     * @return array
     */
    public function build_form_data(array $filling): array {
        $criteria = [];
        $definition = $this->export_definition();
        $valid = [];
        foreach ($definition['criteria'] as $c) {
            $valid[$c['id']] = $c;
        }
        foreach ($filling as $f) {
            $cid = (int)($f['criterionid'] ?? 0);
            if (!isset($valid[$cid])) {
                continue;
            }
            $remark = clean_param((string)($f['remark'] ?? ''), PARAM_TEXT);
            if ($this->method === 'rubric') {
                $levelid = (int)($f['levelid'] ?? 0);
                $levelids = array_column($valid[$cid]['levels'], 'id');
                if ($levelid && !in_array($levelid, $levelids)) {
                    $levelid = 0;
                }
                $row = ['remark' => $remark];
                if ($levelid) {
                    $row['levelid'] = $levelid;
                }
                $criteria[$cid] = $row;
            } else {
                $score = $f['score'] ?? null;
                if ($score === null || $score === '') {
                    continue;
                }
                $score = max(0, min((float)$score, $valid[$cid]['maxscore']));
                $criteria[$cid] = ['score' => $score, 'remark' => $remark];
            }
        }
        return ['criteria' => $criteria];
    }

    /**
     * Whether a filling is complete (every criterion has a level or score).
     *
     * @param array $formdata as returned by build_form_data()
     * @return bool
     */
    public function is_complete(array $formdata): bool {
        $definition = $this->export_definition();
        foreach ($definition['criteria'] as $c) {
            $row = $formdata['criteria'][$c['id']] ?? null;
            if (!$row) {
                return false;
            }
            if ($this->method === 'rubric' && empty($row['levelid'])) {
                return false;
            }
            if ($this->method === 'guide' && !isset($row['score'])) {
                return false;
            }
        }
        return true;
    }
}
