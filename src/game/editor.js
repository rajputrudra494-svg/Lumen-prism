/* =============================================================================
 * Lumen Path - src/game/editor.js
 * -----------------------------------------------------------------------------
 * The level editor.
 *
 * Editing works on a live scene rather than an abstract document: what you are
 * dragging is a real element in a real trace, so the beam updates as you build
 * and you can see immediately whether a layout does anything interesting. The
 * level object is regenerated from that scene on save.
 *
 * The editor deliberately does NOT require a reference solution. A level is
 * publishable once `test()` confirms a human can solve it -- which the editor
 * checks by having you actually solve it in test mode and capturing what you
 * did. That solved arrangement becomes the level's `solution`, so shared levels
 * carry the same solvability guarantee the built-in ones do.
 * ========================================================================== */
(function (LP) {
  'use strict';

  var E = LP.Elements, Sc = LP.Scene, Share = LP.Share, M = LP.M;

  /* What the editor can drop into a level, grouped for the palette. */
  var PALETTE = [
    { group: 'Sources & targets', types: ['emitter', 'receiver'] },
    { group: 'Reflectors', types: ['mirror', 'concave', 'convex', 'flex', 'oneway'] },
    { group: 'Refractors', types: ['prism', 'lens', 'glass'] },
    { group: 'Beam control', types: ['splitter', 'filter', 'polarizer', 'grating'] },
    { group: 'Structure', types: ['absorber', 'portal'] }
  ];

  function blankLevel(name) {
    return {
      id: 'draft-' + Date.now().toString(36),
      name: name || 'Untitled',
      chapter: 'sandbox',
      author: '',
      blurb: '',
      world: { w: 1600, h: 900 },
      emitters: [{ type: 'emitter', x: 160, y: 450, angle: 0, color: 'white', intensity: 1.5 }],
      receivers: [{ type: 'receiver', x: 1440, y: 450, radius: 26,
                    require: { color: 'any', minIntensity: 0.35 } }],
      fixed: [],
      walls: [],
      zones: [],
      inventory: [{ type: 'mirror', count: 3 }],
      par: { objects: 3, bounces: 3 },
      draft: true
    };
  }

  function create(host) {
    var ed = {
      host: host,               /* { renderer, requestDraw, toast } */
      level: null,
      scene: null,
      mode: 'build',            /* 'build' | 'test' */
      selected: null,
      placingType: null,
      dirty: false,
      testSolution: null
    };

    /* ---------------------------------------------------------------- *
     * Loading and rebuilding
     * ---------------------------------------------------------------- */
    ed.load = function (level) {
      ed.level = JSON.parse(JSON.stringify(level));
      ed.level.zones = ed.level.zones || [];
      ed.level.walls = ed.level.walls || [];
      ed.level.fixed = ed.level.fixed || [];
      ed.rebuild();
      ed.dirty = false;              /* freshly loaded, nothing to save yet */
      return ed.level;
    };

    /**
     * In build mode the whole level -- including things that are normally the
     * player's to place -- is made editable, so the author can position
     * emitters and targets directly.
     */
    ed.rebuild = function () {
      var lvl = ed.level;
      var editable = {
        id: lvl.id, name: lvl.name, chapter: lvl.chapter,
        world: lvl.world, fog: lvl.fog, weather: lvl.weather,
        emitters: lvl.emitters, receivers: lvl.receivers,
        fixed: lvl.fixed, walls: lvl.walls,
        zones: null,                    /* no placement limits while building */
        inventory: ed.mode === 'test' ? lvl.inventory : [],
        par: lvl.par, holdTime: lvl.holdTime, sandbox: lvl.sandbox,
        solution: lvl.solution
      };
      ed.scene = Sc.fromLevel(editable);
      if (ed.mode === 'build') {
        /* Unlock everything so it can be dragged. */
        ed.scene.elements.forEach(function (el) {
          el.locked = false;
          el.adjustable = true;
        });
      } else {
        ed.scene.zones = lvl.zones && lvl.zones.length ? lvl.zones : null;
      }
      Sc.run(ed.scene);
      /* `dirty` means "has unsaved changes", so rebuilding the scene must not
       * clear it -- rebuild is just re-deriving the view of a document that
       * may well have only this second been edited. Only save() clears it. */
      return ed.scene;
    };

    /* ---------------------------------------------------------------- *
     * Placing and removing
     * ---------------------------------------------------------------- */
    ed.beginPlace = function (type) { ed.placingType = type; };

    ed.placeAt = function (x, y) {
      if (!ed.placingType) return null;
      var type = ed.placingType;
      var def = { type: type, x: Math.round(x), y: Math.round(y), angle: 0 };

      if (type === 'portal') {
        /* Portals are only useful in pairs, so make both and link them. */
        var idA = 'p' + Date.now().toString(36);
        var idB = idA + 'b';
        ed.level.fixed.push({ type: 'portal', id: idA, link: idB,
                              x: def.x, y: def.y, angle: 0, radius: 34 });
        ed.level.fixed.push({ type: 'portal', id: idB, link: idA,
                              x: Math.min(1520, def.x + 260), y: def.y, angle: 0, radius: 34 });
      } else if (type === 'emitter') {
        ed.level.emitters.push({ type: 'emitter', x: def.x, y: def.y,
                                 angle: 0, color: 'white', intensity: 1.5 });
      } else if (type === 'receiver') {
        ed.level.receivers.push({ type: 'receiver', x: def.x, y: def.y, radius: 26,
                                  require: { color: 'any', minIntensity: 0.35 } });
      } else {
        ed.level.fixed.push(def);
      }
      ed.placingType = null;
      ed.dirty = true;
      ed.rebuild();
      return def;
    };

    ed.addWall = function (x, y, w, h) {
      ed.level.walls.push({ x: Math.round(x), y: Math.round(y),
                            w: Math.round(w), h: Math.round(h) });
      ed.dirty = true;
      ed.rebuild();
    };

    ed.addZone = function (x, y, w, h) {
      ed.level.zones.push({ x: Math.round(x), y: Math.round(y),
                            w: Math.round(w), h: Math.round(h) });
      ed.dirty = true;
    };

    ed.deleteSelected = function () {
      var el = ed.selected;
      if (!el) return false;
      var removed = removeFromLevel(ed.level, el);
      if (removed) {
        ed.selected = null;
        ed.dirty = true;
        ed.rebuild();
      }
      return removed;
    };

    function removeFromLevel(lvl, el) {
      var lists = [lvl.emitters, lvl.receivers, lvl.fixed];
      for (var i = 0; i < lists.length; i++) {
        var list = lists[i];
        for (var j = 0; j < list.length; j++) {
          if (nearlySame(list[j], el)) {
            /* Removing one half of a portal pair takes its twin too --
             * a lone portal silently swallows every beam that enters it. */
            if (el.type === 'portal' && list[j].link) {
              var linkId = list[j].link;
              list.splice(j, 1);
              for (var k = 0; k < list.length; k++) {
                if (list[k].id === linkId) { list.splice(k, 1); break; }
              }
            } else {
              list.splice(j, 1);
            }
            return true;
          }
        }
      }
      /* Walls are stored separately and matched by their bounds. */
      for (var w = 0; w < lvl.walls.length; w++) {
        var wl = lvl.walls[w];
        if (Math.abs(wl.x + wl.w / 2 - el.x) < 3 && Math.abs(wl.y + wl.h / 2 - el.y) < 3) {
          lvl.walls.splice(w, 1);
          return true;
        }
      }
      return false;
    }

    function nearlySame(def, el) {
      return def.type === el.type &&
             Math.abs((def.x || 0) - el.x) < 3 &&
             Math.abs((def.y || 0) - el.y) < 3;
    }

    /**
     * Copy the live scene's transforms back into the level definition.
     * Called after any drag so the document follows what is on screen.
     */
    ed.commit = function () {
      var lvl = ed.level;
      var byList = { emitter: lvl.emitters, receiver: lvl.receivers };
      var fixedIdx = 0, wallIdx = 0;
      var i, el;

      var emitterIdx = 0, receiverIdx = 0;
      for (i = 0; i < ed.scene.elements.length; i++) {
        el = ed.scene.elements[i];
        if (el.fromInventory) continue;
        var target = null;
        if (el.type === 'emitter') target = lvl.emitters[emitterIdx++];
        else if (el.type === 'receiver') target = lvl.receivers[receiverIdx++];
        else if (el.isWall) {
          var wl = lvl.walls[wallIdx++];
          if (wl) { wl.x = Math.round(el.x - wl.w / 2); wl.y = Math.round(el.y - wl.h / 2); }
          continue;
        } else target = lvl.fixed[fixedIdx++];

        if (!target) continue;
        target.x = Math.round(el.x * 10) / 10;
        target.y = Math.round(el.y * 10) / 10;
        target.angle = el.angle;
        ['length', 'radius', 'curvature', 'ratio', 'w', 'h', 'spacing', 'orders',
         'color', 'material', 'flipped', 'intensity', 'width', 'rays', 'require',
         'exitOffset'].forEach(function (k) {
          if (el[k] !== undefined) target[k] = el[k];
        });
      }
      ed.dirty = true;
    };

    /* ---------------------------------------------------------------- *
     * Inventory
     * ---------------------------------------------------------------- */
    ed.setInventory = function (type, count) {
      var inv = ed.level.inventory;
      var i = inv.findIndex(function (s) { return s.type === type && !s.preset; });
      if (count <= 0) { if (i >= 0) inv.splice(i, 1); }
      else if (i >= 0) inv[i].count = count;
      else inv.push({ type: type, count: count });
      ed.dirty = true;
    };

    ed.inventoryCount = function (type) {
      return ed.level.inventory
        .filter(function (s) { return s.type === type; })
        .reduce(function (n, s) { return n + s.count; }, 0);
    };

    /* ---------------------------------------------------------------- *
     * Test mode
     * ---------------------------------------------------------------- */
    ed.enterTest = function () {
      ed.commit();
      ed.mode = 'test';
      ed.selected = null;
      ed.rebuild();
      return ed.scene;
    };

    ed.exitTest = function () {
      ed.mode = 'build';
      ed.selected = null;
      ed.rebuild();
      return ed.scene;
    };

    /**
     * Capture the current test arrangement as the level's reference solution,
     * but only if it genuinely solves the level.
     */
    ed.captureSolution = function () {
      if (ed.mode !== 'test') return { ok: false, why: 'Switch to test mode first.' };
      var ev = ed.level.holdTime
        ? Sc.tickSolve(ed.scene, 1 / 60)
        : Sc.evaluate(ed.scene);
      if (!(ev.solved || ev.allLit)) {
        return { ok: false, why: 'Solve it first -- then this becomes the reference answer.' };
      }
      var sol = [];
      ed.scene.elements.forEach(function (el) {
        if (el.fromInventory) sol.push(E.serialize(el));
      });
      ed.level.solution = sol;
      ed.level.par = { objects: ev.objects, bounces: ev.bounces };
      ed.dirty = true;
      return { ok: true, objects: ev.objects, bounces: ev.bounces };
    };

    /* ---------------------------------------------------------------- *
     * Validation, export, save
     * ---------------------------------------------------------------- */

    /**
     * A pre-flight check with actionable messages. Warnings do not block
     * saving; problems do.
     */
    ed.validate = function () {
      var lvl = ed.level;
      var problems = [], warnings = [];

      if (!lvl.emitters.length) problems.push('Add at least one light source.');
      if (!lvl.sandbox && !lvl.receivers.length) problems.push('Add at least one sensor.');
      if (!lvl.sandbox && !lvl.inventory.length) {
        warnings.push('The inventory is empty, so there is nothing for a player to place.');
      }

      /* Is the level already solved before anyone touches it? */
      try {
        var probe = Sc.fromLevel(Object.assign({}, lvl, { inventory: [] }));
        if (!lvl.sandbox && Sc.evaluate(probe).allLit) {
          problems.push('Every sensor is already lit with nothing placed.');
        }
      } catch (e) { problems.push('The level failed to load: ' + e.message); }

      /* Unlinked portals swallow light with no way to tell. */
      var ids = {};
      lvl.fixed.forEach(function (f) { if (f.id) ids[f.id] = true; });
      lvl.fixed.forEach(function (f) {
        if (f.type === 'portal' && (!f.link || !ids[f.link])) {
          problems.push('A portal has no linked twin.');
        }
      });

      if (!lvl.solution || !lvl.solution.length) {
        if (!lvl.sandbox) warnings.push('No reference answer saved. Solve it in test mode and press "Save answer" so the level ships with a proven solution.');
      } else {
        /* Re-verify a stored solution -- the layout may have moved since. */
        try {
          var sc = Sc.fromLevel(lvl);
          var placed = Sc.applySolution(sc, lvl.solution);
          var ev = lvl.holdTime ? runTimed(sc, lvl) : Sc.evaluate(sc);
          if (placed !== lvl.solution.length) {
            problems.push('The saved answer no longer fits the inventory.');
          } else if (!(ev.solved || ev.allLit)) {
            problems.push('The saved answer no longer solves the level. Re-test it.');
          }
        } catch (e) {
          problems.push('The saved answer could not be replayed: ' + e.message);
        }
      }
      return { ok: problems.length === 0, problems: problems, warnings: warnings };
    };

    function runTimed(sc, lvl) {
      var r = null;
      for (var t = 0; t < (lvl.simWindow || 24); t += 1 / 60) {
        r = Sc.tickSolve(sc, 1 / 60);
        if (r.solved) return r;
      }
      return r || { solved: false, allLit: false };
    }

    ed.exportCode = function () {
      ed.commit();
      return Share.encodeLevel(ed.level);
    };

    ed.exportURL = function () {
      ed.commit();
      return Share.shareURL(ed.level);
    };

    ed.save = function () {
      ed.commit();
      var entry = {
        id: ed.level.id,
        name: ed.level.name,
        author: ed.level.author,
        code: Share.encodeLevel(ed.level),
        savedAt: Date.now()
      };
      LP.Storage.addToLibrary(entry);
      ed.dirty = false;
      return entry;
    };

    return ed;
  }

  LP.Editor = {
    PALETTE: PALETTE,
    blankLevel: blankLevel,
    create: create
  };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
