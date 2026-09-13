/* =============================================================================
 * Lumen Path - src/engine/input.js
 * -----------------------------------------------------------------------------
 * Pointer, touch and keyboard handling.
 *
 * Everything the player can do to an object is here: place it, drag it, spin
 * it, stretch it, flex it, and take it away again. Pointer Events are used
 * throughout so mouse, pen and touch share one code path; the only place touch
 * needs its own handling is the two-finger pinch/twist gesture, which has no
 * mouse equivalent.
 *
 * INTERACTION MODEL
 *   - click an object to select it; handles appear around it
 *   - drag the body to move (subject to the level's placement zones)
 *   - drag the rotate handle to spin, with Shift snapping to 15 degrees and
 *     Ctrl/Cmd to 45; free rotation otherwise
 *   - drag either end handle, or scroll over the object, to resize
 *   - drag the curve handle (flex mirrors and lenses) to change curvature
 *   - two-finger pinch resizes and two-finger twist rotates, on touch
 *   - arrow keys nudge, [ and ] rotate by one degree for fine work
 * ========================================================================== */
(function (LP) {
  'use strict';

  var V = LP.V, M = LP.M, E = LP.Elements, Sc = LP.Scene, R = LP.Renderer;

  var HANDLE_RADIUS = 22;      /* world units of grab tolerance */
  var BODY_TOLERANCE = 20;

  function attach(canvas, host) {
    var input = {
      canvas: canvas,
      host: host,               /* { renderer, scene, onChange, onSelect, ... } */
      selected: null,
      activeHandle: null,
      dragging: false,
      dragOffset: { x: 0, y: 0 },
      placingType: null,        /* set while dragging out of the inventory tray */
      ghost: null,
      pointers: {},             /* active pointer id -> world position */
      pinch: null,
      preview: null,
      lastTapTime: 0,
      snapMode: null,
      enabled: true
    };

    function world(ev) { return R.eventToWorld(host.renderer, ev.clientX, ev.clientY); }
    function scene() { return host.scene(); }
    function changed(structural) { host.onChange(structural); }

    /* ------------------------------------------------------------------ *
     * Hit testing
     * ------------------------------------------------------------------ */
    function handleAt(p) {
      if (!input.selected) return null;
      var hs = E.handles(input.selected);
      var best = null, bestD = HANDLE_RADIUS;
      for (var i = 0; i < hs.length; i++) {
        var d = V.dist(p, hs[i].p);
        if (d < bestD) { bestD = d; best = hs[i]; }
      }
      return best;
    }

    function elementAt(p) {
      var sc = scene();
      var best = null, bestD = BODY_TOLERANCE;
      for (var i = sc.elements.length - 1; i >= 0; i--) {
        var el = sc.elements[i];
        if (el.isWall || el.type === 'emitter') continue;
        if (el.type === 'receiver') continue;
        if (el.locked && !el.adjustable) continue;
        var d = E.distanceTo(el, p);
        if (d < bestD) { bestD = d; best = el; }
      }
      return best;
    }

    /* ------------------------------------------------------------------ *
     * Selection
     * ------------------------------------------------------------------ */
    function select(el) {
      if (input.selected === el) return;
      input.selected = el;
      input.activeHandle = null;
      if (host.onSelect) host.onSelect(el);
    }

    /* ------------------------------------------------------------------ *
     * Placement from the inventory tray
     * ------------------------------------------------------------------ */
    function beginPlacement(type) {
      if (!input.enabled) return;
      input.placingType = type;
      input.ghost = null;
      canvas.style.cursor = 'copy';
    }

    function cancelPlacement() {
      input.placingType = null;
      input.ghost = null;
      canvas.style.cursor = '';
    }

    function commitPlacement(p) {
      var sc = scene();
      var type = input.placingType;

      /* The host gets first refusal. Multiplayer needs to announce the
       * placement to the other player, and the editor writes into the level
       * document rather than the scene, so neither can go through Scene.place
       * directly. Plain single-player falls through to the default. */
      if (host.placeElement) {
        var handled = host.placeElement(type, p);
        cancelPlacement();
        if (handled) { select(handled === true ? null : handled); changed(true); }
        return handled;
      }

      if (!Sc.pointAllowed(sc, p)) {
        cancelPlacement();
        host.onRejected && host.onRejected(p);
        return null;
      }
      host.pushHistory && host.pushHistory();
      var el = Sc.place(sc, type, p.x, p.y);
      cancelPlacement();
      if (el) { select(el); changed(true); }
      return el;
    }

    /* ------------------------------------------------------------------ *
     * Pointer lifecycle
     * ------------------------------------------------------------------ */
    function onPointerDown(ev) {
      if (!input.enabled) return;
      canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId);
      var p = world(ev);
      input.pointers[ev.pointerId] = p;

      /* Two fingers down: switch to pinch/twist on the selected object. */
      var ids = Object.keys(input.pointers);
      if (ids.length === 2 && input.selected) {
        startPinch(ids);
        return;
      }

      if (input.placingType) { commitPlacement(p); return; }

      var h = handleAt(p);
      if (h) {
        input.activeHandle = h.kind;
        input.handleSign = h.sign || 1;
        input.dragging = true;
        host.pushHistory && host.pushHistory();
        return;
      }

      var el = elementAt(p);
      if (el) {
        select(el);
        var T = E.TYPES[el.type];
        if (T.caps.move && !el.locked) {
          input.dragging = true;
          input.dragOffset = { x: el.x - p.x, y: el.y - p.y };
          host.pushHistory && host.pushHistory();
        }
        /* Double tap returns a placed object to the tray. */
        var now = Date.now();
        if (now - input.lastTapTime < 300 && el.fromInventory) {
          Sc.remove(scene(), el);
          select(null);
          input.dragging = false;
          changed(true);
        }
        input.lastTapTime = now;
      } else {
        select(null);
      }
      updatePreview();
    }

    function onPointerMove(ev) {
      if (!input.enabled) return;
      var p = world(ev);
      if (input.pointers[ev.pointerId]) input.pointers[ev.pointerId] = p;

      if (input.pinch) { updatePinch(); return; }

      if (input.placingType) {
        input.ghost = { p: p, ok: Sc.pointAllowed(scene(), p) };
        return;
      }

      if (!input.dragging) {
        /* Hover feedback only. */
        canvas.style.cursor = handleAt(p) ? 'grab' : (elementAt(p) ? 'move' : '');
        return;
      }

      var el = input.selected;
      if (!el) return;

      if (input.activeHandle === 'rotate') {
        var a = Math.atan2(p.y - el.y, p.x - el.x) + Math.PI / 2;
        el.angle = applySnap(a, ev);
        E.touch(el);
      } else if (input.activeHandle === 'resize') {
        applyResize(el, p);
      } else if (input.activeHandle === 'curve') {
        applyCurve(el, p);
      } else {
        /* Body drag. */
        var np = { x: p.x + input.dragOffset.x, y: p.y + input.dragOffset.y };
        if (Sc.pointAllowed(scene(), np) || !el.fromInventory) {
          el.x = np.x; el.y = np.y;
          E.touch(el);
        }
      }
      changed(false);
      updatePreview();
    }

    function onPointerUp(ev) {
      delete input.pointers[ev.pointerId];
      if (input.pinch && Object.keys(input.pointers).length < 2) input.pinch = null;
      if (input.dragging) {
        input.dragging = false;
        input.activeHandle = null;
        changed(true);
      }
      input.preview = null;
      canvas.style.cursor = '';
    }

    function applySnap(a, ev) {
      /* Shift snaps to 15 degrees, Ctrl/Cmd to 45; otherwise free. */
      if (ev && ev.shiftKey) { input.snapMode = 15; return M.rad(Math.round(M.deg(a) / 15) * 15); }
      if (ev && (ev.ctrlKey || ev.metaKey)) { input.snapMode = 45; return M.rad(Math.round(M.deg(a) / 45) * 45); }
      input.snapMode = null;
      return a;
    }

    function applyResize(el, p) {
      var d = V.dist(p, { x: el.x, y: el.y });
      if (el.length !== undefined) {
        el.length = E.clampProp(el, 'length', d * 2);
      } else if (el.radius !== undefined) {
        el.radius = E.clampProp(el, 'radius', d);
      } else if (el.w !== undefined) {
        /* Resize a box along its own axes, not the screen's. */
        var local = V.rot(V.sub(p, { x: el.x, y: el.y }), -el.angle);
        el.w = E.clampProp(el, 'w', Math.abs(local.x) * 2);
        el.h = E.clampProp(el, 'h', Math.abs(local.y) * 2);
      }
      E.touch(el);
    }

    function applyCurve(el, p) {
      /* Curvature comes from how far the handle is pulled perpendicular to
       * the chord, normalised by half the chord length -- so the gesture maps
       * directly onto the sagitta the geometry actually uses. */
      var rel = V.rot(V.sub(p, { x: el.x, y: el.y }), -el.angle);
      var half = Math.max(20, (el.length || 100) * 0.5);
      var k = M.clamp(rel.y / half, -1, 1);
      el.curvature = E.clampProp(el, 'curvature', k);
      E.touch(el);
    }

    /* ------------------------------------------------------------------ *
     * Touch: pinch to resize, twist to rotate.
     * ------------------------------------------------------------------ */
    function startPinch(ids) {
      var a = input.pointers[ids[0]], b = input.pointers[ids[1]];
      var el = input.selected;
      input.pinch = {
        ids: ids,
        startDist: V.dist(a, b),
        startAngle: Math.atan2(b.y - a.y, b.x - a.x),
        startLength: el.length || el.radius || Math.max(el.w || 0, el.h || 0) || 100,
        startElAngle: el.angle,
        startW: el.w, startH: el.h
      };
      input.dragging = false;
      host.pushHistory && host.pushHistory();
    }

    function updatePinch() {
      var pk = input.pinch, el = input.selected;
      if (!pk || !el) return;
      var a = input.pointers[pk.ids[0]], b = input.pointers[pk.ids[1]];
      if (!a || !b) return;

      var dist = V.dist(a, b);
      var scale = dist / Math.max(1, pk.startDist);
      var ang = Math.atan2(b.y - a.y, b.x - a.x);

      el.angle = pk.startElAngle + (ang - pk.startAngle);
      if (el.length !== undefined) el.length = E.clampProp(el, 'length', pk.startLength * scale);
      else if (el.radius !== undefined) el.radius = E.clampProp(el, 'radius', pk.startLength * scale);
      else if (el.w !== undefined) {
        el.w = E.clampProp(el, 'w', pk.startW * scale);
        el.h = E.clampProp(el, 'h', pk.startH * scale);
      }
      E.touch(el);
      changed(false);
    }

    /* ------------------------------------------------------------------ *
     * Wheel: resize whatever is under the cursor.
     * ------------------------------------------------------------------ */
    function onWheel(ev) {
      if (!input.enabled) return;
      var p = world(ev);
      var el = input.selected && E.distanceTo(input.selected, p) < 60
        ? input.selected : elementAt(p);
      if (!el) return;
      ev.preventDefault();
      host.pushHistory && host.pushHistory();
      var step = ev.deltaY < 0 ? 1.08 : 1 / 1.08;
      if (ev.shiftKey && E.TYPES[el.type].caps.curve) {
        el.curvature = E.clampProp(el, 'curvature', (el.curvature || 0) + (ev.deltaY < 0 ? 0.05 : -0.05));
      } else if (el.length !== undefined) {
        el.length = E.clampProp(el, 'length', el.length * step);
      } else if (el.radius !== undefined) {
        el.radius = E.clampProp(el, 'radius', el.radius * step);
      } else if (el.w !== undefined) {
        el.w = E.clampProp(el, 'w', el.w * step);
        el.h = E.clampProp(el, 'h', el.h * step);
      }
      E.touch(el);
      select(el);
      changed(true);
    }

    /* ------------------------------------------------------------------ *
     * Keyboard
     * ------------------------------------------------------------------ */
    function onKeyDown(ev) {
      if (!input.enabled) return;
      if (ev.target && /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName)) return;

      var el = input.selected;
      var handled = true;
      var nudge = ev.shiftKey ? 1 : 8;

      switch (ev.key) {
        case 'ArrowLeft':  if (el) moveBy(el, -nudge, 0); else handled = false; break;
        case 'ArrowRight': if (el) moveBy(el, nudge, 0); else handled = false; break;
        case 'ArrowUp':    if (el) moveBy(el, 0, -nudge); else handled = false; break;
        case 'ArrowDown':  if (el) moveBy(el, 0, nudge); else handled = false; break;
        case '[': if (el) rotateBy(el, M.rad(ev.shiftKey ? -0.25 : -1)); else handled = false; break;
        case ']': if (el) rotateBy(el, M.rad(ev.shiftKey ? 0.25 : 1)); else handled = false; break;
        case ',': if (el) sizeBy(el, -4); else handled = false; break;
        case '.': if (el) sizeBy(el, 4); else handled = false; break;
        case 'Delete':
        case 'Backspace':
          if (el && el.fromInventory) {
            host.pushHistory && host.pushHistory();
            Sc.remove(scene(), el);
            select(null);
            changed(true);
          } else handled = false;
          break;
        case 'Escape':
          if (input.placingType) cancelPlacement();
          else select(null);
          break;
        default:
          handled = false;
      }

      if (handled) { ev.preventDefault(); return; }

      /* Shortcuts that do not need a selection. */
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) host.redo && host.redo(); else host.undo && host.undo();
      } else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'y') {
        ev.preventDefault();
        host.redo && host.redo();
      } else if (ev.key.toLowerCase() === 'r' && !ev.ctrlKey && !ev.metaKey) {
        host.resetLevel && host.resetLevel();
      } else if (ev.key.toLowerCase() === 'h') {
        host.hint && host.hint();
      }
    }

    function moveBy(el, dx, dy) {
      var T = E.TYPES[el.type];
      if (!T.caps.move || el.locked) return;
      var np = { x: el.x + dx, y: el.y + dy };
      if (!el.fromInventory || Sc.pointAllowed(scene(), np)) {
        host.pushHistory && host.pushHistory();
        el.x = np.x; el.y = np.y;
        E.touch(el);
        changed(true);
      }
    }
    function rotateBy(el, da) {
      if (!E.TYPES[el.type].caps.rotate) return;
      host.pushHistory && host.pushHistory();
      el.angle += da;
      E.touch(el);
      changed(true);
    }
    function sizeBy(el, d) {
      host.pushHistory && host.pushHistory();
      if (el.length !== undefined) el.length = E.clampProp(el, 'length', el.length + d);
      else if (el.radius !== undefined) el.radius = E.clampProp(el, 'radius', el.radius + d / 2);
      E.touch(el);
      changed(true);
    }

    /* ------------------------------------------------------------------ *
     * Live aim preview.
     *
     * Re-traces the scene at a shallow depth while the player is mid-drag, so
     * the dashed line shows where the beam WILL go without waiting for them to
     * let go. Cheap enough to run on every pointer move.
     * ------------------------------------------------------------------ */
    function updatePreview() {
      if (!input.dragging || !input.selected) { input.preview = null; return; }
      var sc = scene();
      var res = LP.Tracer.trace(sc, { maxDepth: 10, maxRays: 160, maxSegments: 260 });
      /* Only show the part of the path downstream of the object being moved. */
      var out = [];
      for (var i = 0; i < res.segments.length; i++) {
        var s = res.segments[i];
        if (s.source === input.selected.id || s.depth > 0) out.push({ a: s.a, b: s.b });
      }
      input.preview = out.slice(0, 120);
    }

    /* ------------------------------------------------------------------ */
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    /* Stop the browser from panning or zooming the page under our gestures. */
    canvas.style.touchAction = 'none';
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    input.beginPlacement = beginPlacement;
    input.cancelPlacement = cancelPlacement;
    input.select = select;
    input.detach = function () {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
    };
    return input;
  }

  LP.Input = { attach: attach };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
