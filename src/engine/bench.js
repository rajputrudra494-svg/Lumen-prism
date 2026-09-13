/* =============================================================================
 * Lumen Path - src/engine/bench.js
 * -----------------------------------------------------------------------------
 * The physical bench the optics sit on: a procedurally generated wooden table,
 * and the dust hanging in the air above it.
 *
 * NO IMAGE ASSETS. The wood is grown in code, once per chapter, so the game
 * still works offline and off the filesystem, and every chapter can have its
 * own species without shipping megabytes of textures.
 *
 * HOW THE WOOD IS MADE
 * Real flat-sawn boards show growth rings sliced at a shallow angle, which
 * appear as long wavering stripes with sharper dark "latewood" lines. That is
 * exactly a sine of the across-grain coordinate, displaced by slow noise:
 *
 *     stripe = sin( (y + warp(x, y)) / spacing )
 *
 * Computing noise for every pixel of a full table is too slow for a level
 * load on a phone, so the expensive part is done on a coarse grid and
 * interpolated, and only for a single long board. The table is then ASSEMBLED
 * from that board -- random offsets, flips, lengths and stains per plank --
 * which is how a real table looks anyway: many boards cut from similar wood.
 * Seams, end joints, knots and the varnish sheen are drawn on top.
 *
 * DUST
 * A beam in clear air is invisible from the side; what you actually see is
 * light scattering off particles in its path. The motes here drift slowly and
 * are only drawn where a beam passes through them, which is what makes a beam
 * read as light in a room rather than a line on a screen.
 * ========================================================================== */
(function (LP) {
  'use strict';

  var M = LP.M, S = LP.Spectrum;

  var WORLD_W = 1600, WORLD_H = 900;

  /* ---- Wood species -------------------------------------------------------
   * light/dark are the earlywood and latewood tones; `grain` is ring spacing
   * in world units; `figure` how far the rings wander; `contrast` how dark the
   * latewood lines are; `knots` knots per table. */
  var SPECIES = {
    maple:    { name: 'Maple',     light: '#d9b98a', dark: '#a9824f', grain: 11, figure: 5,   contrast: 0.55, knots: 2, planks: 6 },
    walnut:   { name: 'Walnut',    light: '#8a6242', dark: '#452d1c', grain: 9,  figure: 7,   contrast: 0.75, knots: 3, planks: 6 },
    oak:      { name: 'Oak',       light: '#b88a5a', dark: '#7a5534', grain: 7,  figure: 8,   contrast: 0.85, knots: 3, planks: 6 },
    teak:     { name: 'Teak',      light: '#a57a4a', dark: '#5e4127', grain: 10, figure: 6,   contrast: 0.6,  knots: 1, planks: 5 },
    ebony:    { name: 'Ebony',     light: '#4a3a31', dark: '#1a1310', grain: 6,  figure: 4,   contrast: 0.7,  knots: 0, planks: 7 },
    mahogany: { name: 'Mahogany',  light: '#a2583a', dark: '#5a2a18', grain: 8,  figure: 9,   contrast: 0.7,  knots: 1, planks: 6 },
    ash:      { name: 'Ash',       light: '#cdbb9d', dark: '#8d785b', grain: 8,  figure: 6,   contrast: 0.75, knots: 2, planks: 6 },
    cherry:   { name: 'Cherry',    light: '#b9744b', dark: '#6f3c22', grain: 10, figure: 5,   contrast: 0.6,  knots: 2, planks: 6 },
    charred:  { name: 'Charred cedar', light: '#4d3027', dark: '#140a08', grain: 9, figure: 10, contrast: 0.95, knots: 3, planks: 5 },
    smoked:   { name: 'Smoked oak', light: '#5d4a3e', dark: '#221914', grain: 7, figure: 8,  contrast: 0.85, knots: 2, planks: 6 },
    limed:    { name: 'Limed oak', light: '#dcd4c6', dark: '#958a7b', grain: 7, figure: 9,  contrast: 0.9,  knots: 2, planks: 6 }
  };

  var cache = {};

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  /* ---- Noise --------------------------------------------------------------- */
  function hash2(ix, iy, seed) {
    var h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 144665)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  }

  function valueNoise(x, y, seed) {
    var ix = Math.floor(x), iy = Math.floor(y);
    var fx = x - ix, fy = y - iy;
    var u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    var a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
    var c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  function fbm(x, y, seed, octaves) {
    var sum = 0, amp = 0.5, freq = 1, norm = 0;
    for (var i = 0; i < octaves; i++) {
      sum += amp * valueNoise(x * freq, y * freq, seed + i * 31);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  /* ---- One board ----------------------------------------------------------- */
  /**
   * A single long board of grain, `w` x `h` texels at `q` texels per world
   * unit. The costly noise is evaluated every 8 texels and bilinearly
   * interpolated; the per-texel work is one sine and one hash.
   */
  function grainBoard(spec, w, h, q, seed) {
    var c = makeCanvas(w, h);
    var ctx = c.getContext('2d');
    var img = ctx.createImageData(c.width, c.height);
    var data = img.data;
    var L = S.fromHex(spec.light), D = S.fromHex(spec.dark);

    var CELL = 8;
    var gw = Math.ceil(c.width / CELL) + 2, gh = Math.ceil(c.height / CELL) + 2;
    var warp = new Float32Array(gw * gh);
    var tone = new Float32Array(gw * gh);
    for (var gy = 0; gy < gh; gy++) {
      for (var gx = 0; gx < gw; gx++) {
        var wx = (gx * CELL) / q, wy = (gy * CELL) / q;
        /* Long along the board, short across it: that anisotropy IS grain. */
        warp[gy * gw + gx] = fbm(wx * 0.0045, wy * 0.028, seed, 3);
        tone[gy * gw + gx] = fbm(wx * 0.0018, wy * 0.006, seed + 7, 2);
      }
    }

    var spacing = spec.grain * q;
    var figure = spec.figure * spacing;
    var contrast = spec.contrast;
    /* Broad "cathedral" arches: where the saw crossed the rings at an angle. */
    var archFreq = (Math.PI * 2 * (1.2 + (seed % 5) * 0.25)) / c.width;
    var archAmp = spacing * (2.5 + (seed % 3));

    for (var y = 0; y < c.height; y++) {
      var gyf = y / CELL, gy0 = gyf | 0, fy = gyf - gy0;
      for (var x = 0; x < c.width; x++) {
        var gxf = x / CELL, gx0 = gxf | 0, fx = gxf - gx0;
        var i0 = gy0 * gw + gx0, i1 = i0 + gw;
        var wv = warp[i0] + (warp[i0 + 1] - warp[i0]) * fx +
                 (warp[i1] - warp[i0]) * fy +
                 (warp[i0] - warp[i0 + 1] - warp[i1] + warp[i1 + 1]) * fx * fy;
        var tv = tone[i0] + (tone[i0 + 1] - tone[i0]) * fx + (tone[i1] - tone[i0]) * fy;

        var phase = (y + wv * figure + Math.sin(x * archFreq) * archAmp) / spacing;
        var s = Math.sin(phase * Math.PI);
        var late = s * s;
        late = late * late * late;                       /* thin, sharp dark lines */
        /* Pores: short streaks along the grain. */
        var pore = hash2((x / 3) | 0, y, seed);

        var t = 0.18 + (tv - 0.5) * 0.55 + late * contrast * 0.55 + (pore - 0.5) * 0.10;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);

        var o = (y * c.width + x) * 4;
        data[o]     = (L.r + (D.r - L.r) * t) * 255;
        data[o + 1] = (L.g + (D.g - L.g) * t) * 255;
        data[o + 2] = (L.b + (D.b - L.b) * t) * 255;
        data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /* ---- The table ----------------------------------------------------------- */
  /**
   * Build (or fetch from cache) the full table texture for a species.
   * `quality` 'high' | 'medium' | 'low' chooses texel density.
   */
  function table(speciesKey, quality, seedBase) {
    var key = speciesKey + '|' + quality + '|' + (seedBase || 0);
    if (cache[key]) return cache[key];

    var spec = SPECIES[speciesKey] || SPECIES.oak;
    var q = quality === 'low' ? 0.5 : (quality === 'medium' ? 0.75 : 1);
    var tw = Math.round(WORLD_W * q), th = Math.round(WORLD_H * q);
    var seed = (M.hash32(speciesKey) + (seedBase || 0)) % 100000;
    var rng = M.rng(seed + 1);

    var tex = makeCanvas(tw, th);
    var ctx = tex.getContext('2d');

    var planks = spec.planks;
    var ph = th / planks;
    var boardW = Math.round(1150 * q), boardH = Math.ceil(ph);
    var boards = [
      grainBoard(spec, boardW, boardH, q, seed + 11),
      grainBoard(spec, boardW, boardH, q, seed + 23),
      grainBoard(spec, boardW, boardH, q, seed + 37)
    ];

    for (var p = 0; p < planks; p++) {
      var y0 = p * ph;
      var x = -rng() * 380 * q;
      while (x < tw) {
        var len = Math.min(boardW, (480 + rng() * 620) * q);
        var board = boards[(rng() * boards.length) | 0];
        var sx = rng() * Math.max(0, board.width - len);

        ctx.save();
        if (rng() < 0.5) {
          /* Flip the board end-for-end: same wood, visibly different plank. */
          ctx.translate(x + len, 0);
          ctx.scale(-1, 1);
          ctx.drawImage(board, sx, 0, len, board.height, 0, y0, len, ph + 1);
        } else {
          ctx.drawImage(board, sx, 0, len, board.height, x, y0, len, ph + 1);
        }
        ctx.restore();

        /* Each board takes stain a little differently. */
        ctx.globalAlpha = 0.05 + rng() * 0.13;
        ctx.fillStyle = rng() < 0.5 ? spec.dark : spec.light;
        ctx.fillRect(x, y0, len, ph);
        ctx.globalAlpha = 1;

        /* End joint: a hairline gap with a lighter catch on the far edge. */
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x + len - 1.6 * q, y0, 2.2 * q, ph);
        ctx.fillStyle = 'rgba(255,235,205,0.06)';
        ctx.fillRect(x + len + 0.6 * q, y0, 1.6 * q, ph);
        x += len;
      }

      /* Long seam between planks, with the bevel catching light below it. */
      if (p > 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        ctx.fillRect(0, y0 - 1.6 * q, tw, 3.2 * q);
        ctx.fillStyle = 'rgba(255,238,210,0.07)';
        ctx.fillRect(0, y0 + 1.6 * q, tw, 2.2 * q);
      }
    }

    /* Knots: a dark heart with rings pushed around it. */
    var knots = spec.knots + ((rng() * 2) | 0);
    for (var k = 0; k < knots; k++) {
      var kx = (80 + rng() * (WORLD_W - 160)) * q;
      var plankIdx = (rng() * planks) | 0;
      var ky = (plankIdx + 0.25 + rng() * 0.5) * ph;
      var rx = (10 + rng() * 16) * q, ry = rx * (0.45 + rng() * 0.25);
      ctx.save();
      ctx.translate(kx, ky);
      ctx.scale(1, ry / rx);
      var kg = ctx.createRadialGradient(0, 0, 0, 0, 0, rx * 2.4);
      kg.addColorStop(0, S.toCSS(S.fromHex(spec.dark), 0.95));
      kg.addColorStop(0.35, S.toCSS(S.fromHex(spec.dark), 0.55));
      kg.addColorStop(1, S.toCSS(S.fromHex(spec.dark), 0));
      ctx.fillStyle = kg;
      ctx.beginPath();
      ctx.arc(0, 0, rx * 2.4, 0, M.TAU);
      ctx.fill();
      ctx.strokeStyle = S.toCSS(S.fromHex(spec.dark), 0.35);
      ctx.lineWidth = 1.2 * q;
      for (var ring = 1; ring <= 4; ring++) {
        ctx.beginPath();
        ctx.arc((rng() - 0.5) * 2 * q, 0, rx * (0.9 + ring * 0.55), 0, M.TAU);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* Wear and blotching at a scale bigger than any plank. */
    for (var b = 0; b < 10; b++) {
      var bx = rng() * tw, by = rng() * th, br = (160 + rng() * 380) * q;
      var bg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      var dark = rng() < 0.55;
      bg.addColorStop(0, dark ? 'rgba(0,0,0,0.10)' : 'rgba(255,240,215,0.07)');
      bg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bg;
      ctx.fillRect(bx - br, by - br, br * 2, br * 2);
    }

    /* Varnish: a broad soft sheen, as if from a window off to one side. */
    var sheen = ctx.createLinearGradient(0, 0, tw, th);
    sheen.addColorStop(0.00, 'rgba(255,245,225,0.00)');
    sheen.addColorStop(0.32, 'rgba(255,245,225,0.07)');
    sheen.addColorStop(0.45, 'rgba(255,245,225,0.00)');
    sheen.addColorStop(1.00, 'rgba(255,245,225,0.00)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, tw, th);

    cache[key] = tex;
    return tex;
  }

  function clearCache() { cache = {}; }

  /* ==========================================================================
   * DUST
   * ======================================================================= */
  function createDust(count, seed) {
    var rng = M.rng(seed || 7);
    var motes = [];
    for (var i = 0; i < count; i++) {
      motes.push({
        x: rng() * WORLD_W,
        y: rng() * WORLD_H,
        vx: (rng() - 0.5) * 9,
        vy: (rng() - 0.5) * 7,
        size: 0.7 + rng() * rng() * 2.6,
        phase: rng() * M.TAU,
        twinkle: 0.6 + rng() * 2.2
      });
    }
    return motes;
  }

  function stepDust(motes, dt, t) {
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      /* Slow convective drift with a little wander, like dust in still air. */
      m.x += (m.vx + Math.sin(t * 0.21 + m.phase) * 4) * dt;
      m.y += (m.vy + Math.cos(t * 0.17 + m.phase * 1.3) * 3) * dt;
      if (m.x < -10) m.x += WORLD_W + 20; else if (m.x > WORLD_W + 10) m.x -= WORLD_W + 20;
      if (m.y < -10) m.y += WORLD_H + 20; else if (m.y > WORLD_H + 10) m.y -= WORLD_H + 20;
    }
  }

  LP.Bench = {
    SPECIES: SPECIES,
    table: table,
    clearCache: clearCache,
    createDust: createDust,
    stepDust: stepDust,
    /* exported for tests */
    _valueNoise: valueNoise,
    _fbm: fbm
  };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
