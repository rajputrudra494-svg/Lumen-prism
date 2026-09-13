/* =============================================================================
 * Lumen Path - src/optics/raytracer.js
 * -----------------------------------------------------------------------------
 * The custom optics solver. Breadth-first propagation of a ray tree.
 *
 * WHY BREADTH-FIRST
 * Beam splitters, prisms and gratings turn one ray into many, so a path is a
 * tree rather than a line. Walking it breadth-first means the whole scene is
 * resolved in order of bounce count, which gives three things for free:
 *   - a natural budget (stop at depth N or after R rays) that degrades by
 *     dropping the least important, deepest branches first;
 *   - segments that arrive already sorted by generation, which is exactly the
 *     order the "beam travels outward" animation wants to draw them in;
 *   - no recursion depth risk on pathological scenes.
 *
 * ATTENUATION
 * Three independent losses, all multiplicative:
 *   1. Distance      I *= exp(-k_air * d)      -- thin ambient loss
 *   2. Fog / weather I *= exp(-k_fog * d)      -- per-chapter atmosphere
 *   3. Medium        I *= exp(-k_mat * d)      -- Beer-Lambert inside glass
 * plus per-surface losses applied by each element in elements.js.
 * ========================================================================== */
(function (LP) {
  'use strict';

  var V = LP.V, G = LP.Geom, S = LP.Spectrum, Mat = LP.Materials, E = LP.Elements;

  var DEFAULTS = {
    maxDepth: 26,        /* bounces before a branch is abandoned */
    maxRays: 1400,       /* total rays processed per trace */
    maxSegments: 3000,   /* drawn segments cap */
    minIntensity: 0.012, /* below this a beam has visibly faded out */
    airAbsorb: 0.00010,  /* per world unit; ~15% loss across a full screen */
    fog: 0                /* extra atmospheric absorption, set per chapter */
  };

  /* --------------------------------------------------------------------------
   * Seed rays from an emitter.
   *
   * An emitter can be:
   *   - a pencil beam (default): one ray
   *   - a parallel bundle (`width` > 0): N parallel rays across the aperture.
   *     This is what makes mirror LENGTH matter -- a short mirror clips part of
   *     the bundle and loses that fraction of the energy -- and what lets a
   *     concave mirror actually demonstrate a focus.
   *   - a fan (`spread` > 0): N rays across an angular spread.
   * Total emitted energy is `intensity` regardless of ray count, so splitting
   * an emitter into more rays never changes how bright a receiver reads.
   * ------------------------------------------------------------------------ */
  function seedRays(em, out) {
    var count = Math.max(1, em.rays || 1);
    var color = S.resolveColor(em.color);
    /* An emitter can declare its colour three ways, in priority order:
     *   wavelength: 532        explicit, always monochromatic
     *   color: 650             a bare number is read as nanometres
     *   color: 'red'           a named colour carries its representative
     *                          wavelength; 'white' stays polychromatic (null)
     * A hex string has no single wavelength, so it stays polychromatic too. */
    var wl;
    if (em.wavelength !== undefined) wl = em.wavelength;
    else if (typeof em.color === 'number') wl = em.color;
    else if (typeof em.color === 'string') wl = S.NAMED_NM[em.color];
    if (wl === undefined) wl = null;

    var baseI = (em.intensity === undefined ? 1 : em.intensity) / count;
    var d0 = V.fromAngle(em.angle);
    var perp = V.perp(d0);

    for (var i = 0; i < count; i++) {
      var t = count === 1 ? 0.5 : i / (count - 1);
      var o, d;
      if (em.width) {
        var off = (t - 0.5) * em.width;
        o = { x: em.x + perp.x * off, y: em.y + perp.y * off };
        d = d0;
      } else if (em.spread) {
        var a = em.angle + (t - 0.5) * em.spread;
        o = { x: em.x, y: em.y };
        d = V.fromAngle(a);
      } else {
        o = { x: em.x, y: em.y };
        d = d0;
      }
      out.push({
        o: { x: o.x + d.x * 0.5, y: o.y + d.y * 0.5 },
        d: d,
        intensity: baseI,
        color: color,
        wl: wl,
        pol: em.polarization === undefined ? null : em.polarization,
        ior: 1.0,
        inside: null,
        depth: 0,
        pathLen: 0,
        emitter: em.id,
        source: em.id,
        via: 'emit'
      });
    }
  }

  /* --------------------------------------------------------------------------
   * trace(scene, opts)
   *
   * Returns:
   *   segments  [{ a, b, c, i0, i1, wl, depth, t0, t1, via }]
   *             c is the RGB the segment should be drawn in; i0/i1 are the
   *             intensities at each end so the renderer can fade along it.
   *   deposits  { receiverId: { color, intensity, count, byWavelength } }
   *   stats     { rays, segments, truncated, maxPath }
   * ------------------------------------------------------------------------ */
  function trace(scene, opts) {
    var o = opts || {};
    var maxDepth   = o.maxDepth   !== undefined ? o.maxDepth   : (scene.maxDepth   || DEFAULTS.maxDepth);
    var maxRays    = o.maxRays    !== undefined ? o.maxRays    : (scene.maxRays    || DEFAULTS.maxRays);
    var maxSegs    = o.maxSegments!== undefined ? o.maxSegments: (scene.maxSegments|| DEFAULTS.maxSegments);
    var minI       = o.minIntensity !== undefined ? o.minIntensity : DEFAULTS.minIntensity;
    var airK       = (scene.airAbsorb === undefined ? DEFAULTS.airAbsorb : scene.airAbsorb);
    var fogK       = (scene.fog === undefined ? DEFAULTS.fog : scene.fog);
    var bounds     = scene.bounds || { x: 0, y: 0, w: 1600, h: 900 };

    /* Colliders: everything with geometry. Emitters build no primitives, so
     * beams sail over their own source. */
    var els = scene.elements;
    var byId = scene.byId || (function () {
      var m = {};
      for (var i = 0; i < els.length; i++) m[els[i].id] = els[i];
      return m;
    })();

    var ctx = {
      byId: byId,
      scene: scene,
      maxDepth: maxDepth,
      time: scene.time || 0
    };

    var segments = [];
    var deposits = {};
    var energyByElement = {};      /* feeds the thermal-mirror heat model */

    var queue = [];
    for (var e = 0; e < scene.emitters.length; e++) {
      var em = scene.emitters[e];
      if (em.disabled) continue;
      seedRays(em, queue);
    }

    var head = 0;
    var processed = 0;
    var truncated = false;
    var maxPath = 0;

    while (head < queue.length) {
      if (processed >= maxRays || segments.length >= maxSegs) { truncated = true; break; }
      var ray = queue[head++];
      processed++;

      if (ray.intensity < minI) continue;

      /* ---- 1. Nearest surface along the ray ----------------------------- */
      var bestT = Infinity, bestHit = null, bestEl = null;
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.disabled) continue;
        var h = E.intersect(el, ray.o, ray.d, bestT);
        if (h && h.t < bestT) { bestT = h.t; bestHit = h; bestEl = el; }
      }

      /* ---- 2. World edge, if nothing was struck first -------------------- */
      var endP, hitBound = false;
      var bh = G.rayAABB(ray.o, ray.d, bounds.x, bounds.y, bounds.w, bounds.h);
      /* rayAABB from inside the box returns the far wall, which is what we want. */
      if (bh && bh.t < bestT) { bestT = bh.t; bestHit = null; bestEl = null; hitBound = true; }
      if (!bestHit && !hitBound) {
        /* Degenerate (ray started outside bounds heading away) -- drop it. */
        continue;
      }
      endP = { x: ray.o.x + ray.d.x * bestT, y: ray.o.y + ray.d.y * bestT };

      /* ---- 3. Attenuation across the free-flight distance ---------------- */
      var dist = bestT;
      var k = airK + fogK;
      if (ray.inside && byId[ray.inside]) {
        k += Mat.absorbanceOf(byId[ray.inside].material || 'crown');
      }
      var iStart = ray.intensity;
      var iEnd = iStart * Math.exp(-k * dist);

      var t1 = ray.pathLen + dist;
      if (t1 > maxPath) maxPath = t1;

      segments.push({
        a: ray.o, b: endP,
        c: ray.color,
        i0: iStart, i1: iEnd,
        wl: ray.wl,
        depth: ray.depth,
        t0: ray.pathLen, t1: t1,
        inside: ray.inside,
        via: ray.via,
        source: ray.source
      });

      if (hitBound || !bestEl) continue;              /* absorbed by the frame */
      if (iEnd < minI) continue;                      /* faded out en route */

      /* ---- 4. Receivers tally what lands on them ------------------------- */
      if (bestEl.type === 'receiver') {
        var dep = deposits[bestEl.id];
        if (!dep) {
          dep = deposits[bestEl.id] = {
            color: { r: 0, g: 0, b: 0 }, intensity: 0, count: 0,
            wavelengths: [], polarised: null, hitPoints: []
          };
        }
        /* Additive mixing, weighted by how much energy each beam brought.
         * Two half-intensity beams, one red and one green, therefore land on
         * the receiver as yellow. */
        dep.intensity += iEnd;
        dep.color.r += ray.color.r * iEnd;
        dep.color.g += ray.color.g * iEnd;
        dep.color.b += ray.color.b * iEnd;
        dep.count++;
        if (ray.wl !== null) dep.wavelengths.push({ nm: ray.wl, i: iEnd });
        if (ray.pol !== null && ray.pol !== undefined) dep.polarised = ray.pol;
        if (dep.hitPoints.length < 48) dep.hitPoints.push({ p: endP, i: iEnd, c: ray.color });
        continue;
      }

      /* ---- 5. Heat bookkeeping for thermal elements ---------------------- */
      if (bestEl.thermal) {
        energyByElement[bestEl.id] = (energyByElement[bestEl.id] || 0) + iEnd;
      }

      /* ---- 6. Let the element decide what happens next ------------------- */
      if (ray.depth >= maxDepth) { truncated = true; continue; }

      var advanced = {
        o: endP, d: ray.d, intensity: iEnd, color: ray.color, wl: ray.wl,
        pol: ray.pol, ior: ray.ior, inside: ray.inside, depth: ray.depth,
        pathLen: t1, emitter: ray.emitter, source: ray.source,
        polarizedBy: ray.polarizedBy || null
      };
      var kids = E.interact(bestEl, advanced, bestHit, ctx);
      for (var kdx = 0; kdx < kids.length; kdx++) {
        var kid = kids[kdx];
        if (kid.intensity < minI) continue;
        kid.pathLen = t1;
        kid.emitter = ray.emitter;
        queue.push(kid);
      }
    }

    return {
      segments: segments,
      deposits: deposits,
      energyByElement: energyByElement,
      stats: {
        rays: processed,
        queued: queue.length,
        segments: segments.length,
        truncated: truncated,
        maxPath: maxPath
      }
    };
  }

  /* --------------------------------------------------------------------------
   * tracePreview
   * A cheap single-ray trace used for the live aiming line while the player
   * drags a mirror. Deliberately shallow so it can run every pointer-move.
   * ------------------------------------------------------------------------ */
  function tracePreview(scene, fromEmitter, depth) {
    return trace(scene, {
      maxDepth: depth || 8,
      maxRays: 120,
      maxSegments: 200
    });
  }

  /* --------------------------------------------------------------------------
   * Bounce counting for the star rating: how many times did light actually
   * interact with a player-placed object on a path that reached a receiver?
   * ------------------------------------------------------------------------ */
  function countInteractions(result) {
    var n = 0;
    for (var i = 0; i < result.segments.length; i++) {
      if (result.segments[i].depth > 0) n++;
    }
    return n;
  }

  LP.Tracer = {
    DEFAULTS: DEFAULTS,
    trace: trace,
    tracePreview: tracePreview,
    seedRays: seedRays,
    countInteractions: countInteractions
  };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
