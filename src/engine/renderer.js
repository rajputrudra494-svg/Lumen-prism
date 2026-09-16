/* =============================================================================
 * Lumen Path - src/engine/renderer.js
 * -----------------------------------------------------------------------------
 * Canvas 2D renderer.
 *
 * The scene is an optical bench in a dim room, built in five passes:
 *
 *   0. ROOM      a plank floor, and the table's own mitred wooden frame
 *   1. TABLE     the wooden tabletop, fully lit, exactly as it would look
 *                under a bright work light (see bench.js)
 *   2. LIGHTING  a low-resolution light map -- faint room ambient, a hanging
 *                lamp, the pools each beam throws onto the wood, the spill in
 *                front of every lamp -- MULTIPLIED over the table. The wood is
 *                only as bright as the light reaching it, so a beam visibly
 *                lights up the boards it runs across.
 *   3. HARDWARE  mounts, glass and metal, each casting a soft shadow
 *   4. AIR       the beams themselves, drawn additively and blurred: broad
 *                bands of scattered light that widen as they travel, a crisp
 *                core, continuous rainbows filled in between the colours of a
 *                dispersed beam, film grain, and dust motes that glint only
 *                where light passes through them
 *   5. GLASS     prisms, lenses and blocks catch the light at their edges and
 *                corners, drawn over the beams
 *   6. OVERLAY   lamps, flagged destinations, particles and the gizmos
 *
 * Additive blending in the air pass is what makes crossing beams brighten
 * where they overlap -- the same thing the physics says happens.
 *
 * WHAT IS REAL AND WHAT IS LOOK. The scattering shaft, the pools of light on
 * the wood and the dust are rendering. The tracer still decides where every
 * ray goes and how much energy reaches each sensor, so what lights a sensor is
 * always the crisp core line, never the glow around it.
 *
 * TIMED LEVELS. The game hands the renderer an `fx` block each frame: `power`
 * (1 normally; flickering to 0 when a phase's clock runs out and the bench
 * loses power) and `alarm` (the red beacon that sweeps the room in a phase's
 * last seconds). Hardware still waiting for its phase is drawn as what it
 * would be on a real bench: a sensor socket, a slot a wall will rise from,
 * a lamp standing dark.
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

  /* The wooden frame round the tabletop, in world units. The stage is fitted
   * with it, so the frame is never cut off by the edge of the screen. */
  var FRAME = 26;

  /* How fast the light front advances, in world units per second. */
  var LIGHT_SPEED = 3400;

  function create(canvas, opts) {
    var r = {
      canvas: canvas,
      ctx: canvas.getContext('2d'),
      glow: document.createElement('canvas'),
      glowCtx: null,
      dpr: 1,
      view: { scale: 1, ox: 0, oy: 0, w: WORLD_W, h: WORLD_H, rot: 0 },
      /* CSS-pixel bands along each edge that the HUD occupies. The world is
       * fitted INSIDE them, so no level content can sit under a button. */
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
      /* Whether a portrait screen may turn the stage sideways. Levels whose
       * physics has a visible "down" -- pendulums -- switch this off. */
      allowRotate: true,
      coarse: typeof window !== 'undefined' && !!window.matchMedia &&
              window.matchMedia('(pointer: coarse)').matches,
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
    /* Illumination of the tabletop, and a scratch buffer to blur it into. */
    r.light = document.createElement('canvas');
    r.lightCtx = r.light.getContext('2d');
    r.lightBlur = document.createElement('canvas');
    r.lightBlurCtx = r.lightBlur.getContext('2d');
    r.dust = LP.Bench ? LP.Bench.createDust(240, 11) : [];
    resize(r);
    return r;
  }

  /* --------------------------------------------------------------------------
   * Viewport.
   *
   * The world is a fixed 1600x900 stage fitted into whatever part of the page
   * the HUD leaves free, so a level plays identically on every device and the
   * physics never has to care about screen size.
   *
   * PORTRAIT PHONES. Letterboxing a 16:9 stage into a tall screen wastes most
   * of it. When a quarter-turn would make the stage meaningfully bigger, the
   * view rotates instead: world +x runs down the screen and world +y runs from
   * right to left. Only the DRAWING rotates -- the level, the optics and every
   * coordinate the game stores are untouched -- and text is counter-rotated so
   * it still reads upright.
   * ------------------------------------------------------------------------ */
  function computeView(cssW, cssH, dpr, insets, allowRotate) {
    var ins = insets || {};
    var il = (ins.left || 0) * dpr, it = (ins.top || 0) * dpr;
    var ir = (ins.right || 0) * dpr, ib = (ins.bottom || 0) * dpr;
    var w = Math.max(1, Math.round(cssW * dpr));
    var h = Math.max(1, Math.round(cssH * dpr));
    var aw = Math.max(40, w - il - ir);
    var ah = Math.max(40, h - it - ib);

    var PW = WORLD_W + FRAME * 2, PH = WORLD_H + FRAME * 2;
    var flat = Math.min(aw / PW, ah / PH);
    var turned = Math.min(aw / PH, ah / PW);
    /* Demand a real gain before rotating, so a near-square window does not
     * flip back and forth while it is being resized. */
    var rot = !!allowRotate && turned > flat * 1.15;
    var sc = rot ? turned : flat;
    var cx = il + aw / 2, cy = it + ah / 2;

    var view = { scale: sc, w: w, h: h, rot: rot ? 1 : 0 };
    if (rot) {
      view.ox = cx + (WORLD_H * sc) / 2;
      view.oy = cy - (WORLD_W * sc) / 2;
    } else {
      view.ox = cx - (WORLD_W * sc) / 2;
      view.oy = cy - (WORLD_H * sc) / 2;
    }
    return view;
  }

  function resize(r) {
    var c = r.canvas;
    var rect = c.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, r.quality === 'low' ? 1 : 2);
    var view = computeView(rect.width, rect.height, dpr, r.insets, r.allowRotate);
    if (c.width !== view.w || c.height !== view.h) { c.width = view.w; c.height = view.h; }
    r.dpr = dpr;
    r.view = view;

    /* The glow buffer runs at reduced resolution: it is blurred anyway, and
     * this roughly quarters the fill cost of the most expensive pass. Only
     * reallocate when the size actually changes -- assigning a canvas's width
     * clears and reallocates it even when the value is identical. */
    var gscale = r.quality === 'low' ? 0.4 : 0.5;
    var gw = Math.max(1, Math.round(view.w * gscale));
    var gh = Math.max(1, Math.round(view.h * gscale));
    if (r.glow.width !== gw || r.glow.height !== gh) { r.glow.width = gw; r.glow.height = gh; }
    r.glowScale = gscale;

    /* Light on the table varies slowly across space, so its map can be tiny;
     * upscaling it is itself most of the softening. */
    var lscale = r.quality === 'low' ? 0.16 : (r.quality === 'medium' ? 0.2 : 0.25);
    var lw = Math.max(1, Math.round(view.w * lscale));
    var lh = Math.max(1, Math.round(view.h * lscale));
    if (r.light && (r.light.width !== lw || r.light.height !== lh)) {
      r.light.width = lw; r.light.height = lh;
      r.lightBlur.width = lw; r.lightBlur.height = lh;
    }
    r.lightScale = lscale;
  }

  /* World <-> device-pixel mapping for a given view. Pure, so it is testable. */
  function toScreenView(v, p) {
    return v.rot ? { x: v.ox - p.y * v.scale, y: v.oy + p.x * v.scale }
                 : { x: v.ox + p.x * v.scale, y: v.oy + p.y * v.scale };
  }
  function toWorldView(v, q) {
    return v.rot ? { x: (q.y - v.oy) / v.scale, y: (v.ox - q.x) / v.scale }
                 : { x: (q.x - v.ox) / v.scale, y: (q.y - v.oy) / v.scale };
  }
  function toScreen(r, p) { return toScreenView(r.view, p); }
  function toWorld(r, p) { return toWorldView(r.view, p); }

  /** Convert a pointer event (CSS pixels) to world coordinates. */
  function eventToWorld(r, clientX, clientY) {
    var rect = r.canvas.getBoundingClientRect();
    return toWorld(r, {
      x: (clientX - rect.left) * r.dpr,
      y: (clientY - rect.top) * r.dpr
    });
  }

  /** Point a context at world units, optionally at a buffer scale `k`. */
  function setWorld(ctx, v, k) {
    var f = k || 1;
    var sc = v.scale * f, ox = v.ox * f, oy = v.oy * f;
    /* Rotated: (x, y) -> (ox - s*y, oy + s*x). */
    if (v.rot) ctx.setTransform(0, sc, -sc, 0, ox, oy);
    else ctx.setTransform(sc, 0, 0, sc, ox, oy);
  }

  function applyWorldTransform(ctx, r) { setWorld(ctx, r.view, 1); }

  /** World units per CSS pixel at the current zoom. */
  function worldPerCss(r) { return r.dpr / r.view.scale; }

  /**
   * Gizmo sizes in world units, derived from fixed ON-SCREEN sizes. A finger
   * needs a much bigger target than a mouse pointer, so coarse pointers get
   * larger handles, a wider ring and more generous hit areas.
   */
  function handleOpts(r, removable) {
    var wpc = worldPerCss(r);
    var coarse = !!r.coarse;
    return {
      wpc: wpc,
      pad: (coarse ? 46 : 34) * wpc,
      radius: (coarse ? 13 : 9) * wpc,
      hit: (coarse ? 30 : 20) * wpc,
      body: (coarse ? 22 : 14) * wpc,
      font: (coarse ? 13 : 12) * wpc,
      removable: !!removable
    };
  }

  /**
   * Text that stays upright on screen even when the stage is rotated. Every
   * label drawn in world space goes through here.
   */
  function textAt(ctx, r, str, x, y) {
    if (r.view.rot) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(str, 0, 0);
      ctx.restore();
    } else {
      ctx.fillText(str, x, y);
    }
  }

  /* ==========================================================================
   * MAIN DRAW
   * ======================================================================= */
  function draw(r, state) {
    var ctx = r.ctx;
    var scene = state.scene;
    var theme = state.theme || {};
    r.theme = theme;
    var fx = state.fx || NO_FX;
    r.power = fx.power === undefined ? 1 : M.clamp(fx.power, 0, 1);
    r.alarm = fx.alarm || 0;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';

    var sx = 0, sy = 0;
    if (r.shake > 0.01) {
      sx = (Math.random() - 0.5) * r.shake;
      sy = (Math.random() - 0.5) * r.shake;
    }

    /* 0 + 1. The room, the frame and the bare table. */
    drawBackdrop(r, ctx, theme, sx, sy);

    /* 2. Light it. */
    renderLightMap(r, state);
    compositeLightMap(r);

    /* 3. Everything resting on it. */
    applyWorldTransform(ctx, r);
    ctx.save();
    ctx.translate(sx, sy);
    drawZones(r, ctx, theme, scene, state);
    drawCables(r, ctx, scene);
    drawWalls(r, ctx, theme, scene);
    drawElements(r, ctx, theme, scene, state, false);
    ctx.restore();

    /* 4. Light in the air. */
    drawLight(r, state);
    drawDust(r, state);

    /* 5. Lamps, sensors and the overlay. */
    applyWorldTransform(ctx, r);
    ctx.save();
    drawGlassLight(r, ctx, scene);
    drawElements(r, ctx, theme, scene, state, true);
    drawParticles(r, ctx);
    drawInstallFx(r, ctx, scene);
    drawOverlay(r, ctx, theme, scene, state);
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  var NO_FX = { power: 1, alarm: 0 };

  /* --------------------------------------------------------------------------
   * The room: a plank floor under the table, and the table's wooden frame.
   * ------------------------------------------------------------------------ */
  function drawRoom(r, ctx) {
    var v = r.view;
    ctx.fillStyle = '#0a0705';
    ctx.fillRect(0, 0, v.w, v.h);
    if (!LP.Bench || !LP.Bench.floorTile || r.quality === 'low') return;
    var tile = LP.Bench.floorTile('walnut', 1200, 960, 10, 5);
    if (!r._floor || r._floor.tile !== tile) {
      r._floor = { tile: tile, pattern: ctx.createPattern(tile, 'repeat'), key: null };
    }
    var pat = r._floor.pattern;
    var key = v.scale + ',' + v.ox + ',' + v.oy + ',' + v.rot;
    if (r._floor.key !== key && pat.setTransform && typeof DOMMatrix !== 'undefined') {
      /* Floorboards a little broader than the table's, turning with the stage. */
      var k = v.scale * 1.2;
      pat.setTransform(v.rot ? new DOMMatrix([0, k, -k, 0, v.ox, v.oy])
                             : new DOMMatrix([k, 0, 0, k, v.ox, v.oy]));
      r._floor.key = key;
    }
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, v.w, v.h);
    /* The floor is further from the work lamp than the tabletop. */
    ctx.fillStyle = 'rgba(5,3,2,0.5)';
    ctx.fillRect(0, 0, v.w, v.h);
  }

  /**
   * The room, the frame and the tabletop do not change while a level is being
   * played, and painting them -- a full-screen floor, a large soft shadow, the
   * table texture -- is most of a frame's fixed cost. Paint them once per
   * view, chapter and quality into a cached canvas, and copy it each frame.
   */
  function drawBackdrop(r, ctx, theme, sx, sy) {
    var v = r.view;
    var key = [v.w, v.h, v.scale, v.ox, v.oy, v.rot, theme.wood || 'oak', r.quality].join('|');
    if (typeof document === 'undefined') return;
    if (!r._backdrop) r._backdrop = document.createElement('canvas');
    var bd = r._backdrop;
    if (r._backdropKey !== key) {
      if (bd.width !== v.w || bd.height !== v.h) { bd.width = v.w; bd.height = v.h; }
      var bc = bd.getContext('2d');
      bc.setTransform(1, 0, 0, 1, 0, 0);
      bc.globalCompositeOperation = 'source-over';
      bc.clearRect(0, 0, v.w, v.h);
      r._floor = null;
      drawRoom(r, bc);
      setWorld(bc, v, 1);
      drawFrame(r, bc, theme);
      drawTable(r, bc, theme);
      r._backdropKey = key;
    }
    /* A screen shake moves the whole bench, in screen pixels. */
    var ox = 0, oy = 0;
    if (sx || sy) {
      if (v.rot) { ox = -sy * v.scale; oy = sx * v.scale; }
      else { ox = sx * v.scale; oy = sy * v.scale; }
      ctx.fillStyle = '#0a0705';
      ctx.fillRect(0, 0, v.w, v.h);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bd, ox, oy);
  }

  /** Four boards round the tabletop, grain running along each, mitred at the corners. */
  function drawFrame(r, ctx, theme) {
    var spec = LP.Bench && LP.Bench.SPECIES[theme.wood || 'oak'];
    var dark = spec ? spec.dark : '#3a2a1c';
    var F = FRAME, W = WORLD_W, H = WORLD_H;
    ctx.save();
    shadowOn(ctx, r, 0.85, 3.4);
    ctx.fillStyle = shade(dark, 0.8);
    ctx.fillRect(-F, -F, W + F * 2, H + F * 2);
    shadowOff(ctx);

    var tex = LP.Bench ? LP.Bench.table(theme.wood || 'oak', r.quality, 0) : null;
    var sides = [
      [[-F, -F], [W + F, -F], [W, 0], [0, 0]],
      [[W + F, -F], [W + F, H + F], [W, H], [W, 0]],
      [[W + F, H + F], [-F, H + F], [0, H], [W, H]],
      [[-F, H + F], [-F, -F], [0, 0], [0, H]]
    ];
    var light = ['rgba(255,236,205,0.10)', 'rgba(0,0,0,0.24)', 'rgba(0,0,0,0.34)', 'rgba(255,236,205,0.05)'];
    for (var i = 0; i < 4; i++) {
      var q = sides[i];
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(q[0][0], q[0][1]);
      for (var j = 1; j < 4; j++) ctx.lineTo(q[j][0], q[j][1]);
      ctx.closePath();
      ctx.clip();
      if (tex) {
        var strip = tex.height * 0.1;
        if (i % 2 === 0) {
          ctx.drawImage(tex, 0, i === 0 ? 0 : tex.height - strip, tex.width, strip,
                        -F, i === 0 ? -F : H, W + F * 2, F);
        } else {
          ctx.translate(i === 1 ? W + F : 0, -F);
          ctx.rotate(Math.PI / 2);
          ctx.drawImage(tex, 0, 0, tex.width, strip, 0, 0, H + F * 2, F);
        }
      }
      ctx.restore();
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(q[0][0], q[0][1]);
      for (var j2 = 1; j2 < 4; j2++) ctx.lineTo(q[j2][0], q[j2][1]);
      ctx.closePath();
      ctx.fillStyle = light[i];
      ctx.fill();
      ctx.restore();
    }
    /* Mitre joints, the outer arris, and the groove where the top meets the frame. */
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.moveTo(-F, -F); ctx.lineTo(0, 0);
    ctx.moveTo(W + F, -F); ctx.lineTo(W, 0);
    ctx.moveTo(W + F, H + F); ctx.lineTo(W, H);
    ctx.moveTo(-F, H + F); ctx.lineTo(0, H);
    ctx.stroke();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(255,236,205,0.14)';
    ctx.strokeRect(-F + 0.8, -F + 0.8, W + F * 2 - 1.6, H + F * 2 - 1.6);
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.62)';
    ctx.strokeRect(-1.5, -1.5, W + 3, H + 3);
    ctx.restore();
  }

  /* --------------------------------------------------------------------------
   * The tabletop.
   * ------------------------------------------------------------------------ */
  var _gridPath = null;
  function drawTable(r, ctx, theme) {
    var tex = LP.Bench ? LP.Bench.table(theme.wood || 'oak', r.quality, 0) : null;
    if (tex) ctx.drawImage(tex, 0, 0, WORLD_W, WORLD_H);
    else { ctx.fillStyle = '#6b4a2e'; ctx.fillRect(0, 0, WORLD_W, WORLD_H); }

    /* A ruled grid engraved into the varnish every 100 units: a dark groove
     * with a faint lit lip beside it. Enough to line things up by, quiet
     * enough to still read as a table. */
    if (!_gridPath && typeof Path2D !== 'undefined') {
      _gridPath = new Path2D();
      for (var x = 100; x < WORLD_W; x += 100) { _gridPath.moveTo(x, 0); _gridPath.lineTo(x, WORLD_H); }
      for (var y = 100; y < WORLD_H; y += 100) { _gridPath.moveTo(0, y); _gridPath.lineTo(WORLD_W, y); }
    }
    if (_gridPath) {
      ctx.save();
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = 'rgba(0,0,0,0.20)';
      ctx.stroke(_gridPath);
      ctx.translate(1.2, 1.2);
      ctx.strokeStyle = 'rgba(255,236,205,0.06)';
      ctx.stroke(_gridPath);
      ctx.restore();
    }

    /* The edge of the tabletop. */
    ctx.save();
    ctx.lineWidth = 14;
    ctx.strokeStyle = 'rgba(0,0,0,0.38)';
    ctx.strokeRect(7, 7, WORLD_W - 14, WORLD_H - 14);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,230,195,0.08)';
    ctx.strokeRect(15, 15, WORLD_W - 30, WORLD_H - 30);
    ctx.restore();
  }

  /* --------------------------------------------------------------------------
   * Soft drop shadows, cast away from a work light above and to the left.
   * Canvas shadow offsets live in device pixels and ignore the transform, so
   * the offset is rotated by hand when the stage is turned sideways --
   * otherwise shadows would point the wrong way on a portrait phone.
   * ------------------------------------------------------------------------ */
  function shadowOn(ctx, r, strength, lift) {
    if (r.quality === 'low') return;
    var k = r.view.scale;
    var up = lift || 1;
    var ox = 6 * k * up, oy = 9 * k * up;
    if (r.view.rot) { var t = ox; ox = -oy; oy = t; }
    ctx.shadowColor = 'rgba(0,0,0,' + (strength === undefined ? 0.55 : strength) + ')';
    ctx.shadowBlur = 10 * k * up;
    ctx.shadowOffsetX = ox;
    ctx.shadowOffsetY = oy;
  }
  function shadowOff(ctx) {
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  }

  function drawZones(r, ctx, theme, scene, state) {
    if (!scene.zones || !scene.zones.length) return;
    /* Marked out like painter's tape, brighter while you are placing. */
    var strong = state.dragging || state.hoverTray;
    ctx.save();
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    for (var i = 0; i < scene.zones.length; i++) {
      var z = scene.zones[i];
      roundRect(ctx, z.x, z.y, z.w, z.h, 8);
      ctx.fillStyle = strong ? 'rgba(255,236,190,0.08)' : 'rgba(255,236,190,0.03)';
      ctx.fill();
      ctx.setLineDash([18, 10]);
      ctx.strokeStyle = strong ? 'rgba(255,226,160,0.70)' : 'rgba(255,226,160,0.32)';
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawWalls(r, ctx, theme, scene) {
    var spec = LP.Bench && LP.Bench.SPECIES[theme.wood || 'oak'];
    var dark = spec ? spec.dark : '#3a2a1c';
    for (var i = 0; i < scene.elements.length; i++) {
      var el = scene.elements[i];
      if (!el.isWall) continue;
      var pts = el._prims[0].pts;
      var bb = el._bbox;
      if (el.disabled) { drawWallSlot(r, ctx, el, scene); continue; }

      /* A block of hardwood standing on the table. */
      ctx.save();
      shadowOn(ctx, r, 0.7, 1.5);
      polyPath(ctx, pts);
      ctx.fillStyle = shade(dark, 0.5);
      ctx.fill();
      shadowOff(ctx);

      var g = ctx.createLinearGradient(bb.x, bb.y, bb.x + bb.w, bb.y + bb.h);
      g.addColorStop(0, shade(dark, 1.25));
      g.addColorStop(1, shade(dark, 0.55));
      ctx.fillStyle = g;
      ctx.fill();

      /* End grain along the long axis. */
      ctx.save();
      ctx.clip();
      ctx.lineWidth = 1;
      var horizontal = bb.w >= bb.h;
      for (var k = 3; k < (horizontal ? bb.h : bb.w); k += 4.5) {
        ctx.strokeStyle = (k % 9 < 4.5) ? 'rgba(0,0,0,0.16)' : 'rgba(255,230,200,0.05)';
        ctx.beginPath();
        if (horizontal) { ctx.moveTo(bb.x, bb.y + k); ctx.lineTo(bb.x + bb.w, bb.y + k + 1.5); }
        else { ctx.moveTo(bb.x + k, bb.y); ctx.lineTo(bb.x + k + 1.5, bb.y + bb.h); }
        ctx.stroke();
      }
      ctx.restore();

      /* Bevels: lit along the top and left, shaded along the bottom and right. */
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = 'rgba(255,232,200,0.20)';
      ctx.beginPath();
      ctx.moveTo(pts[3].x, pts[3].y); ctx.lineTo(pts[0].x, pts[0].y); ctx.lineTo(pts[1].x, pts[1].y);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.moveTo(pts[1].x, pts[1].y); ctx.lineTo(pts[2].x, pts[2].y); ctx.lineTo(pts[3].x, pts[3].y);
      ctx.stroke();
      ctx.restore();
    }
  }

  function polyPath(ctx, pts) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
  }

  /* ==========================================================================
   * LIGHTING -- how brightly each part of the table is lit
   * ======================================================================= */

  /** Is this point on the edge of the world, where rays leave the table? */
  function onEdge(p) {
    return p.x < 1.5 || p.y < 1.5 || p.x > WORLD_W - 1.5 || p.y > WORLD_H - 1.5;
  }

  /**
   * The visible part of a segment given how far the light front has
   * travelled. Returns null if the light has not reached it yet.
   */
  function visiblePart(s, front) {
    if (s.t0 > front) return null;
    var frac = 1, b = s.b;
    if (s.t1 > front) {
      frac = (front - s.t0) / Math.max(1e-6, s.t1 - s.t0);
      b = { x: s.a.x + (s.b.x - s.a.x) * frac, y: s.a.y + (s.b.y - s.a.y) * frac };
    }
    return { a: s.a, b: b, frac: frac, tEnd: s.t0 + (s.t1 - s.t0) * frac,
             inten: s.i0 + (s.i1 - s.i0) * frac, whole: frac >= 1 };
  }

  /**
   * Exposure. Beam intensity is unbounded -- several lamps can pile onto one
   * path -- but a screen is not, and an eye does not see twice the energy as
   * twice as bright. This soft knee compresses strong beams so they glow
   * instead of burning out to a flat white bar, while faint beams stay faint.
   */
  function expose(i) { return 1 - Math.exp(-1.2 * (i > 0 ? i : 0)); }

  /* A beam's scattering shaft widens as it travels -- real light is never
   * perfectly collimated. Capped so a long path does not flood the table. */
  function shaftHalf(t) { return Math.min(54, 6.5 + t * 0.013); }

  function renderLightMap(r, state) {
    var scene = state.scene, theme = state.theme || {};
    var lc = r.lightCtx, L = r.light;
    if (!lc) return;

    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.globalCompositeOperation = 'source-over';
    var amb = S.fromHex(theme.ambient || '#b0a494');
    var lvl = theme.ambientLevel === undefined ? 0.42 : theme.ambientLevel;
    /* A power cut takes the work lamp with it; a little daylight remains. */
    var power = r.power === undefined ? 1 : r.power;
    lvl *= 0.3 + 0.7 * power;
    lc.fillStyle = 'rgb(' + Math.round(amb.r * 255 * lvl) + ',' +
                   Math.round(amb.g * 255 * lvl) + ',' + Math.round(amb.b * 255 * lvl) + ')';
    lc.fillRect(0, 0, L.width, L.height);

    setWorld(lc, r.view, r.lightScale);
    lc.globalCompositeOperation = 'lighter';

    /* A work lamp hanging somewhere over the middle of the bench. */
    var pool = lc.createRadialGradient(760, 360, 40, 800, 430, 1000);
    pool.addColorStop(0, 'rgba(255,224,178,' + (0.30 * power) + ')');
    pool.addColorStop(0.55, 'rgba(255,224,178,' + (0.10 * power) + ')');
    pool.addColorStop(1, 'rgba(255,224,178,0)');
    lc.fillStyle = pool;
    lc.fillRect(-100, -100, WORLD_W + 200, WORLD_H + 200);

    if (scene.level && scene.level.weather === 'aurora' && !r.reducedMotion) {
      auroraLight(r, lc, theme);
    }

    if (r.alarm > 0.01) beaconLight(r, lc);
    if (power < 0.6) emergencyLight(r, lc, 1 - power);

    /* Every lamp spills light forward, not just down its beam. */
    for (var e = 0; e < scene.emitters.length; e++) {
      var em = scene.emitters[e];
      if (em.disabled || power < 0.02) continue;
      lampSpill(lc, em, S.resolveColor(em.color), 340, em.width ? 0.75 : 0.5, 0.34 * power);
    }

    var res = scene.lastResult;
    if (res && power > 0.02) {
      var segs = res.segments, front = r.lightFront;
      lc.lineCap = 'round';
      for (var i = 0; i < segs.length; i++) {
        var s = segs[i];
        var v = visiblePart(s, front);
        if (!v || v.inten < 0.01) continue;
        var col = S.colClamp(S.colNormalize(s.c));

        /* The beam lights the boards along its whole length... */
        var ex = expose(v.inten) * power;
        lc.strokeStyle = S.toCSS(col, ex * 0.30);
        lc.lineWidth = 70 + ex * 60;
        lc.beginPath(); lc.moveTo(v.a.x, v.a.y); lc.lineTo(v.b.x, v.b.y); lc.stroke();
        lc.strokeStyle = S.toCSS(col, ex * 0.55);
        lc.lineWidth = 16 + ex * 12;
        lc.stroke();

        /* ...and splashes where it strikes something. */
        if (v.whole && !onEdge(v.b)) {
          var rad = 60 + ex * 80;
          var sg = lc.createRadialGradient(v.b.x, v.b.y, 0, v.b.x, v.b.y, rad);
          sg.addColorStop(0, S.toCSS(col, ex * 0.8));
          sg.addColorStop(1, S.toCSS(col, 0));
          lc.fillStyle = sg;
          lc.fillRect(v.b.x - rad, v.b.y - rad, rad * 2, rad * 2);
        }
      }
    }

    /* A satisfied sensor glows onto the wood around it. */
    for (var k = 0; k < scene.receivers.length; k++) {
      var rc = scene.receivers[k];
      if (!rc._state || !rc._state.lit || rc.disabled || (rc.require && rc.require.dark)) continue;
      if (power < 0.05) continue;
      var rq = rc.require || {};
      var rcCol = rq.color && rq.color !== 'any' ? S.resolveColor(rq.color)
                : (rq.wavelength ? S.wavelengthRGB(rq.wavelength) : { r: 1, g: 0.95, b: 0.85 });
      var gr = lc.createRadialGradient(rc.x, rc.y, 0, rc.x, rc.y, rc.radius * 6);
      gr.addColorStop(0, S.toCSS(rcCol, 0.6));
      gr.addColorStop(1, S.toCSS(rcCol, 0));
      lc.fillStyle = gr;
      lc.fillRect(rc.x - rc.radius * 6, rc.y - rc.radius * 6, rc.radius * 12, rc.radius * 12);
    }
  }

  /**
   * The beacon: a red lamp turning above the bench in a phase's last seconds.
   * Its beam sweeps the tabletop like the real thing, and the whole room
   * picks up a little of its colour on every pass.
   */
  function beaconLight(r, lc) {
    var k = M.clamp(r.alarm, 0, 1);
    var a = r.time * 4.2;
    var cx = WORLD_W / 2, cy = -40;
    var sweep = 0.5 + 0.5 * Math.cos(a);
    lc.fillStyle = 'rgba(255,40,24,' + (0.10 * k * (0.4 + 0.6 * sweep)) + ')';
    lc.fillRect(-100, -100, WORLD_W + 200, WORLD_H + 200);
    var dir = Math.PI / 2 + Math.sin(a) * 1.05;
    var g = lc.createRadialGradient(cx, cy, 20, cx, cy, 1150);
    g.addColorStop(0, 'rgba(255,60,40,' + (0.55 * k) + ')');
    g.addColorStop(1, 'rgba(255,60,40,0)');
    lc.fillStyle = g;
    lc.beginPath();
    lc.moveTo(cx, cy);
    lc.arc(cx, cy, 1150, dir - 0.2, dir + 0.2);
    lc.closePath();
    lc.fill();
  }

  /** The emergency light that stays on through a power cut. */
  function emergencyLight(r, lc, k) {
    var pulse = 0.7 + 0.3 * Math.sin(r.time * 6);
    var g = lc.createRadialGradient(80, WORLD_H - 60, 10, 80, WORLD_H - 60, 900);
    g.addColorStop(0, 'rgba(255,70,40,' + (0.5 * k * pulse) + ')');
    g.addColorStop(1, 'rgba(255,70,40,0)');
    lc.fillStyle = g;
    lc.fillRect(-100, -100, WORLD_W + 200, WORLD_H + 200);
  }

  /** Light fanning out of a lamp's lens onto the table in front of it. */
  function lampSpill(lc, em, col, len, spread, alpha) {
    var a = em.angle;
    var ox = em.x + Math.cos(a) * 14, oy = em.y + Math.sin(a) * 14;
    var g = lc.createRadialGradient(ox, oy, 2, ox, oy, len);
    g.addColorStop(0, S.toCSS(col, alpha));
    g.addColorStop(0.35, S.toCSS(col, alpha * 0.35));
    g.addColorStop(1, S.toCSS(col, 0));
    lc.fillStyle = g;
    lc.beginPath();
    lc.moveTo(ox, oy);
    lc.arc(ox, oy, len, a - spread, a + spread);
    lc.closePath();
    lc.fill();
    /* The housing itself is warm and lit from its own lens. */
    var h = lc.createRadialGradient(em.x, em.y, 0, em.x, em.y, 90);
    h.addColorStop(0, S.toCSS(col, alpha * 0.8));
    h.addColorStop(1, S.toCSS(col, 0));
    lc.fillStyle = h;
    lc.fillRect(em.x - 90, em.y - 90, 180, 180);
  }

  /** Aurora chapters: coloured light moving across the table from a window. */
  function auroraLight(r, lc, theme) {
    var t = r.time;
    for (var i = 0; i < 3; i++) {
      var phase = t * (0.10 + i * 0.04) + i * 2.1;
      lc.beginPath();
      lc.moveTo(0, 0);
      for (var x = 0; x <= WORLD_W; x += 40) {
        lc.lineTo(x, 200 + i * 90 + Math.sin(x * 0.004 + phase) * 90 +
                     Math.sin(x * 0.011 + phase * 1.7) * 36);
      }
      lc.lineTo(WORLD_W, 0);
      lc.closePath();
      var g = lc.createLinearGradient(0, 0, 0, 520);
      g.addColorStop(0, hexToRGBA(theme.glow || '#c4ffe0', 0.20));
      g.addColorStop(1, hexToRGBA(theme.accent || '#6bffab', 0));
      lc.fillStyle = g;
      lc.fill();
    }
  }

  function compositeLightMap(r) {
    if (!r.light) return;
    var src = r.light;
    if (r.quality !== 'low' && supportsFilter(r.lightBlurCtx)) {
      var bc = r.lightBlurCtx;
      bc.setTransform(1, 0, 0, 1, 0, 0);
      bc.globalCompositeOperation = 'copy';
      bc.filter = 'blur(' + (r.quality === 'high' ? 5 : 3) + 'px)';
      bc.drawImage(r.light, 0, 0);
      bc.filter = 'none';
      bc.globalCompositeOperation = 'source-over';
      src = r.lightBlur;
    }
    var ctx = r.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(src, 0, 0, r.view.w, r.view.h);
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ==========================================================================
   * THE AIR -- beams as scattered light
   * ======================================================================= */
  function drawLight(r, state) {
    var scene = state.scene;
    var res = scene.lastResult;
    if (!res) return;
    var power = r.power === undefined ? 1 : r.power;
    if (power < 0.02) return;

    var gc = r.glowCtx;
    var gs = r.glowScale;
    gc.setTransform(1, 0, 0, 1, 0, 0);
    gc.globalCompositeOperation = 'source-over';
    gc.clearRect(0, 0, r.glow.width, r.glow.height);
    setWorld(gc, r.view, gs);
    /* Floor the on-screen width, so a beam on a small phone stage still reads
     * as a beam rather than a hairline. */
    var minW = worldPerCss(r);
    gc.globalCompositeOperation = 'lighter';
    gc.lineCap = 'round';
    gc.lineJoin = 'round';

    var front = r.lightFront;
    var segs = res.segments;

    /* HAZE. Tied to the same fog coefficient the tracer attenuates by: a room
     * where you can see more of the beam from the side is, physically, a room
     * scattering more light out of it -- which is exactly why those levels
     * cost more light. */
    var haze = M.clamp(0.8 + (scene.fog || 0) * 800, 0.8, 2.4);
    var rich = r.quality !== 'low';
    var hotspots = 0;

    /* SPECTRA. A dispersed beam is not nine thin rays: fill between each pair
     * of neighbouring colours, so a prism throws one continuous rainbow. */
    if (rich) drawSpectralFans(gc, segs, front, haze);

    for (var pass = 0; pass < 4; pass++) {
      if (pass === 0 && !rich) continue;
      for (var i = 0; i < segs.length; i++) {
        var s = segs[i];
        var v = visiblePart(s, front);
        if (!v || v.inten < 0.005) continue;
        var col = S.colClamp(S.colNormalize(s.c));
        var ev = expose(v.inten);

        if (pass === 0) {
          /* A broad band of scattered light that widens as it travels, with a
           * brighter heart: two nested soft quads. */
          var dx = v.b.x - v.a.x, dy = v.b.y - v.a.y;
          var len = Math.sqrt(dx * dx + dy * dy);
          if (len < 0.5) continue;
          var nx = -dy / len, ny = dx / len;
          var h0 = shaftHalf(s.t0), h1 = shaftHalf(v.tEnd);
          var a = ev * 0.3 * haze / (1 + (h0 + h1) * 0.009);
          band(gc, v.a, v.b, nx, ny, h0, h1);
          gc.fillStyle = S.toCSS(col, a * 0.45);
          gc.fill();
          band(gc, v.a, v.b, nx, ny, h0 * 0.5, h1 * 0.5);
          gc.fillStyle = S.toCSS(col, a * 0.6);
          gc.fill();
          band(gc, v.a, v.b, nx, ny, h0 * 0.22, h1 * 0.22);
          gc.fillStyle = S.toCSS(col, a);
          gc.fill();
        } else if (pass === 1 || pass === 2) {
          var wide = pass === 1;
          gc.strokeStyle = S.toCSS(col, wide ? ev * 0.24 : Math.min(1, 0.1 + ev * 0.75));
          gc.lineWidth = wide ? Math.max(8 + ev * 12, 6 * minW)
                              : Math.max(1.2 + ev * 1.6, 1.6 * minW);
          if (r.colorblind && !wide) gc.setLineDash(S.colorSignature(s.c).dash);
          else gc.setLineDash([]);
          gc.beginPath();
          gc.moveTo(v.a.x, v.a.y);
          gc.lineTo(v.b.x, v.b.y);
          gc.stroke();
        } else {
          /* Where light strikes a surface, some of it scatters back at you. */
          if (!v.whole || onEdge(v.b) || v.inten < 0.05 || hotspots > 70) continue;
          hotspots++;
          var hr = 8 + ev * 16;
          var hg = gc.createRadialGradient(v.b.x, v.b.y, 0, v.b.x, v.b.y, hr);
          hg.addColorStop(0, S.toCSS(S.colAdd(S.colScale(col, 0.6), { r: 0.4, g: 0.4, b: 0.4 }), ev * 0.85));
          hg.addColorStop(1, S.toCSS(col, 0));
          gc.fillStyle = hg;
          gc.beginPath();
          gc.arc(v.b.x, v.b.y, hr, 0, M.TAU);
          gc.fill();
        }
      }
    }
    gc.setLineDash([]);

    /* FILM GRAIN. Punch fine specks and fibres out of the light, so beams read
     * as textured haze -- light seen through dust on film -- not flat colour. */
    if (rich && LP.Bench && LP.Bench.grain) {
      if (!r._grain) r._grain = gc.createPattern(LP.Bench.grain(240, 17), 'repeat');
      gc.setTransform(1, 0, 0, 1, 0, 0);
      gc.globalCompositeOperation = 'destination-out';
      gc.globalAlpha = 0.5;
      gc.fillStyle = r._grain;
      gc.fillRect(0, 0, r.glow.width, r.glow.height);
      gc.globalAlpha = 1;
      gc.globalCompositeOperation = 'source-over';
    }

    /* Composite the air back, blurred, additively. */
    var ctx = r.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = power;
    if (rich && supportsFilter(ctx)) {
      ctx.filter = 'blur(' + (r.quality === 'high' ? 6 : 3) + 'px)';
      ctx.drawImage(r.glow, 0, 0, r.view.w, r.view.h);
      ctx.filter = 'none';
    }
    ctx.drawImage(r.glow, 0, 0, r.view.w, r.view.h);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** A quad along a->b, `h0` wide at a and `h1` wide at b, across normal (nx, ny). */
  function band(gc, a, b, nx, ny, h0, h1) {
    gc.beginPath();
    gc.moveTo(a.x + nx * h0, a.y + ny * h0);
    gc.lineTo(b.x + nx * h1, b.y + ny * h1);
    gc.lineTo(b.x - nx * h1, b.y - ny * h1);
    gc.lineTo(a.x - nx * h0, a.y - ny * h0);
    gc.closePath();
  }

  /**
   * Continuous rainbows. The tracer splits a white ray into nine monochromatic
   * bands, and each travels on its own; drawn alone they look like nine thin
   * rays. Pair every band with its nearest neighbour one colour up -- same
   * element, same bounce, starting close together, heading the same way --
   * and fill the sheet of light between them.
   */
  function drawSpectralFans(gc, segs, front, haze) {
    var groups = {}, count = 0, key;
    for (var i = 0; i < segs.length && count < 1200; i++) {
      var s = segs[i];
      if (s.wl === null || s.inside) continue;
      var v = visiblePart(s, front);
      if (!v || v.inten < 0.003) continue;
      var dx = v.b.x - v.a.x, dy = v.b.y - v.a.y;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len < 3) continue;
      key = s.source + '|' + s.depth + '|' + s.via;
      (groups[key] || (groups[key] = [])).push({ s: s, v: v, len: len, ux: dx / len, uy: dy / len });
      count++;
    }
    for (key in groups) {
      if (!Object.prototype.hasOwnProperty.call(groups, key)) continue;
      var g = groups[key];
      if (g.length < 2) continue;
      g.sort(function (p, q) { return p.s.wl - q.s.wl; });
      for (var a = 0; a < g.length; a++) {
        var A = g[a], B = null, bestD = Infinity;
        for (var b = a + 1; b < g.length; b++) {
          var C = g[b], dnm = C.s.wl - A.s.wl;
          if (dnm < 4) continue;               /* the same colour, from another ray */
          if (dnm > 48) break;                 /* not a neighbour */
          var d = V.dist(A.v.a, C.v.a);
          if (d < bestD) { bestD = d; B = C; }
        }
        if (!B) continue;
        var meanLen = (A.len + B.len) / 2;
        if (bestD > 24 + meanLen * 0.35) continue;
        if (A.ux * B.ux + A.uy * B.uy < 0.88) continue;
        if (V.dist(A.v.b, B.v.b) > bestD + meanLen * 0.7 + 30) continue;
        var col = S.colClamp(S.colNormalize(S.colAdd(A.s.c, B.s.c)));
        gc.fillStyle = S.toCSS(col, expose(A.v.inten + B.v.inten) * 0.42 * haze);
        gc.beginPath();
        gc.moveTo(A.v.a.x, A.v.a.y);
        gc.lineTo(A.v.b.x, A.v.b.y);
        gc.lineTo(B.v.b.x, B.v.b.y);
        gc.lineTo(B.v.a.x, B.v.a.y);
        gc.closePath();
        gc.fill();
      }
    }
  }

  /**
   * Dust motes, drawn only where a beam passes through them. A mote lights
   * in the colour of the brightest beam it is inside, scaled by how close to
   * the beam's axis it drifts.
   */
  function drawDust(r, state) {
    if (r.reducedMotion || !r.dust || !r.dust.length) return;
    if (r.power !== undefined && r.power < 0.05) return;
    var scene = state.scene, res = scene.lastResult;
    if (!res) return;
    var front = r.lightFront, segs = res.segments;

    var vis = [];
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      var v = visiblePart(s, front);
      if (!v || v.inten < 0.03) continue;
      var hw = shaftHalf(v.tEnd) + 12;
      var dx = v.b.x - v.a.x, dy = v.b.y - v.a.y;
      var l2 = dx * dx + dy * dy;
      if (l2 < 1) continue;
      vis.push({
        ax: v.a.x, ay: v.a.y, dx: dx, dy: dy, l2: l2, hw: hw, inten: v.inten,
        col: S.colClamp(S.colNormalize(s.c)),
        x0: Math.min(v.a.x, v.b.x) - hw, x1: Math.max(v.a.x, v.b.x) + hw,
        y0: Math.min(v.a.y, v.b.y) - hw, y1: Math.max(v.a.y, v.b.y) + hw
      });
    }
    if (!vis.length) return;

    var haze = M.clamp(0.8 + (scene.fog || 0) * 800, 0.8, 2.4);
    var base = r.quality === 'low' ? 50 : (r.quality === 'medium' ? 100 : 150);
    var n = Math.min(r.dust.length, Math.round(base * haze));
    var wpc = worldPerCss(r);

    var ctx = r.ctx;
    applyWorldTransform(ctx, r);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var m = 0; m < n; m++) {
      var mote = r.dust[m];
      var best = 0, bestCol = null;
      for (var j = 0; j < vis.length; j++) {
        var q = vis[j];
        if (mote.x < q.x0 || mote.x > q.x1 || mote.y < q.y0 || mote.y > q.y1) continue;
        var t = ((mote.x - q.ax) * q.dx + (mote.y - q.ay) * q.dy) / q.l2;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        var px = q.ax + q.dx * t - mote.x, py = q.ay + q.dy * t - mote.y;
        var d = Math.sqrt(px * px + py * py);
        if (d >= q.hw) continue;
        var k = expose(q.inten) * 1.3 * (1 - d / q.hw);
        if (k > best) { best = k; bestCol = q.col; }
      }
      if (best < 0.03) continue;
      var tw = 0.5 + 0.5 * Math.sin(r.time * mote.twinkle + mote.phase);
      var glint = S.colAdd(S.colScale(bestCol, 0.55), { r: 0.45, g: 0.45, b: 0.45 });
      ctx.fillStyle = S.toCSS(glint, Math.min(1, best * (0.45 + tw * 0.75)));
      ctx.beginPath();
      ctx.arc(mote.x, mote.y, Math.max(mote.size, 0.9 * wpc), 0, M.TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  var _filterSupport = null;
  function supportsFilter(ctx) {
    if (_filterSupport === null) _filterSupport = !!ctx && (typeof ctx.filter === 'string');
    return _filterSupport;
  }

  /** Advance the travelling light front and the dust. Called once per frame. */
  function stepLight(r, dt, maxPath) {
    r.time += dt;
    if (r.shake > 0) r.shake = Math.max(0, r.shake - dt * 40);
    if (LP.Bench && r.dust && !r.reducedMotion) LP.Bench.stepDust(r.dust, Math.min(dt, 0.1), r.time);
    if (r.reducedMotion) { r.lightFront = 1e9; return; }
    if (r.lightFront < maxPath + 200) r.lightFront += LIGHT_SPEED * dt;
  }

  /** Restart the travel animation -- called whenever the scene is edited. */
  function restartLight(r) { r.lightFront = r.reducedMotion ? 1e9 : 0; }

  /* ==========================================================================
   * OPTICAL HARDWARE -- glass, silver, brass and black anodised aluminium
   * ======================================================================= */
  function drawElements(r, ctx, theme, scene, state, foreground) {
    var phaseNow = scene.phase ? scene.phase.index + 1 : 1;
    for (var i = 0; i < scene.elements.length; i++) {
      var el = scene.elements[i];
      el._future = !!el.disabled && el.phase !== undefined && el.phase > phaseNow;
      if (el.isWall) continue;
      var isGoal = el.type === 'receiver' || el.type === 'emitter';
      if (el.disabled) {
        /* Hardware switched off on a timed level: a lamp still stands there,
         * dark; everything else is a fitting set into the bench. */
        if (el.type === 'emitter') { if (foreground) drawEmitter(r, ctx, el, theme, 0); }
        else if (!foreground) drawSocket(r, ctx, el, scene);
        continue;
      }
      /* Goals draw on top of the light; optics draw beneath it. */
      if (foreground !== isGoal) continue;
      if (el.motion) drawMotionRig(r, ctx, el, theme);
      drawElement(r, ctx, theme, el, scene, state);
    }
  }

  function drawElement(r, ctx, theme, el, scene, state) {
    switch (el.type) {
      case 'mirror':
      case 'concave':
      case 'convex':
      case 'flex':     drawMirror(r, ctx, el); break;
      case 'oneway':   drawOneWay(r, ctx, el); break;
      case 'splitter': drawSplitter(r, ctx, el); break;
      case 'filter':   drawFilter(r, ctx, el); break;
      case 'polarizer':drawPolarizer(r, ctx, el); break;
      case 'grating':  drawGrating(r, ctx, el); break;
      case 'prism':
      case 'glass':
      case 'lens':     drawDielectric(r, ctx, el); break;
      case 'portal':   drawPortal(r, ctx, el, theme); break;
      case 'absorber': drawAbsorber(r, ctx, el); break;
      case 'receiver': drawReceiver(r, ctx, el, theme, state); break;
      case 'emitter':  drawEmitter(r, ctx, el, theme); break;
    }
  }

  /** Path along the element's working surface (segment, arc or circle). */
  function surfacePath(ctx, el) {
    var p = el._prims[0];
    ctx.beginPath();
    if (!p) return;
    if (p.kind === 'seg') { ctx.moveTo(p.a.x, p.a.y); ctx.lineTo(p.b.x, p.b.y); }
    else if (p.kind === 'arc') ctx.arc(p.c.x, p.c.y, p.r, p.a0, p.a0 + p.sweep, p.sweep < 0);
    else if (p.kind === 'circle') ctx.arc(p.c.x, p.c.y, p.r, 0, M.TAU);
  }

  function endsOf(el) {
    var p = el._prims[0];
    if (!p) return null;
    if (p.kind === 'seg') return [p.a, p.b];
    if (p.kind === 'arc') return p.ends;
    return null;
  }

  /** A turned brass cap screw, lit from the upper left. */
  function brassBolt(ctx, x, y, rad) {
    var g = ctx.createRadialGradient(x - rad * 0.4, y - rad * 0.4, rad * 0.1, x, y, rad);
    g.addColorStop(0, '#fff3cc');
    g.addColorStop(0.45, '#c99a48');
    g.addColorStop(1, '#4e3413');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, M.TAU);
    ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.stroke();
  }

  /** Short black clamp blocks gripping a plate at both ends. */
  function endClamps(ctx, el, reach) {
    var ends = endsOf(el);
    if (!ends) return;
    var d = V.norm(V.sub(ends[1], ends[0]));
    for (var i = 0; i < 2; i++) {
      var e = ends[i], sgn = i === 0 ? 1 : -1;
      ctx.lineCap = 'butt';
      ctx.lineWidth = 15;
      ctx.strokeStyle = '#15110e';
      ctx.beginPath();
      ctx.moveTo(e.x - d.x * sgn * 3, e.y - d.y * sgn * 3);
      ctx.lineTo(e.x + d.x * sgn * (reach || 9), e.y + d.y * sgn * (reach || 9));
      ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.stroke();
    }
  }

  function drawMirror(r, ctx, el) {
    var gold = el.material === 'gold';
    var ends = endsOf(el);

    /* The mount the glass is bonded to, casting its shadow. */
    ctx.save();
    ctx.lineCap = 'round';
    shadowOn(ctx, r, 0.6);
    ctx.lineWidth = 13;
    ctx.strokeStyle = '#1c1611';
    surfacePath(ctx, el);
    ctx.stroke();
    shadowOff(ctx);
    ctx.restore();

    /* The silvered face. The bright band is the room reflected in the glass,
     * so it slides along the mirror as the mirror turns. */
    if (ends) {
      var g = ctx.createLinearGradient(ends[0].x, ends[0].y, ends[1].x, ends[1].y);
      var c = 0.5 + 0.33 * Math.sin(el.angle * 2 + 0.7);
      var s1 = M.clamp(c - 0.26, 0.02, 0.6), s2 = M.clamp(c, s1 + 0.02, 0.94);
      var s3 = M.clamp(c + 0.2, s2 + 0.02, 0.98);
      var lo = gold ? '#6e4a1c' : '#4f5a66', mid = gold ? '#d9a852' : '#aebbc8';
      var hi = gold ? '#fff0c6' : '#ffffff';
      g.addColorStop(0, lo);
      g.addColorStop(s1, mid);
      g.addColorStop(s2, hi);
      g.addColorStop(s3, mid);
      g.addColorStop(1, lo);
      ctx.strokeStyle = g;
    } else {
      ctx.strokeStyle = gold ? '#e0b46a' : '#c8d4de';
    }
    ctx.lineCap = 'butt';
    ctx.lineWidth = 7.5;
    surfacePath(ctx, el);
    ctx.stroke();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    surfacePath(ctx, el);
    ctx.stroke();

    if (ends) { brassBolt(ctx, ends[0].x, ends[0].y, 5.5); brassBolt(ctx, ends[1].x, ends[1].y, 5.5); }
    if (el.thermal) drawHeatBloom(r, ctx, el);
  }

  function drawHeatBloom(r, ctx, el) {
    var m = el.motion || {};
    var stress = m.stress || 0;
    if (stress <= 0.02) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 16;
    ctx.strokeStyle = 'rgba(255,' + Math.round(150 - Math.min(1.6, stress) * 90) + ',60,' +
                      (0.10 + Math.min(0.4, stress * 0.22)) + ')';
    surfacePath(ctx, el);
    ctx.stroke();
    ctx.restore();
    if (stress > 1) {
      /* Past the damage threshold: say so, loudly. */
      ctx.save();
      ctx.font = '600 ' + Math.round(Math.max(15, 12 * worldPerCss(r))) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,120,60,' + (0.55 + 0.4 * Math.sin(r.time * 9)) + ')';
      textAt(ctx, r, 'OVERHEATING', el.x, el.y - E.handleReach(el) - 16);
      ctx.restore();
    }
  }

  function drawOneWay(r, ctx, el) {
    var p = el._prims[0];
    var d = V.norm(V.sub(p.b, p.a));
    var n = V.perp(d);
    if (el.flipped) n = V.neg(n);

    ctx.save();
    shadowOn(ctx, r, 0.45);
    ctx.lineCap = 'round';
    ctx.lineWidth = 11;
    ctx.strokeStyle = 'rgba(40,48,56,0.7)';
    surfacePath(ctx, el);
    ctx.stroke();
    shadowOff(ctx);
    ctx.restore();

    /* Clear glass behind... */
    ctx.lineCap = 'butt';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(190,225,240,0.45)';
    ctx.beginPath();
    ctx.moveTo(p.a.x - n.x * 2.5, p.a.y - n.y * 2.5);
    ctx.lineTo(p.b.x - n.x * 2.5, p.b.y - n.y * 2.5);
    ctx.stroke();
    /* ...and the silvered face in front. */
    var g = ctx.createLinearGradient(p.a.x, p.a.y, p.b.x, p.b.y);
    g.addColorStop(0, '#5b6671');
    g.addColorStop(0.5, '#ffffff');
    g.addColorStop(1, '#5b6671');
    ctx.lineWidth = 4.5;
    ctx.strokeStyle = g;
    ctx.beginPath();
    ctx.moveTo(p.a.x + n.x * 2.2, p.a.y + n.y * 2.2);
    ctx.lineTo(p.b.x + n.x * 2.2, p.b.y + n.y * 2.2);
    ctx.stroke();
    endClamps(ctx, el, 8);
  }

  function drawSplitter(r, ctx, el) {
    ctx.save();
    shadowOn(ctx, r, 0.35);
    ctx.lineCap = 'round';
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(40,52,62,0.5)';
    surfacePath(ctx, el);
    ctx.stroke();
    shadowOff(ctx);
    ctx.restore();

    /* A glass plate... */
    ctx.lineCap = 'butt';
    ctx.lineWidth = 7;
    ctx.strokeStyle = 'rgba(205,232,248,0.34)';
    surfacePath(ctx, el);
    ctx.stroke();
    /* ...half-silvered: coverage in proportion to the reflect ratio. */
    var ratio = el.ratio === undefined ? 0.5 : el.ratio;
    var dash = Math.max(3, 14 * ratio);
    ctx.lineWidth = 3.6;
    ctx.setLineDash([dash, Math.max(2.5, 14 - dash)]);
    ctx.strokeStyle = 'rgba(232,240,248,0.92)';
    surfacePath(ctx, el);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    surfacePath(ctx, el);
    ctx.stroke();
    endClamps(ctx, el, 8);
  }

  function drawFilter(r, ctx, el) {
    var col = S.resolveColor(el.color);
    ctx.save();
    shadowOn(ctx, r, 0.3);
    ctx.lineCap = 'butt';
    ctx.lineWidth = 12;
    ctx.strokeStyle = S.toCSS(S.colScale(col, 0.45), 0.7);
    surfacePath(ctx, el);
    ctx.stroke();
    shadowOff(ctx);
    ctx.restore();

    /* Coloured glass, lighter towards its face. */
    ctx.lineCap = 'butt';
    ctx.lineWidth = 6.5;
    ctx.strokeStyle = S.toCSS(col, 0.62);
    surfacePath(ctx, el);
    ctx.stroke();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    surfacePath(ctx, el);
    ctx.stroke();
    endClamps(ctx, el, 9);

    if (r.colorblind) {
      var sig = S.colorSignature(col);
      ctx.save();
      ctx.font = '600 ' + Math.round(Math.max(16, 13 * worldPerCss(r))) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      textAt(ctx, r, sig.glyph, el.x, el.y - 18);
      ctx.restore();
    }
  }

  function drawPolarizer(r, ctx, el) {
    var rad = el.radius;
    ctx.save();
    ctx.translate(el.x, el.y);

    /* Black anodised ring mount. */
    ctx.save();
    shadowOn(ctx, r, 0.55);
    ctx.beginPath();
    ctx.arc(0, 0, rad + 6, 0, M.TAU);
    ctx.fillStyle = '#141210';
    ctx.fill();
    shadowOff(ctx);
    ctx.restore();

    var rim = ctx.createLinearGradient(-rad, -rad, rad, rad);
    rim.addColorStop(0, '#9aa0a6');
    rim.addColorStop(0.5, '#3a3d41');
    rim.addColorStop(1, '#151618');
    ctx.lineWidth = 3;
    ctx.strokeStyle = rim;
    ctx.beginPath();
    ctx.arc(0, 0, rad + 4, 0, M.TAU);
    ctx.stroke();

    /* Knurled grip. */
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var k = 0; k < 40; k++) {
      var a = (k / 40) * M.TAU;
      ctx.moveTo(Math.cos(a) * (rad + 5.5), Math.sin(a) * (rad + 5.5));
      ctx.lineTo(Math.cos(a) * (rad + 8), Math.sin(a) * (rad + 8));
    }
    ctx.stroke();

    /* Polarising film: grey-green, and striated along the axis. */
    ctx.beginPath();
    ctx.arc(0, 0, rad, 0, M.TAU);
    ctx.fillStyle = 'rgba(62,74,66,0.46)';
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, rad - 1, 0, M.TAU);
    ctx.clip();
    ctx.rotate(el.angle);
    ctx.strokeStyle = 'rgba(215,232,215,0.26)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (var y = -rad; y <= rad; y += 6) { ctx.moveTo(-rad, y); ctx.lineTo(rad, y); }
    ctx.stroke();
    /* A soft specular sweep across the film. */
    var sheen = ctx.createLinearGradient(-rad, -rad, rad, rad);
    sheen.addColorStop(0.3, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.45, 'rgba(255,255,255,0.14)');
    sheen.addColorStop(0.6, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fillRect(-rad, -rad, rad * 2, rad * 2);
    ctx.restore();

    /* Engraved axis line with a brass index mark. */
    ctx.rotate(el.angle);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-rad + 4, 0); ctx.lineTo(rad - 4, 0);
    ctx.stroke();
    brassBolt(ctx, rad + 4, 0, 3.4);
    ctx.restore();
  }

  function drawGrating(r, ctx, el) {
    var p = el._prims[0];
    var d = V.norm(V.sub(p.b, p.a));
    var n = V.perp(d);
    var len = V.dist(p.a, p.b);

    ctx.save();
    shadowOn(ctx, r, 0.5);
    ctx.lineCap = 'butt';
    ctx.lineWidth = 11;
    ctx.strokeStyle = '#131215';
    surfacePath(ctx, el);
    ctx.stroke();
    shadowOff(ctx);
    ctx.restore();

    /* Holographic sheen: the rulings split room light into colour too, and
     * the colours slide as you look along the plate. */
    var shift = (r.reducedMotion ? 0 : r.time * 0.05) + el.angle * 0.25;
    var g = ctx.createLinearGradient(p.a.x, p.a.y, p.b.x, p.b.y);
    for (var k = 0; k <= 6; k++) {
      var f = k / 6;
      var nm = 410 + (((f + shift) % 1) + 1) % 1 * 260;
      g.addColorStop(f, S.toCSS(S.wavelengthRGB(nm), 0.55));
    }
    ctx.lineWidth = 5;
    ctx.strokeStyle = g;
    surfacePath(ctx, el);
    ctx.stroke();

    var step = M.clamp(el.spacing / 260, 3, 9);
    ctx.strokeStyle = 'rgba(230,235,255,0.22)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (var t = 0; t <= len; t += step) {
      var px = p.a.x + d.x * t, py = p.a.y + d.y * t;
      ctx.moveTo(px - n.x * 4, py - n.y * 4);
      ctx.lineTo(px + n.x * 4, py + n.y * 4);
    }
    ctx.stroke();
    endClamps(ctx, el, 8);
  }

  /* Glass tints: a faint body colour per material, as real glass has. */
  var GLASS_TINT = {
    crown: '#dcefff', flint: '#fff0da', sapphire: '#bcd4ff', diamond: '#ffffff',
    water: '#bdf2ee', acrylic: '#eef8ff'
  };

  function drawDielectric(r, ctx, el) {
    var pts = el._prims[0].pts;
    var tint = S.fromHex(GLASS_TINT[el.material] || GLASS_TINT.crown);
    var c = { x: 0, y: 0 }, i;
    for (i = 0; i < pts.length; i++) { c.x += pts[i].x; c.y += pts[i].y; }
    c.x /= pts.length; c.y /= pts.length;
    var reach = 1;
    for (i = 0; i < pts.length; i++) reach = Math.max(reach, V.dist(c, pts[i]));

    /* Clear glass throws only the faintest shadow. */
    ctx.save();
    shadowOn(ctx, r, 0.2);
    polyPath(ctx, pts);
    ctx.fillStyle = 'rgba(12,16,20,0.05)';
    ctx.fill();
    shadowOff(ctx);
    ctx.restore();

    /* The body: all but invisible in the middle, denser toward the faces --
     * the way a thick edge of real glass darkens and picks up colour. */
    polyPath(ctx, pts);
    var g = ctx.createRadialGradient(c.x, c.y, reach * 0.08, c.x, c.y, reach * 1.02);
    g.addColorStop(0, S.toCSS(tint, 0.02));
    g.addColorStop(0.65, S.toCSS(tint, 0.05));
    g.addColorStop(1, S.toCSS(tint, 0.22));
    ctx.fillStyle = g;
    ctx.fill();

    /* Facets, like cut crystal: faint lines from every corner to the heart. */
    if (pts.length <= 8) {
      ctx.beginPath();
      for (i = 0; i < pts.length; i++) { ctx.moveTo(c.x, c.y); ctx.lineTo(pts[i].x, pts[i].y); }
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.stroke();
    }

    /* The faces seen again from inside. */
    scaledPath(ctx, pts, c, 0.8);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.stroke();

    /* A chromatic fringe: red just outside the edge, blue just inside. */
    scaledPath(ctx, pts, c, 1 + 3 / reach);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(255,96,80,0.26)';
    ctx.stroke();
    scaledPath(ctx, pts, c, 1 - 3 / reach);
    ctx.strokeStyle = 'rgba(96,150,255,0.26)';
    ctx.stroke();

    /* The polished edge. */
    polyPath(ctx, pts);
    ctx.lineJoin = 'round';
    ctx.lineWidth = el.material === 'diamond' ? 2 : 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.stroke();
  }

  function scaledPath(ctx, pts, c, k) {
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var x = c.x + (pts[i].x - c.x) * k, y = c.y + (pts[i].y - c.y) * k;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  /**
   * Glass catching the light: its edges glow and its corners sparkle. Drawn
   * over the beams, additively, so the brightest thing about a prism in a
   * dark room is its outline.
   */
  function drawGlassLight(r, ctx, scene) {
    var pw = r.power === undefined ? 1 : r.power;
    var any = false;
    for (var i = 0; i < scene.elements.length; i++) {
      var el = scene.elements[i];
      if (el.disabled) continue;
      if (el.type !== 'prism' && el.type !== 'lens' && el.type !== 'glass') continue;
      if (!any) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineJoin = 'round'; any = true; }
      var pts = el._prims[0].pts;
      polyPath(ctx, pts);
      ctx.lineWidth = 10;
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.035 + 0.045 * pw) + ')';
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.06 + 0.12 * pw) + ')';
      ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.15 + 0.4 * pw) + ')';
      ctx.stroke();

      var corners = el.type === 'glass' ? [pts[0], pts[2]]
                  : el.type === 'lens' ? [pts[0], pts[Math.floor(pts.length / 2)]] : pts;
      for (var k = 0; k < corners.length && k < 4; k++) {
        var tw = 0.5 + 0.5 * Math.sin(r.time * (1.6 + k * 0.55) + el.x * 0.013 + k * 2.3);
        glint(ctx, corners[k].x, corners[k].y, 7 + 9 * tw, 0.12 + 0.6 * tw * pw);
      }
    }
    if (any) ctx.restore();
  }

  /** A four-pointed star of light. Expects an additive composite. */
  function glint(ctx, x, y, size, alpha) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, size);
    g.addColorStop(0, 'rgba(255,255,255,' + alpha + ')');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.quadraticCurveTo(x, y, x + size, y);
    ctx.quadraticCurveTo(x, y, x, y + size);
    ctx.quadraticCurveTo(x, y, x - size, y);
    ctx.quadraticCurveTo(x, y, x, y - size);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, size * 0.14), 0, M.TAU);
    ctx.fillStyle = 'rgba(255,255,255,' + Math.min(1, alpha * 1.3) + ')';
    ctx.fill();
  }

  function drawPortal(r, ctx, el, theme) {
    var t = r.time, R0 = el.radius;
    var pw = r.power === undefined ? 1 : r.power;
    ctx.save();
    ctx.translate(el.x, el.y);

    /* An orb of dark glass... */
    ctx.save();
    shadowOn(ctx, r, 0.45);
    ctx.beginPath();
    ctx.arc(0, 0, R0, 0, M.TAU);
    var body = ctx.createRadialGradient(-R0 * 0.3, -R0 * 0.35, R0 * 0.05, 0, 0, R0);
    body.addColorStop(0, 'rgba(46,50,66,0.6)');
    body.addColorStop(1, 'rgba(5,6,11,0.88)');
    ctx.fillStyle = body;
    ctx.fill();
    shadowOff(ctx);
    ctx.restore();

    ctx.globalCompositeOperation = 'lighter';
    /* ...ringed by its own rainbow, violet on the inside and red outside... */
    var halo = ctx.createRadialGradient(0, 0, R0 * 0.94, 0, 0, R0 * 1.46);
    halo.addColorStop(0.00, 'rgba(120,60,255,0)');
    halo.addColorStop(0.12, 'rgba(130,70,255,' + (0.55 * pw) + ')');
    halo.addColorStop(0.30, 'rgba(60,120,255,' + (0.55 * pw) + ')');
    halo.addColorStop(0.47, 'rgba(60,230,140,' + (0.5 * pw) + ')');
    halo.addColorStop(0.63, 'rgba(255,232,60,' + (0.55 * pw) + ')');
    halo.addColorStop(0.80, 'rgba(255,124,40,' + (0.5 * pw) + ')');
    halo.addColorStop(0.92, 'rgba(255,40,40,' + (0.35 * pw) + ')');
    halo.addColorStop(1.00, 'rgba(255,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, R0 * 1.46, 0, M.TAU);
    ctx.fill();

    /* ...with a white heart that breathes slowly. */
    var pulse = 0.85 + 0.15 * Math.sin(t * 2.2 + el.x * 0.01);
    var core = ctx.createRadialGradient(0, 0, 0, 0, 0, R0 * 0.72);
    core.addColorStop(0, 'rgba(255,255,255,' + (0.95 * pulse * pw) + ')');
    core.addColorStop(0.35, 'rgba(255,246,228,' + (0.42 * pulse * pw) + ')');
    core.addColorStop(1, 'rgba(255,240,220,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(0, 0, R0 * 0.72, 0, M.TAU);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    /* The glass rim, and the room reflected in it. */
    ctx.beginPath();
    ctx.arc(0, 0, R0, 0, M.TAU);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, R0 * 0.86, -2.5, -1.35);
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = 'rgba(255,255,255,0.32)';
    ctx.stroke();

    /* Which way light leaves this gate. */
    ctx.rotate(el.angle + (el.exitOffset || 0));
    brassBolt(ctx, R0 + 10, 0, 3.4);
    ctx.restore();
  }

  function drawAbsorber(r, ctx, el) {
    var pts = el._prims[0].pts;
    /* Black flocked board: swallows light and reflects almost none. */
    ctx.save();
    shadowOn(ctx, r, 0.6);
    polyPath(ctx, pts);
    ctx.fillStyle = '#12100e';
    ctx.fill();
    shadowOff(ctx);
    ctx.restore();
    polyPath(ctx, pts);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,240,220,0.10)';
    ctx.stroke();
  }

  function drawEmitter(r, ctx, el, theme, powerOverride) {
    var col = S.resolveColor(el.color);
    var pw = powerOverride === undefined ? (r.power === undefined ? 1 : r.power) : powerOverride;
    ctx.save();
    ctx.translate(el.x, el.y);
    ctx.rotate(el.angle);

    /* Lamp housing. */
    ctx.save();
    shadowOn(ctx, r, 0.65, 1.2);
    roundRect(ctx, -36, -20, 48, 40, 8);
    ctx.fillStyle = '#16120f';
    ctx.fill();
    shadowOff(ctx);
    ctx.restore();

    var body = ctx.createLinearGradient(0, -20, 0, 20);
    body.addColorStop(0, '#57504a');
    body.addColorStop(0.42, '#26221f');
    body.addColorStop(1, '#0d0b09');
    roundRect(ctx, -36, -20, 48, 40, 8);
    ctx.fillStyle = body;
    ctx.fill();

    /* Cooling fins. */
    ctx.lineWidth = 2;
    for (var f = 0; f < 4; f++) {
      var fx = -30 + f * 6;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.beginPath(); ctx.moveTo(fx, -20); ctx.lineTo(fx, 20); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.beginPath(); ctx.moveTo(fx + 1.4, -20); ctx.lineTo(fx + 1.4, 20); ctx.stroke();
    }

    /* Brass bezel and the lens, glowing in the lamp's own colour. */
    var bz = ctx.createLinearGradient(2, -12, 22, 12);
    bz.addColorStop(0, '#f6dca2');
    bz.addColorStop(0.5, '#a97b35');
    bz.addColorStop(1, '#4f3412');
    ctx.lineWidth = 4.5;
    ctx.strokeStyle = bz;
    ctx.beginPath();
    ctx.arc(12, 0, 11.5, 0, M.TAU);
    ctx.stroke();
    var lens = ctx.createRadialGradient(10, -2, 1, 12, 0, 10);
    /* An unpowered lamp shows cold glass with only a hint of its filter. */
    var cold = S.colAdd({ r: 0.05, g: 0.05, b: 0.06 }, S.colScale(col, 0.14));
    var hot = S.colAdd(S.colScale(col, 0.4), { r: 0.6, g: 0.6, b: 0.6 });
    lens.addColorStop(0, S.toCSS(S.colAdd(S.colScale(hot, pw), S.colScale(cold, 1 - pw)), 1));
    lens.addColorStop(1, S.toCSS(S.colAdd(S.colScale(col, 0.85 * pw), S.colScale(cold, 1 - pw)), 1));
    ctx.fillStyle = lens;
    ctx.beginPath();
    ctx.arc(12, 0, 9.5, 0, M.TAU);
    ctx.fill();

    if (el.width) {
      ctx.strokeStyle = S.toCSS(col, 0.5);
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(18, -el.width / 2);
      ctx.lineTo(18, el.width / 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    /* Lens flare: a bloom and a thin streak across the lens. */
    if (el._future) drawPhaseTag(r, ctx, el.x, el.y - 40, el);
    if (pw > 0.02) {
      ctx.save();
      ctx.globalAlpha = pw;
      var lx = el.x + Math.cos(el.angle) * 12, ly = el.y + Math.sin(el.angle) * 12;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var fl = ctx.createRadialGradient(lx, ly, 0, lx, ly, 48);
      fl.addColorStop(0, S.toCSS(S.colAdd(S.colScale(col, 0.6), { r: 0.4, g: 0.4, b: 0.4 }), 0.75));
      fl.addColorStop(0.3, S.toCSS(col, 0.25));
      fl.addColorStop(1, S.toCSS(col, 0));
      ctx.fillStyle = fl;
      ctx.beginPath();
      ctx.arc(lx, ly, 48, 0, M.TAU);
      ctx.fill();
      ctx.translate(lx, ly);
      ctx.rotate(el.angle + Math.PI / 2);
      ctx.scale(1, 0.09);
      var st = ctx.createRadialGradient(0, 0, 0, 0, 0, 80);
      st.addColorStop(0, S.toCSS(col, 0.55));
      st.addColorStop(1, S.toCSS(col, 0));
      ctx.fillStyle = st;
      ctx.beginPath();
      ctx.arc(0, 0, 80, 0, M.TAU);
      ctx.fill();
      ctx.restore();
      ctx.restore();
    }
  }

  function drawReceiver(r, ctx, el, theme, state) {
    var st = el._state || { lit: false, intensity: 0, dark: false };
    var req = el.require || {};
    if (req.dark) { drawAlarm(r, ctx, el, st); return; }

    var pw = r.power === undefined ? 1 : r.power;
    var lit = st.lit && pw > 0.5;
    var wantCol = req.color && req.color !== 'any' ? S.resolveColor(req.color)
                : (req.wavelength ? S.wavelengthRGB(req.wavelength) : null);
    var gotCol = st.intensity > 0.001 ? S.colClamp(S.colNormalize(st.color)) : { r: 1, g: 0.97, b: 0.9 };
    var R0 = el.radius;
    var wpc = worldPerCss(r);

    ctx.save();
    ctx.translate(el.x, el.y);

    /* A glass disc standing on the bench. */
    ctx.save();
    shadowOn(ctx, r, 0.45, 1.1);
    ctx.beginPath();
    ctx.arc(0, 0, R0 * 1.08, 0, M.TAU);
    ctx.fillStyle = 'rgba(12,14,20,0.4)';
    ctx.fill();
    shadowOff(ctx);
    ctx.restore();
    var body = ctx.createRadialGradient(-R0 * 0.35, -R0 * 0.4, R0 * 0.05, 0, 0, R0 * 1.08);
    body.addColorStop(0, 'rgba(255,255,255,0.22)');
    body.addColorStop(0.55, 'rgba(160,182,210,0.08)');
    body.addColorStop(1, 'rgba(230,240,255,0.28)');
    ctx.beginPath();
    ctx.arc(0, 0, R0 * 1.08, 0, M.TAU);
    ctx.fillStyle = body;
    ctx.fill();

    if (lit) {
      ctx.globalCompositeOperation = 'lighter';
      var g = ctx.createRadialGradient(0, 0, R0 * 0.2, 0, 0, R0 * 2.8);
      g.addColorStop(0, S.toCSS(gotCol, 0.55));
      g.addColorStop(1, S.toCSS(gotCol, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, R0 * 2.8, 0, M.TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    /* The target rings. A colour the sensor wants tints the inner one. */
    var ringA = lit ? 0.96 : 0.66;
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = 'rgba(255,255,255,' + ringA + ')';
    ctx.beginPath();
    ctx.arc(0, 0, R0 * 0.72, 0, M.TAU);
    ctx.stroke();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = wantCol ? S.toCSS(wantCol, lit ? 1 : 0.7 + 0.2 * Math.sin(r.time * 2.4))
                              : 'rgba(255,255,255,' + ringA + ')';
    ctx.beginPath();
    ctx.arc(0, 0, R0 * 0.42, 0, M.TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(2, R0 * 0.1), 0, M.TAU);
    ctx.fillStyle = 'rgba(255,255,255,' + ringA + ')';
    ctx.fill();

    /* The rim, and a glint of the room in it. */
    ctx.beginPath();
    ctx.arc(0, 0, R0 * 1.08, 0, M.TAU);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = 'rgba(255,255,255,0.82)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, R0 * 0.9, -2.55, -1.45);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.stroke();

    /* Progress toward the brightness it needs, glowing round the rim. */
    var minI = req.minIntensity === undefined ? 0.22 : req.minIntensity;
    var frac = M.clamp(st.intensity / Math.max(1e-6, minI), 0, 1);
    if (frac > 0.01 && pw > 0.5) {
      ctx.lineWidth = 3.4;
      ctx.lineCap = 'round';
      ctx.strokeStyle = S.toCSS(lit ? gotCol : { r: 1, g: 0.8, b: 0.35 }, 0.95);
      ctx.beginPath();
      ctx.arc(0, 0, R0 * 1.08 + 4, -Math.PI / 2, -Math.PI / 2 + M.TAU * frac);
      ctx.stroke();
    }

    if (r.colorblind && req.color && req.color !== 'any') {
      var sig = S.colorSignature(wantCol);
      ctx.font = '700 ' + Math.round(R0 * 0.62) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = lit ? '#0b0f18' : '#dfe8f5';
      textAt(ctx, r, sig.glyph, 0, 0);
    }
    if (req.wavelength) {
      ctx.font = '600 ' + Math.round(Math.max(12, 11 * wpc)) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,240,215,0.9)';
      textAt(ctx, r, req.wavelength + 'nm', 0, R0 + Math.max(20, 15 * wpc));
    }
    if (st.latched) {
      /* A timed level's destination whose phase is done: a green pilot lamp. */
      var lr = Math.max(6, 5 * wpc);
      var lpx = R0 * 0.8, lpy = R0 * 0.8;
      ctx.globalCompositeOperation = 'lighter';
      var lg = ctx.createRadialGradient(lpx, lpy, 0, lpx, lpy, lr * 3);
      lg.addColorStop(0, 'rgba(120,255,150,0.75)');
      lg.addColorStop(1, 'rgba(120,255,150,0)');
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.arc(lpx, lpy, lr * 3, 0, M.TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.beginPath(); ctx.arc(lpx, lpy, lr, 0, M.TAU);
      ctx.fillStyle = '#9dffb4'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#1b3a22'; ctx.stroke();
    }
    ctx.restore();

    if (lit) drawEntryGlints(r, ctx, el, state);
    drawFlag(r, ctx, el, lit, gotCol);
  }

  /** Where light enters a lit destination, the glass flares. */
  function drawEntryGlints(r, ctx, el, state) {
    var res = state && state.scene && state.scene.lastResult;
    var dep = res && res.deposits[el.id];
    if (!dep || !dep.hitPoints || !dep.hitPoints.length) return;
    var hits = dep.hitPoints.slice().sort(function (a, b) { return b.i - a.i; }).slice(0, 2);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < hits.length; i++) {
      glint(ctx, hits[i].p.x, hits[i].p.y, 9 + expose(hits[i].i) * 15, 0.85);
    }
    ctx.restore();
  }

  /**
   * The flag that marks a destination. It stands up on screen whichever way
   * the stage is turned, hangs slack while the destination waits, and flies --
   * lit by the light that reached it -- once it is satisfied.
   */
  function drawFlag(r, ctx, el, lit, col) {
    var R0 = el.radius, t = r.time;
    var k = Math.max(1, worldPerCss(r) * 0.8);
    ctx.save();
    ctx.translate(el.x, el.y);
    if (r.view.rot) ctx.rotate(-Math.PI / 2);

    var base = -R0 * 0.12;
    var top = -(R0 * 1.15 + 36 * k);
    ctx.lineCap = 'round';
    ctx.lineWidth = 3.4 * k;
    ctx.strokeStyle = 'rgba(16,12,10,0.75)';
    ctx.beginPath();
    ctx.moveTo(0.8 * k, base);
    ctx.lineTo(0.8 * k, top);
    ctx.stroke();
    ctx.lineWidth = 1.9 * k;
    ctx.strokeStyle = '#eef1f5';
    ctx.beginPath();
    ctx.moveTo(0, base);
    ctx.lineTo(0, top);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, top - 1.5 * k, 2.6 * k, 0, M.TAU);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    /* The cloth: a pennant whose free end waves -- lazily until the light
     * arrives, briskly after. */
    var fw = 30 * k + R0 * 0.3, fh = 18 * k + R0 * 0.12;
    var speed = lit ? 7.5 : 1.5, amp = (lit ? 3.4 : 1.2) * k;
    var ph = t * speed + el.x * 0.013 + el.y * 0.007;
    var w1 = Math.sin(ph) * amp, w2 = Math.sin(ph - 1.3) * amp * 1.4, w3 = Math.sin(ph - 2.5) * amp * 1.9;
    var y0 = top + 1.2 * k;
    function cloth() {
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.bezierCurveTo(fw * 0.33, y0 + w1, fw * 0.66, y0 + w2 - fh * 0.04, fw, y0 + fh * 0.34 + w3);
      ctx.bezierCurveTo(fw * 0.68, y0 + fh * 0.62 + w2, fw * 0.34, y0 + fh + w1 * 0.6, 0, y0 + fh);
      ctx.closePath();
    }
    if (lit) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var halo = ctx.createRadialGradient(fw * 0.4, y0 + fh * 0.5, 2, fw * 0.4, y0 + fh * 0.5, fw * 1.2);
      halo.addColorStop(0, 'rgba(255,90,70,0.35)');
      halo.addColorStop(1, 'rgba(255,90,70,0)');
      ctx.fillStyle = halo;
      ctx.fillRect(-fw, y0 - fw, fw * 3, fw * 3);
      ctx.restore();
    }
    cloth();
    var cg = ctx.createLinearGradient(0, y0, fw, y0 + fh);
    cg.addColorStop(0, lit ? '#ff5b46' : '#d63a2c');
    cg.addColorStop(1, lit ? '#c2200f' : '#8c1b12');
    ctx.fillStyle = cg;
    ctx.fill();
    /* Folds: light on the crests, shade in the troughs. */
    ctx.save();
    cloth();
    ctx.clip();
    for (var f = 0; f < 3; f++) {
      var fx = fw * (0.22 + f * 0.28);
      var crest = Math.sin(ph - f * 1.25);
      ctx.fillStyle = crest > 0 ? 'rgba(255,255,255,' + (0.14 * crest) + ')' : 'rgba(40,0,0,' + (-0.2 * crest) + ')';
      ctx.fillRect(fx - fw * 0.1, y0 - fh, fw * 0.2, fh * 3);
    }
    ctx.restore();
    cloth();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(70,6,4,0.55)';
    ctx.stroke();
    ctx.restore();
  }

  /** A tripwire: smoked glass with red rings, and no flag -- never a destination. */
  function drawAlarm(r, ctx, el, st) {
    var R0 = el.radius, tripped = !st.lit;
    ctx.save();
    ctx.translate(el.x, el.y);
    ctx.save();
    shadowOn(ctx, r, 0.5, 1.1);
    ctx.beginPath();
    ctx.arc(0, 0, R0 * 1.08, 0, M.TAU);
    var body = ctx.createRadialGradient(-R0 * 0.35, -R0 * 0.4, R0 * 0.05, 0, 0, R0 * 1.08);
    body.addColorStop(0, 'rgba(70,24,22,0.8)');
    body.addColorStop(1, 'rgba(10,3,3,0.92)');
    ctx.fillStyle = body;
    ctx.fill();
    shadowOff(ctx);
    ctx.restore();
    var pulse = tripped ? 0.65 + 0.35 * Math.sin(r.time * 10) : 0.45;
    ctx.lineWidth = 2.6;
    ctx.strokeStyle = 'rgba(255,70,55,' + pulse + ')';
    ctx.beginPath(); ctx.arc(0, 0, R0 * 0.72, 0, M.TAU); ctx.stroke();
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(0, 0, R0 * 0.42, 0, M.TAU); ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, R0 * 1.08, 0, M.TAU);
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = tripped ? 'rgba(255,110,95,0.9)' : 'rgba(255,190,180,0.45)';
    ctx.stroke();
    if (tripped) {
      ctx.globalCompositeOperation = 'lighter';
      var ag = ctx.createRadialGradient(0, 0, 0, 0, 0, R0 * 2.4);
      ag.addColorStop(0, 'rgba(255,60,50,0.45)');
      ag.addColorStop(1, 'rgba(255,60,50,0)');
      ctx.fillStyle = ag;
      ctx.beginPath(); ctx.arc(0, 0, R0 * 2.4, 0, M.TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.font = '700 ' + Math.round(Math.max(15, 13 * worldPerCss(r))) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = tripped ? '#ffb0a6' : 'rgba(230,170,165,0.9)';
    textAt(ctx, r, tripped ? '!' : '∅', 0, 0);
    ctx.restore();
  }

  /* ==========================================================================
   * TIMED LEVELS -- hardware waiting for its phase
   * ======================================================================= */

  /** A small brass tag stamped with the phase a fitting is waiting for. */
  function drawPhaseTag(r, ctx, x, y, el) {
    var s = Math.max(1, worldPerCss(r) * 0.95);
    var w = 30 * s, h = 17 * s;
    ctx.save();
    ctx.translate(x, y);
    if (r.view.rot) ctx.rotate(-Math.PI / 2);
    shadowOn(ctx, r, 0.45, 0.6);
    roundRect(ctx, -w / 2, -h / 2, w, h, 4 * s);
    var g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, '#f1d49a');
    g.addColorStop(1, '#9c7334');
    ctx.fillStyle = g;
    ctx.fill();
    shadowOff(ctx);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(40,24,6,0.8)';
    ctx.stroke();
    ctx.fillStyle = '#2b1a07';
    ctx.font = '800 ' + Math.round(11 * s) + 'px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('P' + el.phase, 0, 0.5 * s);
    ctx.restore();
  }

  /**
   * A fitting set into the bench: the socket a sensor will rise from, or the
   * chalked outline and mounting holes of optics still to be installed. It
   * lies flush with the table, which is why light passes straight over it.
   */
  function drawSocket(r, ctx, el, scene) {
    /* A later phase's sensor that shares its spot with a live one is hidden
     * under it: no socket, and no tag across the live one's flag. */
    if (el.type === 'receiver') {
      for (var i = 0; i < scene.receivers.length; i++) {
        var o = scene.receivers[i];
        if (o !== el && !o.disabled && Math.abs(o.x - el.x) < 8 && Math.abs(o.y - el.y) < 8) return;
      }
    }
    ctx.save();
    if (el.type === 'receiver') {
      var R0 = el.radius + 7;
      var g = ctx.createRadialGradient(el.x, el.y, el.radius * 0.25, el.x, el.y, R0);
      g.addColorStop(0, 'rgba(0,0,0,0.62)');
      g.addColorStop(0.85, 'rgba(0,0,0,0.38)');
      g.addColorStop(1, 'rgba(0,0,0,0.12)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(el.x, el.y, R0, 0, M.TAU); ctx.fill();
      ctx.lineWidth = 3.2;
      ctx.strokeStyle = (el.require && el.require.dark) ? 'rgba(170,70,60,0.6)' : 'rgba(205,165,95,0.6)';
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,240,205,0.16)';
      ctx.beginPath(); ctx.arc(el.x - 1, el.y - 1, R0 - 2.5, 0, M.TAU); ctx.stroke();
      for (var k = 0; k < 3; k++) {
        var a = -Math.PI / 2 + k * (M.TAU / 3);
        brassBolt(ctx, el.x + Math.cos(a) * (R0 - 6), el.y + Math.sin(a) * (R0 - 6), 2.6);
      }
    } else {
      /* Chalk on the wood: where the part will be bolted down. */
      var p = el._prims[0];
      ctx.setLineDash([7, 7]);
      ctx.lineWidth = 2.6;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,244,222,0.30)';
      if (p && p.kind === 'poly') polyPath(ctx, p.pts); else surfacePath(ctx, el);
      ctx.stroke();
      ctx.setLineDash([]);
      var ends = endsOf(el);
      (ends || [{ x: el.x, y: el.y }]).forEach(function (e) {
        ctx.beginPath(); ctx.arc(e.x, e.y, 3.4, 0, M.TAU);
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fill();
      });
    }
    ctx.restore();
    if (el._future) drawPhaseTag(r, ctx, el.x, el.y - (el.radius || 22) - 30, el);
  }

  /** The steel channel a wall rises from, striped so no one parks a mirror on it. */
  function drawWallSlot(r, ctx, el, scene) {
    var pts = el._prims[0].pts, bb = el._bbox;
    var phaseNow = scene.phase ? scene.phase.index + 1 : 1;
    ctx.save();
    polyPath(ctx, pts);
    ctx.fillStyle = 'rgba(10,8,7,0.58)';
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(235,175,45,0.20)';
    ctx.beginPath();
    for (var t = -bb.h; t < bb.w + bb.h; t += 20) {
      ctx.moveTo(bb.x + t, bb.y);
      ctx.lineTo(bb.x + t - bb.h, bb.y + bb.h);
    }
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(200,205,215,0.34)';
    polyPath(ctx, pts);
    ctx.stroke();
    ctx.restore();
    if (el.phase !== undefined && el.phase > phaseNow) {
      drawPhaseTag(r, ctx, el.x, el.y, el);
    }
  }

  /** A bright ring where hardware has just risen, switched on or been re-set. */
  function drawInstallFx(r, ctx, scene) {
    var any = false;
    for (var i = 0; i < scene.elements.length; i++) {
      var el = scene.elements[i];
      if (el._fxT === undefined) continue;
      var age = r.time - el._fxT;
      if (age < 0 || age > 0.9) continue;
      if (!any) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; any = true; }
      var k = 1 - age / 0.9;
      var reach = el.isWall ? Math.max(el.w, el.h) * 0.55 : Math.max(30, E.handleReach(el));
      ctx.lineWidth = 3 + 5 * k;
      ctx.strokeStyle = 'rgba(255,226,170,' + (0.75 * k) + ')';
      ctx.beginPath();
      ctx.arc(el.x, el.y, reach * (0.7 + age * 0.9), 0, M.TAU);
      ctx.stroke();
    }
    if (any) ctx.restore();
  }

  /**
   * Every lamp is plugged in: a rubber mains lead runs from the back of its
   * housing to the nearest edge of the bench and over it. Decoration only --
   * but a lamp with a lead reads as an object, not an icon.
   */
  function drawCables(r, ctx, scene) {
    if (!scene.emitters.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (var i = 0; i < scene.emitters.length; i++) {
      var c = cableFor(scene.emitters[i]);
      ctx.beginPath();
      ctx.moveTo(c[0].x, c[0].y);
      ctx.bezierCurveTo(c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y);
      shadowOn(ctx, r, 0.5, 0.5);
      ctx.lineWidth = 6.5;
      ctx.strokeStyle = '#0e0c0b';
      ctx.stroke();
      shadowOff(ctx);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(255,248,236,0.12)';
      ctx.stroke();
    }
    ctx.restore();
  }

  function cableFor(em) {
    var key = em.x + ',' + em.y + ',' + em.angle;
    if (em._cable && em._cable.key === key) return em._cable.pts;
    var dx = Math.cos(em.angle), dy = Math.sin(em.angle);
    var p0 = { x: em.x - dx * 34, y: em.y - dy * 34 };
    var edges = [
      { x: -14, y: p0.y, nx: 1, ny: 0, tx: 0, ty: 1, d: p0.x },
      { x: WORLD_W + 14, y: p0.y, nx: -1, ny: 0, tx: 0, ty: 1, d: WORLD_W - p0.x },
      { x: p0.x, y: -14, nx: 0, ny: 1, tx: 1, ty: 0, d: p0.y },
      { x: p0.x, y: WORLD_H + 14, nx: 0, ny: -1, tx: 1, ty: 0, d: WORLD_H - p0.y }
    ];
    /* Prefer the edge behind the lamp: a lead does not run out in front of
     * its own beam if it can help it. */
    var best = edges[0], bestScore = Infinity;
    edges.forEach(function (e) {
      var facing = dx * e.nx + dy * e.ny;
      var score = e.d * (facing > 0.3 ? 1 : 2.4);
      if (score < bestScore) { bestScore = score; best = e; }
    });
    var h = Math.sin(em.x * 12.9898 + em.y * 78.233) * 43758.5453;
    var slide = ((h - Math.floor(h)) - 0.5) * 140;
    var end = { x: best.x + best.tx * slide, y: best.y + best.ty * slide };
    var pts = [
      p0,
      { x: p0.x - dx * 80, y: p0.y - dy * 80 },
      { x: end.x + best.nx * 110, y: end.y + best.ny * 110 },
      end
    ];
    em._cable = { key: key, pts: pts };
    return pts;
  }

  /** The rod, rail, turntable or orbit an element is mounted on. */
  function drawMotionRig(r, ctx, el, theme) {
    var m = el.motion;
    ctx.save();
    if (m.type === 'pendulum' && m.pivot) {
      /* Swept arc scribed on the table. */
      if (m.len && m.release !== undefined) {
        ctx.setLineDash([3, 9]);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(255,230,190,0.22)';
        ctx.beginPath();
        ctx.arc(m.pivot.x, m.pivot.y, m.len, Math.PI / 2 - m.release, Math.PI / 2 + m.release);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      /* Brass rod. */
      ctx.lineCap = 'round';
      ctx.lineWidth = 4.5;
      ctx.strokeStyle = '#3d2a12';
      ctx.beginPath(); ctx.moveTo(m.pivot.x, m.pivot.y); ctx.lineTo(el.x, el.y); ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#d6aa5c';
      ctx.stroke();
      brassBolt(ctx, m.pivot.x, m.pivot.y, 7);
    } else if (m.type === 'track' && m.from && m.to) {
      /* Steel rail. */
      var d = V.norm(V.sub(m.to, m.from)), n = V.perp(d);
      ctx.lineCap = 'round';
      for (var side = -1; side <= 1; side += 2) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(20,20,22,0.8)';
        ctx.beginPath();
        ctx.moveTo(m.from.x + n.x * side * 5, m.from.y + n.y * side * 5);
        ctx.lineTo(m.to.x + n.x * side * 5, m.to.y + n.y * side * 5);
        ctx.stroke();
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(210,220,230,0.55)';
        ctx.stroke();
      }
      brassBolt(ctx, m.from.x, m.from.y, 4.5);
      brassBolt(ctx, m.to.x, m.to.y, 4.5);
    } else if (m.type === 'orbit' && m.center) {
      ctx.setLineDash([4, 10]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,230,190,0.28)';
      ctx.beginPath();
      ctx.arc(m.center.x, m.center.y, m.radius, 0, M.TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      brassBolt(ctx, m.center.x, m.center.y, 5);
    } else if (m.type === 'turntable' || m.type === 'beat') {
      /* Knurled turntable disc under the mirror. */
      var tr = Math.max(22, E.handleReach(el) * 0.35);
      ctx.save();
      shadowOn(ctx, r, 0.5);
      ctx.beginPath();
      ctx.arc(el.x, el.y, tr, 0, M.TAU);
      ctx.fillStyle = '#1b1714';
      ctx.fill();
      shadowOff(ctx);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (var k = 0; k < 28; k++) {
        var a = (k / 28) * M.TAU + (m.type === 'turntable' ? el.angle : 0);
        ctx.moveTo(el.x + Math.cos(a) * (tr - 4), el.y + Math.sin(a) * (tr - 4));
        ctx.lineTo(el.x + Math.cos(a) * tr, el.y + Math.sin(a) * tr);
      }
      ctx.stroke();
      if (m.type === 'beat') {
        ctx.fillStyle = 'rgba(255,190,110,0.9)';
        for (var i = 0; i < 4; i++) {
          ctx.globalAlpha = (m.beatIndex % 4) === i ? 1 : 0.25;
          ctx.beginPath();
          ctx.arc(el.x - 18 + i * 12, el.y - E.handleReach(el) - 16, 3.2, 0, M.TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  /* ==========================================================================
   * OVERLAY: selection, handles, aim preview
   * ======================================================================= */
  function drawOverlay(r, ctx, theme, scene, state) {
    var accent = theme.accent || '#5ad7ff';
    var wpc = worldPerCss(r);

    /* Live aim preview while dragging or rotating. */
    if (state.preview && state.preview.length) {
      ctx.save();
      ctx.setLineDash([9 * wpc, 9 * wpc]);
      ctx.lineWidth = Math.max(2, 1.6 * wpc);
      ctx.strokeStyle = hexToRGBA('#ffffff', 0.55);
      ctx.beginPath();
      for (var i = 0; i < state.preview.length; i++) {
        var sg = state.preview[i];
        ctx.moveTo(sg.a.x, sg.a.y);
        ctx.lineTo(sg.b.x, sg.b.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    /* Ghost of the object about to be dropped. */
    if (state.ghost) {
      var gr = Math.max(26, 20 * wpc);
      var gp = state.ghost.p;
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.strokeStyle = state.ghost.ok ? hexToRGBA(accent, 0.9) : 'rgba(255,110,110,0.9)';
      ctx.fillStyle = state.ghost.ok ? hexToRGBA(accent, 0.16) : 'rgba(255,110,110,0.14)';
      ctx.lineWidth = 2 * wpc;
      ctx.setLineDash([7 * wpc, 6 * wpc]);
      ctx.beginPath();
      ctx.arc(gp.x, gp.y, gr, 0, M.TAU);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      if (!state.ghost.ok) {
        var gx = gr * 0.42;
        ctx.lineWidth = 3 * wpc;
        ctx.beginPath();
        ctx.moveTo(gp.x - gx, gp.y - gx); ctx.lineTo(gp.x + gx, gp.y + gx);
        ctx.moveTo(gp.x + gx, gp.y - gx); ctx.lineTo(gp.x - gx, gp.y + gx);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* Hint marker: where the reference answer puts the next object. */
    if (state.hint) {
      var hr = Math.max(30, 24 * wpc);
      ctx.save();
      var pulse = 0.5 + 0.5 * Math.sin(r.time * 4);
      ctx.strokeStyle = 'rgba(255,214,120,' + (0.55 + pulse * 0.45) + ')';
      ctx.lineWidth = 3 * wpc;
      ctx.setLineDash([5 * wpc, 8 * wpc]);
      ctx.beginPath();
      ctx.arc(state.hint.x, state.hint.y, hr + pulse * 6 * wpc, 0, M.TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = '600 ' + Math.round(Math.max(13, 12 * wpc)) + 'px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,224,150,0.95)';
      textAt(ctx, r, state.hint.type, state.hint.x, state.hint.y - hr - 16 * wpc);
      ctx.restore();
    }

    var sel = state.selected;
    if (!sel) return;

    var ho = handleOpts(r, state.removable);
    var ring = E.handleReach(sel) + ho.pad * 0.35;

    ctx.save();
    /* Selection ring. */
    ctx.strokeStyle = hexToRGBA(accent, 0.85);
    ctx.lineWidth = 2 * wpc;
    ctx.setLineDash([6 * wpc, 6 * wpc]);
    ctx.beginPath();
    ctx.arc(sel.x, sel.y, ring, 0, M.TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    var hs = E.handles(sel, ho);
    for (var h = 0; h < hs.length; h++) {
      var hd = hs[h];
      var active = state.activeHandle === hd.kind;
      var rad = ho.radius * (active ? 1.3 : 1) * (hd.tap ? 1.15 : 1);

      /* Connectors drawn under the knobs. */
      if (hd.kind === 'rotate') {
        ctx.strokeStyle = hexToRGBA(accent, 0.5);
        ctx.lineWidth = 1.5 * wpc;
        ctx.beginPath(); ctx.moveTo(sel.x, sel.y); ctx.lineTo(hd.p.x, hd.p.y); ctx.stroke();
      } else if (hd.kind === 'ratio') {
        ctx.strokeStyle = 'rgba(120,255,190,0.4)';
        ctx.lineWidth = 3 * wpc;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(hd.track.a.x, hd.track.a.y);
        ctx.lineTo(hd.track.b.x, hd.track.b.y);
        ctx.stroke();
      }

      var fill = 'rgba(255,255,255,0.92)';                        /* resize */
      if (hd.kind === 'rotate') fill = hexToRGBA(accent, 0.95);
      else if (hd.kind === 'curve') fill = 'rgba(255,200,120,0.95)';
      else if (hd.kind === 'ratio') fill = 'rgba(120,255,190,0.95)';
      else if (hd.kind === 'remove') fill = 'rgba(240,84,84,0.96)';
      else if (hd.kind === 'flip' || hd.kind === 'material') fill = 'rgba(26,34,52,0.96)';
      else if (hd.kind === 'color') fill = S.toCSS(S.resolveColor(sel.color), 1);

      ctx.beginPath();
      ctx.arc(hd.p.x, hd.p.y, rad, 0, M.TAU);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 2 * wpc;
      ctx.strokeStyle = hd.tap ? 'rgba(255,255,255,0.85)' : 'rgba(10,14,22,0.9)';
      ctx.stroke();

      var glyph = hd.kind === 'remove' ? '×' : hd.kind === 'flip' ? '⇄'
                : hd.kind === 'material' ? 'n' : hd.kind === 'color' ? '↻' : null;
      if (glyph) {
        ctx.fillStyle = hd.kind === 'color' ? 'rgba(10,14,22,0.92)' : '#ffffff';
        ctx.font = '700 ' + (ho.font * 1.3) + 'px system-ui, sans-serif';
        textAt(ctx, r, glyph, hd.p.x, hd.p.y);
      }

      if (hd.kind === 'ratio') {
        var pct = Math.round((sel.ratio === undefined ? 0.5 : sel.ratio) * 100);
        var lp = { x: hd.p.x + hd.track.u.x * rad * 3.2, y: hd.p.y + hd.track.u.y * rad * 3.2 };
        ctx.fillStyle = 'rgba(210,255,230,0.95)';
        ctx.font = '600 ' + ho.font + 'px system-ui, sans-serif';
        textAt(ctx, r, pct + '% reflected', lp.x, lp.y);
      }
    }

    /* Angle readout while rotating, on a dark pill at the element's centre --
     * on touch the finger is on the handle, so the centre is what stays
     * visible. */
    if (state.activeHandle === 'rotate') {
      var deg = Math.round(M.deg(M.wrapAngle2(sel.angle))) % 360;
      ctx.beginPath();
      ctx.arc(sel.x, sel.y, ho.font * 1.9, 0, M.TAU);
      ctx.fillStyle = 'rgba(8,12,20,0.85)';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 ' + (ho.font * 1.2) + 'px system-ui, sans-serif';
      textAt(ctx, r, deg + '°', sel.x, sel.y);
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
    computeView: computeView,
    toScreenView: toScreenView,
    toWorldView: toWorldView,
    setWorld: setWorld,
    worldPerCss: worldPerCss,
    handleOpts: handleOpts,
    textAt: textAt,
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
