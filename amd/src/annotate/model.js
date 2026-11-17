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
 * Annotations for the open student: in-memory model, undo/redo, and autosave.
 *
 * @module     local_fastgrade/annotate/model
 * @copyright  2026 LMS Hosting Services / LMS Labs
 * @license    http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import {debounce, uid} from 'local_fastgrade/lib/dom';
import * as Api from 'local_fastgrade/lib/api';
import * as Rotate from 'local_fastgrade/annotate/rotate';

const clone = o => (o ? JSON.parse(JSON.stringify(o)) : o);

export default class AnnotationModel {
    /**
     * Constructor.
     *
     * @param {Object} app
     * @param {Object} entry
     * @param {Object} item
     */
    constructor(app, entry, item) {
        this.app = app;
        this.entry = entry;
        this.item = item;
        this.items = new Map();
        (item.annotations || []).forEach(a => this.items.set(a.clientid, a));
        this.dirty = new Set();
        this.deleted = new Set();
        this.meta = {};
        this.listeners = new Set();
        this.undoStack = [];
        this.redoStack = [];
        this.saving = null;
        // How each document is shown: {docref: {rot: {page: degrees}}}. Saved with the marks.
        this.views = clone(item.views && typeof item.views === 'object' && !Array.isArray(item.views) ? item.views : {});
        this.viewDirty = new Set();
        this.queue = debounce(() => this.flush(), 700);
    }

    /**
     * How far a page is turned clockwise (0, 90, 180 or 270).
     *
     * @param {string} docref
     * @param {number} page 1-based
     * @returns {number}
     */
    rotation(docref, page) {
        const v = this.views[docref];
        return v && v.rot ? Rotate.norm(v.rot[page] || 0) : 0;
    }

    /**
     * Turn a page and move its marks (and the undo history for them) so they stay on the same spot.
     * The turn and the moved marks are saved together.
     *
     * @param {string} docref
     * @param {number} page 1-based
     * @param {number} delta degrees clockwise: 90, -90 or 180
     * @param {number} w page width before turning, in page units
     * @param {number} hgt page height before turning, in page units
     * @returns {number} the new rotation
     */
    turn(docref, page, delta, w, hgt) {
        const step = Rotate.norm(delta);
        const now = Rotate.norm(this.rotation(docref, page) + step);
        if (!step) {
            return now;
        }
        const move = a => a && a.docref === docref && (a.page || 1) === page;
        this.items.forEach(a => {
            if (move(a) && a.anchor) {
                a.anchor = Rotate.anchor(a.anchor, step, w, hgt);
                this.dirty.add(a.clientid);
                this.deleted.delete(a.clientid);
            }
        });
        const fix = a => {
            if (move(a) && a.anchor) {
                a.anchor = Rotate.anchor(a.anchor, step, w, hgt);
            }
        };
        this.undoStack.concat(this.redoStack).forEach(op => {
            fix(op.before);
            fix(op.after);
        });
        const v = this.views[docref] || (this.views[docref] = {});
        v.rot = Object.assign({}, v.rot || {});
        if (now) {
            v.rot[page] = now;
        } else {
            delete v.rot[page];
        }
        this.viewDirty.add(docref);
        this.queue();
        this.emit('view', {docref, page});
        return now;
    }

    /**
     * Listen for changes.
     *
     * @param {Function} fn (reason, annotation)
     * @returns {Function}
     */
    on(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    }

    /**
     * Notify.
     *
     * @param {string} reason
     * @param {Object} a
     */
    emit(reason, a) {
        this.listeners.forEach(fn => {
            try {
                fn(reason, a);
            } catch (e) {
                window.console.error(e);
            }
        });
    }

    /**
     * Annotations for one document (not rejected).
     *
     * @param {string} docref
     * @returns {Array}
     */
    forDoc(docref) {
        return [...this.items.values()].filter(a => a.docref === docref && a.status !== 'rejected');
    }

    /**
     * All live annotations.
     *
     * @returns {Array}
     */
    all() {
        return [...this.items.values()].filter(a => a.status !== 'rejected');
    }

    /**
     * Get one.
     *
     * @param {string} id
     * @returns {Object|undefined}
     */
    get(id) {
        return this.items.get(id);
    }

    /**
     * Create an annotation.
     *
     * @param {Object} a
     * @param {Object} meta
     * @returns {Object}
     */
    create(a, meta = null) {
        const full = Object.assign({
            clientid: uid(),
            page: 0,
            polarity: 'neutral',
            comment: '',
            source: 'typed',
            status: 'active',
            criterionid: 0,
            style: null,
            authorid: this.app.boot.me.id,
            timemodified: Math.floor(Date.now() / 1000),
        }, a);
        this.items.set(full.clientid, full);
        this.touch(full.clientid, meta);
        this.push({type: 'create', after: clone(full)});
        this.emit('create', full);
        return full;
    }

    /**
     * Change an annotation.
     *
     * @param {string} id
     * @param {Object} changes
     * @param {Object} meta
     * @param {boolean} record add to undo history
     */
    update(id, changes, meta = null, record = true) {
        const a = this.items.get(id);
        if (!a) {
            return;
        }
        const before = clone(a);
        Object.assign(a, changes, {timemodified: Math.floor(Date.now() / 1000)});
        this.touch(id, meta);
        if (record) {
            this.push({type: 'update', before, after: clone(a)});
        }
        this.emit('update', a);
    }

    /**
     * Delete an annotation.
     *
     * @param {string} id
     */
    remove(id) {
        const a = this.items.get(id);
        if (!a) {
            return;
        }
        this.items.delete(id);
        this.dirty.delete(id);
        this.deleted.add(id);
        this.push({type: 'delete', before: clone(a)});
        this.emit('delete', a);
        this.queue();
    }

    /**
     * Mark for saving.
     *
     * @param {string} id
     * @param {Object} meta
     */
    touch(id, meta) {
        this.dirty.add(id);
        this.deleted.delete(id);
        if (meta) {
            this.meta[id] = meta;
        }
        this.queue();
    }

    /**
     * Add to undo history.
     *
     * @param {Object} op
     */
    push(op) {
        this.undoStack.push(op);
        if (this.undoStack.length > 200) {
            this.undoStack.shift();
        }
        this.redoStack = [];
    }

    /**
     * Undo the last change.
     *
     * @returns {boolean}
     */
    undo() {
        const op = this.undoStack.pop();
        if (!op) {
            return false;
        }
        this.apply(op, true);
        this.redoStack.push(op);
        return true;
    }

    /**
     * Redo.
     *
     * @returns {boolean}
     */
    redo() {
        const op = this.redoStack.pop();
        if (!op) {
            return false;
        }
        this.apply(op, false);
        this.undoStack.push(op);
        return true;
    }

    /**
     * Apply an operation forwards or backwards.
     *
     * @param {Object} op
     * @param {boolean} reverse
     */
    apply(op, reverse) {
        const restore = a => {
            this.items.set(a.clientid, clone(a));
            this.touch(a.clientid);
            this.emit('update', this.items.get(a.clientid));
        };
        const drop = a => {
            this.items.delete(a.clientid);
            this.dirty.delete(a.clientid);
            this.deleted.add(a.clientid);
            this.emit('delete', a);
            this.queue();
        };
        if (op.type === 'create') {
            if (reverse) {
                drop(op.after);
            } else {
                restore(op.after);
            }
        } else if (op.type === 'delete') {
            if (reverse) {
                restore(op.before);
            } else {
                drop(op.before);
            }
        } else {
            restore(reverse ? op.before : op.after);
        }
    }

    /**
     * Whether changes are waiting.
     *
     * @returns {boolean}
     */
    pending() {
        return this.dirty.size > 0 || this.deleted.size > 0 || this.viewDirty.size > 0;
    }

    /**
     * Save now.
     *
     * @returns {Promise}
     */
    async flush() {
        this.queue.cancel();
        if (this.saving) {
            await this.saving.catch(() => null);
        }
        if (!this.pending()) {
            return;
        }
        const upserts = [...this.dirty].map(id => this.items.get(id)).filter(Boolean);
        const deletes = [...this.deleted];
        const meta = {};
        upserts.forEach(a => {
            if (this.meta[a.clientid]) {
                meta[a.clientid] = this.meta[a.clientid];
            }
        });
        const bankused = this.app.annotationsBankUsed ? [...this.app.annotationsBankUsed] : [];
        this.app.annotationsBankUsed = new Set();
        const views = {};
        this.viewDirty.forEach(d => {
            views[d] = clone(this.views[d] || {});
        });
        const viewed = [...this.viewDirty];
        this.dirty.clear();
        this.deleted.clear();
        this.viewDirty.clear();
        const store = this.app.store;
        if (store.get('savestate') !== 'saving') {
            store.set({savestate: 'saving'});
        }
        this.saving = Api.call('save_annotations', {cmid: this.app.cmid, userid: this.entry.person.id,
            attempt: this.item.attempt, slot: this.entry.slot || 0, data: {upserts, deletes, meta, bankused, views}});
        try {
            await this.saving;
            upserts.forEach(a => delete this.meta[a.clientid]);
            store.set({savestate: store.get('dirty') ? 'draft' : 'saved'});
        } catch (e) {
            // Put them back to try again.
            upserts.forEach(a => this.dirty.add(a.clientid));
            deletes.forEach(d => this.deleted.add(d));
            viewed.forEach(d => this.viewDirty.add(d));
            store.set({savestate: navigator.onLine ? 'error' : 'offline'});
            if (navigator.onLine) {
                setTimeout(() => this.queue(), 5000);
            }
        } finally {
            this.saving = null;
        }
    }
}
