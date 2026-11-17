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
 * Mark polarities: icon and label for Improvement, Positive and Neutral.
 * Kept in its own module because Moodle's build drops named exports from a module that also has a default export.
 *
 * @module     local_fastgrade/annotate/polarity
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {t} from 'local_fastgrade/lib/str';

export const POL = {
    improvement: {icon: 'up', label: () => t('pol_improvement')},
    positive: {icon: 'check', label: () => t('pol_positive')},
    neutral: {icon: 'comment', label: () => t('pol_neutral')},
};
