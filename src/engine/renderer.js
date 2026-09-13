/* =============================================================================
 * Lumen Path - src/engine/renderer.js
 * -----------------------------------------------------------------------------
 * Canvas 2D renderer.
 *
 * Three passes, composited in this order:
 *   1. WORLD    background, grid, weather, zones, walls, optical hardware
 *   2. LIGHT    every beam segment, drawn additively into an offscreen buffer
 *               and blurred to produce bloom, then composited with 'lighter'
 *   3. OVERLAY  selection, handles, aim preview, receiver labels, particles
 *
 * The light pass is separate because additive blending plus a blur is what
 * makes overlapping beams brighten where they cross -- the same thing the
 * physics says should happen -- rather than just painting over one another.
 *
 * BEAM TRAVEL. Every segment carries the distance along its path at which it
 * starts and ends (t0/t1). A single advancing `lightFront` distance therefore
 * animates the whole branching tree correctly for free: a branch three bounces
 * deep does not begin drawing until the front has travelled far enough to
 * reach it, so splitters visibly fork in the right order.
 * ========================================================================== */
(function (LP) {
  'use strict';

  var V = LP.V, M = LP.M, S = LP.Spectrum, G = LP.Geom, E = LP.Elements;

  var WORLD_W = 1600, WORLD_H = 900;

  /* How fast the light front advances, in world units per second. */
  var LIGHT_SPEED = 3400;

  function create(canvas, opts) {
    var r = {
      canvas: canvas,
      ctx: canvas.getContext('2d'),
      glow: document.createElement('canvas'),
      glowCtx: null,
      dpr: 1,
      view: { scale: 1, ox: 0, oy: 0, w: WORLD_W, h: WORLD_H },
      theme: null,
      quality: (opts && opts.quality) || 'high',
      colorblind: false,
      reducedMotion: false,
      lightFront: 0,
      particles: [],
      time: 0,
      shake: 0
    };
    r.glowCtx = r.glow.getContext('2d');
    resize(r);
    return r;
  }

  /* --------------------------------------------------------------------------
   * Viewport. The world is a fixed 1600x900 stage letterboxed into whatever
   * the page gives us, so a level looks identical on every device and the
   * physics never has to care about screen size.
   * ------------------------------------------------------------------------ */
  function resize(r) {
    var c = r.canvas;
    var rect = c.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, r.quality === 'low' ? 1 : 2);
    var w = Math.max(1, Math.round(rect.width * dpr));
    var h = Math.max(1, Math.round(rect.height * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    r.dpr = dpr;

    var scale = Math.min(w / WORLD_W, h / WORLD_H);
    r.view.scale = scale;
    r.view.ox = (w - WORLD_W * scale) / 2;
    r.view.oy = (h - WORLD_H * scale) / 2;
    r.view.w = w; r.view.h = h;

    /* The glow buffer runs at half resolution: it is blurred anyway, and this
     * roughly quarters the fill cost of the most expensive pass. */
    var gscale = r.quality === 'low' ? 0.4 : 0.5;
    r.glow.width = Math.max(1, Math.round(w * gscale));
    r.glow.height = Math.max(1, Math.round(h * gscale));
    r.glowScale = gscale;
  }

  function toScreen(r, p) {
    return { x: r.view.ox + p.x * r.view.scale, y: r.view.oy + p.y * r.view.scale };
  }
  function toWorld(r, p) {
    return { x: (p.x - r.view.ox) / r.view.scale, y: (p.y - r.view.oy) / r.view.scale };
  }
  /** Convert a pointer event (CSS pixels) to world coordinates. */
  function eventToWorld(r, clientX, clientY) {
    var rect = r.canvas.getBoundingClientRect();
    return toWorld(r, {
      x: (clientX - rect.left) * r.dpr,
      y: (clientY - rect.top) * r.dpr
    });
  }

  function applyWorldTransform(ctx, r) {
    ctx.setTransform(r.view.scale, 0, 0, r.view.scale, r.view.ox, r.view.oy);
  }

  /* ==========================================================================
   * MAIN DRAW
   * ======================================================================= */
  function draw(r, state) {
    var ctx = r.ctx;
    var scene = state.scene;
    var theme = state.theme || {};
    r.theme = theme;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, r.view.w, r.view.h);

    /* Letterbox surround. */
    ctx.fillStyle = '#05060a';
    ctx.fillRect(0, 0, r.view.w, r.view.h);

    applyWorldTransform(ctx, r);
    ctx.save();
    if (r.shake > 0.01) {
      ctx.translate((Math.random() - 0.5) * r.shake, (Math.random() - 0.5) * r.shake);
    }

    drawBackground(r, ctx, theme, scene, state);
    drawZones(r, ctx, theme, scene, state);
    drawWalls(r, ctx, theme, scene);

    /* Hardware under the light, so beams read as passing over glass. */
    drawElements(r, ctx, theme, scene, state, false);

    ctx.restore();

    /* ---- Light pass ---------------------------------------------------- */
    drawLight(r, state);

    /* ---- Foreground hardware + overlay --------------------------------- */
    applyWorldTransform(ctx, r);
    ctx.save();
    drawElements(r, ctx, theme, scene, state, true);
    drawParticles(r, ctx);
    drawOverlay(r, ctx, theme, scene, state);
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* --------------------------------------------------------------------------
   * Background: chapter colour, grid, vignette and weather.
   * ------------------------------------------------------------------------ */
  function drawBackground(r, ctx, theme, scene, state) {
    var g = ctx.createLinearGradient(0, 0, 0, WORLD_H);
    var bg = theme.bg || '#0d1220';
    g.addColorStop(0, shade(bg, 1.35));
    g.addColorStop(0.55, bg);
    g.addColorStop(1, shade(bg, 0.7));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    /* Grid. */
    ctx.strokeStyle = theme.grid || '#1b2740';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    for (var x = 50; x < WORLD_W; x += 50) { ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); }
    for (var y = 50; y < WORLD_H; y += 50) { ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); }
    ctx.stroke();
    ctx.globalAlpha = 1;

    /* Heavier lines every 200 units give a sense of scale without noise. */
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (x = 200; x < WORLD_W; x += 200) { ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); }
    for (y = 200; y < WORLD_H; y += 200) { ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); }
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (scene.level && scene.level.weather && !r.reducedMotion) {
      drawWeather(r, ctx, theme, scene.level.weather, state);
    }

    /* Fog reads as a wash whose density matches the actual absorption
     * coefficient the tracer is using, so what you see is what is costing you. */
    if (scene.fog) {
      ctx.fillStyle = hexToRGBA(theme.accent || '#88aacc', Math.min(0.22, scene.fog * 120));
      ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    }

    /* Vignette. */
    var v = ctx.createRadialGradient(WORLD_W / 2, WORLD_H / 2, WORLD_H * 0.35,
                                     WORLD_W / 2, WORLD_H / 2, WORLD_H * 0.85);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  }

  function drawWeather(r, ctx, theme, kind, state) {
    var t = r.time;
    ctx.save();
    if (kind === 'aurora') {
      ctx.globalCompositeOperation = 'lighter';
      for (var i = 0; i < 3; i++) {
        var phase = t * (0.12 + i * 0.05) + i * 2.1;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        for (var x = 0; x <= WORLD_W; x += 40) {
          var y = 120 + i * 60 +
                  Math.sin(x * 0.004 + phase) * 60 +
                  Math.sin(x * 0.011 + phase * 1.7) * 26;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(WORLD_W, 0);
        ctx.closePath();
        var grd = ctx.createLinearGradient(0, 0, 0, 400);
        grd.addColorStop(0, hexToRGBA(theme.glow || '#c4ffe0', 0.0));
        grd.addColorStop(1, hexToRGBA(theme.accent || '#6bffab', 0.055));
        ctx.fillStyle = grd;
        ctx.fill();
      }
    } else if (kind === 'murk') {
      /* Slow drifting motes -- suspended particulate, the thing doing the
       * absorbing in these levels. */
      ctx.globalAlpha = 0.20;
      ctx.fillStyle = theme.glow || '#a5fff0';
      for (var k = 0; k < 46; k++) {
        var seed = k * 97.13;
        var px = (seed * 13.7 + t * (8 + (k % 5) * 3)) % (WORLD_W + 80) - 40;
        var py = (seed * 29.1 + Math.sin(t * 0.4 + k) * 18) % WORLD_H;
        var rr = 1.5 + (k % 4);
        ctx.beginPath();
        ctx.arc(px, py, rr, 0, M.TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawZones(r, ctx, theme, scene, state) {
    if (!scene.zones || !scene.zones.length) return;
    /* Only show the allowed bays while the player is actually placing. */
    var strong = state.dragging || state.hoverTray;
    ctx.save();
    ctx.setLineDash([12, 10]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = hexToRGBA(theme.accent || '#5ad7ff', strong ? 0.55 : 0.22);
    ctx.fillStyle = hexToRGBA(theme.accent || '#5ad7ff', strong ? 0.07 : 0.03);
    for (var i = 0; i < scene.zones.length; i++) {
      var z = scene.zones[i];
      roundRect(ctx, z.x, z.y, z.w, z.h, 10);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawWalls(r, ctx, theme, scene) {
    for (var i = 0; i < scene.elements.length; i++) {
      var el = scene.elements[i];
      if (!el.isWall) continue;
      var pts = el._prims[0].pts;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var j = 1; j < pts.length; j++) ctx.lineTo(pts[j].x, pts[j].y);
      ctx.closePath();
      ctx.fillStyle = shade(theme.bg || '#0d1220', 0.45);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = hexToRGBA(theme.grid || '#1b2740', 1);
      ctx.stroke();
      /* Hatching so a wall never reads as empty space. */
      ctx.save();
      ctx.clip();
      ctx.globalAlpha = 0.25;
      ctx.strokeStyle = theme.grid || '#1b2740';
      ctx.lineWidth = 3;
      ctx.beginPath();
      var b = el._bbox;
      for (var d = -b.h; d < b.w; d += 14) {
        ctx.moveTo(b.x + d, b.y + b.h);
        ctx.lineTo(b.x + d + b.h, b.y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ==========================================================================
   * LIGHT PASS
   * ======================================================================= */
  function drawLight(r, state) {
    var scene = state.scene;
    var res = scene.lastResult;
    if (!res) return;

    var gc = r.glowCtx;
    var gs = r.glowScale;
    gc.setTransform(1, 0, 0, 1, 0, 0);
    gc.clearRect(0, 0, r.glow.width, r.glow.height);
    gc.setTransform(r.view.scale * gs, 0, 0, r.view.scale * gs,
                    r.view.ox * gs, r.view.oy * gs);
    gc.globalCompositeOperation = 'lighter';
    gc.lineCap = 'round';

    var front = r.lightFront;
    var segs = res.segments;

    /* Two strokes per segment: a wide soft halo and a tight bright core.
     * Additive blending does the rest -- where beams cross, they add. */
    for (var pass = 0; pass < 2; pass++) {
      var wide = pass === 0;
      for (var i = 0; i < segs.length; i++) {
        var s = segs[i];
        if (s.t0 > front) continue;                 /* light has not got here yet */

        var a = s.a, b = s.b;
        var frac = 1;
        if (s.t1 > front) {
          frac = (front - s.t0) / Math.max(1e-6, s.t1 - s.t0);
          b = { x: a.x + (s.b.x - a.x) * frac, y: a.y + (s.b.y - a.y) * frac };
        }
        var inten = s.i0 + (s.i1 - s.i0) * frac;
        if (inten < 0.005) continue;

        var col = S.colClamp(S.colNormalize(s.c));
        var alpha = Math.min(1, inten * (wide ? 0.5 : 1.05));
        gc.strokeStyle = S.toCSS(col, wide ? alpha * 0.42 : alpha);
        gc.lineWidth = wide ? (7 + inten * 12) : (1.6 + inten * 2.6);

        if (r.colorblind && !wide) {
          gc.setLineDash(S.colorSignature(s.c).dash);
        } else {
          gc.setLineDash([]);
        }

        gc.beginPath();
        gc.moveTo(a.x, a.y);
        gc.lineTo(b.x, b.y);
        gc.stroke();
      }
    }
    gc.setLineDash([]);

    /* Composite the glow buffer back, blurred, in additive mode. */
    var ctx = r.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    if (r.quality !== 'low' && supportsFilter(ctx)) {
      ctx.filter = 'blur(' + (r.quality === 'high' ? 6 : 3) + 'px)';
      ctx.drawImage(r.glow, 0, 0, r.view.w, r.view.h);
      ctx.filter = 'none';
    }
    ctx.drawImage(r.glow, 0, 0, r.view.w, r.view.h);
    ctx.globalCompositeOperation = 'source-over';
  }

  var _filterSupport = null;
  function supportsFilter(ctx) {
    if (_filterSupport === null) _filterSupport = (typeof ctx.filter === 'string');
    return _filterSupport;
  }

  /** Advance the travelling light front. Called once per frame. */
  function stepLight(r, dt, maxPath) {
    r.time += dt;
    if (r.shake > 0) r.shake = Math.max(0, r.shake - dt * 40);
    if (r.reducedMotion) { r.lightFront = 1e9; return; }
    if (r.lightFront < maxPath + 200) r.lightFront += LIGHT_SPEED * dt;
  }

  /** Restart the travel animation -- called whenever the scene is edited. */
  function restartLight(r) { r.lightFront = r.reducedMotion ? 1e9 : 0; }

  /* ==========================================================================
   * OPTICAL HARDWARE
   * ======================================================================= */
  function drawElements(r, ctx, theme, scene, state, foreground) {
    for (var i = 0; i < scene.elements.length; i++) {
      var el = scene.elements[i];
      if (el.isWall) continue;
      var isGoal = el.type === 'receiver' || el.type === 'emitter';
      /* Goals draw on top of the light; optics draw beneath it. */
      if (foreground !== isGoal) continue;
      drawElement(r, ctx, theme, el, scene, state);
    }
  }

  function drawElement(r, ctx, theme, el, scene, state) {
    var accent = theme.accent || '#5ad7ff';
    switch (el.type) {
      case 'mirror':   drawMirror(r, ctx, el, '#dff2ff'); break;
      case 'concave':
      case 'convex':
      case 'flex':     drawMirror(r, ctx, el, '#dff2ff'); break;
      case 'oneway':   drawOneWay(r, ctx, el); break;
      case 'splitter': drawSplitter(r, ctx, el); break;
      case 'filter':   drawFilter(r, ctx, el); break;
      case 'polarizer':drawPolarizer(r, ctx, el); break;
      case 'grating':  drawGrating(r, ctx, el); break;
      case 'prism':
      case 'glass':
      case 'lens':     drawDielectric(r, ctx, el); break;
      case 'portal':   drawPortal(r, ctx, el, theme); break;
      case 'absorber': drawAbsorber(r, ctx, el, theme); break;
      case 'receiver': drawReceiver(r, ctx, el, theme, state); break;
      case 'emitter':  drawEmitter(r, ctx, el, theme); break;
    }
    if (el.motion) drawMotionRig(r, ctx, el, theme);
  }

  /** Path along the element's reflective primitive (segment or arc). */
  function surfacePath(ctx, el) {
    var p = el._prims[0];
    ctx.beginPath();
    if (!p) return;
    if (p.kind === 'seg') { ctx.moveTo(p.a.x, p.a.y); ctx.lineTo(p.b.x, p.b.y); }
    else if (p.kind === 'arc') {
      ctx.arc(p.c.x, p.c.y, p.r, p.a0, p.a0 + p.sweep, p.sweep < 0);
    } else if (p.kind === 'circle') {
      ctx.arc(p.c.x, p.c.y, p.r, 0, M.TAU);
    }
  }

  function drawMirror(r, ctx, el, face) {
    /* Dark backing plate, then the bright reflective coat on the front. */
    ctx.lineCap = 'round';
    ctx.lineWidth = 11;
    ctx.strokeStyle = 'rgba(12,18,30,0.95)';
    surfacePath(ctx, el);
    ctx.stroke();

    ctx.lineWidth = 5.5;
    var grad = ctx.createLinearGradient(el.x - 60, el.y - 60, el.x + 60, el.y + 60);
    var tint = el.material === 'gold' ? '#ffd9a0' : face;
    grad.addColorStop(0, shade(tint, 0.72));
    grad.addColorStop(0.5, tint);
    grad.addColorStop(1, shade(tint, 0.72));
    ctx.strokeStyle = grad;
    surfacePath(ctx, el);
    ctx.stroke();

    /* A hairline highlight sells it as polished rather than painted. */
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    surfacePath(ctx, el);
    ctx.stroke();

    if (el.thermal) drawHeatBloom(r, ctx, el);
  }

  function drawHeatBloom(r, ctx, el) {
    var m = el.motion || {};
    var stress = m.stress || 0;
    if (stress <= 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 16;
    ctx.strokeStyle = 'rgba(255,' + Math.round(150 - stress * 90) + ',60,' +
                      (0.10 + Math.min(0.4, stress * 0.22)) + ')';
    surfacePath(ctx, el);
    ctx.stroke();
    ctx.restore();
    if (stress > 1) {
      /* Past the damage threshold: say so, loudly. */
      ctx.save();
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,120,60,' + (0.55 + 0.4 * Math.sin(r.time * 9)) + ')';
      ctx.fillText('OVERHEATING', el.x, el.y - E.handleReach(el) - 16);
      ctx.restore();
    }
  }

  function drawOneWay(r, ctx, el) {
    var p = el._prims[0];
    var d = V.norm(V.sub(p.b, p.a));
    var n = V.perp(d);
    if (el.flipped) n = V.neg(n);

    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(12,18,30,0.95)';
    surfacePath(ctx, el);
    ctx.stroke();
    /* Mirrored face. */
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#e8f4ff';
    ctx.beginPath();
    ctx.moveTo(p.a.x + n.x * 2.5, p.a.y + n.y * 2.5);
    ctx.lineTo(p.b.x + n.x * 2.5, p.b.y + n.y * 2.5);
    ctx.stroke();
    /* Clear face: dashed, so the two sides never look the same. */
    ctx.lineWidth = 3;
    ctx.setLineDash([7, 7]);
    ctx.strokeStyle = 'rgba(190,215,235,0.5)';
    ctx.beginPath();
    ctx.moveTo(p.a.x - n.x * 3.5, p.a.y - n.y * 3.5);
    ctx.lineTo(p.b.x - n.x * 3.5, p.b.y - n.y * 3.5);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawSplitter(r, ctx, el) {
    var p = el._prims[0];
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(14,20,34,0.9)';
    surfacePath(ctx, el);
    ctx.stroke();

    /* Half-silvered: alternating opaque and clear, in proportion to the ratio. */
    var ratio = el.ratio === undefined ? 0.5 : el.ratio;
    var dash = Math.max(4, 16 * ratio);
    ctx.lineWidth = 4.5;
    ctx.setLineDash([dash, Math.max(3, 16 - dash)]);
    ctx.strokeStyle = '#cfe8ff';
    surfacePath(ctx, el);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(190,225,255,0.45)';
    surfacePath(ctx, el);
    ctx.stroke();
  }

  function drawFilter(r, ctx, el) {
    var col = S.resolveColor(el.color);
    ctx.lineWidth = 13;
    ctx.strokeStyle = S.toCSS(col, 0.30);
    surfacePath(ctx, el);
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.strokeStyle = S.toCSS(col, 0.92);
    surfacePath(ctx, el);
    ctx.stroke();
    /* Frame. */
    var p = el._prims[0];
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(230,240,255,0.75)';
    ctx.beginPath();
    ctx.arc(p.a.x, p.a.y, 4, 0, M.TAU);
    ctx.moveTo(p.b.x + 4, p.b.y);
    ctx.arc(p.b.x, p.b.y, 4, 0, M.TAU);
    ctx.stroke();

    if (r.colorblind) {
      var sig = S.colorSignature(col);
      ctx.save();
      ctx.font = '600 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText(sig.glyph, el.x, el.y - 14);
      ctx.restore();
    }
  }

  function drawPolarizer(r, ctx, el) {
    var rad = el.radius;
    ctx.save();
    ctx.translate(el.x, el.y);

    ctx.beginPath();
    ctx.arc(0, 0, rad, 0, M.TAU);
    ctx.fillStyle = 'rgba(180,200,230,0.13)';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(214,232,255,0.85)';
    ctx.stroke();

    /* Hatching along the transmission axis -- rotating this is the control. */
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, rad - 2, 0, M.TAU);
    ctx.clip();
    ctx.rotate(el.angle);
    ctx.strokeStyle = 'rgba(220,238,255,0.5)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (var y = -rad; y <= rad; y += 7) { ctx.moveTo(-rad, y); ctx.lineTo(rad, y); }
    ctx.stroke();
    ctx.restore();

    /* Axis indicator. */
    ctx.rotate(el.angle);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(-rad + 5, 0); ctx.lineTo(rad - 5, 0);
    ctx.stroke();
    ctx.restore();
  }

  function drawGrating(r, ctx, el) {
    var p = el._prims[0];
    var d = V.norm(V.sub(p.b, p.a));
    var n = V.perp(d);
    var len = V.dist(p.a, p.b);

    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(16,22,36,0.9)';
    surfacePath(ctx, el);
    ctx.stroke();

    /* Rulings. Their spacing on screen tracks the element's `spacing`, so a
     * finer grating visibly looks finer. */
    var step = M.clamp(el.spacing / 260, 3, 9);
    ctx.strokeStyle = 'rgba(200,225,255,0.8)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (var t = 0; t <= len; t += step) {
      var px = p.a.x + d.x * t, py = p.a.y + d.y * t;
      ctx.moveTo(px - n.x * 5, py - n.y * 5);
      ctx.lineTo(px + n.x * 5, py + n.y * 5);
    }
    ctx.stroke();
  }

  function drawDielectric(r, ctx, el) {
    var pts = el._prims[0].pts;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();

    var b = el._bbox;
    var g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
    g.addColorStop(0, 'rgba(200,230,255,0.20)');
    g.addColorStop(0.45, 'rgba(170,210,255,0.10)');
    g.addColorStop(1, 'rgba(220,240,255,0.24)');
    ctx.fillStyle = g;
    ctx.fill();

    ctx.lineWidth = 2.4;
    ctx.strokeStyle = 'rgba(226,242,255,0.85)';
    ctx.stroke();

    /* Inner highlight to suggest thickness. */
    ctx.save();
    ctx.clip();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    for (var j = 0; j < pts.length; j++) {
      var a = pts[j], c = pts[(j + 1) % pts.length];
      var mx = (a.x + c.x) / 2 - el.x, my = (a.y + c.y) / 2 - el.y;
      var l = Math.sqrt(mx * mx + my * my) || 1;
      ctx.moveTo(a.x - mx / l * 4, a.y - my / l * 4);
      ctx.lineTo(c.x - mx / l * 4, c.y - my / l * 4);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawPortal(r, ctx, el, theme) {
    var t = r.time;
    ctx.save();
    ctx.translate(el.x, el.y);
    var accent = theme.accent || '#8fa8ff';

    ctx.globalCompositeOperation = 'lighter';
    var g = ctx.createRadialGradient(0, 0, el.radius * 0.2, 0, 0, el.radius * 1.5);
    g.addColorStop(0, hexToRGBA(accent, 0.42));
    g.addColorStop(1, hexToRGBA(accent, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, el.radius * 1.5, 0, M.TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    /* Counter-rotating arcs. */
    for (var i = 0; i < 3; i++) {
      ctx.save();
      ctx.rotate(t * (0.6 + i * 0.35) * (i % 2 ? -1 : 1));
      ctx.strokeStyle = hexToRGBA(accent, 0.9 - i * 0.22);
      ctx.lineWidth = 3 - i * 0.6;
      ctx.beginPath();
      ctx.arc(0, 0, el.radius - i * 5, 0.4, 0.4 + Math.PI * 1.15);
      ctx.stroke();
      ctx.restore();
    }
    /* Exit-direction pip. */
    ctx.rotate(el.angle + (el.exitOffset || 0));
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(el.radius + 7, 0, 3.4, 0, M.TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawAbsorber(r, ctx, el, theme) {
    var pts = el._prims[0].pts;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(8,10,16,0.92)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(120,130,150,0.5)';
    ctx.stroke();
  }

  function drawEmitter(r, ctx, el, theme) {
    var col = S.resolveColor(el.color);
    ctx.save();
    ctx.translate(el.x, el.y);
    ctx.rotate(el.angle);

    /* Housing. */
    ctx.fillStyle = '#161d2c';
    ctx.strokeStyle = 'rgba(200,220,245,0.7)';
    ctx.lineWidth = 2;
    roundRect(ctx, -26, -18, 40, 36, 7);
    ctx.fill();
    ctx.stroke();

    /* Aperture, glowing in the emitter's own colour. */
    ctx.globalCompositeOperation = 'lighter';
    var g = ctx.createRadialGradient(14, 0, 1, 14, 0, 26);
    g.addColorStop(0, S.toCSS(col, 0.95));
    g.addColorStop(1, S.toCSS(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(14, 0, 26, 0, M.TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = S.toCSS(col, 1);
    ctx.beginPath();
    ctx.arc(13, 0, 6.5, 0, M.TAU);
    ctx.fill();

    /* Aperture width marker for parallel-bundle emitters. */
    if (el.width) {
      ctx.strokeStyle = S.toCSS(col, 0.5);
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(16, -el.width / 2);
      ctx.lineTo(16, el.width / 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  function drawReceiver(r, ctx, el, theme, state) {
    var st = el._state || { lit: false, intensity: 0, dark: false };
    var req = el.require || {};
    var wantCol = req.color && req.color !== 'any'
      ? S.resolveColor(req.color)
      : (req.wavelength ? S.wavelengthRGB(req.wavelength) : { r: 0.8, g: 0.86, b: 1 });

    ctx.save();
    ctx.translate(el.x, el.y);

    var lit = st.lit;
    var pulse = lit ? 1 : 0.55 + 0.12 * Math.sin(r.time * 2.4);

    if (req.dark) {
      /* Alarm sensor: the goal is to keep it dark, so invert the language. */
      var tripped = !st.lit;
      ctx.strokeStyle = tripped ? '#ff5a5a' : 'rgba(200,120,120,0.7)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, el.radius, 0, M.TAU);
      ctx.stroke();
      ctx.setLineDash([5, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, el.radius - 9, 0, M.TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = tripped ? '#ff8080' : 'rgba(210,150,150,0.85)';
      ctx.fillText(tripped ? '!' : '∅', 0, 5);
      ctx.restore();
      return;
    }

    /* Halo when satisfied. */
    if (lit) {
      ctx.globalCompositeOperation = 'lighter';
      var g = ctx.createRadialGradient(0, 0, el.radius * 0.3, 0, 0, el.radius * 2.4);
      g.addColorStop(0, S.toCSS(wantCol, 0.55));
      g.addColorStop(1, S.toCSS(wantCol, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, el.radius * 2.4, 0, M.TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    /* Body. */
    ctx.fillStyle = lit ? S.toCSS(wantCol, 0.30) : 'rgba(16,22,34,0.85)';
    ctx.beginPath();
    ctx.arc(0, 0, el.radius, 0, M.TAU);
    ctx.fill();

    ctx.lineWidth = 3.2;
    ctx.strokeStyle = S.toCSS(wantCol, pulse);
    ctx.beginPath();
    ctx.arc(0, 0, el.radius, 0, M.TAU);
    ctx.stroke();

    /* Fill ring showing progress toward the intensity requirement. */
    var minI = req.minIntensity === undefined ? 0.22 : req.minIntensity;
    var frac = M.clamp(st.intensity / Math.max(1e-6, minI), 0, 1);
    if (frac > 0.01) {
      ctx.lineWidth = 5;
      ctx.strokeStyle = S.toCSS(lit ? wantCol : { r: 1, g: 0.8, b: 0.35 }, 0.95);
      ctx.beginPath();
      ctx.arc(0, 0, el.radius - 6, -Math.PI / 2, -Math.PI / 2 + M.TAU * frac);
      ctx.stroke();
    }

    /* Core. */
    ctx.fillStyle = lit ? S.toCSS(wantCol, 1) : 'rgba(120,140,170,0.5)';
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(4, el.radius * 0.22), 0, M.TAU);
    ctx.fill();

    /* Colourblind mode: the required colour also gets a glyph. */
    if (r.colorblind && req.color && req.color !== 'any') {
      var sig = S.colorSignature(wantCol);
      ctx.font = '700 ' + Math.round(el.radius * 0.7) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = lit ? '#0b0f18' : '#dfe8f5';
      ctx.fillText(sig.glyph, 0, el.radius * 0.25);
    }
    if (req.wavelength) {
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(230,240,255,0.85)';
      ctx.fillText(req.wavelength + 'nm', 0, el.radius + 18);
    }
    ctx.restore();
  }

  /** Draw the rail, pivot rod or turntable base an element is mounted on. */
  function drawMotionRig(r, ctx, el, theme) {
    var m = el.motion;
    ctx.save();
    ctx.strokeStyle = 'rgba(190,205,230,0.32)';
    ctx.lineWidth = 2;
    if (m.type === 'pendulum' && m.pivot) {
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(m.pivot.x, m.pivot.y);
      ctx.lineTo(el.x, el.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(210,225,245,0.9)';
      ctx.beginPath();
      ctx.arc(m.pivot.x, m.pivot.y, 5, 0, M.TAU);
      ctx.fill();
      /* The arc it will sweep. */
      if (m.len && m.release !== undefined) {
        ctx.setLineDash([3, 9]);
        ctx.strokeStyle = 'rgba(190,205,230,0.18)';
        ctx.beginPath();
        ctx.arc(m.pivot.x, m.pivot.y, m.len,
                Math.PI / 2 - m.release, Math.PI / 2 + m.release);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (m.type === 'track' && m.from && m.to) {
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.moveTo(m.from.x, m.from.y);
      ctx.lineTo(m.to.x, m.to.y);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (m.type === 'orbit' && m.center) {
      ctx.setLineDash([4, 10]);
      ctx.beginPath();
      ctx.arc(m.center.x, m.center.y, m.radius, 0, M.TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (m.type === 'turntable') {
      ctx.beginPath();
      ctx.arc(el.x, el.y, 13, 0, M.TAU);
      ctx.stroke();
      ctx.fillStyle = 'rgba(190,205,230,0.25)';
      ctx.fill();
    } else if (m.type === 'beat') {
      /* Beat pips: which step of the cycle it is on. */
      ctx.fillStyle = 'rgba(255,190,110,0.85)';
      for (var i = 0; i < 4; i++) {
        var on = (m.beatIndex % 4) === i;
        ctx.globalAlpha = on ? 1 : 0.25;
        ctx.beginPath();
        ctx.arc(el.x - 18 + i * 12, el.y - E.handleReach(el) - 14, 3.2, 0, M.TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /* ==========================================================================
   * OVERLAY: selection, handles, aim preview
   * ======================================================================= */
  function drawOverlay(r, ctx, theme, scene, state) {
    var accent = theme.accent || '#5ad7ff';

    /* Live aim preview while dragging or rotating. */
    if (state.preview && state.preview.length) {
      ctx.save();
      ctx.setLineDash([9, 9]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = hexToRGBA('#ffffff', 0.55);
      ctx.beginPath();
      for (var i = 0; i < state.preview.length; i++) {
        var s = state.preview[i];
        ctx.moveTo(s.a.x, s.a.y);
        ctx.lineTo(s.b.x, s.b.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    /* Ghost of the object about to be dropped. */
    if (state.ghost) {
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = state.ghost.ok ? hexToRGBA(accent, 0.9) : 'rgba(255,110,110,0.9)';
      ctx.fillStyle = state.ghost.ok ? hexToRGBA(accent, 0.16) : 'rgba(255,110,110,0.14)';
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 6]);
      ctx.beginPath();
      ctx.arc(state.ghost.p.x, state.ghost.p.y, 26, 0, M.TAU);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      if (!state.ghost.ok) {
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(state.ghost.p.x - 11, state.ghost.p.y - 11);
        ctx.lineTo(state.ghost.p.x + 11, state.ghost.p.y + 11);
        ctx.moveTo(state.ghost.p.x + 11, state.ghost.p.y - 11);
        ctx.lineTo(state.ghost.p.x - 11, state.ghost.p.y + 11);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* Hint marker: where the reference answer puts the next object. */
    if (state.hint) {
      ctx.save();
      var pulse = 0.5 + 0.5 * Math.sin(r.time * 4);
      ctx.strokeStyle = 'rgba(255,214,120,' + (0.55 + pulse * 0.45) + ')';
      ctx.lineWidth = 3;
      ctx.setLineDash([5, 8]);
      ctx.beginPath();
      ctx.arc(state.hint.x, state.hint.y, 30 + pulse * 8, 0, M.TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,224,150,0.95)';
      ctx.fillText(state.hint.type, state.hint.x, state.hint.y - 44);
      ctx.restore();
    }

    var sel = state.selected;
    if (!sel) return;

    /* Selection ring. */
    ctx.save();
    ctx.strokeStyle = hexToRGBA(accent, 0.85);
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 6]);
    var reach = E.handleReach(sel) + 14;
    ctx.beginPath();
    ctx.arc(sel.x, sel.y, reach, 0, M.TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    var hs = E.handles(sel);
    for (var h = 0; h < hs.length; h++) {
      var hd = hs[h];
      var active = state.activeHandle === hd.kind;
      ctx.beginPath();
      ctx.arc(hd.p.x, hd.p.y, active ? 11 : 8, 0, M.TAU);
      ctx.fillStyle = hd.kind === 'rotate' ? hexToRGBA(accent, 0.95)
                    : hd.kind === 'curve' ? 'rgba(255,200,120,0.95)'
                    : 'rgba(255,255,255,0.92)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(10,14,22,0.9)';
      ctx.stroke();

      if (hd.kind === 'rotate') {
        ctx.strokeStyle = hexToRGBA(accent, 0.5);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sel.x, sel.y);
        ctx.lineTo(hd.p.x, hd.p.y);
        ctx.stroke();
      }
    }

    /* Angle readout while rotating. */
    if (state.activeHandle === 'rotate') {
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      var deg = Math.round(M.deg(M.wrapAngle2(sel.angle)));
      ctx.fillText(deg + '°', sel.x, sel.y - reach - 14);
    }
    ctx.restore();
  }

  /* ==========================================================================
   * PARTICLES -- the burst when a receiver lights.
   * ======================================================================= */
  function burst(r, p, color, count) {
    if (r.reducedMotion) return;
    var n = count || 22;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * M.TAU + Math.random() * 0.4;
      var sp = 90 + Math.random() * 210;
      r.particles.push({
        x: p.x, y: p.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.5 + Math.random() * 0.5, age: 0,
        c: color, size: 2 + Math.random() * 3
      });
    }
    r.shake = 6;
  }

  function stepParticles(r, dt) {
    for (var i = r.particles.length - 1; i >= 0; i--) {
      var p = r.particles[i];
      p.age += dt;
      if (p.age >= p.life) { r.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.94; p.vy *= 0.94;
      p.vy += 120 * dt;             /* a little gravity so it settles */
    }
  }

  function drawParticles(r, ctx) {
    if (!r.particles.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < r.particles.length; i++) {
      var p = r.particles[i];
      var k = 1 - p.age / p.life;
      ctx.fillStyle = S.toCSS(p.c, k);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * k, 0, M.TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ==========================================================================
   * Small colour helpers
   * ======================================================================= */
  function hexToRGBA(hex, a) {
    var c = S.fromHex(hex);
    return 'rgba(' + Math.round(c.r * 255) + ',' + Math.round(c.g * 255) + ',' +
           Math.round(c.b * 255) + ',' + a + ')';
  }
  function shade(hex, f) {
    var c = S.fromHex(hex);
    return S.toHex({ r: M.clamp(c.r * f, 0, 1), g: M.clamp(c.g * f, 0, 1), b: M.clamp(c.b * f, 0, 1) });
  }
  function roundRect(ctx, x, y, w, h, rad) {
    var rr = Math.min(rad, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  LP.Renderer = {
    WORLD_W: WORLD_W, WORLD_H: WORLD_H,
    LIGHT_SPEED: LIGHT_SPEED,
    create: create,
    resize: resize,
    draw: draw,
    toScreen: toScreen,
    toWorld: toWorld,
    eventToWorld: eventToWorld,
    stepLight: stepLight,
    restartLight: restartLight,
    burst: burst,
    stepParticles: stepParticles,
    roundRect: roundRect,
    hexToRGBA: hexToRGBA,
    shade: shade
  };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
