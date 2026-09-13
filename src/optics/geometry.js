/* =============================================================================
 * Lumen Path - src/optics/geometry.js
 * -----------------------------------------------------------------------------
 * Ray/primitive intersection routines. Everything the tracer can hit reduces to
 * one of three primitives:
 *
 *   SEGMENT  { kind:'seg', a, b }              flat mirrors, filters, splitters
 *   ARC      { kind:'arc', c, r, a0, sweep }   curved mirrors, lens faces
 *   POLYGON  { kind:'poly', pts }              prisms, glass blocks
 *
 * Each intersection returns a HIT record:
 *
 *   { t, p, n, u, prim }
 *     t    distance along the ray (world units)
 *     p    world-space hit point
 *     n    unit surface normal, ALWAYS oriented against the incoming ray so
 *          that dot(dir, n) < 0. `entering` records which geometric side we
 *          came from, which is what polygons need to decide enter vs. exit.
 *     u    0..1 parameter along the primitive (used for portals and for
 *          fading a beam near a mirror's edge)
 * ========================================================================== */
(function (LP) {
  'use strict';

  var V = LP.V;
  var M = LP.M;

  /* Rays are nudged this far off a surface before continuing, so a child ray
   * cannot immediately re-hit the surface that spawned it. */
  var SURFACE_EPS = 1e-4;
  var T_MIN = 1e-6;

  /* --------------------------------------------------------------------------
   * SEGMENT
   * Solve  o + t*d  =  a + u*(b - a)   for t >= 0 and u in [0,1].
   * ------------------------------------------------------------------------ */
  function raySegment(o, d, a, b) {
    var ex = b.x - a.x, ey = b.y - a.y;
    var denom = d.x * ey - d.y * ex;
    if (Math.abs(denom) < 1e-12) return null;      /* parallel */

    var qx = a.x - o.x, qy = a.y - o.y;
    var t = (qx * ey - qy * ex) / denom;
    if (t < T_MIN) return null;

    var u = (qx * d.y - qy * d.x) / denom;
    if (u < 0 || u > 1) return null;

    /* Left-hand normal of the segment direction, then flipped to face the ray. */
    var nlen = Math.sqrt(ex * ex + ey * ey);
    var nx = -ey / nlen, ny = ex / nlen;
    var facing = (d.x * nx + d.y * ny) < 0;
    if (!facing) { nx = -nx; ny = -ny; }

    return {
      t: t,
      p: { x: o.x + d.x * t, y: o.y + d.y * t },
      n: { x: nx, y: ny },
      u: u,
      entering: facing            /* true when we struck the segment's front */
    };
  }

  /* --------------------------------------------------------------------------
   * CIRCLE (full) -- used by portals, receivers and lens construction.
   * Returns the nearest positive root.
   * ------------------------------------------------------------------------ */
  function rayCircle(o, d, c, r) {
    var ox = o.x - c.x, oy = o.y - c.y;
    var b = ox * d.x + oy * d.y;              /* d is unit, so a == 1 */
    var cc = ox * ox + oy * oy - r * r;
    var disc = b * b - cc;
    if (disc < 0) return null;
    var sq = Math.sqrt(disc);
    var t = -b - sq;
    var inside = false;
    if (t < T_MIN) { t = -b + sq; inside = true; }
    if (t < T_MIN) return null;

    var p = { x: o.x + d.x * t, y: o.y + d.y * t };
    var nx = (p.x - c.x) / r, ny = (p.y - c.y) / r;
    if (inside) { nx = -nx; ny = -ny; }        /* face the ray from within */
    return {
      t: t, p: p, n: { x: nx, y: ny },
      u: M.wrapAngle2(Math.atan2(p.y - c.y, p.x - c.x)) / M.TAU,
      entering: !inside
    };
  }

  /** Is `ang` inside the arc that starts at a0 and sweeps `sweep` radians? */
  function angleInArc(ang, a0, sweep) {
    if (sweep >= M.TAU) return true;
    var rel;
    if (sweep >= 0) {
      rel = M.wrapAngle2(ang - a0);
      return rel <= sweep;
    }
    rel = M.wrapAngle2(a0 - ang);
    return rel <= -sweep;
  }

  /* --------------------------------------------------------------------------
   * ARC -- a circle restricted to an angular span.
   *
   * This is what makes curved mirrors genuinely focus: the normal at the hit
   * point is the true radial direction, so R = D - 2(D.N)N converges parallel
   * rays near r/2 all by itself. No focal-point fudging anywhere.
   * ------------------------------------------------------------------------ */
  function rayArc(o, d, c, r, a0, sweep) {
    var ox = o.x - c.x, oy = o.y - c.y;
    var b = ox * d.x + oy * d.y;
    var cc = ox * ox + oy * oy - r * r;
    var disc = b * b - cc;
    if (disc < 0) return null;
    var sq = Math.sqrt(disc);

    /* Both roots must be considered: the near one may fall outside the span. */
    var roots = [-b - sq, -b + sq];
    for (var i = 0; i < 2; i++) {
      var t = roots[i];
      if (t < T_MIN) continue;
      var px = o.x + d.x * t, py = o.y + d.y * t;
      var ang = Math.atan2(py - c.y, px - c.x);
      if (!angleInArc(ang, a0, sweep)) continue;

      var nx = (px - c.x) / r, ny = (py - c.y) / r;
      var facing = (d.x * nx + d.y * ny) < 0;
      if (!facing) { nx = -nx; ny = -ny; }

      var rel = sweep >= 0 ? M.wrapAngle2(ang - a0) : M.wrapAngle2(a0 - ang);
      return {
        t: t,
        p: { x: px, y: py },
        n: { x: nx, y: ny },
        u: Math.abs(sweep) < 1e-9 ? 0 : rel / Math.abs(sweep),
        entering: facing
      };
    }
    return null;
  }

  /* --------------------------------------------------------------------------
   * POLYGON -- nearest edge hit. Points are expected counter-clockwise in a
   * y-down screen space, but the code does not depend on winding: `entering`
   * is derived from the dot product with the ray, and callers additionally use
   * pointInPolygon to know whether they started inside.
   * ------------------------------------------------------------------------ */
  function rayPolygon(o, d, pts) {
    var best = null;
    var n = pts.length;
    for (var i = 0; i < n; i++) {
      var a = pts[i], b = pts[(i + 1) % n];
      var h = raySegment(o, d, a, b);
      if (h && (!best || h.t < best.t)) { h.edge = i; best = h; }
    }
    return best;
  }

  function pointInPolygon(p, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var xi = pts[i].x, yi = pts[i].y, xj = pts[j].x, yj = pts[j].y;
      var hit = ((yi > p.y) !== (yj > p.y)) &&
                (p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi);
      if (hit) inside = !inside;
    }
    return inside;
  }

  /* --------------------------------------------------------------------------
   * AXIS-ALIGNED BOX -- walls and placement zones. Slab method.
   * ------------------------------------------------------------------------ */
  function rayAABB(o, d, x, y, w, h) {
    var invx = d.x !== 0 ? 1 / d.x : Infinity;
    var invy = d.y !== 0 ? 1 / d.y : Infinity;
    var t1 = (x - o.x) * invx, t2 = (x + w - o.x) * invx;
    var t3 = (y - o.y) * invy, t4 = (y + h - o.y) * invy;
    var tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
    var tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));
    if (tmax < 0 || tmin > tmax) return null;
    var t = tmin >= T_MIN ? tmin : tmax;
    if (t < T_MIN) return null;

    var p = { x: o.x + d.x * t, y: o.y + d.y * t };
    /* Pick the normal from whichever slab produced tmin. */
    var nx = 0, ny = 0;
    var e = 1e-6;
    if (Math.abs(p.x - x) < e) nx = -1;
    else if (Math.abs(p.x - (x + w)) < e) nx = 1;
    else if (Math.abs(p.y - y) < e) ny = -1;
    else ny = 1;
    if (d.x * nx + d.y * ny > 0) { nx = -nx; ny = -ny; }
    return { t: t, p: p, n: { x: nx, y: ny }, u: 0, entering: true };
  }

  function pointInAABB(p, x, y, w, h) {
    return p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
  }

  /* --------------------------------------------------------------------------
   * Utilities the UI needs for hit-testing and handles.
   * ------------------------------------------------------------------------ */
  function closestPointOnSegment(p, a, b) {
    var ex = b.x - a.x, ey = b.y - a.y;
    var l2 = ex * ex + ey * ey;
    if (l2 < 1e-12) return { p: { x: a.x, y: a.y }, t: 0, d: V.dist(p, a) };
    var t = ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2;
    t = M.clamp(t, 0, 1);
    var q = { x: a.x + ex * t, y: a.y + ey * t };
    return { p: q, t: t, d: V.dist(p, q) };
  }

  function distToSegment(p, a, b) { return closestPointOnSegment(p, a, b).d; }

  /** Bounding box of a point list, optionally padded. */
  function bboxOf(pts, pad) {
    var pd = pad || 0;
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i].x < minx) minx = pts[i].x;
      if (pts[i].y < miny) miny = pts[i].y;
      if (pts[i].x > maxx) maxx = pts[i].x;
      if (pts[i].y > maxy) maxy = pts[i].y;
    }
    return { x: minx - pd, y: miny - pd, w: (maxx - minx) + pd * 2, h: (maxy - miny) + pd * 2 };
  }

  function aabbOverlap(a, b) {
    return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
  }

  /**
   * Fast reject before running exact intersection: does the ray reach this box?
   * The tracer calls this per element per ray, so it is deliberately branchy
   * and allocation-free.
   */
  function rayHitsAABB(o, d, box, maxT) {
    var invx = d.x !== 0 ? 1 / d.x : 1e30;
    var invy = d.y !== 0 ? 1 / d.y : 1e30;
    var t1 = (box.x - o.x) * invx, t2 = (box.x + box.w - o.x) * invx;
    var t3 = (box.y - o.y) * invy, t4 = (box.y + box.h - o.y) * invy;
    var tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
    var tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));
    return tmax >= 0 && tmin <= tmax && tmin <= maxT;
  }

  /* --------------------------------------------------------------------------
   * Primitive builders used by optical elements.
   * ------------------------------------------------------------------------ */

  /** Endpoints of a segment centred at c, rotated by `ang`, of total length L. */
  function segmentEnds(c, ang, L) {
    var hx = Math.cos(ang) * L * 0.5, hy = Math.sin(ang) * L * 0.5;
    return [{ x: c.x - hx, y: c.y - hy }, { x: c.x + hx, y: c.y + hy }];
  }

  /**
   * Build an arc through a chord of length L centred at `c` with orientation
   * `ang`, bowed by `curvature` in [-1, 1].
   *
   * SIGN CONVENTION. A surface's "front" is its left-normal side, i.e. the
   * direction (ang + 90deg), which is the face the level author points at the
   * light. Then:
   *
   *   curvature > 0  CONCAVE from the front -- the surface bows away from the
   *                  viewer and the centre of curvature sits in front of it,
   *                  so a parallel bundle converges near R/2.
   *   curvature < 0  CONVEX from the front -- bulges toward the viewer and
   *                  spreads the bundle.
   *   curvature = 0  flat; the caller should fall back to a segment.
   *
   * That is why the sagitta below is negated: a positive curvature has to
   * displace the surface along -n for the hollow to face the front.
   *
   * From the chord half-length a = L/2 and the sagitta s, the circle radius is
   *
   *       R = (a^2 + s^2) / (2s)
   *
   * which keeps the arc endpoints pinned to the chord ends no matter how the
   * player flexes the mirror. That matters: it means resizing and flexing are
   * independent controls rather than fighting each other.
   */
  function arcFromChord(c, ang, L, curvature) {
    var a = L * 0.5;
    /* Negated so that positive curvature reads as concave-from-the-front.
     * 0.85 caps the bow short of a full semicircle, where R would collapse. */
    var s = -curvature * a * 0.85;
    if (Math.abs(s) < 1e-6) return null;     /* flat: use a segment instead */

    var R = (a * a + s * s) / (2 * Math.abs(s));
    var sign = s > 0 ? 1 : -1;

    /* Chord direction and its left normal. */
    var dx = Math.cos(ang), dy = Math.sin(ang);
    var nx = -dy, ny = dx;

    /* Circle centre sits on the normal, offset so the sagitta comes out right. */
    var off = (R - Math.abs(s)) * sign;
    var cc = { x: c.x - nx * off, y: c.y - ny * off };

    var e = segmentEnds(c, ang, L);
    var a0 = Math.atan2(e[0].y - cc.y, e[0].x - cc.x);
    var a1 = Math.atan2(e[1].y - cc.y, e[1].x - cc.x);

    /* Choose the sweep direction that keeps the arc on the bowed side. */
    var sweep = M.wrapAngle(a1 - a0);
    var mid = a0 + sweep * 0.5;
    var mp = { x: cc.x + Math.cos(mid) * R, y: cc.y + Math.sin(mid) * R };
    var wantSide = sign * ((mp.x - c.x) * nx + (mp.y - c.y) * ny);
    if (wantSide < 0) {
      /* Take the long way round the circle instead. */
      sweep = sweep > 0 ? sweep - M.TAU : sweep + M.TAU;
    }
    return { c: cc, r: R, a0: a0, sweep: sweep, ends: e, sagitta: s };
  }

  /** Regular polygon (used for prisms and default glass blocks). */
  function regularPolygon(c, ang, radius, sides) {
    var pts = [];
    for (var i = 0; i < sides; i++) {
      var a = ang + (i / sides) * M.TAU - Math.PI / 2;
      pts.push({ x: c.x + Math.cos(a) * radius, y: c.y + Math.sin(a) * radius });
    }
    return pts;
  }

  function rectPolygon(c, ang, w, h) {
    var hw = w * 0.5, hh = h * 0.5;
    var ca = Math.cos(ang), sa = Math.sin(ang);
    var raw = [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }];
    return raw.map(function (p) {
      return { x: c.x + p.x * ca - p.y * sa, y: c.y + p.x * sa + p.y * ca };
    });
  }

  function transformPoints(pts, c, ang, scale) {
    var ca = Math.cos(ang), sa = Math.sin(ang), s = scale === undefined ? 1 : scale;
    return pts.map(function (p) {
      var x = p.x * s, y = p.y * s;
      return { x: c.x + x * ca - y * sa, y: c.y + x * sa + y * ca };
    });
  }

  LP.Geom = {
    SURFACE_EPS: SURFACE_EPS,
    T_MIN: T_MIN,
    raySegment: raySegment,
    rayCircle: rayCircle,
    rayArc: rayArc,
    rayPolygon: rayPolygon,
    rayAABB: rayAABB,
    rayHitsAABB: rayHitsAABB,
    pointInPolygon: pointInPolygon,
    pointInAABB: pointInAABB,
    angleInArc: angleInArc,
    closestPointOnSegment: closestPointOnSegment,
    distToSegment: distToSegment,
    bboxOf: bboxOf,
    aabbOverlap: aabbOverlap,
    segmentEnds: segmentEnds,
    arcFromChord: arcFromChord,
    regularPolygon: regularPolygon,
    rectPolygon: rectPolygon,
    transformPoints: transformPoints
  };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
