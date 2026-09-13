/* =============================================================================
 * Lumen Path - src/game/daily.js
 * -----------------------------------------------------------------------------
 * The daily challenge: one procedurally generated level per calendar day, the
 * same for everyone, scored on fewest objects and fewest bounces.
 *
 * SOLVABILITY BY CONSTRUCTION
 * A generator that perturbs a hand-made level and hopes for the best will
 * eventually ship an impossible daily. These templates instead build the light
 * path FIRST -- a randomised polyline through the field -- and then solve for
 * the mirror angles that walk it, exactly as the hand-authored levels do. The
 * puzzle is generated from a guaranteed solution rather than the other way
 * round. Each candidate is then run through the real tracer before being
 * accepted, so a template that produces a degenerate layout (a mirror inside a
 * wall, two objects on top of each other) is simply rejected and re-rolled.
 *
 * Determinism comes from a seeded PRNG keyed on the UTC date, so every player
 * gets an identical level without any server involvement.
 * ========================================================================== */
(function (LP) {
  'use strict';

  var A = LP.Authoring, M = LP.M, Sc = LP.Scene;
  var E = A.emitter, R = A.receiver, W = A.wall;

  var WORLD = { w: 1600, h: 900 };

  function dateKey(d) {
    var dt = d || new Date();
    return dt.getUTCFullYear() + '-' +
           String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' +
           String(dt.getUTCDate()).padStart(2, '0');
  }

  function seedFor(key) { return M.hash32('lumen-daily-' + key); }

  /* Pick n values spread across a range without clustering. */
  function spread(rng, n, lo, hi, jitter) {
    var out = [];
    var step = (hi - lo) / n;
    for (var i = 0; i < n; i++) {
      out.push(lo + step * (i + 0.5) + (rng() - 0.5) * step * (jitter === undefined ? 0.7 : jitter));
    }
    return out;
  }

  /* ==========================================================================
   * TEMPLATES
   * Each returns a level object with a reference solution already attached.
   * ======================================================================= */
  var TEMPLATES = [];

  /* --- 1. Zigzag: a staircase of mirrors across the field. ---------------- */
  TEMPLATES.push({
    id: 'zigzag',
    name: 'Zigzag',
    blurb: 'A staircase of turns from one wall to the other.',
    build: function (rng, difficulty) {
      var n = 2 + Math.floor(rng() * 2) + (difficulty > 0.6 ? 1 : 0);   /* 2-4 mirrors */
      var xs = spread(rng, n, 380, 1180, 0.5);
      var ys = [];
      var top = rng() < 0.5;
      for (var i = 0; i < n; i++) {
        ys.push(top === (i % 2 === 0) ? 180 + rng() * 160 : 620 + rng() * 160);
      }
      var emY = ys[0];
      var path = [];
      for (i = 0; i < n; i++) path.push({ x: xs[i], y: ys[i] });

      var recY = 200 + rng() * 500;
      return {
        emitter: E(130, emY, 0, 'white', { intensity: 1.4 }),
        receiver: R(1460, recY, { color: 'any', minIntensity: 0.4 }),
        path: path,
        inventory: [{ type: 'mirror', count: n + 1 }]
      };
    }
  });

  /* --- 2. Obstacle course: mirrors routing around solid blocks. ----------- */
  TEMPLATES.push({
    id: 'blocks',
    name: 'Obstacle Course',
    blurb: 'Solid columns between you and the sensor.',
    build: function (rng, difficulty) {
      var n = 2 + Math.floor(rng() * 2);
      var laneY = [150 + rng() * 120, 430 + rng() * 60, 720 + rng() * 120];
      var lane = laneY.slice().sort(function () { return rng() - 0.5; });

      /* Consecutive waypoints must never be collinear with the incoming beam:
       * a mirror asked to send light back the way it came has no valid angle.
       * Each leg therefore changes lane. */
      var x1 = 360 + rng() * 120;
      var x2 = 780 + rng() * 180;
      var path = [
        { x: x1, y: lane[0] },
        { x: x1, y: lane[1] },
        { x: x2, y: lane[1] }
      ];
      if (n > 2 && Math.abs(lane[2] - lane[1]) > 120) {
        path.push({ x: x2, y: lane[2] });
      }

      /* Walls that sit BETWEEN the lanes, never on the authored path. */
      var walls = [];
      var wallX = [520, 900, 1180];
      for (var i = 0; i < wallX.length; i++) {
        var gapTop = Math.min(lane[0], lane[1]) - 70;
        var gapBot = Math.max(lane[0], lane[1]) + 70;
        if (rng() < 0.7) walls.push(W(wallX[i], gapBot, 44, 900 - gapBot));
        if (rng() < 0.5 && gapTop > 60) walls.push(W(wallX[i], 0, 44, gapTop));
      }
      return {
        emitter: E(130, lane[0], 0, 'white', { intensity: 1.6 }),
        receiver: R(1460, path[path.length - 1].y + (rng() - 0.5) * 90,
                    { color: 'any', minIntensity: 0.34 }),
        path: path,
        walls: walls,
        inventory: [{ type: 'mirror', count: path.length + 1 }]
      };
    }
  });

  /* --- 3. Two lamps into one sensor: additive colour. --------------------- */
  TEMPLATES.push({
    id: 'mix',
    name: 'Colour Mix',
    blurb: 'Two lamps, one sensor, and a colour neither of them is.',
    build: function (rng) {
      var pairs = [
        ['red', 'green', 'yellow'],
        ['red', 'blue', 'magenta'],
        ['green', 'blue', 'cyan']
      ];
      var pick = pairs[Math.floor(rng() * pairs.length)];
      var tx = 1120 + rng() * 200, ty = 320 + rng() * 260;
      var y1 = 140 + rng() * 130, y2 = 660 + rng() * 130;
      var w1 = { x: 520 + rng() * 260, y: y1 };
      var w2 = { x: 520 + rng() * 260, y: y2 };
      return {
        multi: [
          { emitter: E(130, y1, 0, pick[0], { intensity: 1.5 }),
            receiver: R(tx, ty, { color: pick[2], minIntensity: 1.4 }, { radius: 38 }),
            path: [w1] },
          { emitter: E(130, y2, 0, pick[1], { intensity: 1.5 }),
            receiver: R(tx, ty, { color: pick[2], minIntensity: 1.4 }, { radius: 38 }),
            path: [w2] }
        ],
        inventory: [{ type: 'mirror', count: 3 }]
      };
    }
  });

  /* --- 4. Fog run: the same shape, but distance now costs you. ------------ */
  TEMPLATES.push({
    id: 'fog',
    name: 'Fog Run',
    blurb: 'Thick air. Take the short way.',
    build: function (rng) {
      var n = 2 + Math.floor(rng() * 2);
      var xs = spread(rng, n, 420, 1120, 0.4);
      var ys = [];
      for (var i = 0; i < n; i++) ys.push(200 + rng() * 500);
      var path = [];
      for (i = 0; i < n; i++) path.push({ x: xs[i], y: ys[i] });
      return {
        fog: 0.00055 + rng() * 0.00035,
        weather: 'murk',
        emitter: E(130, ys[0], 0, 'white', { intensity: 2.6 }),
        receiver: R(1450, 200 + rng() * 500, { color: 'any', minIntensity: 0.3 }),
        path: path,
        inventory: [{ type: 'mirror', count: n + 1 }]
      };
    }
  });

  /* ==========================================================================
   * Generation
   * ======================================================================= */

  function assemble(spec, meta) {
    var emitters = [], receivers = [], solution = [];

    function addChain(ch) {
      var res = A.chain(ch.emitter, ch.path, ch.receiver, { snap: 15 });
      var em = {};
      for (var k in ch.emitter) em[k] = ch.emitter[k];
      em.angle = res.emitterAngle;
      emitters.push(em);
      var dup = receivers.some(function (r) {
        return Math.abs(r.x - ch.receiver.x) < 1 && Math.abs(r.y - ch.receiver.y) < 1;
      });
      if (!dup) receivers.push(ch.receiver);
      res.placements.forEach(function (p) { solution.push(p); });
    }

    if (spec.multi) spec.multi.forEach(addChain);
    else addChain({ emitter: spec.emitter, receiver: spec.receiver, path: spec.path });

    return {
      id: meta.id,
      chapter: 'daily',
      name: meta.name,
      blurb: meta.blurb,
      world: WORLD,
      fog: spec.fog,
      weather: spec.weather,
      emitters: emitters,
      receivers: receivers,
      fixed: [],
      walls: spec.walls || [],
      inventory: spec.inventory,
      solution: solution,
      par: { objects: solution.length, bounces: solution.length },
      daily: true,
      seedKey: meta.seedKey,
      template: meta.template
    };
  }

  /**
   * Does this candidate actually work? Runs the real solver over the reference
   * solution and also insists the level is not already solved for free.
   */
  function isPlayable(level) {
    try {
      var bare = Sc.fromLevel(level);
      if (Sc.evaluate(bare).allLit) return false;      /* free win */

      var sc = Sc.fromLevel(level);
      if (Sc.applySolution(sc) !== level.solution.length) return false;
      var ev = Sc.evaluate(sc);
      if (!ev.allLit) return false;

      /* Reject layouts where two placed objects overlap badly enough that the
       * player could not physically build the intended answer. */
      for (var i = 0; i < level.solution.length; i++) {
        for (var j = i + 1; j < level.solution.length; j++) {
          var a = level.solution[i], b = level.solution[j];
          var d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < 90) return false;
        }
        /* And keep objects clear of the frame. */
        if (level.solution[i].x < 90 || level.solution[i].x > WORLD.w - 90 ||
            level.solution[i].y < 90 || level.solution[i].y > WORLD.h - 90) return false;
      }
      level.par.bounces = ev.bounces;
      level.par.objects = ev.objects;
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Generate the level for a given date key. Deterministic: same key in, same
   * level out, on every device.
   */
  function generate(key) {
    var k = key || dateKey();
    var seed = seedFor(k);
    var rng = M.rng(seed);

    /* Difficulty drifts across the week so dailies are not all the same size. */
    var dayOfWeek = new Date(k + 'T00:00:00Z').getUTCDay();
    var difficulty = 0.3 + (dayOfWeek / 6) * 0.6;

    var order = [0, 1, 2, 3].sort(function () { return rng() - 0.5; });

    for (var attempt = 0; attempt < 40; attempt++) {
      var tpl = TEMPLATES[order[attempt % order.length]];
      var spec = tpl.build(rng, difficulty);
      var level = assemble(spec, {
        id: 'daily-' + k,
        name: tpl.name,
        blurb: tpl.blurb,
        seedKey: k,
        template: tpl.id
      });
      if (isPlayable(level)) {
        level.attempts = attempt + 1;
        return level;
      }
    }

    /* Fallback: a plain two-mirror level that cannot fail to work. Reaching
     * this would mean every template rolled badly forty times in a row, but a
     * daily challenge must never simply fail to appear. */
    return assemble({
      emitter: E(140, 260, 0, 'white', { intensity: 1.5 }),
      receiver: R(1440, 700, { color: 'any', minIntensity: 0.4 }),
      path: [{ x: 700, y: 260 }, { x: 700, y: 700 }],
      inventory: [{ type: 'mirror', count: 3 }]
    }, { id: 'daily-' + k, name: 'Fallback Run',
         blurb: 'A straightforward two-turn relay.', seedKey: k, template: 'fallback' });
  }

  /** Seconds until the next daily rolls over (UTC midnight). */
  function timeUntilNext() {
    var now = new Date();
    var next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return Math.max(0, Math.floor((next - now.getTime()) / 1000));
  }

  function formatCountdown(sec) {
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' +
           String(s).padStart(2, '0');
  }

  LP.Daily = {
    TEMPLATES: TEMPLATES,
    dateKey: dateKey,
    seedFor: seedFor,
    generate: generate,
    isPlayable: isPlayable,
    timeUntilNext: timeUntilNext,
    formatCountdown: formatCountdown
  };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
