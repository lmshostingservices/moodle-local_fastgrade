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
 * Document area: one tab per submitted file or text, the right viewer for each, and the
 * annotation toolbar.
 *
 * @module     local_fastgrade/viewer/host
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon, replace} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import {tip} from 'local_fastgrade/ui/tooltip';
import * as Shortcuts from 'local_fastgrade/ui/shortcuts';
import * as Api from 'local_fastgrade/lib/api';
import {toast} from 'local_fastgrade/ui/toast';
import TextViewer from 'local_fastgrade/viewer/text';
import PdfViewer from 'local_fastgrade/viewer/pdf';
import SheetViewer from 'local_fastgrade/viewer/sheet';
import MediaViewer from 'local_fastgrade/viewer/media';
import CodeViewer from 'local_fastgrade/viewer/code';
import ZipViewer from 'local_fastgrade/viewer/zip';
import * as Export from 'local_fastgrade/annotate/export';

const KINDICON = {text: 'filetext', pdf: 'file', office: 'filetext', slides: 'slides', sheet: 'sheet', image: 'image',
    audio: 'media', video: 'media', code: 'code', zip: 'file', other: 'file'};

export const TOOLS = [
    ['select', 'select', 'Esc'], ['area', 'area', 'Q'], ['pen', 'pen', 'D'], ['rect', 'rect', 'R'], ['ellipse', 'ellipse', 'O'],
    ['arrow', 'arrow', 'W'], ['text', 'text', 'T'], ['tick', 'check', '⇧ 1'], ['cross', 'x', '⇧ 2'], ['query', 'question', '⇧ 3'],
    ['eraser', 'eraser', 'E'],
];

export default class ViewerHost {
    /**
     * Constructor.
     *
     * @param {Object} app
     */
    constructor(app) {
        this.app = app;
        this.tabs = h('div.fg-doctabs', {role: 'tablist', 'aria-label': t('documents')});
        this.toolbar = h('div.fg-toolbar', {role: 'toolbar', 'aria-label': t('annotationtools')});
        this.stage = h('div.fg-stage');
        this.el = h('main.fg-docarea', {'aria-label': t('documents')},
            h('div.fg-docbar', null, this.tabs, this.toolbar), this.stage);
        this.viewer = null;
        this.doc = null;
        this.tool = 'select';
        this.colour = 'amber';
        this.pollers = [];
    }

    /**
     * Loading state.
     */
    loading() {
        this.destroyViewer();
        replace(this.tabs);
        replace(this.toolbar);
        replace(this.stage, h('div.fg-doc-loading', null, h('div.fg-spinner'), h('span', null, t('loadingsubmission'))));
    }

    /**
     * Empty state.
     *
     * @param {string} msg
     */
    empty(msg) {
        this.destroyViewer();
        replace(this.tabs);
        replace(this.toolbar);
        replace(this.stage, h('div.fg-doc-empty', null, icon('filetext', 'fg-i-xl'), h('p', null, msg)));
    }

    /**
     * Stop the current viewer.
     */
    destroyViewer() {
        this.pollers.forEach(p => clearTimeout(p));
        this.pollers = [];
        if (this.viewer) {
            this.viewer.destroy();
            this.viewer = null;
        }
    }

    /**
     * Show an item's documents.
     *
     * @param {Object} item
     */
    show(item) {
        this.item = item;
        const docs = item.docs || [];
        if (!docs.length) {
            this.empty(item.status === 'new' ? t('nosubmission') : t('nothingsubmitted'));
            return;
        }
        // Prefer the document with annotations, else the first.
        const withmarks = docs.find(d => item.annotations.some(a => a.docref === d.docref));
        this.renderTabs(docs);
        this.open(withmarks || docs[0]);
    }

    /**
     * Tabs.
     *
     * @param {Array} docs
     */
    renderTabs(docs) {
        const integ = (this.item.integrations || {}).docguard || {};
        replace(this.tabs, docs.map(d => {
            const count = this.item.annotations.filter(a => a.docref === d.docref && a.status !== 'rejected').length;
            const dg = d.docref.startsWith('file:') ? integ[d.docref.slice(5)] : null;
            const b = h('button.fg-doctab', {type: 'button', role: 'tab', dataset: {docref: d.docref},
                'aria-selected': String(this.doc && this.doc.docref === d.docref), onclick: () => this.open(d)},
            icon(KINDICON[d.kind] || 'file', 'fg-i-sm'), h('span.fg-doctab-name', null, d.filename),
            count ? h('span.fg-count', null, String(count)) : null,
            dg ? h('span.fg-dg-dot.fg-integrity', {"class": 'is-risk-' + dg.level}) : null);
            const tiptext = [d.filename, d.kind === 'text' ? t('nwords', d.wordcount) : t('kind_' + d.kind),
                dg ? t('dg_tip', {score: dg.score, level: t('risk_' + dg.level)}) : ''].filter(Boolean).join('\n');
            return tip(b, tiptext);
        }));
    }

    /**
     * Open a document.
     *
     * @param {Object} doc
     */
    async open(doc) {
        this.destroyViewer();
        this.doc = doc;
        this.tabs.querySelectorAll('.fg-doctab').forEach(b => b.setAttribute('aria-selected',
            String(b.dataset.docref === doc.docref)));
        let ViewerClass = null;
        let source = doc;
        switch (doc.kind) {
            case 'text': ViewerClass = TextViewer; break;
            case 'pdf': case 'image': ViewerClass = PdfViewer; break;
            case 'office': case 'slides':
                if (doc.conversion !== 'done') {
                    this.convert(doc);
                    return;
                }
                ViewerClass = PdfViewer;
                break;
            case 'sheet': ViewerClass = SheetViewer; break;
            case 'audio': case 'video': ViewerClass = MediaViewer; break;
            case 'code': ViewerClass = CodeViewer; break;
            case 'zip': ViewerClass = ZipViewer; break;
            default:
                replace(this.stage, h('div.fg-doc-empty', null, icon('file', 'fg-i-xl'), h('p', null, t('cannotpreview')),
                    h('a.fg-btn', {href: doc.downloadurl}, icon('download', 'fg-i-sm'), t('download'))));
                replace(this.toolbar);
                return;
        }
        replace(this.stage);
        this.viewer = new ViewerClass(this.app, source, this);
        this.renderToolbar();
        this.stage.appendChild(this.viewer.el);
        try {
            await this.viewer.load();
            this.autoCheck();
        } catch (e) {
            replace(this.stage, h('div.fg-doc-empty', null, icon('warning', 'fg-i-xl'), h('p', null, t('loadfailed')),
                h('p.fg-small.fg-muted', null, Api.message(e)),
                h('a.fg-btn', {href: doc.downloadurl || '#'}, icon('download', 'fg-i-sm'), t('download'))));
        }
    }

    /**
     * Run the auto-marking checks as soon as a document opens, once per document, so suggestions
     * are already waiting. Runs in the browser on text already loaded: no server round trip.
     */
    autoCheck() {
        const app = this.app;
        const v = this.viewer;
        if (app.readonly || !app.boot.autograde || !v || !v.supportsMarks || (!v.plainText && !v.pagesText)) {
            return;
        }
        if (app.batch || !app.panel.auto.hasRules(app.store.get('item'))) {
            return;
        }
        const item = app.store.get('item') || {};
        const already = [...app.annotations.items.values()].some(a => a.docref === v.docref && a.source === 'auto');
        const gs = item.gradestate || {};
        const marked = gs.grade !== null && gs.grade !== undefined && gs.grade !== '';
        // Suggestions with no draft behind them (the marker left before it saved): run again so the marks fill in too.
        if (already && (item.draft || marked)) {
            return;
        }
        const run = () => {
            if (this.viewer === v) {
                app.panel.auto.run(true);
            }
        };
        if (window.requestIdleCallback) {
            window.requestIdleCallback(run, {timeout: 600});
        } else {
            setTimeout(run, 50);
        }
    }

    /**
     * Open a document and wait until it is ready to read, converting Word and PowerPoint files first.
     * Used by auto-mark all.
     *
     * @param {Object} doc
     * @returns {Promise<boolean>} whether a viewer with text is ready
     */
    async openAndWait(doc) {
        if ((doc.kind === 'office' || doc.kind === 'slides') && doc.conversion !== 'done') {
            const started = Date.now();
            for (;;) {
                const r = await Api.call('convert_file', {cmid: this.app.cmid, fileid: doc.fileid, retry: false});
                if (r.status === 'done') {
                    doc.conversion = 'done';
                    doc.pdfurl = r.pdfurl;
                    break;
                }
                if (r.status === 'failed' || r.status === 'unsupported' || Date.now() - started > 90000) {
                    return false;
                }
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }
        await this.open(doc);
        const v = this.viewer;
        return !!(this.doc === doc && v && v.supportsMarks && (v.plainText || v.pagesText));
    }

    /**
     * Convert an office file, then open it.
     *
     * @param {Object} doc
     * @param {boolean} retry
     */
    async convert(doc, retry = false) {
        replace(this.toolbar);
        const status = h('p', null, t('converting', doc.filename));
        replace(this.stage, h('div.fg-doc-loading', null, h('div.fg-spinner'), status,
            h('a.fg-btn.is-small.is-ghost', {href: doc.downloadurl}, icon('download', 'fg-i-sm'), t('download'))));
        const started = Date.now();
        const poll = async(first) => {
            if (this.doc !== doc) {
                return;
            }
            try {
                const r = await Api.call('convert_file', {cmid: this.app.cmid, fileid: doc.fileid, retry: first && retry});
                if (r.status === 'done') {
                    doc.conversion = 'done';
                    doc.pdfurl = r.pdfurl;
                    this.open(doc);
                    return;
                }
                if (r.status === 'failed' || r.status === 'unsupported') {
                    doc.conversion = r.status;
                    replace(this.stage, h('div.fg-doc-empty', null, icon('warning', 'fg-i-xl'),
                        h('p', null, r.status === 'unsupported' ? t('noconverter') : t('conversionfailed')),
                        h('div.fg-row-actions', null,
                            r.status === 'failed' ? h('button.fg-btn', {type: 'button', onclick: () => this.convert(doc, true)},
                                icon('rotate', 'fg-i-sm'), t('retry')) : null,
                            h('a.fg-btn', {href: doc.downloadurl}, icon('download', 'fg-i-sm'), t('download')))));
                    return;
                }
                if (Date.now() - started > 120000) {
                    status.textContent = t('conversionslow');
                }
                this.pollers.push(setTimeout(() => poll(false), 2000));
            } catch (e) {
                toast(Api.message(e), {type: 'error'});
            }
        };
        poll(true);
    }

    /**
     * Annotation toolbar for the current viewer.
     */
    renderToolbar() {
        const v = this.viewer;
        const bits = [];
        const ro = !!this.app.readonly;
        if (v && v.supportsDrawing && !ro) {
            bits.push(h('div.fg-tools', {role: 'group', 'aria-label': t('drawingtools')}, TOOLS.map(([id, ic, key]) => tip(
                h('button.fg-tool', {type: 'button', 'aria-pressed': String(this.tool === id), dataset: {tool: id},
                    onclick: () => this.setTool(id)}, icon(ic)), t('tool_' + id + '_tip'), key))));
            bits.push(h('div.fg-colours', {role: 'radiogroup', 'aria-label': t('colour')}, ['amber', 'green', 'blue',
                'ink'].map(c =>
                tip(h('button.fg-swatch', {type: 'button', role: 'radio', 'aria-checked': String(this.colour === c),
                    "class": 'is-' + c, onclick: () => {
                        this.colour = c;
                        this.renderToolbar();
                    }}), t('colour_' + c)))));
        }
        if (v && v.supportsMarks && !ro) {
            bits.push(h('span.fg-tb-hint', null, icon('info', 'fg-i-xs'), t('selecthint')));
        }
        bits.push(h('span.fg-grow'));
        if (v && v.supportsMarks && !ro) {
            bits.push(tip(h('button.fg-icon-btn', {type: 'button', onclick: () => this.app.annotations.undo()}, icon('undo')),
                t('undo'), Shortcuts.label('mod+z')));
            bits.push(tip(h('button.fg-icon-btn', {type: 'button', onclick: () => this.app.annotations.redo()}, icon('redo')),
                t('redo'), Shortcuts.label('mod+shift+z')));
        }
        if (v && v.zoom) {
            bits.push(h('span.fg-sep'));
            bits.push(tip(h('button.fg-icon-btn', {type: 'button', onclick: () => v.zoom(-1)}, icon('zoomout')),
                t('zoomout'), '-'));
            bits.push(v.zoomLabel || null);
            bits.push(tip(h('button.fg-icon-btn', {type: 'button', onclick: () => v.zoom(1)}, icon('zoomin')), t('zoomin'), '+'));
            bits.push(tip(h('button.fg-icon-btn', {type: 'button', onclick: () => v.zoom(0)}, icon('fit')), t('fitwidth'), '0'));
        }
        if (v && v.search) {
            bits.push(tip(h('button.fg-icon-btn', {type: 'button', onclick: () => v.search()}, icon('search')), t('find'),
                Shortcuts.label('mod+f')));
        }
        if (v && v.supportsMarks && (this.doc.pdfurl || this.doc.kind === 'text')) {
            bits.push(tip(h('button.fg-icon-btn', {type: 'button', onclick: () => Export.download(this.app, this)},
                icon('send')), t('downloadannotated_tip')));
        }
        if (this.doc && this.doc.downloadurl) {
            bits.push(tip(h('a.fg-icon-btn', {href: this.doc.downloadurl}, icon('download')), t('downloadoriginal')));
        }
        replace(this.toolbar, bits);
    }

    /**
     * Choose a drawing tool.
     *
     * @param {string} id
     */
    setTool(id) {
        this.tool = id;
        this.toolbar.querySelectorAll('.fg-tool').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tool === id)));
        if (this.viewer && this.viewer.setTool) {
            this.viewer.setTool(id);
        }
    }

    /**
     * In-document find bar.
     */
    openFind() {
        if (this.findbar) {
            this.findbar.querySelector('input').focus();
            return;
        }
        const input = h('input.fg-input', {type: 'search', placeholder: t('find'), 'aria-label': t('find')});
        const close = () => {
            this.findbar.remove();
            this.findbar = null;
        };
        input.addEventListener('keydown', async e => {
            if (e.key === 'Enter' && input.value.trim() && this.viewer && this.viewer.findText) {
                e.preventDefault();
                const last = this.viewer.lastFind;
                const from = last && last.words === input.value.trim() ? last.page : 0;
                const ok = await this.viewer.findText(input.value.trim(), from);
                input.classList.toggle('is-invalid', !ok);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close();
            }
        });
        this.findbar = h('div.fg-findbar', null, icon('search', 'fg-i-sm'), input,
            h('button.fg-icon-btn.is-small', {type: 'button', 'aria-label': t('close'), onclick: close}, icon('x')));
        this.el.appendChild(this.findbar);
        input.focus();
    }

    /**
     * Find words in a document (used by integrity findings).
     *
     * @param {string} docref
     * @param {string} words
     */
    async find(docref, words) {
        const doc = (this.item.docs || []).find(d => d.docref === docref);
        if (!doc) {
            return;
        }
        if (!this.doc || this.doc.docref !== docref) {
            await this.open(doc);
        }
        if (this.viewer && this.viewer.findText) {
            const found = await this.viewer.findText(words);
            if (!found) {
                toast(t('notfoundindoc'), {type: 'info'});
            }
        }
    }

    /**
     * Viewer shortcuts.
     */
    registerShortcuts() {
        const a = t('sc_annotate');
        const has = () => this.viewer && this.viewer.annotator;
        const sel = kind => () => (has() ? this.viewer.annotator.fromSelection(kind) : false);
        Shortcuts.add('i', sel('improvement'), {group: a, label: t('sc_improvement'), when: has});
        Shortcuts.add('p', sel('positive'), {group: a, label: t('sc_positive'), when: has});
        Shortcuts.add('c', sel('comment'), {group: a, label: t('sc_comment'), when: has});
        Shortcuts.add('h', sel('highlight'), {group: a, label: t('sc_highlight'), when: has});
        Shortcuts.add('u', sel('underline'), {group: a, label: t('sc_underline'), when: has});
        Shortcuts.add('s', sel('strike'), {group: a, label: t('sc_strike'), when: has});
        Shortcuts.add('#', sel('bank'), {group: a, label: t('sc_bankonselection'), when: has});
        Shortcuts.add('shift+3', sel('bank'), {hidden: true, when: has});
        Shortcuts.add('mod+z', () => this.app.annotations && this.app.annotations.undo(), {group: a, label: t('undo')});
        Shortcuts.add('mod+shift+z', () => this.app.annotations && this.app.annotations.redo(), {group: a, label: t('redo')});
        Shortcuts.add('mod+y', () => this.app.annotations && this.app.annotations.redo(), {hidden: true});
        const selected = () => has() && this.viewer.annotator.selectedAnnotation();
        Shortcuts.add('a', () => {
            const s = selected();
            if (s && s.status === 'suggested') {
                this.viewer.annotator.accept(s);
                return true;
            }
            return false;
        }, {group: a, label: t('sc_accept'), when: () => !!selected()});
        Shortcuts.add('x', () => {
            const s = selected();
            if (s && s.status === 'suggested') {
                this.viewer.annotator.reject(s);
                return true;
            }
            return false;
        }, {group: a, label: t('sc_reject'), when: () => !!selected()});
        Shortcuts.add('e', () => {
            const s = selected();
            if (s) {
                this.viewer.annotator.cards.edit(s.clientid);
                return true;
            }
            if (this.viewer && this.viewer.supportsDrawing) {
                this.setTool('eraser');
                return true;
            }
            return false;
        }, {group: a, label: t('sc_edit')});
        Shortcuts.add('delete', () => {
            const s = selected();
            if (s) {
                this.viewer.annotator.remove(s);
                return true;
            }
            return false;
        }, {group: a, label: t('delete'), when: () => !!selected()});
        Shortcuts.add('backspace', () => {
            const s = selected();
            if (s) {
                this.viewer.annotator.remove(s);
                return true;
            }
            return false;
        }, {hidden: true, when: () => !!selected()});
        const tool = id => () => {
            if (this.viewer && this.viewer.supportsDrawing) {
                this.setTool(id);
                return true;
            }
            return false;
        };
        const tg = t('sc_tools');
        TOOLS.forEach(([id, , key]) => {
            if (key === 'E' || key === 'Esc') {
                return;
            }
            const combo = key.startsWith('⇧') ? 'shift+' + key.slice(2) : key.toLowerCase();
            Shortcuts.add(combo, tool(id), {group: tg, label: t('tool_' + id)});
        });
        Shortcuts.add('escape', () => {
            if (this.viewer && this.viewer.annotator && this.viewer.annotator.pill) {
                this.viewer.annotator.hidePill();
                return true;
            }
            if (this.tool !== 'select' && this.viewer && this.viewer.supportsDrawing) {
                this.setTool('select');
                return true;
            }
            return false;
        }, {hidden: true});
        const zoom = d => () => (this.viewer && this.viewer.zoom ? (this.viewer.zoom(d), true) : false);
        Shortcuts.add('+', zoom(1), {group: t('sc_view'), label: t('zoomin')});
        Shortcuts.add('=', zoom(1), {hidden: true});
        Shortcuts.add('-', zoom(-1), {group: t('sc_view'), label: t('zoomout')});
        Shortcuts.add('0', zoom(0), {group: t('sc_view'), label: t('fitwidth')});
        Shortcuts.add('mod+f', () => (this.viewer && this.viewer.search ? (this.viewer.search(), true) : false),
            {group: t('sc_view'), label: t('find')});
    }
}
