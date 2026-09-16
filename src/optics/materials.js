/* =============================================================================
 * Lumen Path - src/optics/materials.js
 * -----------------------------------------------------------------------------
 * Per-material optical constants: refractive index (with dispersion), bulk
 * absorption, and surface reflectance.
 *
 * DISPERSION is modelled with Cauchy's empirical equation:
 *
 *       n(lambda) = A + B / lambda^2        (lambda in micrometres)
 *
 * B is the dispersion coefficient. A larger B means blue bends noticeably more
 * than red, which is precisely what makes a prism throw a wide rainbow. Flint
 * glass has roughly twice the B of crown glass, so the "flint prism" element
 * produces a visibly fatter spectrum than the "crown prism" -- a real
 * difference the player can exploit in later levels.
 *
 * GAME GLASS IS MORE DISPERSIVE THAN REAL GLASS. Real flint spreads white light
 * over a few degrees -- a rainbow too thin to see across a table, let alone
 * aim at. Every colour's index here is pulled further from violet's by a
 * constant factor (SPREAD), so a prism throws a fan roughly twice as wide:
 *
 *       n(lambda) = n_violet + SPREAD * B * (1/lambda^2 - 1/0.4^2)
 *
 * It is still Cauchy's law -- blue always bends more than red, by an amount
 * that grows with B -- just for a glass that does not exist. Anchoring at the
 * violet end is deliberate: no colour's index rises, so no beam that escaped
 * a prism before is now trapped inside it by total internal reflection.
 * White light that is not split (`disperse: false`) keeps the catalogue index
 * at the sodium D-line.
 * ========================================================================== */
(function (LP) {
  'use strict';

  /**
   * absorb  - bulk absorption coefficient per world-unit travelled inside the
   *           material (Beer-Lambert: I = I0 * exp(-absorb * distance)).
   * reflect - fraction of intensity a mirrored surface returns.
   */
  /* How many times wider than Cauchy's real spread a spectrum fans out. */
  var SPREAD = 4.0;
  var VIOLET_UM2 = 0.4 * 0.4;

  var MATERIALS = {
    air:        { name: 'Air',          A: 1.0002,  B: 0.0,      absorb: 0.0,      reflect: 0 },
    water:      { name: 'Water',        A: 1.3200,  B: 0.00340,  absorb: 0.00022,  reflect: 0 },
    acrylic:    { name: 'Acrylic',      A: 1.4780,  B: 0.00420,  absorb: 0.00030,  reflect: 0 },
    crown:      { name: 'Crown Glass',  A: 1.5046,  B: 0.00420,  absorb: 0.00025,  reflect: 0 },
    flint:      { name: 'Flint Glass',  A: 1.6700,  B: 0.00743,  absorb: 0.00040,  reflect: 0 },
    sapphire:   { name: 'Sapphire',     A: 1.7500,  B: 0.00590,  absorb: 0.00018,  reflect: 0 },
    diamond:    { name: 'Diamond',      A: 2.4000,  B: 0.01060,  absorb: 0.00012,  reflect: 0 },

    /* Mirror coatings. `reflect` is the intensity kept per bounce. */
    silver:     { name: 'Silver',       A: 1, B: 0, absorb: 0, reflect: 0.965 },
    aluminium:  { name: 'Aluminium',    A: 1, B: 0, absorb: 0, reflect: 0.915 },
    gold:       { name: 'Gold',         A: 1, B: 0, absorb: 0, reflect: 0.980, tint: { r: 1.0, g: 0.86, b: 0.57 } },
    dielectric: { name: 'Dielectric',   A: 1, B: 0, absorb: 0, reflect: 0.995 }
  };

  /**
   * Refractive index of `mat` at `wavelength` nanometres.
   * A null wavelength (white light) uses the sodium D-line (589nm) as the
   * representative index, which is the convention optical catalogues use.
   */
  function iorAt(mat, wavelength) {
    var m = (typeof mat === 'string') ? MATERIALS[mat] : mat;
    if (!m) return 1.0;
    if (wavelength === null || wavelength === undefined) {
      var d = 0.589;                    /* Cauchy wants micrometres */
      return m.A + m.B / (d * d);
    }
    var um = wavelength / 1000;
    return m.A + m.B / VIOLET_UM2 + SPREAD * m.B * (1 / (um * um) - 1 / VIOLET_UM2);
  }

  /** True when the material spreads wavelengths enough to be worth splitting. */
  function isDispersive(mat) {
    var m = (typeof mat === 'string') ? MATERIALS[mat] : mat;
    return !!m && m.B > 0.001;
  }

  function absorbanceOf(mat) {
    var m = (typeof mat === 'string') ? MATERIALS[mat] : mat;
    return m ? (m.absorb || 0) : 0;
  }

  function reflectanceOf(mat) {
    var m = (typeof mat === 'string') ? MATERIALS[mat] : mat;
    return m ? (m.reflect || 0) : 0;
  }

  function get(mat) {
    return (typeof mat === 'string') ? (MATERIALS[mat] || MATERIALS.air) : (mat || MATERIALS.air);
  }

  /* ---------------------------------------------------------------------------
   * Schlick's approximation of the Fresnel reflectance.
   *
   *   R(theta) = R0 + (1 - R0)(1 - cos theta)^5,   R0 = ((n1-n2)/(n1+n2))^2
   *
   * This is why glass in this game shows a faint reflected ghost at glancing
   * angles and almost none head-on -- the same behaviour as a real window.
   * ------------------------------------------------------------------------ */
  function fresnel(cosi, n1, n2) {
    var r0 = (n1 - n2) / (n1 + n2);
    r0 = r0 * r0;
    var c = 1 - Math.min(1, Math.max(0, cosi));
    var c2 = c * c;
    return r0 + (1 - r0) * c2 * c2 * c;
  }

  /** Critical angle in radians for n1 -> n2, or null when none exists. */
  function criticalAngle(n1, n2) {
    if (n1 <= n2) return null;           /* TIR only happens going dense -> sparse */
    return Math.asin(n2 / n1);
  }

  LP.Materials = {
    MATERIALS: MATERIALS,
    SPREAD: SPREAD,
    get: get,
    iorAt: iorAt,
    isDispersive: isDispersive,
    absorbanceOf: absorbanceOf,
    reflectanceOf: reflectanceOf,
    fresnel: fresnel,
    criticalAngle: criticalAngle
  };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
