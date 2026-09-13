/* =============================================================================
 * Lumen Path - src/game/authoring.js
 * -----------------------------------------------------------------------------
 * Helpers used to write levels, and to prove they are solvable.
 *
 * The central idea: a mirror puzzle is authored as a POLYLINE the light is
 * meant to walk --
 *
 *     emitter -> waypoint -> waypoint -> ... -> receiver
 *
 * and `chain()` solves for the mirror angle at each waypoint exactly. The
 * result is stored on the level as its reference `solution`, which serves
 * three purposes at once:
 *
 *   1. tools/verify.js replays it and asserts every receiver lights, so no
 *      shipped level can be unsolvable;
 *   2. the in-game hint system can reveal one placement at a time;
 *   3. the ghost replay animates it.
 *
 * The player never sees the polyline -- there are normally many other valid
 * solutions, and the star pars are set against the authored one.
 * ========================================================================== */
(function (LP) {
  'use strict';

  var V = LP.V, M = LP.M;

  /* --------------------------------------------------------------------------
   * aimAngle
   *
   * Given light arriving at `at` from `from`, and a desired outgoing target
   * `to`, return the SURFACE angle a flat mirror must have.
   *
   * The mirror normal must bisect the incoming and outgoing directions:
   *
   *     N = normalise( out - in )
   *
   * Substituting into R = D - 2(D·N)N returns exactly `out`, so this is not an
   * approximation -- it is the closed-form inverse of the reflection law.
   * The surface runs perpendicular to N.
   * ------------------------------------------------------------------------ */
  function aimAngle(from, at, to) {
    var i = V.norm(V.sub(at, from));      /* direction light is travelling */
    var o = V.norm(V.sub(to, at));        /* direction we want it to leave */
    var n = V.norm(V.sub(o, i));
    if (V.len2(n) < 1e-12) {
      /* Straight-back retroreflection: the surface is perpendicular to i. */
      return Math.atan2(i.y, i.x) + Math.PI / 2;
    }
    return Math.atan2(n.y, n.x) + Math.PI / 2;
  }

  /** Angle of the vector a -> b, in radians. */
  function dirAngle(a, b) { return Math.atan2(b.y - a.y, b.x - a.x); }

  /** Point `dist` units from `p` along `angDeg`. */
  function along(p, angDeg, dist) {
    var a = M.rad(angDeg);
    return { x: p.x + Math.cos(a) * dist, y: p.y + Math.sin(a) * dist };
  }

  function snapDeg(rad, step) {
    var st = step === undefined ? 15 : step;
    var d = M.deg(rad);
    return M.rad(Math.round(d / st) * st);
  }

  /* --------------------------------------------------------------------------
   * chain
   *
   * Build the reference solution for a polyline puzzle.
   *
   *   E     emitter position
   *   wps   ordered waypoints (one mirror each)
   *   R     receiver position
   *   opts  { snap: degrees to snap the emitter to (default 15),
   *           type: element type for each mirror (default 'mirror'),
   *           length: mirror length, or per-waypoint via wp.length,
   *           props: extra properties merged into every placement }
   *
   * Returns { emitterAngle, placements: [...] }.
   *
   * The emitter's launch angle is snapped to a readable increment and the
   * first waypoint is re-projected onto that exact ray, so the authored
   * solution stays perfectly consistent with the emitter the player sees.
   * ------------------------------------------------------------------------ */
  function chain(E, wps, R, opts) {
    var o = opts || {};
    var snap = o.snap === undefined ? 15 : o.snap;
    var pts = wps.map(function (w) { return { x: w.x, y: w.y, wp: w }; });

    var emitterAngle = dirAngle(E, pts[0]);
    if (snap > 0) {
      var d0 = V.dist(E, pts[0]);
      emitterAngle = snapDeg(emitterAngle, snap);
      /* Re-project waypoint 0 onto the snapped ray, preserving its distance. */
      pts[0].x = E.x + Math.cos(emitterAngle) * d0;
      pts[0].y = E.y + Math.sin(emitterAngle) * d0;
    }

    var placements = [];
    for (var i = 0; i < pts.length; i++) {
      var prev = i === 0 ? E : pts[i - 1];
      var next = i === pts.length - 1 ? R : pts[i + 1];
      var w = pts[i].wp;
      var pl = {
        type: w.type || o.type || 'mirror',
        x: Math.round(pts[i].x * 100) / 100,
        y: Math.round(pts[i].y * 100) / 100,
        angle: aimAngle(prev, pts[i], next)
      };
      var len = w.length || o.length;
      if (len) pl.length = len;
      var k;
      if (o.props) for (k in o.props) if (Object.prototype.hasOwnProperty.call(o.props, k)) pl[k] = o.props[k];
      if (w.props) for (k in w.props) if (Object.prototype.hasOwnProperty.call(w.props, k)) pl[k] = w.props[k];
      placements.push(pl);
    }
    return { emitterAngle: emitterAngle, placements: placements, points: pts };
  }

  /* --------------------------------------------------------------------------
   * mirrorLevel
   *
   * Sugar over `chain` that emits a complete level object for the common case:
   * one emitter, one or more polyline paths, one receiver per path.
   *
   *   spec = {
   *     id, chapter, name, blurb, hint, par, world, zones, walls, fixed,
   *     emitter: { x, y, color, ... },
   *     receiver: { x, y, require },
   *     path: [ {x,y}, {x,y} ],           // waypoints -> one mirror each
   *     inventory: [...]                  // defaults to one mirror per waypoint
   *   }
   * ------------------------------------------------------------------------ */
  function mirrorLevel(spec) {
    var res = chain(spec.emitter, spec.path, spec.receiver, {
      snap: spec.snap === undefined ? 15 : spec.snap,
      type: spec.mirrorType,
      length: spec.mirrorLength,
      props: spec.mirrorProps
    });

    var em = {};
    var k;
    for (k in spec.emitter) if (Object.prototype.hasOwnProperty.call(spec.emitter, k)) em[k] = spec.emitter[k];
    em.angle = res.emitterAngle;

    var inv = spec.inventory;
    if (!inv) {
      /* Tally the placements by type so the inventory always matches. */
      var counts = {};
      for (var i = 0; i < res.placements.length; i++) {
        var t = res.placements[i].type;
        counts[t] = (counts[t] || 0) + 1;
      }
      inv = [];
      for (var key in counts) if (Object.prototype.hasOwnProperty.call(counts, key)) {
        inv.push({ type: key, count: counts[key] });
      }
    }

    var lvl = {
      id: spec.id,
      chapter: spec.chapter,
      name: spec.name,
      blurb: spec.blurb,
      hint: spec.hint,
      world: spec.world,
      fog: spec.fog,
      zones: spec.zones,
      walls: spec.walls,
      fixed: spec.fixed,
      emitters: [em].concat(spec.extraEmitters || []),
      receivers: [spec.receiver].concat(spec.extraReceivers || []),
      inventory: inv,
      par: spec.par || { objects: res.placements.length, bounces: res.placements.length },
      solution: res.placements,
      holdTime: spec.holdTime,
      sandbox: spec.sandbox,
      tags: spec.tags
    };
    /* Drop undefined keys so serialised levels stay tidy. */
    for (k in lvl) if (lvl[k] === undefined) delete lvl[k];
    return lvl;
  }

  /* --------------------------------------------------------------------------
   * Small builders that keep levels.js readable.
   * ------------------------------------------------------------------------ */
  function emitter(x, y, angleDeg, color, extra) {
    var e = { x: x, y: y, angle: M.rad(angleDeg), color: color || 'white' };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) e[k] = extra[k];
    return e;
  }

  function receiver(x, y, req, extra) {
    var r = { x: x, y: y, require: req || { color: 'any', minIntensity: 0.2 } };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) r[k] = extra[k];
    return r;
  }

  function wall(x, y, w, h) { return { x: x, y: y, w: w, h: h }; }

  function zone(x, y, w, h) { return { x: x, y: y, w: w, h: h }; }

  function fixedEl(type, x, y, angleDeg, extra) {
    var e = { type: type, x: x, y: y, angle: M.rad(angleDeg || 0), locked: true };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) e[k] = extra[k];
    return e;
  }

  /**
   * Where does a beam leaving `p` at `angDeg` cross a given x or y line?
   * Handy for placing receivers exactly on an intended path.
   */
  function hitX(p, angDeg, x) {
    var a = M.rad(angDeg);
    var t = (x - p.x) / Math.cos(a);
    return { x: x, y: p.y + Math.sin(a) * t };
  }
  function hitY(p, angDeg, y) {
    var a = M.rad(angDeg);
    var t = (y - p.y) / Math.sin(a);
    return { x: p.x + Math.cos(a) * t, y: y };
  }

  /* ==========================================================================
   * PHYSICS-DERIVED AUTHORING
   *
   * Curved mirrors and prisms cannot be placed by trigonometry alone -- where
   * a bundle focuses, or where the 470nm band lands, depends on the whole
   * optical path. Rather than hard-code coordinates that could silently drift,
   * these helpers run the real tracer over a stripped-down scene and report
   * where the light actually goes. Levels then place their receivers there.
   *
   * The upshot: a level's targets are correct by construction, and stay
   * correct if the solver is ever tuned.
   * ======================================================================== */

  /**
   * Authoring probes throw rather than return null. A level whose probe finds
   * nothing is a level whose target could never be lit, and it is far better
   * to hear about that on the first load than to ship a dead receiver.
   */
  function mustFind(value, what) {
    if (value === null || value === undefined) {
      throw new Error('level authoring probe found no ' + what +
                      ' -- the arrangement does not send light there');
    }
    return value;
  }

  /** Trace a scratch scene made of just these fixtures and emitters. */
  function probe(fixed, emitters, extra) {
    var lvl = {
      id: '_probe', world: (extra && extra.world) || { w: 1600, h: 900 },
      emitters: emitters, receivers: [], fixed: fixed, inventory: []
    };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) {
      if (k !== 'world') lvl[k] = extra[k];
    }
    var sc = LP.Scene.fromLevel(lvl);
    return { scene: sc, result: LP.Tracer.trace(sc, {}) };
  }

  /**
   * Least-squares intersection of a bundle of rays -- i.e. where they focus.
   *
   * For lines through p_i with unit directions d_i, the point minimising the
   * summed squared perpendicular distance solves
   *
   *     [ SUM (I - d_i d_i^T) ] x  =  SUM (I - d_i d_i^T) p_i
   *
   * which is a 2x2 solve. Returns null if the rays are parallel (no focus).
   */
  function focusOf(segments) {
    var a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0, n = 0;
    for (var i = 0; i < segments.length; i++) {
      var s = segments[i];
      var d = V.norm(V.sub(s.b, s.a));
      /* Projector onto the perpendicular of d. */
      var m11 = 1 - d.x * d.x, m12 = -d.x * d.y, m22 = 1 - d.y * d.y;
      a11 += m11; a12 += m12; a22 += m22;
      b1 += m11 * s.a.x + m12 * s.a.y;
      b2 += m12 * s.a.x + m22 * s.a.y;
      n++;
    }
    if (n < 2) return null;
    var det = a11 * a22 - a12 * a12;
    if (Math.abs(det) < 1e-8) return null;          /* parallel bundle */
    return {
      x: (b1 * a22 - b2 * a12) / det,
      y: (a11 * b2 - a12 * b1) / det
    };
  }

  /**
   * Where does a bundle converge after `bounce` interactions?
   * Used to place receivers exactly at a concave mirror's focus.
   */
  function focusAfter(fixed, emitters, bounce) {
    var p = probe(fixed, emitters);
    var depth = bounce === undefined ? 1 : bounce;
    var segs = p.result.segments.filter(function (s) { return s.depth === depth; });
    var f = mustFind(focusOf(segs), 'convergence point at depth ' + depth);
    return { x: Math.round(f.x * 10) / 10, y: Math.round(f.y * 10) / 10 };
  }

  /**
   * Where does the `nm` band of a dispersed spectrum cross a given line?
   * `axis` is 'x' or 'y' and `value` the coordinate of the line.
   * Returns the crossing point, or null if that band never gets there.
   */
  function bandCrossing(fixed, emitters, nm, axis, value) {
    var p = probe(fixed, emitters);
    var best = null, bestDelta = Infinity;
    for (var i = 0; i < p.result.segments.length; i++) {
      var s = p.result.segments[i];
      if (s.wl === null || s.inside) continue;
      if (Math.abs(s.wl - nm) > bestDelta) continue;
      var d = V.sub(s.b, s.a);
      var t;
      if (axis === 'x') { if (Math.abs(d.x) < 1e-9) continue; t = (value - s.a.x) / d.x; }
      else { if (Math.abs(d.y) < 1e-9) continue; t = (value - s.a.y) / d.y; }
      if (t < 0 || t > 1.0001) continue;
      bestDelta = Math.abs(s.wl - nm);
      best = { x: Math.round((s.a.x + d.x * t) * 10) / 10,
               y: Math.round((s.a.y + d.y * t) * 10) / 10,
               wl: s.wl, intensity: s.i0 * (1 - t) + s.i1 * t };
    }
    return mustFind(best, 'band near ' + nm + 'nm crossing ' + axis + '=' + value);
  }

  /**
   * Follow a single beam through a scene and report where it ends up after
   * `n` interactions. Used to place receivers behind splitters, gratings,
   * portals and glass -- anywhere the geometry is easier to measure than to
   * derive.
   */
  function beamEnd(fixed, emitters, opts) {
    var o = opts || {};
    var p = probe(fixed, emitters, o.sceneExtra);
    var segs = p.result.segments.filter(function (s) {
      if (o.depth !== undefined && s.depth !== o.depth) return false;
      if (o.via !== undefined && s.via !== o.via) return false;
      if (o.inside === false && s.inside) return false;
      return true;
    });
    mustFind(segs.length ? true : null, 'segment matching ' + JSON.stringify(o));
    if (o.pick === 'brightest') {
      segs.sort(function (a, b) { return b.i1 - a.i1; });
    } else if (o.pick === 'last') {
      segs.sort(function (a, b) { return b.t1 - a.t1; });
    }
    var s = segs[o.index || 0];
    return {
      a: s.a, b: s.b, dir: V.norm(V.sub(s.b, s.a)),
      intensity: s.i1, wl: s.wl,
      /* Point `dist` along the segment from its start. */
      at: function (dist) {
        var d = V.norm(V.sub(s.b, s.a));
        return { x: Math.round((s.a.x + d.x * dist) * 10) / 10,
                 y: Math.round((s.a.y + d.y * dist) * 10) / 10 };
      }
    };
  }

  /**
   * Total energy a hypothetical receiver at `p` would collect, given a scene.
   * Levels use this to set `minIntensity` thresholds that are demanding but
   * genuinely reachable.
   */
  function energyAt(fixed, emitters, p, radius, extra) {
    var defs = fixed.slice();
    var lvl = {
      id: '_probe', world: { w: 1600, h: 900 },
      emitters: emitters,
      receivers: [{ x: p.x, y: p.y, radius: radius || 24,
                    require: { color: 'any', minIntensity: 0.0001 } }],
      fixed: defs, inventory: []
    };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) lvl[k] = extra[k];
    var sc = LP.Scene.fromLevel(lvl);
    var res = LP.Tracer.trace(sc, {});
    var dep = res.deposits[sc.receivers[0].id];
    return dep ? { intensity: dep.intensity, count: dep.count,
                   color: LP.Spectrum.colScale(dep.color, 1 / Math.max(1e-6, dep.intensity)) }
               : { intensity: 0, count: 0, color: { r: 0, g: 0, b: 0 } };
  }

  LP.Authoring = {
    probe: probe,
    focusOf: focusOf,
    focusAfter: focusAfter,
    bandCrossing: bandCrossing,
    beamEnd: beamEnd,
    energyAt: energyAt,
    aimAngle: aimAngle,
    dirAngle: dirAngle,
    along: along,
    snapDeg: snapDeg,
    chain: chain,
    mirrorLevel: mirrorLevel,
    emitter: emitter,
    receiver: receiver,
    wall: wall,
    zone: zone,
    fixedEl: fixedEl,
    hitX: hitX,
    hitY: hitY
  };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
