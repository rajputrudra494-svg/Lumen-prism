/* =============================================================================
 * Lumen Path - src/engine/input.js
 * -----------------------------------------------------------------------------
 * Pointer, touch and keyboard handling.
 *
 * Everything the player can do to an object happens ON the bench, attached to
 * the object itself -- there is no side panel. Pointer Events are used
 * throughout so mouse, pen and touch share one code path; the only touch-only
 * gesture is the two-finger pinch/twist, which has no mouse equivalent.
 *
 * INTERACTION MODEL
 *   tap an object         select it; its gizmo appears
 *   drag the body         move (within the level's placement zones)
 *   drag the ring handle  rotate -- Shift snaps to 15 degrees, Ctrl/Cmd to 45;
 *                         on touch, angles settle onto 15 degree steps when close
 *   drag an end handle    resize (or scroll over the object)
 *   drag the amber knob   flex a curved mirror or lens
 *   drag the green knob   set a beam splitter's ratio along its track
 *   tap a badge           return to tray / flip face / next colour / next glass
 *   pinch and twist       resize and rotate the selection with two fingers
 *
 * SIZES ARE SCREEN-RELATIVE. Every tolerance comes from Renderer.handleOpts,
 * which converts a fixed on-screen size into world units at the current zoom,
 * so a handle is equally grabbable on a phone and on a 4K monitor.
 * ========================================================================== */
(function (LP) {
  'use strict';

  var V = LP.V, M = LP.M, E = LP.Elements, Sc = LP.Scene, R = LP.Renderer;

  /* On touch, rotation "settles" onto 15-degree steps within this margin. A
   * fingertip cannot hold an exact angle the way a mouse can, but the snap is
   * deliberately narrow so every in-between angle stays reachable. */
  var TOUCH_SNAP_DEG = 2.5;

  function attach(canvas, host) {
    var input = {
      canvas: canvas,
      host: host,
      selected: null,
      activeHandle: null,
      dragging: false,
      dragOffset: { x: 0, y: 0 },
      placingType: null,
      ghost: null,
      pointers: {},
      pinch: null,
      preview: null,
      lastTap: { time: 0, el: null },
      lastPointerType: 'mouse',
      enabled: true
    };

    function world(ev) { return R.eventToWorld(host.renderer, ev.clientX, ev.clientY); }
    function scene() { return host.scene(); }
    function changed(structural) { host.onChange(structural); }

    function opts(el) {
      var removable = !!(el && host.canRemove && host.canRemove(el));
      return R.handleOpts(host.renderer, removable);
    }

    /* ------------------------------------------------------------------ *
     * Hit testing
     * ------------------------------------------------------------------ */
    function handleAt(p) {
      var sel = input.selected;
      if (!sel) return null;
      var ho = opts(sel);
      var hs = E.handles(sel, ho);
      var best = null, bestD = ho.hit;
      for (var i = 0; i < hs.length; i++) {
        var d = V.dist(p, hs[i].p);
        /* Tap badges win ties: they are small and sit near other handles. */
        if (d < bestD || (best && d <= bestD && hs[i].tap && !best.tap)) {
          bestD = d; best = hs[i];
        }
      }
      return best;
    }

    function elementAt(p) {
      var sc = scene();
      var tol = Math.max(20, R.handleOpts(host.renderer, false).body);
      var best = null, bestD = tol;
      for (var i = sc.elements.length - 1; i >= 0; i--) {
        var el = sc.elements[i];
        if (el.isWall || el.type === 'emitter' || el.type === 'receiver') continue;
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
      var type = input.placingType;
      /* The host decides: multiplayer announces the placement, the editor
       * writes into the level document instead of the scene. */
      var placed = host.placeElement ? host.placeElement(type, p) : null;
      cancelPlacement();
      if (placed && placed !== true) select(placed);
      if (placed) changed(true);
      return placed;
    }

    /* ------------------------------------------------------------------ *
     * Pointer lifecycle
     * ------------------------------------------------------------------ */
    function onPointerDown(ev) {
      if (!input.enabled) return;
      input.lastPointerType = ev.pointerType || 'mouse';
      host.renderer.coarse = input.lastPointerType !== 'mouse';
      if (canvas.setPointerCapture) {
        try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* not capturable */ }
      }
      var p = world(ev);
      input.pointers[ev.pointerId] = p;

      /* A second finger on a selected object turns the gesture into pinch/twist. */
      var ids = Object.keys(input.pointers);
      if (ids.length === 2 && input.selected) { startPinch(ids); return; }
      if (ids.length > 2) return;

      if (input.placingType) { commitPlacement(p); return; }

      var h = handleAt(p);
      if (h) {
        if (h.tap) {
          /* Badges act immediately and never start a drag. */
          host.tapHandle && host.tapHandle(h.kind, input.selected);
          return;
        }
        input.activeHandle = h.kind;
        input.dragging = true;
        host.pushHistory && host.pushHistory();
        return;
      }

      var el = elementAt(p);
      if (!el) { select(null); input.preview = null; return; }

      /* Double-click returns an object to the tray -- mouse only. On touch the
       * red badge does that job, and a double-tap is too easy to trigger by
       * accident while nudging something into place. */
      var now = Date.now();
      if (input.lastPointerType === 'mouse' && input.lastTap.el === el &&
          now - input.lastTap.time < 320 && host.canRemove && host.canRemove(el)) {
        input.lastTap = { time: 0, el: null };
        host.tapHandle && host.tapHandle('remove', el);
        return;
      }
      input.lastTap = { time: now, el: el };

      select(el);
      var T = E.TYPES[el.type];
      if (T.caps.move && (!el.locked || el.adjustable)) {
        input.dragging = true;
        input.activeHandle = null;
        input.dragOffset = { x: el.x - p.x, y: el.y - p.y };
        host.pushHistory && host.pushHistory();
      }
      updatePreview();
    }

    function onPointerMove(ev) {
      if (!input.enabled) return;
      var p = world(ev);
      if (input.pointers[ev.pointerId]) input.pointers[ev.pointerId] = p;

      if (input.pinch) { updatePinch(); return; }

      if (input.placingType) {
        if (ev.pointerType === 'mouse') {
          input.ghost = { p: p, ok: Sc.pointAllowed(scene(), p) };
        }
        return;
      }

      if (!input.dragging) {
        if (ev.pointerType === 'mouse') {
          var over = handleAt(p);
          canvas.style.cursor = over ? (over.tap ? 'pointer' : 'grab') : (elementAt(p) ? 'move' : '');
        }
        return;
      }

      var el = input.selected;
      if (!el) return;

      switch (input.activeHandle) {
        case 'rotate':
          el.angle = snapAngle(Math.atan2(p.y - el.y, p.x - el.x) + Math.PI / 2, ev);
          break;
        case 'resize':
          applyResize(el, p);
          break;
        case 'curve':
          applyCurve(el, p);
          break;
        case 'ratio':
          el.ratio = E.clampProp(el, 'ratio', E.ratioFromPoint(el, p, opts(el).pad));
          break;
        default: {
          var np = { x: p.x + input.dragOffset.x, y: p.y + input.dragOffset.y };
          if (!el.fromInventory || Sc.pointAllowed(scene(), np)) {
            el.x = np.x;
            el.y = np.y;
          }
        }
      }
      E.touch(el);
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
      if (ev.pointerType === 'mouse') canvas.style.cursor = '';
    }

    function snapAngle(a, ev) {
      if (ev && ev.shiftKey) return M.rad(Math.round(M.deg(a) / 15) * 15);
      if (ev && (ev.ctrlKey || ev.metaKey)) return M.rad(Math.round(M.deg(a) / 45) * 45);
      if (input.lastPointerType !== 'mouse') {
        var deg = M.deg(a);
        var nearest = Math.round(deg / 15) * 15;
        if (Math.abs(deg - nearest) <= TOUCH_SNAP_DEG) return M.rad(nearest);
      }
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
    }

    function applyCurve(el, p) {
      /* Curvature follows how far the knob is pulled off the chord, normalised
       * by half the chord -- the same quantity the arc geometry is built from. */
      var rel = V.rot(V.sub(p, { x: el.x, y: el.y }), -el.angle);
      var half = Math.max(20, (el.length || 100) * 0.5);
      el.curvature = E.clampProp(el, 'curvature', M.clamp(rel.y / half, -1, 1));
    }

    /* ------------------------------------------------------------------ *
     * Two fingers: pinch to resize, twist to rotate.
     * ------------------------------------------------------------------ */
    function startPinch(ids) {
      var a = input.pointers[ids[0]], b = input.pointers[ids[1]];
      var el = input.selected;
      input.pinch = {
        ids: ids,
        startDist: V.dist(a, b),
        startAngle: Math.atan2(b.y - a.y, b.x - a.x),
        startSize: el.length || el.radius || Math.max(el.w || 0, el.h || 0) || 100,
        startElAngle: el.angle,
        startW: el.w, startH: el.h
      };
      input.dragging = false;
      input.activeHandle = null;
      host.pushHistory && host.pushHistory();
    }

    function updatePinch() {
      var pk = input.pinch, el = input.selected;
      if (!pk || !el) return;
      var a = input.pointers[pk.ids[0]], b = input.pointers[pk.ids[1]];
      if (!a || !b) return;

      var scale = V.dist(a, b) / Math.max(1, pk.startDist);
      var ang = Math.atan2(b.y - a.y, b.x - a.x);

      if (E.TYPES[el.type].caps.rotate) {
        el.angle = snapAngle(pk.startElAngle + (ang - pk.startAngle), null);
      }
      if (el.length !== undefined) el.length = E.clampProp(el, 'length', pk.startSize * scale);
      else if (el.radius !== undefined) el.radius = E.clampProp(el, 'radius', pk.startSize * scale);
      else if (el.w !== undefined) {
        el.w = E.clampProp(el, 'w', pk.startW * scale);
        el.h = E.clampProp(el, 'h', pk.startH * scale);
      }
      E.touch(el);
      changed(false);
    }

    /* ------------------------------------------------------------------ *
     * Wheel: resize whatever is under the cursor (Shift: flex it instead).
     * ------------------------------------------------------------------ */
    function onWheel(ev) {
      if (!input.enabled) return;
      var p = world(ev);
      var near = input.selected && E.distanceTo(input.selected, p) < opts(input.selected).pad * 1.5;
      var el = near ? input.selected : elementAt(p);
      if (!el) return;
      ev.preventDefault();
      host.pushHistory && host.pushHistory();
      var step = ev.deltaY < 0 ? 1.08 : 1 / 1.08;
      if (ev.shiftKey && E.TYPES[el.type].caps.curve) {
        el.curvature = E.clampProp(el, 'curvature', (el.curvature || 0) + (ev.deltaY < 0 ? 0.05 : -0.05));
      } else if (ev.shiftKey && E.TYPES[el.type].caps.ratio) {
        el.ratio = E.clampProp(el, 'ratio', (el.ratio || 0.5) + (ev.deltaY < 0 ? 0.02 : -0.02));
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
        case '-': if (el && E.TYPES[el.type].caps.ratio) ratioBy(el, -0.02); else handled = false; break;
        case '=':
        case '+': if (el && E.TYPES[el.type].caps.ratio) ratioBy(el, 0.02); else handled = false; break;
        case 'Delete':
        case 'Backspace':
          if (el && host.canRemove && host.canRemove(el)) host.tapHandle('remove', el);
          else handled = false;
          break;
        case 'Escape':
          if (input.placingType) cancelPlacement();
          else if (el) select(null);
          else handled = false;
          break;
        default:
          handled = false;
      }

      if (handled) { ev.preventDefault(); return; }

      var key = (ev.key || '').toLowerCase();
      if ((ev.ctrlKey || ev.metaKey) && key === 'z') {
        ev.preventDefault();
        if (ev.shiftKey) host.redo && host.redo(); else host.undo && host.undo();
      } else if ((ev.ctrlKey || ev.metaKey) && key === 'y') {
        ev.preventDefault();
        host.redo && host.redo();
      } else if (!ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        if (key === 'r') host.resetLevel && host.resetLevel();
        else if (key === 'h') host.hint && host.hint();
        else if (el && key === 'f') host.tapHandle && host.tapHandle('flip', el);
        else if (el && key === 'c') host.tapHandle && host.tapHandle('color', el);
        else if (el && key === 'm') host.tapHandle && host.tapHandle('material', el);
      }
    }

    function moveBy(el, dx, dy) {
      var T = E.TYPES[el.type];
      if (!T.caps.move || (el.locked && !el.adjustable)) return;
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
    function ratioBy(el, d) {
      host.pushHistory && host.pushHistory();
      el.ratio = E.clampProp(el, 'ratio', Math.round(((el.ratio || 0.5) + d) * 100) / 100);
      E.touch(el);
      changed(true);
    }

    /* ------------------------------------------------------------------ *
     * Live aim preview: a shallow re-trace on every drag move, so the dashed
     * line shows where the beam WILL go without letting go to find out.
     * ------------------------------------------------------------------ */
    function updatePreview() {
      if (!input.dragging || !input.selected) { input.preview = null; return; }
      var res = LP.Tracer.trace(scene(), { maxDepth: 10, maxRays: 160, maxSegments: 260 });
      var out = [];
      for (var i = 0; i < res.segments.length && out.length < 120; i++) {
        var sg = res.segments[i];
        if (sg.source === input.selected.id || sg.depth > 0) out.push({ a: sg.a, b: sg.b });
      }
      input.preview = out;
    }

    /* ------------------------------------------------------------------ */
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    /* Stop the browser panning, zooming or opening menus under our gestures. */
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

  LP.Input = { attach: attach, TOUCH_SNAP_DEG: TOUCH_SNAP_DEG };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
