/* =============================================================================
 * Lumen Path - src/optics/elements.js
 * -----------------------------------------------------------------------------
 * The optical object catalogue.
 *
 * Every element is a plain data object (so it serialises directly into a level
 * or a share code) plus a TYPE descriptor holding the behaviour:
 *
 *   build(el)                    -> world-space primitives for the tracer
 *   interact(el, ray, hit, ctx)  -> array of child rays
 *
 * `interact` is where the physics lives. Each implementation is written against
 * the vector forms in vec2.js -- reflect() for mirrors, refract() for anything
 * dielectric -- so behaviour stays correct at arbitrary rotation without any
 * axis-aligned special cases.
 *
 * RAY SHAPE (created by the tracer, consumed here):
 *   { o, d, intensity, color, wl, pol, ior, inside, depth, ... }
 *     o, d      origin and unit direction
 *     intensity scalar 0..1 energy carried
 *     color     {r,g,b} for additive mixing and rendering
 *     wl        wavelength in nm, or null for polychromatic "white"
 *     pol       polarisation angle in radians, or null for unpolarised
 *     ior       refractive index of the medium the ray is currently in
 *     inside    id of the solid whose interior we are in, or null
 * ========================================================================== */
(function (LP) {
  'use strict';

  var V = LP.V, M = LP.M, G = LP.Geom, S = LP.Spectrum, Mat = LP.Materials;

  /* Rays weaker than this are dropped entirely. */
  var MIN_INTENSITY = 0.012;

  /* --------------------------------------------------------------------------
   * Helpers shared by several element types.
   * ------------------------------------------------------------------------ */

  /** Offset a spawn point slightly along the new direction to avoid re-hitting. */
  function nudge(p, d) {
    return { x: p.x + d.x * G.SURFACE_EPS * 4, y: p.y + d.y * G.SURFACE_EPS * 4 };
  }

  /** Derive a child ray from a parent, overriding only what changed. */
  function child(ray, o, d, intensity, over) {
    var c = {
      o: o, d: d,
      intensity: intensity,
      color: over && over.color ? over.color : ray.color,
      wl: over && over.wl !== undefined ? over.wl : ray.wl,
      pol: over && over.pol !== undefined ? over.pol : ray.pol,
      ior: over && over.ior !== undefined ? over.ior : ray.ior,
      inside: over && over.inside !== undefined ? over.inside : ray.inside,
      depth: ray.depth + 1,
      via: over && over.via ? over.via : null,
      /* Carried through so a two-surfaced element (the polariser disc) can
       * tell "entering" from "leaving". */
      polarizedBy: ray.polarizedBy || null
    };
    return c;
  }

  /** Reflect helper that also applies coating loss and any metallic tint. */
  function mirrorReflect(el, ray, hit, mat) {
    var m = Mat.get(mat || el.material || 'silver');
    var R = V.reflect(ray.d, hit.n);
    var inten = ray.intensity * (m.reflect || 0.95);
    var col = ray.color;
    if (m.tint) col = S.colNormalize(S.colMul(ray.color, m.tint));
    if (inten < MIN_INTENSITY) return [];
    return [child(ray, nudge(hit.p, R), R, inten, { color: col })];
  }

  /* --------------------------------------------------------------------------
   * DIELECTRIC INTERACTION -- shared by prism, glass block and lens.
   *
   * Handles, in one place:
   *   - Snell refraction with a per-wavelength index (Cauchy dispersion)
   *   - total internal reflection past the critical angle
   *   - a Fresnel-weighted partial reflection at every interface
   *   - splitting white light into monochromatic bands on entry to a
   *     dispersive medium, after which each band travels independently
   * ------------------------------------------------------------------------ */
  function dielectric(el, ray, hit, ctx) {
    var out = [];
    var matKey = el.material || 'crown';
    var mat = Mat.get(matKey);

    /* Are we going in or coming out?
     * Deliberately tracked by state (`ray.inside`) rather than by the hit's
     * geometric side: polygon winding is author-supplied and unreliable, but
     * the enter/exit bookkeeping below is always consistent because every
     * child ray inherits or clears `inside` explicitly. */
    var goingIn = (ray.inside !== el.id);
    var n1, n2;
    if (goingIn) { n1 = ray.ior; n2 = Mat.iorAt(mat, ray.wl); }
    else { n1 = Mat.iorAt(mat, ray.wl); n2 = 1.0; }

    /* --- Dispersion: a white ray entering dispersive glass fans out. ------ */
    if (goingIn && ray.wl === null && Mat.isDispersive(mat) && el.disperse !== false) {
      var bands = S.DISPERSION_BANDS;
      for (var b = 0; b < bands.length; b++) {
        var band = bands[b];
        var sub = {
          o: ray.o, d: ray.d,
          intensity: ray.intensity * band.weight,
          color: band.rgb, wl: band.nm, pol: ray.pol,
          ior: ray.ior, inside: ray.inside, depth: ray.depth
        };
        /* Recurse once with a now-monochromatic ray; each band gets its own
         * index of refraction and therefore its own exit angle. */
        var kids = dielectric(el, sub, hit, ctx);
        for (var k = 0; k < kids.length; k++) out.push(kids[k]);
      }
      return out;
    }

    var cosi = -V.dot(ray.d, hit.n);
    if (cosi < 0) cosi = 0;

    var T = V.refract(ray.d, hit.n, n1 / n2);

    if (T === null) {
      /* ---- TOTAL INTERNAL REFLECTION: all energy stays inside. ---------- */
      var Rt = V.reflect(ray.d, hit.n);
      var it = ray.intensity * 0.995;
      if (it >= MIN_INTENSITY) {
        out.push(child(ray, nudge(hit.p, Rt), Rt, it, { via: 'tir' }));
      }
      return out;
    }

    /* ---- Partial reflection (Fresnel / Schlick). ------------------------ */
    var Rf = Mat.fresnel(cosi, n1, n2);
    if (el.noFresnel) Rf = 0;

    var iRefl = ray.intensity * Rf;
    var iRefr = ray.intensity * (1 - Rf);

    if (iRefl >= MIN_INTENSITY * 2 && ray.depth < (ctx.maxDepth - 2)) {
      var Rr = V.reflect(ray.d, hit.n);
      out.push(child(ray, nudge(hit.p, Rr), Rr, iRefl, { via: 'fresnel' }));
    }

    if (iRefr >= MIN_INTENSITY) {
      T = V.norm(T);
      out.push(child(ray, nudge(hit.p, T), T, iRefr, {
        ior: n2,
        inside: goingIn ? el.id : null
      }));
    }
    return out;
  }

  /* ==========================================================================
   * TYPE DESCRIPTORS
   * ======================================================================= */
  var TYPES = {};

  function defType(key, def) {
    def.key = key;
    def.caps = def.caps || {};
    def.defaults = def.defaults || {};
    TYPES[key] = def;
    return def;
  }

  /* ---- 1. FLAT MIRROR ---------------------------------------------------- */
  defType('mirror', {
    name: 'Flat Mirror',
    short: 'Mirror',
    icon: 'mirror',
    category: 'reflect',
    blurb: 'Perfect specular reflection. Angle in equals angle out.',
    caps: { rotate: true, resize: true, move: true },
    defaults: { length: 120, material: 'silver' },
    limits: { length: [40, 340] },
    build: function (el) {
      var e = G.segmentEnds(el, el.angle, el.length);
      return [{ kind: 'seg', a: e[0], b: e[1], role: 'mirror' }];
    },
    interact: function (el, ray, hit) { return mirrorReflect(el, ray, hit); }
  });

  /* ---- 2/3/4. CURVED MIRRORS -------------------------------------------- *
   * concave, convex and the player-flexible variant are the same geometry
   * with a different default curvature and a different UI affordance. The
   * focusing behaviour is emergent: the arc normal is radial, so the standard
   * reflection formula converges parallel rays near r/2 without any help.    */
  function curvedMirrorType(key, name, blurb, curvature, flexible) {
    return defType(key, {
      name: name,
      short: name.replace(' Mirror', ''),
      icon: key,
      category: 'reflect',
      blurb: blurb,
      caps: { rotate: true, resize: true, move: true, curve: flexible },
      defaults: { length: 150, curvature: curvature, material: 'silver' },
      limits: { length: [50, 340], curvature: flexible ? [-0.95, 0.95] : [-0.95, 0.95] },
      build: function (el) {
        var arc = G.arcFromChord(el, el.angle, el.length, el.curvature);
        if (!arc) {
          var e = G.segmentEnds(el, el.angle, el.length);
          return [{ kind: 'seg', a: e[0], b: e[1], role: 'mirror' }];
        }
        return [{
          kind: 'arc', c: arc.c, r: arc.r, a0: arc.a0, sweep: arc.sweep,
          ends: arc.ends, role: 'mirror'
        }];
      },
      interact: function (el, ray, hit) { return mirrorReflect(el, ray, hit); }
    });
  }
  curvedMirrorType('concave', 'Concave Mirror',
    'Converges parallel light toward a focal point at roughly half the radius.', 0.45, false);
  curvedMirrorType('convex', 'Convex Mirror',
    'Spreads one beam into a diverging fan -- useful for lighting several targets.', -0.45, false);
  curvedMirrorType('flex', 'Flex Mirror',
    'Adjustable curvature. Flex it from concave through flat to convex.', 0.0, true);

  /* ---- 5. PRISM ---------------------------------------------------------- */
  defType('prism', {
    name: 'Prism',
    short: 'Prism',
    icon: 'prism',
    category: 'refract',
    blurb: 'Refracts by Snell’s law and disperses white light into a spectrum.',
    caps: { rotate: true, resize: true, move: true, material: ['crown', 'flint', 'sapphire', 'diamond'] },
    defaults: { radius: 58, sides: 3, material: 'flint' },
    limits: { radius: [30, 110] },
    build: function (el) {
      var pts = G.regularPolygon(el, el.angle, el.radius, el.sides || 3);
      return [{ kind: 'poly', pts: pts, role: 'dielectric' }];
    },
    interact: dielectric
  });

  /* ---- 6. BEAM SPLITTER -------------------------------------------------- */
  defType('splitter', {
    name: 'Beam Splitter',
    short: 'Splitter',
    icon: 'splitter',
    category: 'split',
    blurb: 'Half-silvered plate: reflects part of the beam and transmits the rest.',
    caps: { rotate: true, resize: true, move: true, ratio: true },
    defaults: { length: 120, ratio: 0.5, material: 'dielectric' },
    limits: { length: [50, 260], ratio: [0.1, 0.9] },
    build: function (el) {
      var e = G.segmentEnds(el, el.angle, el.length);
      return [{ kind: 'seg', a: e[0], b: e[1], role: 'splitter' }];
    },
    interact: function (el, ray, hit) {
      var out = [];
      var r = el.ratio === undefined ? 0.5 : el.ratio;
      var loss = 0.97;                                   /* coating absorption */
      var iR = ray.intensity * r * loss;
      var iT = ray.intensity * (1 - r) * loss;

      if (iR >= MIN_INTENSITY) {
        var R = V.reflect(ray.d, hit.n);
        out.push(child(ray, nudge(hit.p, R), R, iR, { via: 'split-r' }));
      }
      if (iT >= MIN_INTENSITY) {
        /* Thin-plate approximation: the transmitted beam keeps its direction.
         * A real plate would offset it slightly sideways; at puzzle scale that
         * offset is well under a pixel, so it is deliberately ignored. */
        out.push(child(ray, nudge(hit.p, ray.d), ray.d, iT, { via: 'split-t' }));
      }
      return out;
    }
  });

  /* ---- 7. COLOUR FILTER -------------------------------------------------- */
  defType('filter', {
    name: 'Colour Filter',
    short: 'Filter',
    icon: 'filter',
    category: 'colour',
    blurb: 'Passes only light matching its colour and absorbs the rest.',
    caps: { rotate: true, resize: true, move: true, colorize: true },
    defaults: { length: 110, color: 'red' },
    limits: { length: [50, 240] },
    build: function (el) {
      var e = G.segmentEnds(el, el.angle, el.length);
      return [{ kind: 'seg', a: e[0], b: e[1], role: 'filter' }];
    },
    interact: function (el, ray, hit) {
      var pass = S.resolveColor(el.color);
      var inC = ray.color;

      /* Fraction of the ray's spectral energy this filter lets through.
       * For a monochromatic ray, `inC` is its wavelength colour, so this is
       * effectively the filter's transmission at that wavelength. */
      var den = inC.r + inC.g + inC.b;
      if (den < 1e-6) return [];
      var num = inC.r * pass.r + inC.g * pass.g + inC.b * pass.b;
      var frac = num / den;

      var outI = ray.intensity * frac * 0.98;
      if (outI < MIN_INTENSITY) return [];

      var outC = S.colNormalize(S.colMul(inC, pass));
      return [child(ray, nudge(hit.p, ray.d), ray.d, outI, { color: outC })];
    }
  });

  /* ---- 8. POLARISING FILTER --------------------------------------------- *
   * Built as a ROUND disc rather than a flat plate, deliberately.
   *
   * In 2D the transmission axis and the plate's own orientation would
   * otherwise be the same number, so rotating the filter to gate a beam would
   * also swing the plate out of the beam's path. Making it a disc decouples
   * the two: `angle` is purely the transmission axis, the beam always meets
   * the face, and rotating the filter really does gate the light on and off,
   * which is what the puzzles are built around.
   *
   * The disc has two surfaces (entry and exit). `polarizedBy` marks a ray that
   * has already been filtered by this element so the exit face just lets it
   * out instead of applying Malus twice.                                       */
  defType('polarizer', {
    name: 'Polarising Filter',
    short: 'Polariser',
    icon: 'polarizer',
    category: 'colour',
    blurb: 'Passes only light aligned with its axis. Malus’ law: I = I₀cos²θ.',
    caps: { rotate: true, resize: true, move: true, axisDial: true },
    defaults: { radius: 42 },
    limits: { radius: [24, 90] },
    build: function (el) {
      return [{ kind: 'circle', c: { x: el.x, y: el.y }, r: el.radius, role: 'polarizer' }];
    },
    interact: function (el, ray, hit) {
      /* Leaving the disc: pass straight through, already filtered. */
      if (ray.polarizedBy === el.id) {
        var k = child(ray, nudge(hit.p, ray.d), ray.d, ray.intensity, {});
        k.polarizedBy = null;
        return [k];
      }

      var axis = el.angle;
      var outI, outPol;
      if (ray.pol === null || ray.pol === undefined) {
        /* Unpolarised light loses exactly half its intensity and emerges
         * polarised along the axis. */
        outI = ray.intensity * 0.5;
        outPol = axis;
      } else {
        var c = Math.cos(ray.pol - axis);
        outI = ray.intensity * c * c;               /* Malus' law */
        outPol = axis;
      }
      outI *= 0.97;                                  /* substrate absorption */
      if (outI < MIN_INTENSITY) return [];
      var kid = child(ray, nudge(hit.p, ray.d), ray.d, outI, { pol: outPol });
      kid.polarizedBy = el.id;
      return [kid];
    }
  });

  /* ---- 9. DIFFRACTION GRATING ------------------------------------------- */
  defType('grating', {
    name: 'Diffraction Grating',
    short: 'Grating',
    icon: 'grating',
    category: 'split',
    blurb: 'Splits a beam into faint spectral orders: d·sinθ = m·λ.',
    caps: { rotate: true, resize: true, move: true },
    /* Line spacing in nanometres. 1600nm is about 625 lines/mm, which throws a
     * comfortably wide first order for visible light. */
    defaults: { length: 120, spacing: 1600, orders: 2 },
    limits: { length: [50, 240], spacing: [900, 4000] },
    build: function (el) {
      var e = G.segmentEnds(el, el.angle, el.length);
      return [{ kind: 'seg', a: e[0], b: e[1], role: 'grating' }];
    },
    interact: function (el, ray, hit) {
      var out = [];
      var n = hit.n;
      var tang = { x: -n.y, y: n.x };                 /* along the grating */
      var d = el.spacing || 1600;
      var maxOrder = el.orders || 2;

      /* Incidence measured from the normal, signed along the tangent. */
      var sinI = V.dot(ray.d, tang);

      /* Relative power per order; order 0 keeps most of the light. */
      var power = { 0: 0.42, 1: 0.19, 2: 0.07 };

      function emit(m, wl, rgb, weight) {
        var p = power[Math.abs(m)];
        if (p === undefined) return;
        var sinO = sinI + m * (wl / d);
        if (sinO > 1 || sinO < -1) return;             /* evanescent, no order */
        var cosO = Math.sqrt(Math.max(0, 1 - sinO * sinO));

        /* Rebuild the outgoing direction in the (tangent, normal) frame.
         * The transmitted side keeps the sign of the original normal component. */
        var dirN = -1;                                  /* n faces the ray, so
                                                         * continuing forward is -n */
        var dir = V.norm({
          x: tang.x * sinO + n.x * cosO * dirN,
          y: tang.y * sinO + n.y * cosO * dirN
        });
        var inten = ray.intensity * p * weight * 0.96;
        if (inten < MIN_INTENSITY) return;
        out.push(child(ray, nudge(hit.p, dir), dir, inten, {
          color: rgb, wl: wl, via: 'grating' + m
        }));
      }

      for (var m = -maxOrder; m <= maxOrder; m++) {
        if (m === 0) {
          /* Zeroth order is undeviated and keeps the ray's original colour. */
          var i0 = ray.intensity * power[0] * 0.96;
          if (i0 >= MIN_INTENSITY) {
            out.push(child(ray, nudge(hit.p, ray.d), ray.d, i0, { via: 'grating0' }));
          }
          continue;
        }
        if (ray.wl === null) {
          /* White light fans into a rainbow, one ray per band. */
          var bands = S.GRATING_BANDS;
          for (var b = 0; b < bands.length; b++) {
            emit(m, bands[b].nm, bands[b].rgb, bands[b].weight);
          }
        } else {
          emit(m, ray.wl, ray.color, 1);
        }
      }
      return out;
    }
  });

  /* ---- 10. ONE-WAY MIRROR ------------------------------------------------ */
  defType('oneway', {
    name: 'One-Way Mirror',
    short: 'One-Way',
    icon: 'oneway',
    category: 'reflect',
    blurb: 'Mirrored on its marked face, clear from behind.',
    caps: { rotate: true, resize: true, move: true, flip: true },
    defaults: { length: 130, material: 'aluminium', flipped: false },
    limits: { length: [50, 280] },
    build: function (el) {
      var e = G.segmentEnds(el, el.angle, el.length);
      return [{ kind: 'seg', a: e[0], b: e[1], role: 'oneway' }];
    },
    interact: function (el, ray, hit) {
      /* `hit.entering` is true when we struck the segment's left-normal face.
       * `flipped` swaps which face is the mirrored one. */
      var frontFace = el.flipped ? !hit.entering : hit.entering;
      if (frontFace) return mirrorReflect(el, ray, hit);
      var it = ray.intensity * 0.88;                 /* the clear side dims a little */
      if (it < MIN_INTENSITY) return [];
      return [child(ray, nudge(hit.p, ray.d), ray.d, it, { via: 'oneway-t' })];
    }
  });

  /* ---- 11. REFRACTIVE GLASS BLOCK --------------------------------------- */
  defType('glass', {
    name: 'Glass Block',
    short: 'Glass',
    icon: 'glass',
    category: 'refract',
    blurb: 'Freeform refractive solid. Bends light by its geometry alone.',
    caps: { rotate: true, resize: true, move: true, material: ['water', 'acrylic', 'crown', 'flint', 'sapphire'] },
    defaults: { w: 160, h: 90, material: 'crown', shape: null },
    limits: { w: [50, 400], h: [30, 300] },
    build: function (el) {
      var pts;
      if (el.shape && el.shape.length >= 3) {
        /* Arbitrary polygon, authored in local space and placed by transform. */
        pts = G.transformPoints(el.shape, el, el.angle, el.scale || 1);
      } else {
        pts = G.rectPolygon(el, el.angle, el.w, el.h);
      }
      return [{ kind: 'poly', pts: pts, role: 'dielectric' }];
    },
    interact: dielectric
  });

  /* ---- 12. LENS ---------------------------------------------------------- *
   * Built as a fine polygon approximation of two circular faces so it can
   * reuse the same Snell path as the prism. Because it refracts for real, a
   * converging lens genuinely brings a parallel bundle to a focus, and moving
   * it changes where that focus lands.                                        */
  defType('lens', {
    name: 'Lens',
    short: 'Lens',
    icon: 'lens',
    category: 'refract',
    blurb: 'Converging or diverging refractor. Real focus, no shortcuts.',
    caps: { rotate: true, resize: true, move: true, curve: true, material: ['acrylic', 'crown', 'flint'] },
    defaults: { length: 140, curvature: 0.42, material: 'crown' },
    limits: { length: [60, 260], curvature: [-0.8, 0.8] },
    build: function (el) {
      var L = el.length;
      var k = el.curvature;
      if (Math.abs(k) < 0.05) k = (k < 0 ? -1 : 1) * 0.05;
      var half = L * 0.5;
      var bulge = Math.abs(k) * half * 0.55;
      var STEPS = 16;
      var pts = [];
      var ca = Math.cos(el.angle), sa = Math.sin(el.angle);
      function put(lx, ly) {
        pts.push({ x: el.x + lx * ca - ly * sa, y: el.y + lx * sa + ly * ca });
      }
      var i, t, y, x;
      /* Both faces meet at the rim, so the pole vertices are shared: the
       * second sweep skips its endpoints to avoid emitting them twice. */
      if (k > 0) {
        /* Bi-convex: both faces bow outward. */
        for (i = 0; i <= STEPS; i++) {
          t = i / STEPS; y = -half + t * L;
          x = bulge * Math.cos((y / half) * Math.PI * 0.5);
          put(x, y);
        }
        for (i = STEPS - 1; i >= 1; i--) {
          t = i / STEPS; y = -half + t * L;
          x = -bulge * Math.cos((y / half) * Math.PI * 0.5);
          put(x, y);
        }
      } else {
        /* Bi-concave: waisted in the middle, with flat-ish rims so the shape
         * stays a simple polygon. */
        var rim = bulge * 0.45 + 4;
        for (i = 0; i <= STEPS; i++) {
          t = i / STEPS; y = -half + t * L;
          x = rim - bulge * Math.cos((y / half) * Math.PI * 0.5);
          put(x, y);
        }
        for (i = STEPS - 1; i >= 1; i--) {
          t = i / STEPS; y = -half + t * L;
          x = -rim + bulge * Math.cos((y / half) * Math.PI * 0.5);
          put(x, y);
        }
      }
      return [{ kind: 'poly', pts: pts, role: 'dielectric' }];
    },
    interact: dielectric
  });

  /* ---- 13. PORTAL -------------------------------------------------------- */
  defType('portal', {
    name: 'Portal',
    short: 'Portal',
    icon: 'portal',
    category: 'exotic',
    blurb: 'Teleports a beam to its twin, rotated by the exit angle.',
    caps: { rotate: true, move: true },
    defaults: { radius: 30, link: null, exitOffset: 0 },
    limits: { radius: [18, 60] },
    build: function (el) {
      return [{ kind: 'circle', c: { x: el.x, y: el.y }, r: el.radius, role: 'portal' }];
    },
    interact: function (el, ray, hit, ctx) {
      var twin = ctx.byId[el.link];
      if (!twin) return [];                          /* an unlinked portal absorbs */

      /* Rotate the beam by the difference in portal orientation, plus whatever
       * exit offset the player has dialled in on the far portal. */
      var rot = (twin.angle - el.angle) + (twin.exitOffset || 0);
      var nd = V.norm(V.rot(ray.d, rot));

      /* Preserve where across the aperture the beam entered: carry the entry
       * offset over, mirrored through the centre so the beam leaves by the
       * far rim, then keep only the part transverse to the new direction and
       * push clear of the disc. Without that last step a beam whose exit
       * offset turns it back inward would re-enter its own portal. */
      var rel = V.rot(V.neg(V.sub(hit.p, { x: el.x, y: el.y })), rot);
      var alongN = V.dot(rel, nd);
      var trans = V.sub(rel, V.mul(nd, alongN));
      var no = {
        x: twin.x + trans.x + nd.x * (twin.radius + 1.5),
        y: twin.y + trans.y + nd.y * (twin.radius + 1.5)
      };

      var it = ray.intensity * 0.96;
      if (it < MIN_INTENSITY) return [];
      return [child(ray, no, nd, it, { via: 'portal' })];
    }
  });

  /* ---- 14. ABSORBER / WALL ---------------------------------------------- */
  defType('absorber', {
    name: 'Absorber',
    short: 'Absorber',
    icon: 'absorber',
    category: 'block',
    blurb: 'Swallows any beam that touches it.',
    caps: { rotate: true, resize: true, move: true },
    defaults: { w: 90, h: 24 },
    limits: { w: [20, 500], h: [10, 500] },
    build: function (el) {
      return [{ kind: 'poly', pts: G.rectPolygon(el, el.angle, el.w, el.h), role: 'absorb' }];
    },
    interact: function () { return []; }
  });

  /* ---- 15. RECEIVER ------------------------------------------------------ *
   * Modelled as an element so the tracer's single intersection loop finds it,
   * but its interaction is "stop and record" -- the scene tallies what landed.  */
  defType('receiver', {
    name: 'Receiver',
    short: 'Receiver',
    icon: 'receiver',
    category: 'goal',
    blurb: 'Lights up when it is struck by light meeting its requirement.',
    caps: { move: false },
    defaults: { radius: 24, require: { color: 'any', minIntensity: 0.22 } },
    build: function (el) {
      return [{ kind: 'circle', c: { x: el.x, y: el.y }, r: el.radius, role: 'receiver' }];
    },
    interact: function () { return []; }             /* light is absorbed here */
  });

  /* ---- 16. EMITTER (non-colliding marker) -------------------------------- */
  defType('emitter', {
    name: 'Emitter',
    short: 'Emitter',
    icon: 'emitter',
    category: 'goal',
    blurb: 'Fixed light source.',
    caps: { move: false },
    defaults: { radius: 18, color: 'white', intensity: 1, spread: 0, rays: 1 },
    build: function () { return []; },               /* beams pass over emitters */
    interact: function () { return []; }
  });

  /* ==========================================================================
   * ELEMENT LIFECYCLE
   * ======================================================================= */

  var _nextId = 1;
  function nextId(prefix) { return (prefix || 'e') + (_nextId++); }
  function resetIds() { _nextId = 1; }

  /**
   * Create an element instance. `opts` overrides the type defaults; anything
   * not supplied falls back to a sensible value so hand-written level data can
   * stay terse.
   */
  function create(type, opts) {
    var T = TYPES[type];
    if (!T) throw new Error('unknown element type: ' + type);
    var el = {
      id: (opts && opts.id) || nextId(type.charAt(0)),
      type: type,
      x: 0, y: 0, angle: 0,
      curvature: 0,
      scale: 1,
      locked: false,
      fromInventory: false
    };
    var d = T.defaults, k;
    for (k in d) if (Object.prototype.hasOwnProperty.call(d, k)) {
      el[k] = (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k]))
        ? JSON.parse(JSON.stringify(d[k])) : d[k];
    }
    if (opts) for (k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) el[k] = opts[k];
    el._dirty = true;
    rebuild(el);
    return el;
  }

  /** Recompute world-space primitives. Called whenever a transform changes. */
  function rebuild(el) {
    var T = TYPES[el.type];
    el._prims = T.build(el) || [];
    var pts = [];
    for (var i = 0; i < el._prims.length; i++) {
      var p = el._prims[i];
      if (p.kind === 'seg') { pts.push(p.a, p.b); }
      else if (p.kind === 'poly') { for (var j = 0; j < p.pts.length; j++) pts.push(p.pts[j]); }
      else if (p.kind === 'circle') {
        pts.push({ x: p.c.x - p.r, y: p.c.y - p.r }, { x: p.c.x + p.r, y: p.c.y + p.r });
      } else if (p.kind === 'arc') {
        /* Conservative: the whole circle. Cheap and always correct. */
        pts.push({ x: p.c.x - p.r, y: p.c.y - p.r }, { x: p.c.x + p.r, y: p.c.y + p.r });
      }
    }
    el._bbox = pts.length ? G.bboxOf(pts, 2) : { x: el.x - 1, y: el.y - 1, w: 2, h: 2 };
    el._dirty = false;
    return el;
  }

  function touch(el) { rebuild(el); }

  /** Nearest intersection between a ray and one element. */
  function intersect(el, o, d, maxT) {
    if (el._dirty) rebuild(el);
    if (!el._prims.length) return null;
    if (!G.rayHitsAABB(o, d, el._bbox, maxT === undefined ? Infinity : maxT)) return null;

    var best = null;
    for (var i = 0; i < el._prims.length; i++) {
      var p = el._prims[i], h = null;
      if (p.kind === 'seg') h = G.raySegment(o, d, p.a, p.b);
      else if (p.kind === 'arc') h = G.rayArc(o, d, p.c, p.r, p.a0, p.sweep);
      else if (p.kind === 'poly') h = G.rayPolygon(o, d, p.pts);
      else if (p.kind === 'circle') h = G.rayCircle(o, d, p.c, p.r);
      if (h && (!best || h.t < best.t)) { h.prim = p; best = h; }
    }
    return best;
  }

  function interact(el, ray, hit, ctx) {
    var T = TYPES[el.type];
    var kids = T.interact(el, ray, hit, ctx) || [];
    /* Every element attributes its children so replay and hint systems can
     * explain which object bent which beam. */
    for (var i = 0; i < kids.length; i++) kids[i].source = el.id;
    return kids;
  }

  /* --------------------------------------------------------------------------
   * UI support: where the drag handles live for a given element.
   * ------------------------------------------------------------------------ */
  function handles(el) {
    var T = TYPES[el.type];
    var out = [];
    var c = { x: el.x, y: el.y };
    if (T.caps.rotate) {
      var rr = handleReach(el) + 34;
      out.push({ kind: 'rotate', p: { x: el.x + Math.cos(el.angle - Math.PI / 2) * rr,
                                      y: el.y + Math.sin(el.angle - Math.PI / 2) * rr } });
    }
    if (T.caps.resize) {
      if (el.length !== undefined) {
        var e = G.segmentEnds(c, el.angle, el.length);
        out.push({ kind: 'resize', p: e[0], sign: -1 });
        out.push({ kind: 'resize', p: e[1], sign: 1 });
      } else if (el.radius !== undefined) {
        out.push({ kind: 'resize', p: { x: el.x + Math.cos(el.angle) * el.radius,
                                        y: el.y + Math.sin(el.angle) * el.radius }, sign: 1 });
      } else if (el.w !== undefined) {
        var pts = G.rectPolygon(c, el.angle, el.w, el.h);
        out.push({ kind: 'resize', p: pts[2], sign: 1 });
      }
    }
    if (T.caps.curve) {
      var cr = handleReach(el) * 0.55 + 18;
      out.push({ kind: 'curve', p: { x: el.x + Math.cos(el.angle + Math.PI / 2) * cr,
                                     y: el.y + Math.sin(el.angle + Math.PI / 2) * cr } });
    }
    return out;
  }

  /** Roughly how far the element extends from its centre -- for handle layout. */
  function handleReach(el) {
    if (el.length !== undefined) return el.length * 0.5;
    if (el.radius !== undefined) return el.radius;
    if (el.w !== undefined) return Math.max(el.w, el.h) * 0.5;
    return 40;
  }

  /** Distance from a world point to the element, for click selection. */
  function distanceTo(el, p) {
    if (el._dirty) rebuild(el);
    var best = Infinity;
    for (var i = 0; i < el._prims.length; i++) {
      var pr = el._prims[i], d;
      if (pr.kind === 'seg') d = G.distToSegment(p, pr.a, pr.b);
      else if (pr.kind === 'circle') d = Math.abs(V.dist(p, pr.c) - pr.r);
      else if (pr.kind === 'arc') {
        var ang = Math.atan2(p.y - pr.c.y, p.x - pr.c.x);
        if (G.angleInArc(ang, pr.a0, pr.sweep)) d = Math.abs(V.dist(p, pr.c) - pr.r);
        else d = Math.min(V.dist(p, pr.ends[0]), V.dist(p, pr.ends[1]));
      } else if (pr.kind === 'poly') {
        if (G.pointInPolygon(p, pr.pts)) d = 0;
        else {
          d = Infinity;
          for (var j = 0; j < pr.pts.length; j++) {
            var a = pr.pts[j], b = pr.pts[(j + 1) % pr.pts.length];
            d = Math.min(d, G.distToSegment(p, a, b));
          }
        }
      } else d = Infinity;
      if (d < best) best = d;
    }
    /* Elements with no geometry (emitters) still need to be clickable. */
    if (!el._prims.length) best = V.dist(p, { x: el.x, y: el.y }) - (el.radius || 18);
    return best;
  }

  /** Clamp a numeric property to its declared limits. */
  function clampProp(el, prop, value) {
    var T = TYPES[el.type];
    var lim = T.limits && T.limits[prop];
    if (!lim) return value;
    return M.clamp(value, lim[0], lim[1]);
  }

  /** Strip runtime caches so an element can be serialised. */
  function serialize(el) {
    var out = {};
    for (var k in el) {
      if (!Object.prototype.hasOwnProperty.call(el, k)) continue;
      if (k.charAt(0) === '_') continue;
      out[k] = el[k];
    }
    return out;
  }

  LP.Elements = {
    TYPES: TYPES,
    MIN_INTENSITY: MIN_INTENSITY,
    create: create,
    rebuild: rebuild,
    touch: touch,
    intersect: intersect,
    interact: interact,
    handles: handles,
    handleReach: handleReach,
    distanceTo: distanceTo,
    clampProp: clampProp,
    serialize: serialize,
    nextId: nextId,
    resetIds: resetIds,
    /* exported for tests */
    _dielectric: dielectric
  };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
