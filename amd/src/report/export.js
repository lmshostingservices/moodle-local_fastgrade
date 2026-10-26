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
 * Exports: the report as a PDF (through the browser's print dialog, laid out for paper), and the
 * student table or pivot table as Excel, CSV or JSON.
 *
 * @module     local_fastgrade/report/export
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import {toast} from 'local_fastgrade/ui/toast';
import * as Table from 'local_fastgrade/report/table';
import * as Pivot from 'local_fastgrade/report/pivot';
import * as Tabs from 'local_fastgrade/report/tabs';

/**
 * A file name for this report.
 *
 * @param {Object} app
 * @param {string} what
 * @returns {string}
 */
const filename = (app, what) => `${app.meta.name} - ${what} - ${new Date().toISOString().slice(0, 10)}`
    .replace(/[\\/:*?"<>|]+/g, '-');

/**
 * Send a table to the server to turn into a spreadsheet.
 *
 * @param {Object} app
 * @param {Object} data {columns, rows}
 * @param {string} format excel, ods, csv
 * @param {string} name
 */
const post = (app, data, format, name) => {
    const frame = h('iframe', {name: 'fg-rp-dl', hidden: true, title: name});
    const form = h('form', {method: 'post', action: app.boot.wwwroot + '/local/fastgrade/export.php', target: 'fg-rp-dl',
        hidden: true},
    ['id', 'format', 'filename', 'sesskey', 'table'].map(n => h('input', {type: 'hidden', name: n, value: {
        id: app.meta.cmid, format, filename: name, sesskey: M.cfg.sesskey, table: JSON.stringify(data)}[n]})));
    document.body.append(frame, form);
    form.submit();
    setTimeout(() => {
        form.remove();
        frame.remove();
    }, 60000);
    toast(t('rp_ex_started'), {type: 'info'});
};

/**
 * Download a file made in the browser.
 *
 * @param {string} name
 * @param {string} type
 * @param {string} content
 */
const save = (name, type, content) => {
    const blob = new Blob([content], {type});
    const url = URL.createObjectURL(blob);
    const a = h('a', {href: url, download: name});
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
};

/**
 * CSV text (with a byte order mark so Excel reads accents correctly).
 *
 * @param {Object} data
 * @returns {string}
 */
const csv = data => '﻿' + [data.columns].concat(data.rows).map(r => r.map(v => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}).join(',')).join('\r\n');

/**
 * Export the student table.
 *
 * @param {Object} app
 * @param {string} format
 */
export const table = (app, format) => {
    const data = Table.data(app);
    const name = filename(app, t('rp_tab_students'));
    if (format === 'csv') {
        save(name + '.csv', 'text/csv;charset=utf-8', csv(data));
        return;
    }
    post(app, data, format, name);
};

/**
 * Export the pivot.
 *
 * @param {Object} app
 * @param {string} format
 */
export const pivot = (app, format) => {
    const data = Pivot.data(app);
    const name = filename(app, t('rp_tab_pivot'));
    if (format === 'csv') {
        save(name + '.csv', 'text/csv;charset=utf-8', csv(data));
        return;
    }
    post(app, data, format, name);
};

/**
 * Export everything as JSON (for other tools).
 *
 * @param {Object} app
 */
export const json = app => {
    save(filename(app, 'data') + '.json', 'application/json', JSON.stringify({activity: app.meta, filters: app.snapshot(),
        rows: app.current}, null, 2));
};

/**
 * Print or save as PDF: a cover, then every section, laid out for A4.
 *
 * @param {Object} app
 */
export const print = app => {
    const ctx = app.ctx();
    const filters = Object.entries(app.state.filters).filter(([, v]) => v && v.length).map(([k, v]) => {
        const d = app.F.dims.find(x => x.key === k);
        return d ? `${d.label}: ${v.length} ${t('rp_selected')}` : '';
    }).filter(Boolean);
    const tabs = app.tabs().map(x => x[0]).filter(k => !['students', 'pivot'].includes(k));
    const doc = h('div.fg-rp-print', {'aria-hidden': 'true'},
        h('section.fg-rp-cover', null,
            h('p.fg-rp-cover-brand', null, 'Fast Grade'),
            h('h1', null, app.meta.name),
            h('p', null, t('rp_subtitle', {course: app.meta.course, time: new Date().toLocaleString()})),
            h('p', null, t('rp_showing', {n: app.current.length, total: app.all.length}) + ' · ' +
                t(app.state.versions === 'all' ? 'rp_allversions' : 'rp_latestonly')),
            filters.length ? h('p', null, t('rp_filters') + ': ' + filters.join('; ')) : null),
        tabs.map(k => h('section.fg-rp-printsec', null, h('h1', null, app.tabs().find(x => x[0] === k)[1]), Tabs.render(k, ctx))),
        h('section.fg-rp-printsec', null, h('h1', null, t('rp_tab_pivot')), Pivot.render(ctx)));
    app.root.append(doc);
    document.body.classList.add('fg-printing');
    const done = () => {
        document.body.classList.remove('fg-printing');
        doc.remove();
        window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 120);
};
