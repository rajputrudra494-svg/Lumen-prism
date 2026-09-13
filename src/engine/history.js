/* =============================================================================
 * Lumen Path - src/engine/history.js
 * -----------------------------------------------------------------------------
 * Undo / redo.
 *
 * Snapshots are whole-scene captures of the mutable state (every player-placed
 * object plus the inventory tally). That is a few hundred bytes per step even
 * on the busiest level, which is cheap enough that command-pattern deltas would
 * be false economy -- and snapshots are immune to the class of bug where an
 * inverse operation does not quite undo its forward operation.
 *
 * COALESCING. A drag fires a snapshot request on every pointer-down, but a
 * continuous gesture should undo as one step. `push` therefore ignores a
 * snapshot identical to the top of the stack, and callers push BEFORE mutating
 * so the stack always holds the state to return to.
 * ========================================================================== */
(function (LP) {
  'use strict';

  var Sc = LP.Scene;

  function create(scene, limit) {
    return {
      scene: scene,
      undoStack: [],
      redoStack: [],
      limit: limit || 60,
      suspended: false
    };
  }

  function sig(snap) {
    /* Cheap structural signature -- enough to spot a no-op push. */
    var s = snap.inv.join(',') + '|';
    for (var i = 0; i < snap.els.length; i++) {
      var e = snap.els[i];
      s += e.type + ':' + Math.round(e.x) + ',' + Math.round(e.y) + ',' +
           (e.angle || 0).toFixed(3) + ',' + (e.length || e.radius || e.w || 0).toFixed(1) +
           ',' + (e.curvature || 0).toFixed(3) + ',' + (e.ratio || 0).toFixed(2) + ';';
    }
    return s;
  }

  function push(h) {
    if (h.suspended) return;
    var snap = Sc.snapshot(h.scene);
    var top = h.undoStack[h.undoStack.length - 1];
    if (top && sig(top) === sig(snap)) return;      /* nothing actually changed */
    h.undoStack.push(snap);
    if (h.undoStack.length > h.limit) h.undoStack.shift();
    h.redoStack.length = 0;                          /* a new branch */
  }

  function undo(h) {
    if (!h.undoStack.length) return false;
    var current = Sc.snapshot(h.scene);
    var prev = h.undoStack.pop();
    /* If the top of the stack is where we already are, step back one further:
     * this happens when a gesture pushed its "before" state and then ended
     * without changing anything meaningful. */
    if (sig(prev) === sig(current)) {
      if (!h.undoStack.length) return false;
      prev = h.undoStack.pop();
    }
    h.redoStack.push(current);
    h.suspended = true;
    Sc.restore(h.scene, prev);
    h.suspended = false;
    return true;
  }

  function redo(h) {
    if (!h.redoStack.length) return false;
    var next = h.redoStack.pop();
    h.undoStack.push(Sc.snapshot(h.scene));
    h.suspended = true;
    Sc.restore(h.scene, next);
    h.suspended = false;
    return true;
  }

  function clear(h) {
    h.undoStack.length = 0;
    h.redoStack.length = 0;
  }

  function canUndo(h) { return h.undoStack.length > 0; }
  function canRedo(h) { return h.redoStack.length > 0; }

  LP.History = {
    create: create,
    push: push,
    undo: undo,
    redo: redo,
    clear: clear,
    canUndo: canUndo,
    canRedo: canRedo
  };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
