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
 * Audio and video submissions with comments pinned to a moment.
 *
 * @module     local_fastgrade/viewer/media
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {h, icon, replace} from 'local_fastgrade/lib/dom';
import {t} from 'local_fastgrade/lib/str';
import {tip} from 'local_fastgrade/ui/tooltip';
import Annotator from 'local_fastgrade/annotate/controller';

const clock = s => {
    s = Math.max(0, Math.floor(s));
    const m = Math.floor(s / 60);
    return `${m}:${String(s % 60).padStart(2, '0')}`;
};

export default class MediaViewer {
    /**
     * Constructor.
     *
     * @param {Object} app
     * @param {Object} doc
     * @param {Object} host
     */
    constructor(app, doc, host) {
        this.app = app;
        this.doc = doc;
        this.host = host;
        this.docref = doc.docref;
        this.supportsMarks = true;
        this.supportsDrawing = false;
        const tag = doc.kind === 'video' ? 'video' : 'audio';
        this.media = h(tag + '.fg-media', {src: doc.url, controls: true, preload: 'metadata'});
        this.track = h('div.fg-timeline', {'aria-label': t('timeline')});
        this.marginEl = h('div.fg-margin.is-list', {'aria-label': t('comments')});
        this.here = h('span.fg-media-time', null, '0:00');
        const btn = (cls, ic, label, tiptext, kind) => tip(h('button.fg-btn.is-small', {type: 'button', "class": cls,
            onclick: () => this.commentHere(kind)}, icon(ic, 'fg-i-sm'), label), tiptext);
        this.el = h('div.fg-viewer.is-media', null,
            h('div.fg-doc-scroll', null,
                h('div.fg-media-wrap', null, this.media, this.track,
                    h('div.fg-media-actions', null, h('span.fg-small.fg-muted', null, t('commentat')), this.here,
                        btn('is-improvement', 'mic', t('pol_improvement'), t('media_improvement_tip'), 'improvement'),
                        btn('is-positive', 'mic', t('pol_positive'), t('media_positive_tip'), 'positive'),
                        btn('', 'comment', t('comment'), t('media_comment_tip'), 'comment'))),
                h('div.fg-paper.is-media', null, this.marginEl)));
    }

    /**
     * Load.
     */
    async load() {
        this.annotator = new Annotator(this.app, this);
        this.media.addEventListener('timeupdate', () => {
            this.here.textContent = clock(this.media.currentTime);
        });
        this.media.addEventListener('loadedmetadata', () => this.renderMarks());
        this.annotator.refresh();
    }

    /**
     * Comment at the current time.
     *
     * @param {string} kind
     */
    commentHere(kind) {
        const at = this.media.currentTime || 0;
        this.media.pause();
        this.current = {anchor: {t: Math.round(at * 10) / 10, exact: clock(at)}, page: 0, rect: this.media.getBoundingClientRect()};
        this.annotator.fromSelection(kind);
        this.current = null;
    }

    /**
     * Selection (the pending time).
     *
     * @returns {Object|null}
     */
    selectionInfo() {
        return this.current || null;
    }

    /**
     * Timeline markers.
     */
    renderMarks() {
        const dur = this.media.duration || 0;
        replace(this.track, this.app.annotations.forDoc(this.docref).map(a => {
            const pos = dur ? Math.min(100, (a.anchor.t / dur) * 100) : 0;
            return tip(h('button.fg-tl-mark', {type: 'button', "class": 'is-' + a.polarity, style: {left: pos + '%'},
                onclick: () => this.focusMark(a.clientid)}), `${clock(a.anchor.t)} · ${a.comment || ''}`);
        }));
    }

    /**
     * Cards in time order.
     *
     * @param {Object} a
     * @returns {number}
     */
    cardTop(a) {
        return (a.anchor && a.anchor.t ? a.anchor.t : 0) / 1000;
    }

    /**
     * Hover.
     */
    hoverMark() {
        // Timeline markers have their own tooltips.
    }

    /**
     * Seek to a comment.
     *
     * @param {string} id
     */
    focusMark(id) {
        const a = this.app.annotations.get(id);
        if (a && a.anchor) {
            this.media.currentTime = a.anchor.t;
            this.annotator.cards.select(id);
        }
    }

    /**
     * Clean up.
     */
    destroy() {
        this.media.pause();
        if (this.annotator) {
            this.annotator.destroy();
        }
    }
}
