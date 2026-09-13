/* =============================================================================
 * Lumen Path - src/optics/spectrum.js
 * -----------------------------------------------------------------------------
 * Wavelength <-> RGB conversion, additive colour mixing, and the spectral bands
 * used by prisms and diffraction gratings.
 *
 * The game models light two ways at once:
 *
 *   1. MONOCHROMATIC rays carry a `wavelength` in nanometres. These are the
 *      physically meaningful ones -- refractive index, dispersion angle and
 *      grating order all depend on wavelength.
 *   2. POLYCHROMATIC ("white") rays carry `wavelength === null`. They behave
 *      like a bundle until they meet something dispersive, at which point they
 *      are split into DISPERSION_BANDS monochromatic children.
 *
 * Both kinds also carry an RGB triple so the renderer and the receivers can do
 * additive mixing without re-deriving colour from wavelength every frame.
 * ========================================================================== */
(function (LP) {
  'use strict';

  var M = LP.M;

  /* Visible range used throughout. */
  var LAMBDA_MIN = 380;
  var LAMBDA_MAX = 700;

  /* ---------------------------------------------------------------------------
   * wavelengthToRGB
   * Piecewise-linear approximation of the CIE response (Bruton's method), with
   * an intensity roll-off at the ends of the visible band so that deep violet
   * and deep red read as dim. That roll-off is what makes a rendered prism
   * spectrum look right instead of like a flat rainbow stripe.
   * ------------------------------------------------------------------------ */
  function wavelengthToRGB(nm) {
    var r = 0, g = 0, b = 0;
    if (nm >= 380 && nm < 440) { r = -(nm - 440) / (440 - 380); g = 0; b = 1; }
    else if (nm >= 440 && nm < 490) { r = 0; g = (nm - 440) / (490 - 440); b = 1; }
    else if (nm >= 490 && nm < 510) { r = 0; g = 1; b = -(nm - 510) / (510 - 490); }
    else if (nm >= 510 && nm < 580) { r = (nm - 510) / (580 - 510); g = 1; b = 0; }
    else if (nm >= 580 && nm < 645) { r = 1; g = -(nm - 645) / (645 - 580); b = 0; }
    else if (nm >= 645 && nm <= 780) { r = 1; g = 0; b = 0; }

    /* Eye sensitivity falls off at both ends of the visible spectrum. */
    var f = 0;
    if (nm >= 380 && nm < 420) f = 0.3 + 0.7 * (nm - 380) / (420 - 380);
    else if (nm >= 420 && nm <= 700) f = 1;
    else if (nm > 700 && nm <= 780) f = 0.3 + 0.7 * (780 - nm) / (780 - 700);

    /* Gamma so the ramp looks perceptually even on screen. */
    var gam = 0.8;
    return {
      r: r > 0 ? Math.pow(r * f, gam) : 0,
      g: g > 0 ? Math.pow(g * f, gam) : 0,
      b: b > 0 ? Math.pow(b * f, gam) : 0
    };
  }

  /* Precomputed lookup table at 1nm resolution across the visible band. */
  var LUT = (function () {
    var t = new Array(LAMBDA_MAX - LAMBDA_MIN + 1);
    for (var i = 0; i <= LAMBDA_MAX - LAMBDA_MIN; i++) t[i] = wavelengthToRGB(LAMBDA_MIN + i);
    return t;
  })();

  function wavelengthRGB(nm) {
    var i = Math.round(nm) - LAMBDA_MIN;
    if (i < 0) i = 0;
    if (i >= LUT.length) i = LUT.length - 1;
    return LUT[i];
  }

  /* ---------------------------------------------------------------------------
   * Dispersion bands.
   * A white ray entering a dispersive material becomes this many monochromatic
   * rays. More bands means a smoother rainbow but more work for the tracer; 9
   * reads as continuous once the renderer draws them with additive glow.
   * ------------------------------------------------------------------------ */
  var BAND_COUNT = 9;
  var DISPERSION_BANDS = (function () {
    var out = [];
    for (var i = 0; i < BAND_COUNT; i++) {
      /* Sample the middle of each band rather than its edges. */
      var t = (i + 0.5) / BAND_COUNT;
      var nm = 400 + t * (680 - 400);
      out.push({ nm: nm, rgb: wavelengthRGB(nm), weight: 1 / BAND_COUNT });
    }
    return out;
  })();

  /* Coarser fan for diffraction gratings, which make faint wide rainbows. */
  var GRATING_BANDS = (function () {
    var out = [];
    for (var i = 0; i < 7; i++) {
      var nm = 410 + (i / 6) * (670 - 410);
      out.push({ nm: nm, rgb: wavelengthRGB(nm), weight: 1 / 7 });
    }
    return out;
  })();

  /* ---------------------------------------------------------------------------
   * Additive colour algebra.
   * Receivers and overlapping beams use straight additive RGB, so red + green
   * really does land on yellow.
   * ------------------------------------------------------------------------ */
  function colAdd(a, b) { return { r: a.r + b.r, g: a.g + b.g, b: a.b + b.b }; }
  function colScale(a, s) { return { r: a.r * s, g: a.g * s, b: a.b * s }; }
  function colMul(a, b) { return { r: a.r * b.r, g: a.g * b.g, b: a.b * b.b }; }
  function colClone(a) { return { r: a.r, g: a.g, b: a.b }; }

  /** Rec.709 relative luminance -- used for intensity bookkeeping. */
  function luminance(c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

  function colClamp(c) {
    return {
      r: c.r < 0 ? 0 : (c.r > 1 ? 1 : c.r),
      g: c.g < 0 ? 0 : (c.g > 1 ? 1 : c.g),
      b: c.b < 0 ? 0 : (c.b > 1 ? 1 : c.b)
    };
  }

  /** Normalise so the brightest channel is 1 -- gives the hue of a mix. */
  function colNormalize(c) {
    var m = Math.max(c.r, c.g, c.b);
    if (m < 1e-6) return { r: 0, g: 0, b: 0 };
    return { r: c.r / m, g: c.g / m, b: c.b / m };
  }

  /**
   * How well does colour `a` match required colour `b`?
   * Compares normalised hue vectors, so a dim red still matches "red" -- the
   * brightness requirement is checked separately by the receiver.
   * Returns 0..1 where 1 is a perfect match.
   */
  function colMatch(a, b) {
    var na = colNormalize(a), nb = colNormalize(b);
    var d = Math.abs(na.r - nb.r) + Math.abs(na.g - nb.g) + Math.abs(na.b - nb.b);
    return Math.max(0, 1 - d / 1.5);
  }

  function toCSS(c, alpha) {
    var cc = colClamp(c);
    var r = Math.round(cc.r * 255), g = Math.round(cc.g * 255), b = Math.round(cc.b * 255);
    if (alpha === undefined) return 'rgb(' + r + ',' + g + ',' + b + ')';
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function fromHex(hex) {
    var h = String(hex).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return {
      r: parseInt(h.substr(0, 2), 16) / 255,
      g: parseInt(h.substr(2, 2), 16) / 255,
      b: parseInt(h.substr(4, 2), 16) / 255
    };
  }

  function toHex(c) {
    var cc = colClamp(c);
    function p(v) { var s = Math.round(v * 255).toString(16); return s.length < 2 ? '0' + s : s; }
    return '#' + p(cc.r) + p(cc.g) + p(cc.b);
  }

  /* Named light colours the level format can refer to by string. */
  var NAMED = {
    white:   { r: 1,    g: 1,    b: 1    },
    red:     { r: 1,    g: 0.06, b: 0.06 },
    green:   { r: 0.06, g: 1,    b: 0.12 },
    blue:    { r: 0.12, g: 0.24, b: 1    },
    yellow:  { r: 1,    g: 1,    b: 0.10 },
    cyan:    { r: 0.10, g: 1,    b: 1    },
    magenta: { r: 1,    g: 0.10, b: 1    },
    orange:  { r: 1,    g: 0.48, b: 0.05 },
    violet:  { r: 0.55, g: 0.15, b: 1    }
  };

  /** Representative wavelength for a named colour (null when non-spectral). */
  var NAMED_NM = {
    red: 650, orange: 600, yellow: 580, green: 530,
    cyan: 490, blue: 460, violet: 420,
    white: null,
    magenta: null   /* magenta has no single wavelength -- it is inherently a mix */
  };

  function resolveColor(spec) {
    if (!spec) return colClone(NAMED.white);
    if (typeof spec === 'string') {
      if (spec.charAt(0) === '#') return fromHex(spec);
      if (NAMED[spec]) return colClone(NAMED[spec]);
      return colClone(NAMED.white);
    }
    if (typeof spec === 'number') return colClone(wavelengthRGB(spec));
    return { r: spec.r || 0, g: spec.g || 0, b: spec.b || 0 };
  }

  /**
   * Colourblind-accessible encoding: every beam colour also maps to a dash
   * pattern and a glyph, so hue is never the only channel carrying meaning.
   */
  function colorSignature(c) {
    var n = colNormalize(c);
    var mx = Math.max(n.r, n.g, n.b), mn = Math.min(n.r, n.g, n.b);
    var sat = mx - mn;
    if (sat < 0.25) return { name: 'white', glyph: '✦', dash: [] };
    var hue = Math.atan2(1.7320508 * (n.g - n.b), 2 * n.r - n.g - n.b);
    var deg = M.wrapAngle2(hue) * 180 / Math.PI;
    if (deg < 20 || deg >= 330) return { name: 'red',     glyph: '▲', dash: [14, 8] };
    if (deg < 50)  return { name: 'orange',  glyph: '◆', dash: [12, 5, 3, 5] };
    if (deg < 80)  return { name: 'yellow',  glyph: '■', dash: [4, 4] };
    if (deg < 160) return { name: 'green',   glyph: '●', dash: [20, 6] };
    if (deg < 200) return { name: 'cyan',    glyph: '▬', dash: [10, 4, 10, 10] };
    if (deg < 280) return { name: 'blue',    glyph: '★', dash: [6, 10] };
    return { name: 'magenta', glyph: '✖', dash: [16, 4, 4, 4] };
  }

  LP.Spectrum = {
    LAMBDA_MIN: LAMBDA_MIN,
    LAMBDA_MAX: LAMBDA_MAX,
    DISPERSION_BANDS: DISPERSION_BANDS,
    GRATING_BANDS: GRATING_BANDS,
    NAMED: NAMED,
    NAMED_NM: NAMED_NM,
    wavelengthRGB: wavelengthRGB,
    colAdd: colAdd, colScale: colScale, colMul: colMul, colClone: colClone,
    colClamp: colClamp, colNormalize: colNormalize, colMatch: colMatch,
    luminance: luminance,
    toCSS: toCSS, toHex: toHex, fromHex: fromHex,
    resolveColor: resolveColor,
    colorSignature: colorSignature
  };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
