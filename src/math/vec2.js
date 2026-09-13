/* =============================================================================
 * Lumen Path - src/math/vec2.js
 * -----------------------------------------------------------------------------
 * Minimal, allocation-conscious 2D vector math.
 *
 * All optics in this game are derived from these primitives; there is no
 * third-party physics engine anywhere in the light path. Vectors are plain
 * `{x, y}` objects so they serialise straight into level JSON.
 * ========================================================================== */
(function (LP) {
  'use strict';

  var EPS = 1e-9;

  var V = {
    EPS: EPS,

    make: function (x, y) { return { x: x || 0, y: y || 0 }; },
    clone: function (a) { return { x: a.x, y: a.y }; },

    add: function (a, b) { return { x: a.x + b.x, y: a.y + b.y }; },
    sub: function (a, b) { return { x: a.x - b.x, y: a.y - b.y }; },
    mul: function (a, s) { return { x: a.x * s, y: a.y * s }; },

    /** a + b*s  -- the "scale and add" that shows up in every ray march. */
    addMul: function (a, b, s) { return { x: a.x + b.x * s, y: a.y + b.y * s }; },

    dot: function (a, b) { return a.x * b.x + a.y * b.y; },
    /** 2D scalar cross product (z of the 3D cross). Sign tells you which side. */
    cross: function (a, b) { return a.x * b.y - a.y * b.x; },

    len2: function (a) { return a.x * a.x + a.y * a.y; },
    len: function (a) { return Math.sqrt(a.x * a.x + a.y * a.y); },
    dist: function (a, b) { var dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); },
    dist2: function (a, b) { var dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; },

    norm: function (a) {
      var l = Math.sqrt(a.x * a.x + a.y * a.y);
      if (l < EPS) return { x: 0, y: 0 };
      return { x: a.x / l, y: a.y / l };
    },

    /** Left-hand perpendicular. For a surface direction d, this is a normal. */
    perp: function (a) { return { x: -a.y, y: a.x }; },

    neg: function (a) { return { x: -a.x, y: -a.y }; },

    rot: function (a, ang) {
      var c = Math.cos(ang), s = Math.sin(ang);
      return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
    },

    /** Rotate `a` about pivot `p` by `ang` radians. */
    rotAround: function (a, p, ang) {
      var c = Math.cos(ang), s = Math.sin(ang);
      var dx = a.x - p.x, dy = a.y - p.y;
      return { x: p.x + dx * c - dy * s, y: p.y + dx * s + dy * c };
    },

    fromAngle: function (ang, len) {
      var l = (len === undefined) ? 1 : len;
      return { x: Math.cos(ang) * l, y: Math.sin(ang) * l };
    },

    angle: function (a) { return Math.atan2(a.y, a.x); },

    lerp: function (a, b, t) {
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    },

    /* -----------------------------------------------------------------------
     * REFLECTION -- the single most important equation in this game.
     *
     *     R = D - 2 (D . N) N
     *
     * D is the incident direction (unit), N the surface normal (unit).
     * This is exact for any surface orientation, which is why "angle of
     * incidence == angle of reflection" holds automatically at every rotation
     * without a single special case.
     * --------------------------------------------------------------------- */
    reflect: function (D, N) {
      var d = 2 * (D.x * N.x + D.y * N.y);
      return { x: D.x - d * N.x, y: D.y - d * N.y };
    },

    /* -----------------------------------------------------------------------
     * REFRACTION -- vector form of Snell's Law.
     *
     *     n1 sin(theta1) = n2 sin(theta2)
     *
     * `N` must be the normal facing *against* the incident ray (cos_i > 0).
     * `eta` is n1/n2. Returns null when the discriminant goes negative, which
     * is exactly the condition for TOTAL INTERNAL REFLECTION -- the caller is
     * expected to reflect instead.
     * --------------------------------------------------------------------- */
    refract: function (D, N, eta) {
      var cosi = -(D.x * N.x + D.y * N.y);          // = cos(theta1), positive
      var k = 1 - eta * eta * (1 - cosi * cosi);    // = cos^2(theta2)
      if (k < 0) return null;                        // past the critical angle
      var f = eta * cosi - Math.sqrt(k);
      return { x: eta * D.x + f * N.x, y: eta * D.y + f * N.y };
    },

    /** Signed distance from point p to the infinite line through a with dir d. */
    sideOfLine: function (p, a, d) {
      return (p.x - a.x) * d.y - (p.y - a.y) * d.x;
    },

    equals: function (a, b, eps) {
      var e = eps === undefined ? 1e-6 : eps;
      return Math.abs(a.x - b.x) < e && Math.abs(a.y - b.y) < e;
    }
  };

  /* Scalar helpers used all over the codebase. */
  var M = {
    TAU: Math.PI * 2,
    clamp: function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); },
    lerp: function (a, b, t) { return a + (b - a) * t; },
    /** Wrap an angle into [-PI, PI). */
    wrapAngle: function (a) {
      a = (a + Math.PI) % (Math.PI * 2);
      if (a < 0) a += Math.PI * 2;
      return a - Math.PI;
    },
    /** Wrap an angle into [0, TAU). */
    wrapAngle2: function (a) {
      a = a % (Math.PI * 2);
      return a < 0 ? a + Math.PI * 2 : a;
    },
    /** Shortest signed difference b - a. */
    angleDelta: function (a, b) { return M.wrapAngle(b - a); },
    deg: function (r) { return r * 180 / Math.PI; },
    rad: function (d) { return d * Math.PI / 180; },
    /** Deterministic 32-bit hash -> used by the daily challenge seeder. */
    hash32: function (str) {
      var h = 2166136261 >>> 0;
      for (var i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
      }
      return h >>> 0;
    },
    /** Small seeded PRNG (mulberry32) for reproducible daily levels. */
    rng: function (seed) {
      var a = seed >>> 0;
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
  };

  LP.V = V;
  LP.M = M;
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
