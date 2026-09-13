/* =============================================================================
 * Lumen Path - src/engine/scene.js
 * -----------------------------------------------------------------------------
 * The level runtime: turns a level definition into a live scene, runs the
 * tracer over it, decides whether every receiver is satisfied, and awards
 * stars. Everything here is pure state manipulation -- no DOM, no canvas -- so
 * the same code runs in the browser and under Node for level verification.
 * ========================================================================== */
(function (LP) {
  'use strict';

  var V = LP.V, M = LP.M, S = LP.Spectrum, E = LP.Elements, T = LP.Tracer, P = LP.Props, G = LP.Geom;

  /* How closely a mixed colour must match what a receiver asks for. */
  var COLOR_TOLERANCE = 0.80;

  /* --------------------------------------------------------------------------
   * Scene construction
   * ------------------------------------------------------------------------ */
  function fromLevel(level) {
    var scene = {
      level: level,
      id: level.id,
      bounds: { x: 0, y: 0, w: (level.world && level.world.w) || 1600,
                h: (level.world && level.world.h) || 900 },
      fog: level.fog || 0,
      airAbsorb: level.airAbsorb,
      elements: [],
      emitters: [],
      receivers: [],
      byId: {},
      inventory: [],
      time: 0,
      holdAccum: 0,
      lastResult: null,
      dirty: true
    };

    E.resetIds();

    function add(def, locked, fromInv) {
      var opts = {};
      for (var k in def) if (Object.prototype.hasOwnProperty.call(def, k)) opts[k] = def[k];
      var type = opts.type; delete opts.type;
      var el = E.create(type, opts);
      el.locked = locked === undefined ? !!def.locked : locked;
      el.fromInventory = !!fromInv;
      scene.elements.push(el);
      scene.byId[el.id] = el;
      return el;
    }

    var i;
    /* Emitters are markers: they seed rays but have no collision geometry. */
    for (i = 0; i < (level.emitters || []).length; i++) {
      var em = add(assign({ type: 'emitter' }, level.emitters[i]), true);
      scene.emitters.push(em);
    }
    for (i = 0; i < (level.receivers || []).length; i++) {
      var rc = add(assign({ type: 'receiver' }, level.receivers[i]), true);
      scene.receivers.push(rc);
    }
    /* Fixed furniture: mirrors bolted in place, walls, absorbers, portals. */
    for (i = 0; i < (level.fixed || []).length; i++) {
      add(level.fixed[i], level.fixed[i].locked !== false);
    }
    /* Walls are just absorbers with a wall flag for rendering. */
    for (i = 0; i < (level.walls || []).length; i++) {
      var w = level.walls[i];
      var wall = add({ type: 'absorber', x: w.x + w.w / 2, y: w.y + w.h / 2,
                       w: w.w, h: w.h, angle: 0 }, true);
      wall.isWall = true;
    }

    /* Inventory: what the player has to place, and how many of each. */
    for (i = 0; i < (level.inventory || []).length; i++) {
      var inv = level.inventory[i];
      scene.inventory.push({
        type: inv.type,
        count: inv.count === undefined ? 1 : inv.count,
        used: 0,
        preset: inv.preset || null,
        label: inv.label || null
      });
    }

    scene.zones = level.zones || null;
    P.initAll(scene.elements);
    return scene;
  }

  function assign(a, b) {
    var o = {}, k;
    for (k in a) if (Object.prototype.hasOwnProperty.call(a, k)) o[k] = a[k];
    for (k in b) if (Object.prototype.hasOwnProperty.call(b, k)) o[k] = b[k];
    return o;
  }

  /* --------------------------------------------------------------------------
   * Placement
   * ------------------------------------------------------------------------ */

  /** Is this world point a legal place to drop a player object? */
  function pointAllowed(scene, p) {
    if (p.x < 24 || p.y < 24 || p.x > scene.bounds.w - 24 || p.y > scene.bounds.h - 24) return false;
    if (scene.zones && scene.zones.length) {
      var ok = false;
      for (var i = 0; i < scene.zones.length; i++) {
        var z = scene.zones[i];
        if (G.pointInAABB(p, z.x, z.y, z.w, z.h)) { ok = true; break; }
      }
      if (!ok) return false;
    }
    /* Never let a piece be dropped on top of a wall or a goal object. */
    for (var j = 0; j < scene.elements.length; j++) {
      var el = scene.elements[j];
      if (el.isWall || el.type === 'receiver' || el.type === 'emitter') {
        var pad = el.type === 'emitter' || el.type === 'receiver' ? (el.radius + 14) : 6;
        if (E.distanceTo(el, p) < pad) return false;
      }
    }
    return true;
  }

  /**
   * Find a free inventory slot for `type`.
   *
   * A level may hold several slots of the same type with different presets --
   * a red, a green and a blue filter, say. Taking simply the first free one
   * would let a player place three blue filters by spending the red and green
   * allowances, so a preset-matching slot wins when one is available.
   */
  function inventorySlot(scene, type, preferPreset) {
    var want = preferPreset ? JSON.stringify(preferPreset) : null;
    var i, slot;

    if (want !== null) {
      /* Does the level distinguish this preset at all? If it does, the request
       * is bound to those slots and nothing else -- otherwise a blue filter
       * could be built out of the red allowance once the blue one ran out. */
      var presetExists = false, free = null;
      for (i = 0; i < scene.inventory.length; i++) {
        slot = scene.inventory[i];
        if (slot.type !== type) continue;
        if (JSON.stringify(slot.preset || {}) !== want) continue;
        presetExists = true;
        if (!free && slot.used < slot.count) free = slot;
      }
      if (presetExists) return free;
    }

    for (i = 0; i < scene.inventory.length; i++) {
      slot = scene.inventory[i];
      if (slot.type === type && slot.used < slot.count) return slot;
    }
    return null;
  }

  function remaining(scene, type) {
    var n = 0;
    for (var i = 0; i < scene.inventory.length; i++) {
      if (scene.inventory[i].type === type) n += scene.inventory[i].count - scene.inventory[i].used;
    }
    return n;
  }

  /** Place a new element from inventory. Returns the element, or null. */
  function place(scene, type, x, y, extra, preferPreset) {
    var slot = inventorySlot(scene, type, preferPreset);
    if (!slot) return null;
    var opts = assign(slot.preset || {}, extra || {});
    opts.x = x; opts.y = y;
    var el = E.create(type, opts);
    el.fromInventory = true;
    el.locked = false;
    scene.elements.push(el);
    scene.byId[el.id] = el;
    slot.used++;
    if (el.motion) P.initAll([el]);
    scene.dirty = true;
    return el;
  }

  /**
   * Return a placed element to the inventory. Credits the slot it most likely
   * came from -- matching on the preset first, so returning a blue filter does
   * not hand the allowance back to the red one.
   */
  function remove(scene, el) {
    if (!el.fromInventory) return false;
    var idx = scene.elements.indexOf(el);
    if (idx < 0) return false;
    scene.elements.splice(idx, 1);
    delete scene.byId[el.id];

    var i, slot, best = null;
    for (i = 0; i < scene.inventory.length; i++) {
      slot = scene.inventory[i];
      if (slot.type !== el.type || slot.used <= 0) continue;
      if (!best) best = slot;
      if (slot.preset && presetMatchesElement(slot.preset, el)) { best = slot; break; }
    }
    if (best) best.used--;

    scene.dirty = true;
    return true;
  }

  /** Does every key of `preset` still hold on this element? */
  function presetMatchesElement(preset, el) {
    for (var k in preset) {
      if (!Object.prototype.hasOwnProperty.call(preset, k)) continue;
      if (k === 'motion') continue;                 /* mutated by the sim */
      if (JSON.stringify(preset[k]) !== JSON.stringify(el[k])) return false;
    }
    return true;
  }

  function placedCount(scene) {
    var n = 0;
    for (var i = 0; i < scene.elements.length; i++) if (scene.elements[i].fromInventory) n++;
    return n;
  }

  /** Total reflective length in play -- for "photon budget" levels. */
  function usedLength(scene) {
    var total = 0;
    for (var i = 0; i < scene.elements.length; i++) {
      var el = scene.elements[i];
      if (!el.fromInventory) continue;
      total += el.length || el.radius * 2 || Math.max(el.w || 0, el.h || 0) || 0;
    }
    return total;
  }

  /* --------------------------------------------------------------------------
   * Simulation
   * ------------------------------------------------------------------------ */

  function run(scene) {
    var res = T.trace(scene, {});
    scene.lastResult = res;
    scene.dirty = false;
    return res;
  }

  /**
   * Advance moving props and re-trace. Static levels short-circuit: if nothing
   * moved and nothing was edited, the previous result is still valid.
   */
  function update(scene, dt) {
    var moving = P.hasMotion(scene.elements);
    if (moving) {
      scene.time += dt;
      var energy = scene.lastResult ? scene.lastResult.energyByElement : null;
      P.step(scene.elements, dt, scene.time, energy);
      scene.dirty = true;
    }
    if (scene.dirty || !scene.lastResult) run(scene);
    return scene.lastResult;
  }

  /* --------------------------------------------------------------------------
   * Receiver evaluation
   * ------------------------------------------------------------------------ */

  /**
   * Evaluate one receiver against its requirement.
   *
   *   require.color        'any' | named colour | '#rrggbb'
   *   require.minIntensity energy that must land (after all attenuation)
   *   require.maxIntensity optional ceiling -- "do not overload this sensor"
   *   require.minBeams     optional: how many separate beams must arrive
   *                        (used by the synchronisation boss levels)
   *   require.polarization optional: required polarisation angle, +/- tolerance
   *   require.wavelength   optional: required wavelength band, in nm
   */
  function evalReceiver(rc, dep) {
    var req = rc.require || {};
    var minI = req.minIntensity === undefined ? 0.22 : req.minIntensity;
    var out = {
      id: rc.id, lit: false, intensity: 0, color: { r: 0, g: 0, b: 0 },
      match: 0, beams: 0, reason: 'dark'
    };

    /* ---- Inverted targets: sensors that must stay in the dark. -----------
     * Used by the "do not trip the alarm" levels, where routing the beam
     * away from something is as much of the puzzle as hitting the target. */
    if (req.dark) {
      out.dark = true;
      var ceiling = req.maxIntensity === undefined ? 0.03 : req.maxIntensity;
      out.intensity = dep ? dep.intensity : 0;
      if (dep) out.color = S.colScale(dep.color, 1 / Math.max(1e-6, dep.intensity));
      out.lit = out.intensity <= ceiling;      /* "lit" here means "satisfied" */
      out.match = 1;
      out.reason = out.lit ? 'shielded' : 'exposed';
      return out;
    }

    if (!dep || dep.intensity <= 0) return out;

    out.intensity = dep.intensity;
    out.beams = dep.count;
    /* Energy-weighted mean colour of everything that landed. */
    out.color = S.colScale(dep.color, 1 / Math.max(1e-6, dep.intensity));

    if (dep.intensity < minI) { out.reason = 'too dim'; return out; }
    if (req.maxIntensity !== undefined && dep.intensity > req.maxIntensity) {
      out.reason = 'overloaded';
      out.overloaded = true;
      return out;
    }
    if (req.minBeams !== undefined && dep.count < req.minBeams) {
      out.reason = 'needs ' + req.minBeams + ' beams';
      return out;
    }
    if (req.color && req.color !== 'any') {
      var want = S.resolveColor(req.color);
      out.match = S.colMatch(out.color, want);
      if (out.match < COLOR_TOLERANCE) { out.reason = 'wrong colour'; return out; }
    } else {
      out.match = 1;
    }
    if (req.wavelength !== undefined) {
      /* Intensity-weighted mean wavelength must land inside the band. */
      var tot = 0, sum = 0;
      for (var i = 0; i < dep.wavelengths.length; i++) {
        sum += dep.wavelengths[i].nm * dep.wavelengths[i].i;
        tot += dep.wavelengths[i].i;
      }
      if (tot <= 0) { out.reason = 'needs monochromatic light'; return out; }
      var mean = sum / tot;
      var tol = req.wavelengthTolerance === undefined ? 22 : req.wavelengthTolerance;
      out.wavelength = mean;
      if (Math.abs(mean - req.wavelength) > tol) {
        out.reason = Math.round(mean) + 'nm, needs ' + req.wavelength + 'nm';
        return out;
      }
    }
    if (req.polarization !== undefined) {
      if (dep.polarised === null || dep.polarised === undefined) {
        out.reason = 'needs polarised light'; return out;
      }
      var tolP = req.polarizationTolerance === undefined ? 0.22 : req.polarizationTolerance;
      /* Polarisation is symmetric under a half turn. */
      var d = Math.abs(M.wrapAngle((dep.polarised - req.polarization) * 2)) / 2;
      if (d > tolP) { out.reason = 'wrong polarisation'; return out; }
    }

    out.lit = true;
    out.reason = 'lit';
    return out;
  }

  function evaluate(scene) {
    if (scene.dirty || !scene.lastResult) run(scene);
    var res = scene.lastResult;
    var states = [];
    var allLit = true;
    for (var i = 0; i < scene.receivers.length; i++) {
      var rc = scene.receivers[i];
      var st = evalReceiver(rc, res.deposits[rc.id]);
      rc._state = st;
      states.push(st);
      if (!st.lit) allLit = false;
    }
    return {
      receivers: states,
      allLit: allLit,
      objects: placedCount(scene),
      length: usedLength(scene),
      bounces: countPlayerBounces(scene, res)
    };
  }

  /** Count interactions with player-placed objects (the "bounces" par metric). */
  function countPlayerBounces(scene, res) {
    var n = 0;
    for (var i = 0; i < res.segments.length; i++) {
      var seg = res.segments[i];
      if (seg.depth === 0) continue;
      var src = scene.byId[seg.source];
      if (src && src.fromInventory) n++;
    }
    return n;
  }

  /* --------------------------------------------------------------------------
   * Solve state (with hold-time support for moving levels)
   * ------------------------------------------------------------------------ */
  function tickSolve(scene, dt) {
    /* Advance the world FIRST. `update` steps every moving prop, feeds the
     * previous frame's absorbed energy to the thermal ones, and re-traces if
     * anything actually changed -- so the evaluation below is of the scene as
     * it is now, not as it was when the level loaded. */
    update(scene, dt);
    var ev = evaluate(scene);
    var hold = scene.level.holdTime || 0;
    if (ev.allLit) {
      scene.holdAccum += dt;
    } else {
      /* Decay rather than reset, so a single-frame flicker on a moving level
       * does not throw away a genuinely correct alignment. */
      scene.holdAccum = Math.max(0, scene.holdAccum - dt * 2.0);
    }
    ev.holdProgress = hold > 0 ? Math.min(1, scene.holdAccum / hold) : (ev.allLit ? 1 : 0);
    ev.solved = scene.level.sandbox ? false : (hold > 0 ? scene.holdAccum >= hold : ev.allLit);
    if (ev.solved) ev.stars = starsFor(scene, ev);
    return ev;
  }

  /**
   * Star rating.
   *   1 star  - solved at all
   *   2 stars - solved within one object of par
   *   3 stars - solved at or under par on BOTH objects and bounces
   */
  function starsFor(scene, ev) {
    var par = scene.level.par || {};
    var parObj = par.objects === undefined ? Infinity : par.objects;
    var parB = par.bounces === undefined ? Infinity : par.bounces;
    if (ev.objects <= parObj && ev.bounces <= parB) return 3;
    if (ev.objects <= parObj + 1) return 2;
    return 1;
  }

  /* --------------------------------------------------------------------------
   * Reset / snapshot / restore  (drives undo, redo and the reset button)
   * ------------------------------------------------------------------------ */

  function reset(scene) {
    for (var i = scene.elements.length - 1; i >= 0; i--) {
      if (scene.elements[i].fromInventory) {
        var el = scene.elements[i];
        scene.elements.splice(i, 1);
        delete scene.byId[el.id];
      }
    }
    for (var j = 0; j < scene.inventory.length; j++) scene.inventory[j].used = 0;
    /* Fixed elements the player can still rotate need their pose restored. */
    for (var k = 0; k < scene.elements.length; k++) {
      var e2 = scene.elements[k];
      if (e2._home) {
        e2.x = e2._home.x; e2.y = e2._home.y; e2.angle = e2._home.angle;
        if (e2._home.curvature !== undefined) e2.curvature = e2._home.curvature;
        E.touch(e2);
      }
    }
    P.resetAll(scene.elements);
    scene.time = 0;
    scene.holdAccum = 0;
    scene.dirty = true;
  }

  function snapshot(scene) {
    var els = [];
    for (var i = 0; i < scene.elements.length; i++) {
      var el = scene.elements[i];
      /* Only things the player can change need capturing. */
      if (!el.fromInventory && el.locked && !el.adjustable) continue;
      els.push(E.serialize(el));
    }
    var inv = [];
    for (var j = 0; j < scene.inventory.length; j++) inv.push(scene.inventory[j].used);
    return { els: els, inv: inv };
  }

  function restore(scene, snap) {
    /* Drop every mutable element, then rebuild from the snapshot. */
    for (var i = scene.elements.length - 1; i >= 0; i--) {
      var el = scene.elements[i];
      if (el.fromInventory || (!el.locked || el.adjustable)) {
        scene.elements.splice(i, 1);
        delete scene.byId[el.id];
      }
    }
    for (var j = 0; j < snap.els.length; j++) {
      var d = snap.els[j];
      var opts = {}, k;
      for (k in d) if (Object.prototype.hasOwnProperty.call(d, k)) opts[k] = d[k];
      var type = opts.type; delete opts.type;
      var e2 = E.create(type, opts);
      scene.elements.push(e2);
      scene.byId[e2.id] = e2;
    }
    for (var m = 0; m < scene.inventory.length && m < snap.inv.length; m++) {
      scene.inventory[m].used = snap.inv[m];
    }
    P.initAll(scene.elements);
    scene.dirty = true;
  }

  /* --------------------------------------------------------------------------
   * Solutions -- used by the verifier, the hint system and ghost replays.
   * A level's `solution` is a list of placements matching its inventory.
   * ------------------------------------------------------------------------ */
  function applySolution(scene, solution) {
    reset(scene);
    var sol = solution || scene.level.solution || [];
    var placedOk = 0;
    for (var i = 0; i < sol.length; i++) {
      var s = sol[i];
      var extra = {}, k;
      for (k in s) if (Object.prototype.hasOwnProperty.call(s, k)) {
        if (k !== 'type' && k !== 'x' && k !== 'y') extra[k] = s[k];
      }
      var el = place(scene, s.type, s.x, s.y, extra);
      if (el) placedOk++;
    }
    scene.dirty = true;
    return placedOk;
  }

  LP.Scene = {
    COLOR_TOLERANCE: COLOR_TOLERANCE,
    fromLevel: fromLevel,
    place: place,
    remove: remove,
    pointAllowed: pointAllowed,
    remaining: remaining,
    inventorySlot: inventorySlot,
    placedCount: placedCount,
    usedLength: usedLength,
    run: run,
    update: update,
    evaluate: evaluate,
    evalReceiver: evalReceiver,
    tickSolve: tickSolve,
    starsFor: starsFor,
    reset: reset,
    snapshot: snapshot,
    restore: restore,
    applySolution: applySolution
  };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
