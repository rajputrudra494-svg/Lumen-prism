/* =============================================================================
 * Lumen Path - src/game/levels.js
 * -----------------------------------------------------------------------------
 * The level catalogue: 96 hand-designed levels across 13 themed chapters, plus
 * sandboxes -- including timed levels played in phases (see engine/phases.js).
 *
 * HOW THESE ARE BUILT
 * Straight mirror puzzles are authored as a polyline (see authoring.js) and the
 * mirror angles are solved exactly, so the shipped `solution` is guaranteed to
 * work. Levels involving focus, dispersion or teleportation cannot be solved by
 * trigonometry alone, so they probe the real tracer at load time to find where
 * the light actually converges or which colour lands where, and place their
 * receivers on that measured point. Either way, no level ships with a target
 * that light cannot reach -- tools/verify.js re-checks every one.
 *
 * Difficulty ramps by MECHANIC, not by fiddliness: each chapter introduces one
 * new optical idea, uses it three or four ways, then combines it with the last
 * chapter's idea in a boss level every tenth stage.
 * ========================================================================== */
(function (LP) {
  'use strict';

  var A = LP.Authoring, M = LP.M;
  var rad = M.rad;

  /* ==========================================================================
   * CHAPTERS -- theme, palette and the mechanic each one teaches.
   * ======================================================================= */
  var CHAPTERS = [
    { id: 'lab', name: 'The Lab', teaches: 'Reflection',
      blurb: 'Clean benches, cold light, and one idea: angle in equals angle out.',
      bg: '#0d1220', grid: '#1b2740', accent: '#5ad7ff', glow: '#7ef0ff', mood: 'clinical',
      wood: 'maple', ambient: '#c2cad2', ambientLevel: 0.46 },
    { id: 'observatory', name: 'The Observatory', teaches: 'Curved mirrors',
      blurb: 'Big glass under a colder sky. Learn to gather light, not just bend it.',
      bg: '#0a0f1e', grid: '#1d2242', accent: '#ffc46b', glow: '#ffd9a0', mood: 'vast',
      wood: 'walnut', ambient: '#93a3c9', ambientLevel: 0.46 },
    { id: 'caves', name: 'Crystal Caves', teaches: 'Refraction & dispersion',
      blurb: 'Every wall is a prism. White light does not stay white down here.',
      bg: '#150a24', grid: '#31184a', accent: '#c98bff', glow: '#e7c0ff', mood: 'resonant',
      wood: 'cherry', ambient: '#b39cd2', ambientLevel: 0.38 },
    { id: 'reef', name: 'Sunken Reef', teaches: 'Absorption & filters',
      blurb: 'Light drowns quickly. Waste none of it.',
      bg: '#031c24', grid: '#0b3742', accent: '#4fe0c4', glow: '#a5fff0', mood: 'muffled',
      wood: 'teak', ambient: '#8fc6bd', ambientLevel: 0.4 },
    { id: 'neon', name: 'Neon Quarter', teaches: 'Splitting & polarisation',
      blurb: 'One beam is never enough in a city that runs on signal.',
      bg: '#12061c', grid: '#331046', accent: '#ff5ec4', glow: '#ff9ede', mood: 'pulsing',
      wood: 'ebony', ambient: '#d38cc8', ambientLevel: 0.66 },
    { id: 'deepspace', name: 'Deep Space Relay', teaches: 'Portals & gratings',
      blurb: 'Photons are rationed out here. Spend them carefully.',
      bg: '#04040c', grid: '#141430', accent: '#8fa8ff', glow: '#cdd8ff', mood: 'sparse',
      wood: 'smoked', ambient: '#8e98c9', ambientLevel: 0.52 },
    { id: 'clockwork', name: 'Clockwork Tower', teaches: 'Timing & motion',
      blurb: 'Nothing here holds still. Aim at where the mirror will be.',
      bg: '#1a1206', grid: '#3d2c11', accent: '#ffb347', glow: '#ffdca8', mood: 'ticking',
      wood: 'mahogany', ambient: '#e6b67c', ambientLevel: 0.42 },
    { id: 'aurora', name: 'Aurora Fields', teaches: 'Heat & colour mixing',
      blurb: 'The sky does the mixing. You just have to keep the glass cool.',
      bg: '#04140f', grid: '#0f3327', accent: '#6bffab', glow: '#c4ffe0', mood: 'shimmering',
      wood: 'ash', ambient: '#9ed6b6', ambientLevel: 0.36 },
    { id: 'spire', name: 'Obsidian Spire', teaches: 'Precision under pressure',
      blurb: 'Everything you have learned, and far less room to use it in.',
      bg: '#12070a', grid: '#35141b', accent: '#ff7a5c', glow: '#ffb8a3', mood: 'ominous',
      wood: 'charred', ambient: '#e0957a', ambientLevel: 0.58 },
    { id: 'horizon', name: 'Event Horizon', teaches: 'Mastery',
      blurb: 'Light bends, splits and vanishes here. Nothing forgives a stray degree.',
      bg: '#05030b', grid: '#1d1633', accent: '#c9b2ff', glow: '#f1e8ff', mood: 'cosmic',
      wood: 'limed', ambient: '#b8a6e6', ambientLevel: 0.40 },
    { id: 'mirage', name: 'Hall of Mirages', teaches: 'Seeing through clutter',
      blurb: 'Every table here is crowded with machinery. Most of it is lying to you.',
      bg: '#061312', grid: '#12302d', accent: '#7fe3d6', glow: '#c9fff6', mood: 'uncanny',
      wood: 'zebrano', ambient: '#a6d6cf', ambientLevel: 0.40 },
    { id: 'zerohour', name: 'Zero Hour', teaches: 'Working against the clock',
      blurb: 'Timed levels in phases. Beat each clock, or the phase rewinds and you do it again.',
      bg: '#170605', grid: '#3b1410', accent: '#ff6b4a', glow: '#ffc2b0', mood: 'urgent',
      wood: 'padauk', ambient: '#eaa487', ambientLevel: 0.44 },
    { id: 'impossible', name: 'The Impossible', teaches: 'Everything, at once',
      blurb: 'These look unsolvable. Every one has an answer. Most people never find it.',
      bg: '#07060d', grid: '#1d1a33', accent: '#b9a4ff', glow: '#e8e0ff', mood: 'void',
      wood: 'wenge', ambient: '#aaa6cc', ambientLevel: 0.60 },
    { id: 'sandbox', name: 'Open Bench', teaches: 'Nothing at all',
      blurb: 'No targets, no par, no clock. Take the optics apart and see.',
      bg: '#0e0e14', grid: '#242434', accent: '#dddde8', glow: '#ffffff', mood: 'quiet',
      wood: 'oak', ambient: '#dccbb2', ambientLevel: 0.52 }
  ];

  var LEVELS = [];

  function clone(o) {
    if (o === null || typeof o !== 'object') return o;
    if (Array.isArray(o)) return o.map(clone);
    var r = {}, k;
    for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = clone(o[k]);
    return r;
  }

  /* --------------------------------------------------------------------------
   * multi() -- build a level from one or more independent light paths.
   *
   * Each chain contributes an emitter, a receiver and one mirror per waypoint.
   * Extra fixtures, walls, zones and hand-written placements can be merged in
   * for levels that are not purely chains.
   * ------------------------------------------------------------------------ */
  function multi(spec) {
    var emitters = [], receivers = [], solution = [], counts = {};

    (spec.chains || []).forEach(function (ch) {
      var res = A.chain(ch.emitter, ch.path || [], ch.receiver, {
        snap: ch.snap === undefined ? (spec.snap === undefined ? 15 : spec.snap) : ch.snap,
        type: ch.type, length: ch.length, props: ch.props
      });
      var em = clone(ch.emitter);
      em.angle = res.emitterAngle;
      emitters.push(em);
      /* Two chains aiming at the same coordinates mean one shared target, not
       * two stacked ones -- the second would sit inside the first and never
       * see any light. */
      var dup = receivers.some(function (r) {
        return Math.abs(r.x - ch.receiver.x) < 1 && Math.abs(r.y - ch.receiver.y) < 1;
      });
      if (!dup) receivers.push(ch.receiver);
      res.placements.forEach(function (p) {
        solution.push(p);
        counts[p.type] = (counts[p.type] || 0) + 1;
      });
    });

    (spec.extraEmitters || []).forEach(function (e) { emitters.push(e); });
    (spec.extraReceivers || []).forEach(function (r) { receivers.push(r); });
    (spec.extraSolution || []).forEach(function (p) {
      solution.push(p);
      counts[p.type] = (counts[p.type] || 0) + 1;
    });

    var inventory = spec.inventory;
    if (!inventory) {
      inventory = [];
      for (var k in counts) if (Object.prototype.hasOwnProperty.call(counts, k)) {
        inventory.push({ type: k, count: counts[k] });
      }
    }

    var lvl = {
      id: spec.id, chapter: spec.chapter, name: spec.name,
      blurb: spec.blurb, hint: spec.hint,
      world: spec.world || { w: 1600, h: 900 },
      fog: spec.fog, airAbsorb: spec.airAbsorb,
      emitters: emitters, receivers: receivers,
      fixed: spec.fixed || [], walls: spec.walls || [], zones: spec.zones,
      inventory: inventory,
      solution: solution,
      par: spec.par || { objects: solution.length, bounces: solution.length },
      holdTime: spec.holdTime, sandbox: spec.sandbox, tags: spec.tags,
      weather: spec.weather, phases: spec.phases
    };
    /* A timed level's answer lives in its phases; the flat list of pieces is
     * what the hint button and replays work from. */
    if (lvl.phases && !solution.length) lvl.solution = LP.Phases.allPlacements(lvl);
    for (var key in lvl) if (lvl[key] === undefined) delete lvl[key];
    LEVELS.push(lvl);
    return lvl;
  }

  /* Shorthands. */
  var E = A.emitter, R = A.receiver, W = A.wall, Z = A.zone, F = A.fixedEl;
  function need(i, color) { return { color: color || 'any', minIntensity: i }; }

  /**
   * A brightness requirement expressed as a FRACTION of what the reference
   * arrangement actually delivers, measured by probing the tracer.
   *
   * Hard-coding a number here is how a level ends up demanding more light than
   * physics can supply. Asking for, say, 70% of the measured energy keeps the
   * target demanding -- a sloppy placement still fails -- while guaranteeing a
   * correct placement passes.
   */
  function demand(probe, frac, color) {
    var v = Math.round(probe.intensity * frac * 1000) / 1000;
    return { color: color || 'any', minIntensity: Math.max(0.02, v) };
  }

  /**
   * A wavelength requirement for band-targeting levels, plus a receiver radius
   * sized to the actual gap between neighbouring spectral bands so the target
   * isolates the colour it claims to without being pixel-perfect fiddly.
   */
  function bandPort(here, neighbour, nm, tolerance, minI) {
    var gap = Math.abs(here.x - neighbour.x) + Math.abs(here.y - neighbour.y);
    var radius = Math.max(16, Math.min(38, gap * 0.75));
    return {
      x: here.x, y: here.y, radius: Math.round(radius),
      require: { wavelength: nm, wavelengthTolerance: tolerance || 55,
                 minIntensity: minI === undefined ? 0.05 : minI }
    };
  }

  /* ==========================================================================
   * CHAPTER 1 -- THE LAB
   * One mechanic: a flat mirror turns a beam. Introduces place, rotate, resize,
   * placement zones and the fact that light does not travel for free.
   * ======================================================================= */

  multi({
    id: 'lab-1', chapter: 'lab', name: 'First Light',
    blurb: 'Drop a mirror in the beam and turn it onto the sensor.',
    hint: 'Drag the mirror from the tray. Its rotation handle is the small dot.',
    chains: [{
      emitter: E(140, 240, 0, 'white'),
      receiver: R(700, 760, need(0.5)),
      path: [{ x: 700, y: 240 }]
    }],
    par: { objects: 1, bounces: 1 }
  });

  multi({
    id: 'lab-2', chapter: 'lab', name: 'Corner Office',
    blurb: 'Two turns. The second mirror has to finish what the first starts.',
    hint: 'Solve the first bounce, then worry about the second.',
    chains: [{
      emitter: E(140, 180, 0, 'white'),
      receiver: R(1420, 640, need(0.45)),
      path: [{ x: 560, y: 180 }, { x: 560, y: 640 }]
    }],
    par: { objects: 2, bounces: 2 }
  });

  multi({
    id: 'lab-3', chapter: 'lab', name: 'Behind the Pillar',
    blurb: 'The sensor is straight ahead. Something solid is in the way.',
    hint: 'Go over the top.',
    walls: [W(760, 330, 90, 300)],
    chains: [{
      emitter: E(140, 450, 0, 'white'),
      receiver: R(1460, 450, need(0.4)),
      path: [{ x: 520, y: 450 }, { x: 520, y: 180 }]
    }],
    par: { objects: 2, bounces: 2 }
  });

  multi({
    id: 'lab-4', chapter: 'lab', name: 'The Long Way',
    blurb: 'Light is not free. Every bounce and every metre costs you some.',
    hint: 'This sensor is fussy about brightness. A shorter path keeps more light.',
    chains: [{
      emitter: E(120, 140, 0, 'white'),
      receiver: R(1470, 780, need(0.55)),
      path: [{ x: 620, y: 140 }, { x: 620, y: 520 }, { x: 1130, y: 520 }]
    }],
    par: { objects: 3, bounces: 3 }
  });

  multi({
    id: 'lab-5', chapter: 'lab', name: 'Cramped',
    blurb: 'The bench is mostly off-limits. Work inside the marked bays.',
    hint: 'You can only drop mirrors inside the highlighted zones.',
    zones: [Z(430, 150, 260, 640), Z(1000, 330, 320, 300)],
    walls: [W(760, 0, 60, 380), W(760, 560, 60, 340)],
    chains: [{
      emitter: E(140, 250, 0, 'white'),
      receiver: R(1450, 690, need(0.42)),
      path: [{ x: 550, y: 250 }, { x: 550, y: 470 }, { x: 1150, y: 470 }]
    }],
    par: { objects: 3, bounces: 3 }
  });

  multi({
    id: 'lab-6', chapter: 'lab', name: 'Twin Beams',
    blurb: 'Two sources, two sensors, and no reason for them to interfere.',
    hint: 'Treat them as two separate problems that happen to share a room.',
    chains: [
      { emitter: E(120, 150, 0, 'white'), receiver: R(1470, 330, need(0.4)),
        path: [{ x: 600, y: 150 }, { x: 600, y: 330 }] },
      { emitter: E(120, 760, 0, 'white'), receiver: R(1470, 580, need(0.4)),
        path: [{ x: 780, y: 760 }, { x: 780, y: 580 }] }
    ],
    par: { objects: 4, bounces: 4 }
  });

  multi({
    id: 'lab-7', chapter: 'lab', name: 'Wide Load',
    blurb: 'A fat beam needs a big mirror. Stretch it until nothing spills past.',
    hint: 'Drag a mirror’s end handle to make it longer, or scroll on it.',
    chains: [{
      emitter: E(130, 450, 0, 'white', { width: 180, rays: 13 }),
      receiver: R(880, 780, need(0.75), { radius: 105 }),
      path: [{ x: 880, y: 450, length: 260 }]
    }],
    inventory: [{ type: 'mirror', count: 1, preset: { length: 120 } }],
    par: { objects: 1, bounces: 13 }
  });

  /* ==========================================================================
   * CHAPTER 2 -- THE OBSERVATORY
   * Curved mirrors. A concave surface gathers a wide bundle onto a point; a
   * convex one throws it apart. Receiver positions here are measured from the
   * real trace rather than guessed.
   * ======================================================================= */

  /* --- Level 8: pure gathering. The receiver sits at the measured focus. --- */
  (function () {
    var mirror = { type: 'concave', x: 1220, y: 300, angle: rad(68),
                   length: 260, curvature: 0.16, material: 'silver' };
    var em = E(130, 300, 0, 'white', { width: 200, rays: 15 });
    var focus = A.focusAfter([mirror], [em], 1);
    var probe = A.energyAt([mirror], [em], focus, 26);

    multi({
      id: 'obs-8', chapter: 'observatory', name: 'Gathering',
      blurb: 'A flat mirror only redirects. A curved one collects.',
      hint: 'A concave mirror brings a parallel beam to a point. Find the point.',
      chains: [],
      extraEmitters: [em],
      extraReceivers: [R(focus.x, focus.y, demand(probe, 0.72), { radius: 26 })],
      extraSolution: [mirror],
      inventory: [{ type: 'concave', count: 1,
                    preset: { length: 260, curvature: 0.16 } }],
      par: { objects: 1, bounces: 15 }
    });
  })();

  /* --- Level 9: one beam, two sensors, using a convex spreader. ----------- */
  (function () {
    var spreader = { type: 'convex', x: 900, y: 450, angle: rad(90),
                     length: 220, curvature: -0.45, material: 'silver' };
    var em = E(130, 450, 0, 'white', { width: 150, rays: 15, intensity: 1.4 });
    var up = A.beamEnd([spreader], [em], { depth: 1, index: 0 });
    var down = A.beamEnd([spreader], [em], { depth: 1, index: 14 });

    multi({
      id: 'obs-9', chapter: 'observatory', name: 'Spread the Word',
      blurb: 'Convex glass does the opposite job: one beam becomes a fan.',
      hint: 'Both sensors are dim on purpose. A fan reaches wider than a beam.',
      chains: [],
      extraEmitters: [em],
      extraReceivers: [
        R(up.at(300).x, up.at(300).y, need(0.05), { radius: 40 }),
        R(down.at(300).x, down.at(300).y, need(0.05), { radius: 40 })
      ],
      extraSolution: [spreader],
      inventory: [{ type: 'convex', count: 1, preset: { length: 220, curvature: -0.45 } }],
      par: { objects: 1, bounces: 15 }
    });
  })();

  /* --- Level 10: BOSS. Gather, then split the gathered light two ways. ---- */
  (function () {
    var dish = { type: 'concave', x: 1300, y: 240, angle: rad(66),
                 length: 300, curvature: 0.13, material: 'silver' };
    var em = E(120, 240, 0, 'white', { width: 240, rays: 17 });
    var focus = A.focusAfter([dish], [em], 1);
    /* Put a flat mirror short of the focus and send the converging cone down. */
    var relayX = focus.x + 90, relayY = focus.y - 90;
    var relay = { type: 'mirror', x: relayX, y: relayY,
                  angle: A.aimAngle({ x: dish.x, y: dish.y }, { x: relayX, y: relayY },
                                    { x: relayX - 40, y: relayY + 420 }),
                  length: 200 };
    var after = A.focusAfter([dish, relay], [em], 2);
    var probe = A.energyAt([dish, relay], [em], after, 30);

    multi({
      id: 'obs-10', chapter: 'observatory', name: 'The Great Reflector',
      blurb: 'The observatory’s main dish. Catch all of it, then aim the cone.',
      hint: 'Gather first, relay second. The cone keeps converging after the flat mirror.',
      chains: [],
      extraEmitters: [em],
      extraReceivers: [R(after.x, after.y, demand(probe, 0.7), { radius: 30 })],
      extraSolution: [dish, relay],
      inventory: [
        { type: 'concave', count: 1, preset: { length: 300, curvature: 0.13 } },
        { type: 'mirror', count: 1, preset: { length: 200 } }
      ],
      par: { objects: 2, bounces: 34 },
      tags: ['boss']
    });
  })();

  /* --- Level 11: the flexible mirror. Same object, three behaviours. ------ */
  (function () {
    var flexA = { type: 'flex', x: 1150, y: 250, angle: rad(72),
                  length: 240, curvature: 0.2, material: 'silver' };
    var em = E(130, 250, 0, 'white', { width: 170, rays: 13 });
    var focus = A.focusAfter([flexA], [em], 1);
    var probe = A.energyAt([flexA], [em], focus, 24);

    multi({
      id: 'obs-11', chapter: 'observatory', name: 'Flex',
      blurb: 'One mirror that bends from concave, through flat, to convex.',
      hint: 'The curve handle sits on the mirror’s back. Flatten it and nothing focuses.',
      chains: [],
      extraEmitters: [em],
      extraReceivers: [R(focus.x, focus.y, demand(probe, 0.75), { radius: 24 })],
      extraSolution: [flexA],
      inventory: [{ type: 'flex', count: 1, preset: { length: 240, curvature: 0 } }],
      par: { objects: 1, bounces: 13 }
    });
  })();

  /* --- Level 12: off-axis gathering around an obstruction. ---------------- */
  (function () {
    var dish = { type: 'concave', x: 1240, y: 640, angle: rad(112),
                 length: 280, curvature: 0.15, material: 'silver' };
    var em = E(130, 640, 0, 'white', { width: 190, rays: 15 });
    var focus = A.focusAfter([dish], [em], 1);
    var probe = A.energyAt([dish], [em], focus, 26);

    multi({
      id: 'obs-12', chapter: 'observatory', name: 'Off Axis',
      blurb: 'Tilt the dish and the focus swings with it.',
      hint: 'Rotating a curved mirror moves its focal point along an arc.',
      chains: [],
      extraEmitters: [em],
      extraReceivers: [R(focus.x, focus.y, demand(probe, 0.72), { radius: 26 })],
      extraSolution: [dish],
      walls: [W(660, 770, 40, 130)],
      inventory: [{ type: 'concave', count: 1, preset: { length: 280, curvature: 0.15 } }],
      par: { objects: 1, bounces: 15 }
    });
  })();

  /* --- Level 13: a two-mirror telescope. Convex secondary, real cone. ----- */
  (function () {
    var primary = { type: 'concave', x: 1320, y: 450, angle: rad(90),
                    length: 320, curvature: 0.12, material: 'silver' };
    var em = E(120, 450, 0, 'white', { width: 260, rays: 17 });
    var f1 = A.focusAfter([primary], [em], 1);
    /* Secondary sits inside the converging cone and folds it downward. */
    var sec = { type: 'mirror', x: f1.x + 200, y: f1.y,
                angle: rad(45), length: 150 };
    var f2 = A.focusAfter([primary, sec], [em], 2);
    var probe = A.energyAt([primary, sec], [em], f2, 26);

    multi({
      id: 'obs-13', chapter: 'observatory', name: 'Cassegrain',
      blurb: 'Primary gathers, secondary folds. The focus ends up somewhere useful.',
      hint: 'Put the flat mirror inside the cone, before the light converges.',
      chains: [],
      extraEmitters: [em],
      extraReceivers: [R(f2.x, f2.y, demand(probe, 0.7), { radius: 26 })],
      extraSolution: [primary, sec],
      inventory: [
        { type: 'concave', count: 1, preset: { length: 320, curvature: 0.12 } },
        { type: 'mirror', count: 1, preset: { length: 150 } }
      ],
      par: { objects: 2, bounces: 34 }
    });
  })();

  multi({
    id: 'obs-14', chapter: 'observatory', name: 'Guide Star',
    blurb: 'Three sensors, one pencil beam, and no curved glass at all.',
    hint: 'Sometimes the old tool is the right one.',
    chains: [
      { emitter: E(120, 130, 0, 'white'), receiver: R(1470, 300, need(0.4)),
        path: [{ x: 640, y: 130 }, { x: 640, y: 300 }] },
      { emitter: E(120, 780, 0, 'white'), receiver: R(1470, 610, need(0.4)),
        path: [{ x: 780, y: 780 }, { x: 780, y: 610 }] },
      { emitter: E(800, 60, 90, 'white'), receiver: R(1470, 455, need(0.45)),
        path: [{ x: 800, y: 455 }] }
    ],
    par: { objects: 5, bounces: 5 }
  });

  /* ==========================================================================
   * CHAPTER 3 -- CRYSTAL CAVES
   * Refraction, total internal reflection and dispersion. Receivers start
   * asking for particular colours, and the prism is the only way to make them.
   * ======================================================================= */

  multi({
    id: 'cav-15', chapter: 'caves', name: 'Bent',
    blurb: 'Glass does not reflect light. It bends it, and the bend is exact.',
    hint: 'Slide the block sideways: how far the beam shifts depends on the glass.',
    fixed: [F('glass', 800, 450, 30, { w: 240, h: 200, material: 'crown', locked: true })],
    chains: [{
      emitter: E(130, 300, 0, 'white'),
      receiver: R(1460, 620, need(0.32)),
      path: [{ x: 480, y: 300 }, { x: 480, y: 620 }]
    }],
    par: { objects: 2, bounces: 2 }
  });

  /* --- Level 16: the first spectrum. ------------------------------------- *
   * A prism straight onto a wall gives a rainbow only ~80px wide, which is far
   * too tight to aim at. The level folds the fan off a fixed mirror so it
   * travels three times as far and separates into ports you can actually hit.
   * The port positions and radii are measured from the trace, not guessed.    */
  (function () {
    var prism = { type: 'prism', x: 820, y: 450, angle: rad(45),
                  radius: 92, material: 'flint' };
    var em = E(200, 510, 0, 'white', { intensity: 2.0 });

    /* Where the fan leaves the prism, and where its middle crosses the fold. */
    var fanOrigin = A.beamEnd([prism], [em], { depth: 2, pick: 'brightest' }).a;
    var mid = A.bandCrossing([prism], [em], 540, 'y', 150);
    var fold = { type: 'mirror', x: mid.x, y: mid.y, length: 320, locked: true,
                 angle: A.aimAngle(fanOrigin, mid, { x: 1080, y: 860 }) };

    var TARGET_Y = 780;
    var redP  = A.bandCrossing([prism, fold], [em], 664, 'y', TARGET_Y);
    var redN  = A.bandCrossing([prism, fold], [em], 602, 'y', TARGET_Y);
    var bluP  = A.bandCrossing([prism, fold], [em], 416, 'y', TARGET_Y);
    var bluN  = A.bandCrossing([prism, fold], [em], 478, 'y', TARGET_Y);

    multi({
      id: 'cav-16', chapter: 'caves', name: 'Split the White',
      blurb: 'White light is a crowd. A prism makes it queue up by wavelength.',
      hint: 'Red bends least and lands at one end of the fan; violet bends most.',
      chains: [],
      fixed: [fold],
      extraEmitters: [em],
      extraReceivers: [
        R(redP.x, redP.y, bandPort(redP, redN, 640, 60, 0.08).require,
          { radius: bandPort(redP, redN, 640).radius }),
        R(bluP.x, bluP.y, bandPort(bluP, bluN, 445, 60, 0.08).require,
          { radius: bandPort(bluP, bluN, 445).radius })
      ],
      extraSolution: [prism],
      inventory: [{ type: 'prism', count: 1, preset: { radius: 92, material: 'flint' } }],
      par: { objects: 1, bounces: 34 }
    });
  })();

  /* --- Level 17: total internal reflection as a right-angle turn. --------- *
   * The beam enters a 60-60-60 prism square-on, so it does not bend at all on
   * the way in. It then meets the far face at 60 degrees, well past crown
   * glass's ~41.5 degree critical angle, and the glass turns into a mirror.    */
  (function () {
    var block = { type: 'prism', x: 900, y: 300, angle: rad(-30),
                  radius: 110, material: 'crown', disperse: false };
    var em = E(200, 350, 0, 'green', { intensity: 1.2 });
    var out = A.beamEnd([block], [em], { depth: 3, inside: false, pick: 'brightest' });
    var probe = A.energyAt([block], [em], out.at(300), 30);

    multi({
      id: 'cav-17', chapter: 'caves', name: 'Trapped Light',
      blurb: 'Past the critical angle, glass stops letting light out at all.',
      hint: 'Enter a face square-on and nothing bends. It is the SECOND face that matters.',
      chains: [],
      extraEmitters: [em],
      extraReceivers: [R(out.at(300).x, out.at(300).y, demand(probe, 0.75), { radius: 30 })],
      extraSolution: [block],
      inventory: [{ type: 'prism', count: 1,
                    preset: { radius: 110, material: 'crown', disperse: false } }],
      par: { objects: 1, bounces: 8 }
    });
  })();

  multi({
    id: 'cav-18', chapter: 'caves', name: 'Colour Coded',
    blurb: 'Three sensors, three colours, one white source.',
    hint: 'Filters throw away everything that does not match. Start with the brightest path.',
    fixed: [
      F('splitter', 620, 450, 45, { length: 200, ratio: 0.5 }),
      F('splitter', 1050, 450, 135, { length: 200, ratio: 0.5 })
    ],
    chains: [],
    extraEmitters: [E(140, 450, 0, 'white', { intensity: 1.8 })],
    extraReceivers: [
      R(620, 850, { color: 'green', minIntensity: 0.2 }, { radius: 28 }),
      R(1450, 450, { color: 'red', minIntensity: 0.1 }, { radius: 28 }),
      R(1050, 90, { color: 'blue', minIntensity: 0.1 }, { radius: 28 })
    ],
    extraSolution: [
      { type: 'filter', x: 620, y: 700, angle: rad(0), length: 170, color: 'green' },
      { type: 'filter', x: 1300, y: 450, angle: rad(90), length: 170, color: 'red' },
      { type: 'filter', x: 1050, y: 230, angle: rad(0), length: 170, color: 'blue' }
    ],
    inventory: [
      { type: 'filter', count: 1, preset: { color: 'red', length: 170 } },
      { type: 'filter', count: 1, preset: { color: 'green', length: 170 } },
      { type: 'filter', count: 1, preset: { color: 'blue', length: 170 } }
    ],
    par: { objects: 3, bounces: 3 }
  });

  /* --- Level 19: a lens, which focuses by refraction rather than shape. --- */
  (function () {
    var lens = { type: 'lens', x: 760, y: 450, angle: rad(0),
                 length: 220, curvature: 0.55, material: 'crown' };
    var em = E(140, 450, 0, 'green', { width: 170, rays: 15 });
    var focus = A.focusAfter([lens], [em], 2);
    var probe = A.energyAt([lens], [em], focus, 24);

    multi({
      id: 'cav-19', chapter: 'caves', name: 'Through a Glass',
      blurb: 'A lens focuses without reflecting anything at all.',
      hint: 'The focus sits on the far side. Move the lens and the focus moves twice as far.',
      chains: [],
      extraEmitters: [em],
      extraReceivers: [R(focus.x, focus.y, demand(probe, 0.7), { radius: 24 })],
      extraSolution: [lens],
      inventory: [{ type: 'lens', count: 1,
                    preset: { length: 220, curvature: 0.55, material: 'crown' } }],
      par: { objects: 1, bounces: 45 }
    });
  })();

  /* --- Level 20: BOSS. Disperse, fold, then pull one band out of the fan. --
   * Two locks: one sits in the spectrum where it falls, the other is across
   * the room and only the green band can reach it -- which means putting a
   * small mirror into the rainbow itself and steering a single colour.         */
  (function () {
    var prism = { type: 'prism', x: 700, y: 470, angle: rad(45),
                  radius: 96, material: 'flint' };
    var em = E(160, 530, 0, 'white', { intensity: 2.4 });

    var fanOrigin = A.beamEnd([prism], [em], { depth: 2, pick: 'brightest' }).a;
    var mid = A.bandCrossing([prism], [em], 540, 'y', 150);
    var fold = { type: 'mirror', x: mid.x, y: mid.y, length: 340, locked: true,
                 angle: A.aimAngle(fanOrigin, mid, { x: 1320, y: 840 }) };

    /* Where each band crosses the pick-off line and the target line. */
    var PICK_Y = 520, PORT_Y = 810;
    var greenP = A.bandCrossing([prism, fold], [em], 540, 'y', PICK_Y);
    var relay = { type: 'mirror', x: greenP.x, y: greenP.y, length: 60,
                  angle: A.aimAngle(mid, greenP, { x: 1480, y: 200 }) };

    var violetP = A.bandCrossing([prism, fold], [em], 416, 'y', PORT_Y);
    var violetN = A.bandCrossing([prism, fold], [em], 478, 'y', PORT_Y);
    var vPort = bandPort(violetP, violetN, 440, 60, 0.05);
    var greenLanding = A.energyAt([prism, fold, relay], [em], { x: 1480, y: 200 }, 40);

    multi({
      id: 'cav-20', chapter: 'caves', name: 'The Chromatic Gate',
      blurb: 'Two locks. One takes violet where it falls; the other wants green, over there.',
      hint: 'Disperse once, then put a small mirror in the rainbow and move only the colour you need.',
      chains: [],
      fixed: [fold],
      extraEmitters: [em],
      extraReceivers: [
        R(violetP.x, violetP.y, vPort.require, { radius: vPort.radius }),
        R(1480, 200, { wavelength: 555, wavelengthTolerance: 70,
                       minIntensity: Math.max(0.02, greenLanding.intensity * 0.7) },
          { radius: 40 })
      ],
      extraSolution: [prism, relay],
      inventory: [
        { type: 'prism', count: 1, preset: { radius: 96, material: 'flint' } },
        { type: 'mirror', count: 1, preset: { length: 64 } }
      ],
      par: { objects: 2, bounces: 40 },
      tags: ['boss']
    });
  })();

  multi({
    id: 'cav-21', chapter: 'caves', name: 'Cave Mouth',
    blurb: 'Long crystal galleries. The light has to survive the trip.',
    hint: 'Fewer bounces means more light left at the end.',
    fog: 0.00035,
    chains: [{
      emitter: E(120, 820, 0, 'white', { intensity: 1.3 }),
      receiver: R(1470, 120, need(0.42)),
      path: [{ x: 560, y: 820 }, { x: 560, y: 380 }, { x: 1080, y: 380 }, { x: 1080, y: 120 }]
    }],
    par: { objects: 4, bounces: 4 }
  });

  /* ==========================================================================
   * CHAPTER 4 -- SUNKEN REEF
   * Absorption. Everything here eats light: the water, the filters, the
   * distance. Levels stop being about geometry and start being about budget.
   * ======================================================================= */

  multi({
    id: 'reef-22', chapter: 'reef', name: 'Murk',
    blurb: 'The water drinks your beam. Take the short road.',
    hint: 'Fog attenuates by distance travelled, not by number of bounces.',
    fog: 0.0011,
    weather: 'murk',
    chains: [{
      emitter: E(140, 200, 0, 'white', { intensity: 2.4 }),
      receiver: R(1420, 660, need(0.24)),
      path: [{ x: 900, y: 200 }, { x: 900, y: 660 }]
    }],
    par: { objects: 2, bounces: 2 }
  });

  multi({
    id: 'reef-23', chapter: 'reef', name: 'Kelp Forest',
    blurb: 'Narrow channels, thick water, and a sensor that wants a real signal.',
    hint: 'Every metre costs. Cut corners literally.',
    fog: 0.0009,
    weather: 'murk',
    walls: [W(520, 0, 50, 380), W(520, 470, 50, 430),
            W(1020, 0, 50, 300), W(1020, 390, 50, 510)],
    chains: [{
      emitter: E(130, 200, 0, 'white', { intensity: 2.0 }),
      receiver: R(1450, 345, need(0.24)),
      path: [{ x: 400, y: 200 }, { x: 400, y: 425 }, { x: 800, y: 425 }, { x: 800, y: 345 }]
    }],
    par: { objects: 4, bounces: 4 }
  });

  multi({
    id: 'reef-24', chapter: 'reef', name: 'Bleached',
    blurb: 'The coral sensor only responds to blue. Everything else is wasted heat.',
    hint: 'A blue filter costs you most of a white beam. Start bright.',
    fog: 0.0006,
    weather: 'murk',
    chains: [{
      emitter: E(130, 250, 0, 'white', { intensity: 2.2 }),
      receiver: R(1440, 700, { color: 'blue', minIntensity: 0.12 }, { radius: 28 }),
      path: [{ x: 760, y: 250 }, { x: 760, y: 700 }]
    }],
    extraSolution: [{ type: 'filter', x: 1080, y: 700, angle: rad(90),
                      length: 170, color: 'blue' }],
    inventory: [
      { type: 'mirror', count: 2 },
      { type: 'filter', count: 1, preset: { color: 'blue', length: 170 } }
    ],
    par: { objects: 3, bounces: 3 }
  });

  /* --- Level 25: refraction through a water wedge. ------------------------ */
  (function () {
    var wedge = { type: 'glass', x: 820, y: 420, angle: rad(30),
                  w: 300, h: 420, material: 'water', disperse: false };
    var em = E(140, 330, 0, 'cyan', { intensity: 1.4 });
    var out = A.beamEnd([wedge], [em], { depth: 2, inside: false, pick: 'brightest' });

    multi({
      id: 'reef-25', chapter: 'reef', name: 'Through the Thermocline',
      blurb: 'Water bends light too. Less than glass, but enough to matter.',
      hint: 'Water’s index is 1.32. The beam kinks going in, and kinks back coming out.',
      fog: 0.0005,
      weather: 'murk',
      chains: [],
      extraEmitters: [em],
      extraReceivers: [R(out.at(430).x, out.at(430).y, need(0.3), { radius: 30 })],
      extraSolution: [wedge],
      inventory: [{ type: 'glass', count: 1,
                    preset: { w: 300, h: 420, material: 'water', disperse: false } }],
      par: { objects: 1, bounces: 4 }
    });
  })();

  multi({
    id: 'reef-26', chapter: 'reef', name: 'Two Lamps, One Lamp’s Worth',
    blurb: 'Neither source alone is strong enough. Together they might be.',
    hint: 'Two beams landing on one sensor add up.',
    fog: 0.0008,
    weather: 'murk',
    chains: [
      { emitter: E(120, 180, 0, 'white', { intensity: 1.2 }),
        receiver: R(1400, 450, need(0.46), { radius: 34 }),
        path: [{ x: 900, y: 180 }] },
      { emitter: E(120, 720, 0, 'white', { intensity: 1.2 }),
        receiver: R(1400, 450, need(0.46), { radius: 34 }),
        path: [{ x: 900, y: 720 }] }
    ],
    par: { objects: 2, bounces: 2 }
  });

  multi({
    id: 'reef-27', chapter: 'reef', name: 'Budget',
    blurb: 'One mirror. That is the entire allowance.',
    hint: 'There is exactly one placement that works. Look for the reflection of the sensor.',
    fog: 0.0004,
    weather: 'murk',
    zones: [Z(560, 260, 480, 380)],
    walls: [W(300, 0, 46, 360), W(300, 620, 46, 280), W(1260, 0, 46, 300), W(1260, 560, 46, 340)],
    chains: [{
      emitter: E(140, 480, 0, 'white', { intensity: 1.5 }),
      receiver: R(1450, 330, need(0.4)),
      path: [{ x: 800, y: 480 }]
    }],
    par: { objects: 1, bounces: 1 },
    tags: ['budget']
  });

  /* ==========================================================================
   * CHAPTER 5 -- NEON QUARTER
   * One beam becomes many. Splitters divide energy, one-way glass divides by
   * direction, and polarisers divide by something you cannot see at all.
   * ======================================================================= */

  (function () {
    var em = E(140, 450, 0, 'white', { intensity: 2.0 });
    var split = { type: 'splitter', x: 700, y: 450, angle: rad(45), length: 200, ratio: 0.5 };
    var m1 = { type: 'mirror', x: 700, y: 750, length: 140,
               angle: A.aimAngle({ x: 700, y: 450 }, { x: 700, y: 750 }, { x: 1450, y: 750 }) };
    var m2 = { type: 'mirror', x: 1100, y: 450, length: 140,
               angle: A.aimAngle({ x: 700, y: 450 }, { x: 1100, y: 450 }, { x: 1100, y: 130 }) };

    multi({
      id: 'neon-28', chapter: 'neon', name: 'Fork',
      blurb: 'A half-silvered plate does not choose. It does both.',
      hint: 'The splitter sends half onward and half at a right angle. Feed both sensors.',
      chains: [],
      extraEmitters: [em],
      extraReceivers: [R(1450, 750, need(0.5)), R(1100, 130, need(0.5))],
      extraSolution: [split, m1, m2],
      inventory: [
        { type: 'splitter', count: 1, preset: { length: 200, ratio: 0.5 } },
        { type: 'mirror', count: 2, preset: { length: 140 } }
      ],
      par: { objects: 3, bounces: 4 }
    });
  })();

  (function () {
    var oneway = F('oneway', 800, 450, 60, { length: 320, material: 'aluminium' });
    /* The coated face throws the beam down-left at 120 degrees; catch it there. */
    var bounce = { x: 627, y: 750 };
    var m1 = { type: 'mirror', x: bounce.x, y: bounce.y, length: 130,
               angle: A.aimAngle({ x: 800, y: 450 }, bounce, { x: 1420, y: 750 }) };
    var m2 = { type: 'mirror', x: 300, y: 340, length: 130,
               angle: A.aimAngle({ x: 737, y: 340 }, { x: 300, y: 340 }, { x: 300, y: 90 }) };

    multi({
      id: 'neon-29', chapter: 'neon', name: 'One Way',
      blurb: 'Mirrored from the front, clear from behind. Which side you are on decides everything.',
      hint: 'One source bounces off the coated face; the other walks straight through the back.',
      chains: [],
      fixed: [oneway],
      extraEmitters: [
        E(140, 450, 0, 'white', { intensity: 1.4 }),
        E(1460, 340, 180, 'white', { intensity: 1.4 })
      ],
      extraReceivers: [R(1420, 750, need(0.4)), R(300, 90, need(0.4))],
      extraSolution: [m1, m2],
      inventory: [{ type: 'mirror', count: 2, preset: { length: 130 } }],
      par: { objects: 2, bounces: 2 }
    });
  })();

  /* --- Level 30: BOSS. A signal split three ways, all of it wanted. ------- */
  (function () {
    var em = E(140, 450, 0, 'white', { intensity: 2.4 });
    var s1 = { type: 'splitter', x: 620, y: 450, angle: rad(45), length: 200, ratio: 0.5 };
    var s2 = { type: 'splitter', x: 1050, y: 450, angle: rad(135), length: 200, ratio: 0.5 };
    var m1 = { type: 'mirror', x: 1050, y: 160, length: 140,
               angle: A.aimAngle({ x: 1050, y: 450 }, { x: 1050, y: 160 }, { x: 1450, y: 160 }) };

    multi({
      id: 'neon-30', chapter: 'neon', name: 'Signal Tower',
      blurb: 'Three subscribers, one feed. Nobody accepts a dead line.',
      hint: 'Split, then split what is left. Order matters more than position.',
      chains: [],
      extraEmitters: [em],
      extraReceivers: [
        R(620, 850, need(0.6)), R(1450, 450, need(0.3)), R(1450, 160, need(0.28))
      ],
      extraSolution: [s1, s2, m1],
      inventory: [
        { type: 'splitter', count: 2, preset: { length: 200, ratio: 0.5 } },
        { type: 'mirror', count: 1, preset: { length: 140 } }
      ],
      par: { objects: 3, bounces: 5 },
      tags: ['boss']
    });
  })();

  /* --- Level 31: the three-polariser paradox, playable. ------------------- *
   * Two crossed polarisers pass nothing at all. Slide a THIRD between them at
   * 45 degrees and light reappears -- adding a filter makes things brighter.
   * That is not a trick of the engine; it is Malus' law twice over:
   *     0.5 * cos^2(45) * cos^2(45)  =  12.5% of the original.               */
  (function () {
    multi({
      id: 'neon-31', chapter: 'neon', name: 'Crossed',
      blurb: 'Two filters block everything. Adding a third lets light through.',
      hint: 'A polariser does not just block -- it re-aligns whatever survives. Try 45 degrees.',
      chains: [],
      fixed: [
        F('polarizer', 500, 450, 0, { radius: 46 }),
        F('polarizer', 1100, 450, 90, { radius: 46 })
      ],
      zones: [Z(600, 330, 400, 240)],
      extraEmitters: [E(140, 450, 0, 'white', { intensity: 1.2 })],
      extraReceivers: [R(1450, 450, need(0.07), { radius: 30 })],
      extraSolution: [{ type: 'polarizer', x: 800, y: 450, angle: rad(45), radius: 46 }],
      inventory: [{ type: 'polarizer', count: 1, preset: { radius: 46, angle: 0 } }],
      par: { objects: 1, bounces: 4 }
    });
  })();

  multi({
    id: 'neon-32', chapter: 'neon', name: 'Dark Room',
    blurb: 'Light the panel. Do not light the alarm.',
    hint: 'Intercept the beam before it reaches the far wall and it never gets there.',
    chains: [{
      emitter: E(140, 450, 0, 'white', { intensity: 1.4 }),
      receiver: R(700, 820, need(0.6)),
      path: [{ x: 700, y: 450 }]
    }],
    extraReceivers: [
      R(1450, 450, { dark: true, maxIntensity: 0.03 }, { radius: 30, alarm: true })
    ],
    par: { objects: 1, bounces: 1 }
  });

  /* --- Level 33: the split RATIO is the control, not the position. -------- */
  (function () {
    multi({
      id: 'neon-33', chapter: 'neon', name: 'Half and Half',
      blurb: 'The far panel is greedy. The near one burns out if you overfeed it.',
      hint: 'Tap the splitter and slide its green knob. It does not have to be an even split.',
      chains: [],
      extraEmitters: [E(140, 450, 0, 'white', { intensity: 2.2 })],
      extraReceivers: [
        R(1450, 450, need(0.9)),
        R(700, 850, { color: 'any', minIntensity: 0.22, maxIntensity: 0.55 }, { radius: 30 })
      ],
      extraSolution: [{ type: 'splitter', x: 700, y: 450, angle: rad(45),
                        length: 200, ratio: 0.2 }],
      inventory: [{ type: 'splitter', count: 1, preset: { length: 200, ratio: 0.5 } }],
      par: { objects: 1, bounces: 2 }
    });
  })();

  multi({
    id: 'neon-34', chapter: 'neon', name: 'Mixing Desk',
    blurb: 'Neither red nor green will do. The panel wants what they make together.',
    hint: 'Additive light: red plus green is yellow. Land both on the same sensor.',
    chains: [
      { emitter: E(140, 200, 0, 'red', { intensity: 1.3 }),
        receiver: R(1300, 450, { color: 'yellow', minIntensity: 1.3 }, { radius: 36 }),
        path: [{ x: 800, y: 200 }] },
      { emitter: E(140, 700, 0, 'green', { intensity: 1.3 }),
        receiver: R(1300, 450, { color: 'yellow', minIntensity: 1.3 }, { radius: 36 }),
        path: [{ x: 800, y: 700 }] }
    ],
    par: { objects: 2, bounces: 2 }
  });

  /* ==========================================================================
   * CHAPTER 6 -- DEEP SPACE RELAY
   * Portals, gratings, and not enough photons to be careless with.
   * ======================================================================= */

  (function () {
    var m1 = { type: 'mirror', x: 1150, y: 700, length: 140,
               angle: A.aimAngle({ x: 740, y: 700 }, { x: 1150, y: 700 }, { x: 1150, y: 140 }) };
    multi({
      id: 'dsp-35', chapter: 'deepspace', name: 'Wormhole',
      blurb: 'The beam goes in here and comes out there, still travelling the same way.',
      hint: 'A portal preserves direction. Everything after it is ordinary optics.',
      chains: [],
      fixed: [
        F('portal', 700, 300, 0, { id: 'wA', link: 'wB', radius: 36 }),
        F('portal', 700, 700, 0, { id: 'wB', link: 'wA', radius: 36 })
      ],
      extraEmitters: [E(140, 300, 0, 'white', { intensity: 1.4 })],
      extraReceivers: [R(1150, 140, need(0.6))],
      extraSolution: [m1],
      inventory: [{ type: 'mirror', count: 1, preset: { length: 140 } }],
      par: { objects: 1, bounces: 1 }
    });
  })();

  /* --- Level 36: the grating fan. Orders, not a single beam. -------------- */
  (function () {
    var grating = { type: 'grating', x: 800, y: 450, angle: rad(90),
                    length: 300, spacing: 1600, orders: 1 };
    var em = E(140, 450, 0, 'white', { intensity: 2.6 });
    var redUp = A.bandCrossing([grating], [em], 664, 'x', 1440);
    var redN = A.bandCrossing([grating], [em], 540, 'x', 1440);
    var zero = A.energyAt([grating], [em], { x: 1440, y: 450 }, 30);
    var port = bandPort(redUp, redN, 620, 90, 0.03);

    multi({
      id: 'dsp-36', chapter: 'deepspace', name: 'Orders',
      blurb: 'A grating does not bend light once. It bends it once per order.',
      hint: 'Most of the energy carries straight on. The rainbow fans sit either side of it.',
      chains: [],
      extraEmitters: [em],
      extraReceivers: [
        R(1440, 450, demand(zero, 0.7), { radius: 28 }),
        R(port.x, port.y, port.require, { radius: port.radius })
      ],
      extraSolution: [grating],
      inventory: [{ type: 'grating', count: 1,
                    preset: { length: 300, spacing: 1600, orders: 1 } }],
      par: { objects: 1, bounces: 22 }
    });
  })();

  multi({
    id: 'dsp-37', chapter: 'deepspace', name: 'Photon Budget',
    blurb: 'One short mirror. Nothing else is coming.',
    hint: 'With this little light, every extra metre of travel counts against you.',
    fog: 0.0004,
    zones: [Z(500, 250, 420, 420)],
    chains: [{
      emitter: E(140, 300, 0, 'white', { intensity: 0.85 }),
      receiver: R(700, 830, need(0.42)),
      path: [{ x: 700, y: 300, length: 70 }]
    }],
    inventory: [{ type: 'mirror', count: 1, preset: { length: 70 } }],
    par: { objects: 1, bounces: 1 },
    tags: ['budget']
  });

  (function () {
    var m1 = { type: 'mirror', x: 420, y: 200, length: 130,
               angle: A.aimAngle({ x: 140, y: 200 }, { x: 420, y: 200 }, { x: 420, y: 620 }) };
    var m2 = { type: 'mirror', x: 1100, y: 800, length: 130,
               angle: A.aimAngle({ x: 1100, y: 654 }, { x: 1100, y: 800 }, { x: 1450, y: 800 }) };
    multi({
      id: 'dsp-38', chapter: 'deepspace', name: 'Relay Chain',
      blurb: 'Two gates, one signal, and a long way between them.',
      hint: 'Get into the first portal, then work out where its twin spits you out.',
      chains: [],
      fixed: [
        F('portal', 420, 700, 90, { id: 'rA', link: 'rB', radius: 34 }),
        F('portal', 1100, 620, 90, { id: 'rB', link: 'rA', radius: 34 })
      ],
      walls: [W(760, 0, 46, 420), W(760, 520, 46, 380)],
      extraEmitters: [E(140, 200, 0, 'white', { intensity: 1.6 })],
      extraReceivers: [R(1450, 800, need(0.45))],
      extraSolution: [m1, m2],
      inventory: [{ type: 'mirror', count: 2, preset: { length: 130 } }],
      par: { objects: 2, bounces: 2 }
    });
  })();

  /* --- Level 39: a signal too faint to use unless you gather it. ---------- */
  (function () {
    var dish = { type: 'concave', x: 1230, y: 380, angle: rad(70),
                 length: 300, curvature: 0.14, material: 'dielectric' };
    var em = E(130, 380, 0, 'white', { width: 240, rays: 17, intensity: 0.55 });
    var focus = A.focusAfter([dish], [em], 1);
    var probe = A.energyAt([dish], [em], focus, 24);

    multi({
      id: 'dsp-39', chapter: 'deepspace', name: 'Faint Signal',
      blurb: 'Spread across a wide aperture, this beam is worth nothing. Concentrated, it is enough.',
      hint: 'You cannot make more light. You can put all of it in one place.',
      chains: [],
      extraEmitters: [em],
      extraReceivers: [R(focus.x, focus.y, demand(probe, 0.7), { radius: 24 })],
      extraSolution: [dish],
      inventory: [{ type: 'concave', count: 1, preset: { length: 300, curvature: 0.14 } }],
      par: { objects: 1, bounces: 17 }
    });
  })();

  /* --- Level 40: BOSS. Portal, then split, then gather. ------------------- */
  (function () {
    var em = E(140, 250, 0, 'white', { intensity: 2.6 });
    var s1 = { type: 'splitter', x: 1050, y: 650, angle: rad(45), length: 200, ratio: 0.5 };
    var m1 = { type: 'mirror', x: 1050, y: 860, length: 150,
               angle: A.aimAngle({ x: 1050, y: 650 }, { x: 1050, y: 860 }, { x: 1450, y: 860 }) };

    multi({
      id: 'dsp-40', chapter: 'deepspace', name: 'The Array',
      blurb: 'Everything the chapter taught you, in one run.',
      hint: 'Through the gate, then divide what comes out.',
      chains: [],
      fixed: [
        F('portal', 700, 250, 0, { id: 'aA', link: 'aB', radius: 36 }),
        F('portal', 700, 650, 0, { id: 'aB', link: 'aA', radius: 36 })
      ],
      extraEmitters: [em],
      extraReceivers: [R(1450, 650, need(0.5)), R(1450, 860, need(0.5))],
      extraSolution: [s1, m1],
      inventory: [
        { type: 'splitter', count: 1, preset: { length: 200, ratio: 0.5 } },
        { type: 'mirror', count: 1, preset: { length: 150 } }
      ],
      par: { objects: 2, bounces: 3 },
      tags: ['boss']
    });
  })();

  multi({
    id: 'dsp-41', chapter: 'deepspace', name: 'Cold Start',
    blurb: 'Bring the relay back online the long way round.',
    hint: 'Four turns, and the sensor still wants a real signal at the end.',
    fog: 0.00025,
    walls: [W(560, 220, 46, 460), W(1000, 220, 46, 460)],
    chains: [{
      emitter: E(130, 450, 0, 'white', { intensity: 1.8 }),
      receiver: R(1460, 450, need(0.5)),
      path: [{ x: 380, y: 450 }, { x: 380, y: 130 }, { x: 1240, y: 130 }, { x: 1240, y: 450 }]
    }],
    par: { objects: 4, bounces: 4 }
  });

  /* ==========================================================================
   * CHAPTER 7 -- CLOCKWORK TOWER
   * Everything moves. The mirrors you place do not, so you are aiming at where
   * the machinery WILL be. `holdTime` gives each of these a window rather than
   * a single frame, and the tracer is re-run every tick.
   * ======================================================================= */

  multi({
    id: 'clk-42', chapter: 'clockwork', name: 'Turntable',
    blurb: 'That mirror never stops turning. Wait for it.',
    hint: 'Place your mirror for the instant the turntable lines up, not for now.',
    fixed: [
      F('mirror', 800, 600, 0, { length: 190, material: 'gold',
        motion: { type: 'turntable', speed: 0.55 } })
    ],
    chains: [{
      emitter: E(140, 200, 0, 'white', { intensity: 1.8 }),
      receiver: R(320, 600, need(0.25), { radius: 44 }),
      path: [{ x: 800, y: 200 }]
    }],
    par: { objects: 1, bounces: 1 },
    holdTime: 0.2, simWindow: 30
  });

  multi({
    id: 'clk-44', chapter: 'clockwork', name: 'Carriage',
    blurb: 'The mirror rides a rail. Somewhere along it, the angle is right.',
    hint: 'It eases at both ends of the track, so the ends are where it lingers.',
    fixed: [
      F('mirror', 820, 220, 45, { length: 180, material: 'gold',
        motion: { type: 'track', from: { x: 820, y: 220 }, to: { x: 820, y: 640 },
                  period: 5 } })
    ],
    chains: [{
      emitter: E(140, 120, 0, 'white', { intensity: 1.8 }),
      receiver: R(1400, 430, need(0.3), { radius: 46 }),
      path: [{ x: 820, y: 120 }]
    }],
    par: { objects: 1, bounces: 1 },
    holdTime: 0.25, simWindow: 30
  });

  /* --- Level 45: the mirror only moves when the music does. --------------- */
  multi({
    id: 'clk-45', chapter: 'clockwork', name: 'Metronome',
    blurb: 'This one steps on the beat and holds still in between.',
    hint: 'It rests for a whole beat at each angle -- that pause is your window.',
    fixed: [
      F('mirror', 780, 380, 0, { length: 200, material: 'gold',
        motion: { type: 'beat', bpm: 120, stepAngle: rad(6), cycle: 30 } })
    ],
    chains: [{
      emitter: E(140, 120, 0, 'white', { intensity: 1.9 }),
      receiver: R(1360, 700, need(0.22), { radius: 78 }),
      path: [{ x: 780, y: 120 }]
    }],
    par: { objects: 1, bounces: 1 },
    holdTime: 0.35, simWindow: 44, tags: ['rhythm']
  });

  (function () {
    var m1 = { type: 'mirror', x: 400, y: 200, length: 150,
               angle: A.aimAngle({ x: 140, y: 200 }, { x: 400, y: 200 }, { x: 900, y: 520 }) };
    multi({
      id: 'clk-46', chapter: 'clockwork', name: 'Escapement',
      blurb: 'Two moving parts, one alignment, and it will not wait for you.',
      hint: 'Feed the turntable from the right side and the rest is patience.',
      fixed: [
        F('mirror', 900, 520, 0, { length: 200, material: 'gold',
          motion: { type: 'turntable', speed: 0.4 } })
      ],
      chains: [],
      extraEmitters: [E(140, 200, 0, 'white', { intensity: 1.8 })],
      extraReceivers: [R(900, 860, need(0.3), { radius: 40 })],
      extraSolution: [m1],
      inventory: [{ type: 'mirror', count: 1, preset: { length: 150 } }],
      par: { objects: 1, bounces: 2 },
      holdTime: 0.22, simWindow: 40
    });
  })();

  multi({
    id: 'clk-47', chapter: 'clockwork', name: 'Orbit',
    blurb: 'It comes round every few seconds, facing the same way each time.',
    hint: 'The mirror keeps its angle as it orbits. Only its position changes.',
    fixed: [
      F('mirror', 900, 280, 45, { length: 190, material: 'gold',
        motion: { type: 'orbit', center: { x: 900, y: 450 }, radius: 170,
                  speed: 0.7, phase: -Math.PI / 2 } })
    ],
    chains: [{
      emitter: E(140, 150, 0, 'white', { intensity: 1.8 }),
      receiver: R(1440, 280, need(0.28), { radius: 50 }),
      path: [{ x: 900, y: 150 }]
    }],
    par: { objects: 1, bounces: 1 },
    holdTime: 0.2, simWindow: 40
  });

  (function () {
    /* The player's single mirror lifts the beam into the fixed relay line. */
    var m1 = { type: 'mirror', x: 380, y: 780, length: 150,
               angle: A.aimAngle({ x: 140, y: 780 }, { x: 380, y: 780 }, { x: 380, y: 300 }) };
    multi({
      id: 'clk-48', chapter: 'clockwork', name: 'Synchrony',
      blurb: 'Two sensors, and they both have to be lit at the same instant.',
      hint: 'Being right one at a time is not enough here.',
      fixed: [
        F('mirror', 380, 300, 135, { length: 170 }),
        F('splitter', 700, 300, 45, { length: 220, ratio: 0.5 }),
        F('mirror', 1150, 300, 0, { length: 200, material: 'gold',
          motion: { type: 'turntable', speed: 0.32 } })
      ],
      chains: [],
      extraEmitters: [E(140, 780, 0, 'white', { intensity: 2.8 })],
      extraReceivers: [
        R(700, 840, need(0.5), { radius: 36 }),
        R(1150, 830, need(0.2), { radius: 48 })
      ],
      extraSolution: [m1],
      inventory: [{ type: 'mirror', count: 1, preset: { length: 150 } }],
      par: { objects: 1, bounces: 3 },
      holdTime: 0.2, simWindow: 40
    });
  })();

  /* ==========================================================================
   * CHAPTER 8 -- AURORA FIELDS
   * Weather, heat, and the full additive colour model.
   * ======================================================================= */

  multi({
    id: 'aur-49', chapter: 'aurora', name: 'Cold Light',
    blurb: 'The air itself is drinking your beam tonight.',
    hint: 'Short hops. Every metre of fog costs you.',
    fog: 0.0013,
    weather: 'aurora',
    chains: [{
      emitter: E(140, 250, 0, 'white', { intensity: 2.8 }),
      receiver: R(1300, 700, need(0.24)),
      path: [{ x: 800, y: 250 }, { x: 800, y: 700 }]
    }],
    par: { objects: 2, bounces: 2 }
  });

  /* --- Level 50: BOSS. Three primaries into one white sensor. ------------- */
  multi({
    id: 'aur-50', chapter: 'aurora', name: 'The Aurora Gate',
    blurb: 'The gate opens for white light, and white is not a colour you are given.',
    hint: 'Red plus green plus blue. All three, on the same spot, at once.',
    weather: 'aurora',
    chains: [
      { emitter: E(140, 150, 0, 'red', { intensity: 1.5 }),
        receiver: R(1200, 450, { color: 'white', minIntensity: 3.0 }, { radius: 40 }),
        path: [{ x: 760, y: 150 }] },
      { emitter: E(140, 450, 0, 'green', { intensity: 1.5 }),
        receiver: R(1200, 450, { color: 'white', minIntensity: 3.0 }, { radius: 40 }),
        path: [{ x: 620, y: 450 }, { x: 620, y: 620 }] },
      { emitter: E(140, 780, 0, 'blue', { intensity: 1.5 }),
        receiver: R(1200, 450, { color: 'white', minIntensity: 3.0 }, { radius: 40 }),
        path: [{ x: 880, y: 780 }] }
    ],
    par: { objects: 4, bounces: 4 },
    tags: ['boss']
  });

  /* --- Level 51: heat management. The mirror bows when you overfeed it. --- *
   * A thermal mirror absorbs a little of everything that lands on it. Past a
   * threshold the substrate bows, the reflected bundle fans out, and the
   * sensor stops seeing enough. The fix is not aim -- it is throttling.       */
  (function () {
    multi({
      id: 'aur-51', chapter: 'aurora', name: 'Thermal Creep',
      blurb: 'Point everything at that mirror and watch it slowly stop working.',
      hint: 'It is not misaligned. It is too hot. Send it less light.',
      weather: 'aurora',
      fixed: [
        /* Tilted so the return beam leaves along its own path rather than
         * straight back down the incoming one. maxCurve is negative: a
         * front-surface mirror bulges TOWARD the beam as it heats, which
         * spreads the bundle instead of gathering it. */
        F('flex', 1050, 450, 75, { length: 240, curvature: 0, material: 'silver',
          thermal: true,
          motion: { type: 'thermal', rate: 1.6, cool: 1.0,
                    maxCurve: -0.70, threshold: 2.6, heatScale: 1.4, baseCurve: 0 } })
      ],
      chains: [],
      extraEmitters: [E(130, 450, 0, 'white', { width: 180, rays: 13, intensity: 2.6 })],
      extraReceivers: [R(444, 800, need(0.45), { radius: 58 })],
      extraSolution: [{ type: 'splitter', x: 700, y: 450, angle: rad(45),
                        length: 240, ratio: 0.45 }],
      inventory: [{ type: 'splitter', count: 1, preset: { length: 240, ratio: 0.5 } }],
      par: { objects: 1, bounces: 28 },
      holdTime: 4.0, simWindow: 26, tags: ['thermal']
    });
  })();

  multi({
    id: 'aur-52', chapter: 'aurora', name: 'Yellow',
    blurb: 'Two lamps, one colour that neither of them is.',
    hint: 'Red and green arriving together read as yellow. Neither alone will do.',
    weather: 'aurora',
    chains: [
      { emitter: E(140, 180, 0, 'red', { intensity: 1.4 }),
        receiver: R(1250, 620, { color: 'yellow', minIntensity: 1.6 }, { radius: 38 }),
        path: [{ x: 700, y: 180 }, { x: 700, y: 380 }] },
      { emitter: E(140, 820, 0, 'green', { intensity: 1.4 }),
        receiver: R(1250, 620, { color: 'yellow', minIntensity: 1.6 }, { radius: 38 }),
        path: [{ x: 820, y: 820 }] }
    ],
    par: { objects: 3, bounces: 3 }
  });

  multi({
    id: 'aur-53', chapter: 'aurora', name: 'Magenta',
    blurb: 'The one colour with no wavelength of its own.',
    hint: 'There is no magenta in a rainbow. You have to build it from both ends.',
    weather: 'aurora',
    chains: [
      { emitter: E(140, 200, 0, 'red', { intensity: 1.5 }),
        receiver: R(1150, 500, { color: 'magenta', minIntensity: 1.7 }, { radius: 38 }),
        path: [{ x: 640, y: 200 }, { x: 640, y: 320 }] },
      { emitter: E(140, 780, 0, 'blue', { intensity: 1.5 }),
        receiver: R(1150, 500, { color: 'magenta', minIntensity: 1.7 }, { radius: 38 }),
        path: [{ x: 900, y: 780 }] }
    ],
    par: { objects: 3, bounces: 3 }
  });

  (function () {
    var em = E(140, 450, 0, 'white', { intensity: 2.8 });
    var s1 = { type: 'splitter', x: 620, y: 450, angle: rad(45), length: 210, ratio: 0.5 };
    var f1 = { type: 'filter', x: 620, y: 700, angle: rad(0), length: 180, color: 'red' };
    var f2 = { type: 'filter', x: 1000, y: 450, angle: rad(90), length: 180, color: 'cyan' };

    multi({
      id: 'aur-54', chapter: 'aurora', name: 'Complements',
      blurb: 'Split white in two and filter each half into a different half of the spectrum.',
      hint: 'Red and cyan between them cover the whole spectrum. One sensor wants each.',
      weather: 'aurora',
      chains: [],
      extraEmitters: [em],
      extraReceivers: [
        R(620, 850, { color: 'red', minIntensity: 0.35 }, { radius: 30 }),
        R(1440, 450, { color: 'cyan', minIntensity: 0.35 }, { radius: 30 })
      ],
      extraSolution: [s1, f1, f2],
      inventory: [
        { type: 'splitter', count: 1, preset: { length: 210, ratio: 0.5 } },
        { type: 'filter', count: 1, preset: { color: 'red', length: 180 } },
        { type: 'filter', count: 1, preset: { color: 'cyan', length: 180 } }
      ],
      par: { objects: 3, bounces: 4 }
    });
  })();

  /* --- Level 55: the finale. Mix white AND keep one band pure. ------------ */
  multi({
    id: 'aur-55', chapter: 'aurora', name: 'White Out',
    blurb: 'The last gate wants white from three lamps, and a fourth sensor that only takes blue.',
    hint: 'Split the blue lamp: some of it belongs in the mix, the rest goes on alone.',
    weather: 'aurora',
    fixed: [F('splitter', 400, 780, 45, { length: 200, ratio: 0.42 })],
    chains: [
      { emitter: E(140, 160, 0, 'red', { intensity: 1.7 }),
        receiver: R(1150, 460, { color: 'white', minIntensity: 2.4 }, { radius: 42 }),
        path: [{ x: 700, y: 160 }] },
      { emitter: E(140, 460, 0, 'green', { intensity: 1.7 }),
        receiver: R(1150, 460, { color: 'white', minIntensity: 2.4 }, { radius: 42 }),
        path: [{ x: 560, y: 460 }, { x: 560, y: 620 }] }
    ],
    extraEmitters: [E(140, 780, 0, 'blue', { intensity: 2.6 })],
    extraReceivers: [R(400, 870, { color: 'blue', minIntensity: 0.5 }, { radius: 32 })],
    extraSolution: [
      { type: 'mirror', x: 900, y: 780, length: 150,
        angle: A.aimAngle({ x: 400, y: 780 }, { x: 900, y: 780 }, { x: 1150, y: 460 }) }
    ],
    inventory: [{ type: 'mirror', count: 4, preset: { length: 150 } }],
    par: { objects: 4, bounces: 5 },
    tags: ['finale']
  });

  /* ==========================================================================
   * CHAPTER 9 -- OBSIDIAN SPIRE
   * Nothing new to learn; everything already learned, with the slack taken
   * out. Tight bays, alarms beside the obvious route, decoy gates, and ratios
   * that have to be dialled rather than left at half.
   * ======================================================================= */

  function dark(x, y, r) {
    return R(x, y, { dark: true, maxIntensity: 0.03 }, { radius: r || 30, alarm: true });
  }

  multi({
    id: 'spr-56', chapter: 'spire', name: 'Needle’s Eye',
    blurb: 'Three walls, three narrow gaps, six turns. There is one way through.',
    hint: 'Work gap by gap: each pair of mirrors lifts or drops the beam to the next opening.',
    walls: [W(420, 0, 40, 560), W(420, 660, 40, 240),
            W(820, 0, 40, 180), W(820, 280, 40, 620),
            W(1220, 0, 40, 620), W(1220, 720, 40, 180)],
    zones: [Z(200, 100, 190, 600), Z(540, 160, 200, 560), Z(940, 160, 200, 580)],
    chains: [{
      emitter: E(120, 150, 0, 'white', { intensity: 1.3 }),
      receiver: R(1480, 670, need(0.5)),
      path: [{ x: 300, y: 150 }, { x: 300, y: 610 }, { x: 640, y: 610 },
             { x: 640, y: 230 }, { x: 1040, y: 230 }, { x: 1040, y: 670 }]
    }],
    par: { objects: 6, bounces: 6 },
    tags: ['hard']
  });

  multi({
    id: 'spr-57', chapter: 'spire', name: 'Tripwire',
    blurb: 'Four alarms guard the only routes over and under the block. Thread between them.',
    hint: 'The alarms leave a narrow corridor above the block, and another below it.',
    walls: [W(760, 380, 80, 140)],
    zones: [Z(260, 120, 200, 660), Z(1140, 120, 200, 660)],
    chains: [{
      emitter: E(120, 450, 0, 'white', { intensity: 1.4 }),
      receiver: R(1480, 450, need(0.55)),
      path: [{ x: 360, y: 450 }, { x: 360, y: 285 }, { x: 1240, y: 285 }, { x: 1240, y: 450 }]
    }],
    extraReceivers: [dark(800, 230), dark(800, 340), dark(800, 560), dark(800, 670)],
    par: { objects: 4, bounces: 4 },
    tags: ['hard']
  });

  /* --- Level 58: two colours plucked from one rainbow, sent opposite ways. -- */
  (function () {
    var prism = { type: 'prism', x: 700, y: 470, angle: rad(45), radius: 96, material: 'flint' };
    var em = E(160, 530, 0, 'white', { intensity: 3.0 });
    var fanOrigin = A.beamEnd([prism], [em], { depth: 2, pick: 'brightest' }).a;
    var mid = A.bandCrossing([prism], [em], 540, 'y', 150);
    var fold = { type: 'mirror', x: mid.x, y: mid.y, length: 340, locked: true,
                 angle: A.aimAngle(fanOrigin, mid, { x: 1320, y: 840 }) };

    var PICK_Y = 520;
    var redP = A.bandCrossing([prism, fold], [em], 664, 'y', PICK_Y);
    var bluP = A.bandCrossing([prism, fold], [em], 416, 'y', PICK_Y);
    var RED_T = { x: 1480, y: 150 }, BLU_T = { x: 150, y: 820 };
    /* Each colour leaves the fold mirror from a slightly different point, so
     * each relay must be aimed from where ITS OWN band comes from -- aiming
     * both from the fold's centre sends violet wide of its target. */
    function bandFrom(fixed, nm, y) {
      var segs = A.probe(fixed, [em]).result.segments, best = null, bd = Infinity;
      for (var i = 0; i < segs.length; i++) {
        var sg = segs[i];
        if (sg.wl === null || sg.inside) continue;
        var dy = sg.b.y - sg.a.y;
        if (Math.abs(dy) < 1e-9) continue;
        var t = (y - sg.a.y) / dy;
        if (t < 0 || t > 1) continue;
        if (Math.abs(sg.wl - nm) < bd) { bd = Math.abs(sg.wl - nm); best = sg; }
      }
      return best.a;
    }
    var relayR = { type: 'mirror', x: redP.x, y: redP.y, length: 56,
                   angle: A.aimAngle(bandFrom([prism, fold], 664, PICK_Y), redP, RED_T) };
    var relayB = { type: 'mirror', x: bluP.x, y: bluP.y, length: 56,
                   angle: A.aimAngle(bandFrom([prism, fold], 416, PICK_Y), bluP, BLU_T) };
    var all = [prism, fold, relayR, relayB];
    var eR = A.energyAt(all, [em], RED_T, 40);
    var eB = A.energyAt(all, [em], BLU_T, 40);

    multi({
      id: 'spr-58', chapter: 'spire', name: 'Prismatic Relay',
      blurb: 'Take the two ends of one rainbow and send them to opposite corners.',
      hint: 'Disperse, then put one small mirror at each end of the fan. Red leaves last, violet first.',
      chains: [],
      fixed: [fold],
      extraEmitters: [em],
      extraReceivers: [
        R(RED_T.x, RED_T.y, { wavelength: 640, wavelengthTolerance: 45,
                              minIntensity: Math.max(0.02, eR.intensity * 0.7) }, { radius: 40 }),
        R(BLU_T.x, BLU_T.y, { wavelength: 440, wavelengthTolerance: 45,
                              minIntensity: Math.max(0.02, eB.intensity * 0.7) }, { radius: 40 })
      ],
      extraSolution: [prism, relayR, relayB],
      inventory: [
        { type: 'prism', count: 1, preset: { radius: 96, material: 'flint' } },
        { type: 'mirror', count: 2, preset: { length: 56 } }
      ],
      par: { objects: 3, bounces: 40 },
      tags: ['hard']
    });
  })();

  /* --- Level 59: four subscribers, and the first split must be uneven. ----- */
  (function () {
    var em = E(120, 450, 0, 'white', { intensity: 3.0 });
    var tA = { x: 1480, y: 800 }, tB = { x: 1480, y: 110 },
        tC = { x: 1200, y: 865 }, tD = { x: 1480, y: 450 };
    function build(r1) {
      return [
        { type: 'splitter', x: 480, y: 450, angle: rad(45), length: 200, ratio: r1 },
        { type: 'mirror', x: 480, y: 800, length: 140,
          angle: A.aimAngle({ x: 480, y: 450 }, { x: 480, y: 800 }, tA) },
        { type: 'splitter', x: 860, y: 450, angle: rad(135), length: 200, ratio: 0.5 },
        { type: 'mirror', x: 860, y: 110, length: 140,
          angle: A.aimAngle({ x: 860, y: 450 }, { x: 860, y: 110 }, tB) },
        { type: 'splitter', x: 1200, y: 450, angle: rad(45), length: 200, ratio: 0.5 }
      ];
    }
    var sol = build(0.62), even = build(0.5);
    var eA = A.energyAt(sol, [em], tA, 30).intensity;
    var eAeven = A.energyAt(even, [em], tA, 30).intensity;
    var eB = A.energyAt(sol, [em], tB, 30).intensity;
    var eC = A.energyAt(sol, [em], tC, 30).intensity;
    var eD = A.energyAt(sol, [em], tD, 30).intensity;

    multi({
      id: 'spr-59', chapter: 'spire', name: 'Split Decision',
      blurb: 'Four sensors on one lamp. The first one is hungrier than an even split can feed.',
      hint: 'Lean the first splitter towards reflecting -- but not so far that the far end goes dark.',
      chains: [],
      extraEmitters: [em],
      extraReceivers: [
        /* Halfway between what an even split delivers and what the tuned
         * split delivers: an even split is guaranteed to fall short. */
        R(tA.x, tA.y, need(Math.round((eA + eAeven) * 500) / 1000), { radius: 30 }),
        R(tB.x, tB.y, need(Math.round(eB * 700) / 1000), { radius: 30 }),
        R(tC.x, tC.y, need(Math.round(eC * 750) / 1000), { radius: 30 }),
        R(tD.x, tD.y, need(Math.round(eD * 750) / 1000), { radius: 30 })
      ],
      extraSolution: sol,
      inventory: [
        { type: 'splitter', count: 3, preset: { length: 200, ratio: 0.5 } },
        { type: 'mirror', count: 2, preset: { length: 140 } }
      ],
      par: { objects: 5, bounces: 8 },
      tags: ['hard']
    });
  })();

  /* --- Level 60: BOSS. Three lamps, two gates, one alarm. ------------------- */
  multi({
    id: 'spr-60', chapter: 'spire', name: 'The Obsidian Engine',
    blurb: 'One gate wants yellow, one wants pure blue, and the alarm wants nothing at all.',
    hint: 'Red and green meet on the yellow gate. The white lamp must be filtered and turned before it reaches the alarm.',
    walls: [W(700, 120, 40, 220)],
    chains: [
      { emitter: E(120, 140, 0, 'red', { intensity: 1.6 }),
        receiver: R(1200, 680, { color: 'yellow', minIntensity: 2.0 }, { radius: 40 }),
        path: [{ x: 420, y: 140 }, { x: 420, y: 380 }] },
      { emitter: E(120, 780, 0, 'green', { intensity: 1.6 }),
        receiver: R(1200, 680, { color: 'yellow', minIntensity: 2.0 }, { radius: 40 }),
        path: [{ x: 700, y: 780 }] },
      { emitter: E(1000, 40, 90, 'white', { intensity: 2.4 }),
        receiver: R(1480, 260, { color: 'blue', minIntensity: 0.2 }, { radius: 34 }),
        path: [{ x: 1000, y: 260 }] }
    ],
    extraReceivers: [dark(1000, 480)],
    extraSolution: [{ type: 'filter', x: 1000, y: 170, angle: 0, length: 160, color: 'blue' }],
    inventory: [
      { type: 'mirror', count: 4 },
      { type: 'filter', count: 1, preset: { color: 'blue', length: 160 } }
    ],
    par: { objects: 5, bounces: 5 },
    tags: ['boss']
  });

  /* --- Level 61: gates between sealed rooms, and one of them is a trap. ----- */
  (function () {
    var m0 = { type: 'mirror', x: 400, y: 700, length: 120,
               angle: A.aimAngle({ x: 120, y: 700 }, { x: 400, y: 700 }, { x: 400, y: 200 }) };
    var m1 = { type: 'mirror', x: 640, y: 450, length: 120,
               angle: A.aimAngle({ x: 640, y: 764 }, { x: 640, y: 450 }, { x: 900, y: 450 }) };
    var m2 = { type: 'mirror', x: 1400, y: 150, length: 120,
               angle: A.aimAngle({ x: 1234, y: 150 }, { x: 1400, y: 150 }, { x: 1400, y: 800 }) };
    multi({
      id: 'spr-61', chapter: 'spire', name: 'Portal Maze',
      blurb: 'Sealed walls split the room in three. Only the gates connect them — and one gate is a trap.',
      hint: 'A gate keeps the beam travelling the same way. Work out where each twin lets it out first.',
      walls: [W(520, 0, 40, 900), W(1060, 0, 40, 900)],
      fixed: [
        F('portal', 400, 200, 0, { id: 'mA', link: 'mB', radius: 34 }),
        F('portal', 640, 800, 0, { id: 'mB', link: 'mA', radius: 34 }),
        F('portal', 900, 450, 0, { id: 'mC', link: 'mD', radius: 34 }),
        F('portal', 1200, 150, 0, { id: 'mD', link: 'mC', radius: 34 }),
        F('portal', 900, 780, 0, { id: 'tX', link: 'tY', radius: 30 }),
        F('portal', 250, 450, 0, { id: 'tY', link: 'tX', radius: 30 })
      ],
      chains: [],
      extraEmitters: [E(120, 700, 0, 'white', { intensity: 1.6 })],
      extraReceivers: [R(1400, 800, need(0.6))],
      extraSolution: [m0, m1, m2],
      inventory: [{ type: 'mirror', count: 3 }],
      par: { objects: 3, bounces: 3 },
      tags: ['hard']
    });
  })();

  /* --- Level 62: feed a turntable, then wait for the slot. ----------------- */
  (function () {
    var m1 = { type: 'mirror', x: 420, y: 60, length: 120,
               angle: A.aimAngle({ x: 120, y: 60 }, { x: 420, y: 60 }, { x: 420, y: 620 }) };
    var m2 = { type: 'mirror', x: 420, y: 620, length: 120,
               angle: A.aimAngle({ x: 420, y: 60 }, { x: 420, y: 620 }, { x: 900, y: 620 }) };
    multi({
      id: 'spr-62', chapter: 'spire', name: 'Moving Target',
      blurb: 'A turntable sweeps the beam past a slot in the wall. Get the light onto the table first.',
      hint: 'Two mirrors bring the light down and across. After that it is a matter of waiting for the slot.',
      walls: [W(700, 300, 160, 40), W(940, 300, 160, 40)],
      fixed: [F('mirror', 900, 620, 0, { length: 190, material: 'gold',
                motion: { type: 'turntable', speed: 0.3 } })],
      chains: [],
      extraEmitters: [E(120, 60, 0, 'white', { intensity: 2.0 })],
      extraReceivers: [R(900, 160, need(0.3), { radius: 42 })],
      extraSolution: [m1, m2],
      inventory: [{ type: 'mirror', count: 2 }],
      par: { objects: 2, bounces: 2 },
      holdTime: 0.2, simWindow: 30,
      tags: ['hard']
    });
  })();

  /* --- Level 63: BOSS. Split, filter, disperse and fold -- guarded both ways. */
  (function () {
    var em = E(120, 560, 0, 'white', { intensity: 3.2 });
    var split = { type: 'splitter', x: 380, y: 560, angle: rad(135), length: 200, ratio: 0.5 };
    var up = { type: 'mirror', x: 380, y: 300, length: 130,
               angle: A.aimAngle({ x: 380, y: 560 }, { x: 380, y: 300 }, { x: 1480, y: 300 }) };
    var filt = { type: 'filter', x: 900, y: 300, angle: rad(90), length: 170, color: 'red' };
    var prism = { type: 'prism', x: 1000, y: 500, angle: rad(45), radius: 92, material: 'flint' };
    var base = [split, up, filt, prism];

    var segs = A.probe(base, [em]).result.segments;
    var fanOrigin = null;
    for (var i = 0; i < segs.length; i++) {
      if (segs[i].wl !== null && !segs[i].inside && segs[i].via !== 'fresnel' && segs[i].depth >= 3) {
        fanOrigin = segs[i].a; break;
      }
    }
    var mid = A.bandCrossing(base, [em], 540, 'y', 120);
    var fold = { type: 'mirror', x: mid.x, y: mid.y, length: 320, locked: true,
                 angle: A.aimAngle(fanOrigin, mid, { x: 1400, y: 880 }) };
    var withFold = base.concat([fold]);

    var PORT_Y = 800;
    var vP = A.bandCrossing(withFold, [em], 416, 'y', PORT_Y);
    var vN = A.bandCrossing(withFold, [em], 478, 'y', PORT_Y);
    var rP = A.bandCrossing(withFold, [em], 664, 'y', PORT_Y);
    var rN = A.bandCrossing(withFold, [em], 602, 'y', PORT_Y);
    var vPort = bandPort(vP, vN, 440, 50);
    var rPort = bandPort(rP, rN, 640, 50);
    var eV = A.energyAt(withFold, [em], vP, vPort.radius).intensity;
    var eRp = A.energyAt(withFold, [em], rP, rPort.radius).intensity;
    var eRed = A.energyAt(withFold, [em], { x: 1480, y: 300 }, 32).intensity;
    vPort.require.minIntensity = Math.max(0.02, Math.round(eV * 700) / 1000);
    rPort.require.minIntensity = Math.max(0.02, Math.round(eRp * 700) / 1000);

    multi({
      id: 'spr-63', chapter: 'spire', name: 'Crown of the Spire',
      blurb: 'One lamp feeds three locks: a red gate, and both ends of a rainbow. Two alarms watch the lazy routes.',
      hint: 'Split first. One arm is filtered red; the other goes through the prism and onto the fold.',
      chains: [],
      fixed: [fold],
      extraEmitters: [em],
      extraReceivers: [
        R(1480, 300, { color: 'red', minIntensity: Math.max(0.05, Math.round(eRed * 700) / 1000) },
          { radius: 32 }),
        R(vP.x, vP.y, vPort.require, { radius: vPort.radius }),
        R(rP.x, rP.y, rPort.require, { radius: rPort.radius }),
        dark(1540, 560, 28),
        dark(380, 110, 28)
      ],
      extraSolution: base,
      inventory: [
        { type: 'splitter', count: 1, preset: { length: 200, ratio: 0.5 } },
        { type: 'mirror', count: 1, preset: { length: 130 } },
        { type: 'filter', count: 1, preset: { color: 'red', length: 170 } },
        { type: 'prism', count: 1, preset: { radius: 92, material: 'flint' } }
      ],
      par: { objects: 4, bounces: 40 },
      tags: ['boss']
    });
  })();

  /* ==========================================================================
   * CHAPTER 10 -- EVENT HORIZON
   * The last chapter. Each level turns on a piece of optics that only works
   * if you understand WHY it works: focusing through a relay, Malus in small
   * steps, diffraction orders, synchronised motion, and a power budget.
   * ======================================================================= */

  /* --- Level 64: gather faint light, but not where it naturally focuses. --- */
  (function () {
    var em = E(130, 300, 0, 'white', { width: 200, rays: 15, intensity: 0.9 });
    var dish = { type: 'concave', x: 1220, y: 300, angle: rad(68), length: 260,
                 curvature: 0.16, material: 'silver' };
    var f1 = A.focusAfter([dish], [em], 1);
    var relayPt = { x: Math.round(dish.x + (f1.x - dish.x) * 0.55),
                    y: Math.round(dish.y + (f1.y - dish.y) * 0.55) };
    var target = { x: 1450, y: 820 };
    var relay = { type: 'mirror', x: relayPt.x, y: relayPt.y, length: 220,
                  angle: A.aimAngle({ x: dish.x, y: dish.y }, relayPt, target) };
    var f2 = A.focusAfter([dish, relay], [em], 2);
    var probe = A.energyAt([dish, relay], [em], f2, 24);

    multi({
      id: 'hzn-64', chapter: 'horizon', name: 'Gravity Well',
      blurb: 'A faint lamp, a dish to gather it, and an alarm sitting exactly where the dish focuses.',
      hint: 'Catch the converging cone with a flat mirror before it reaches its focus. It keeps converging after the turn.',
      chains: [],
      extraEmitters: [em],
      extraReceivers: [
        R(f2.x, f2.y, demand(probe, 0.7), { radius: 24 }),
        R(f1.x, f1.y, { dark: true, maxIntensity: 0.05 }, { radius: 26, alarm: true })
      ],
      extraSolution: [dish, relay],
      inventory: [
        { type: 'concave', count: 1, preset: { length: 260, curvature: 0.16 } },
        { type: 'mirror', count: 1, preset: { length: 220 } }
      ],
      par: { objects: 2, bounces: 30 },
      tags: ['hard']
    });
  })();

  /* --- Level 65: Malus in small steps. ------------------------------------- */
  (function () {
    var em = E(120, 450, 0, 'white', { intensity: 1.2 });
    var fixedP = [F('polarizer', 400, 450, 0, { radius: 46 }),
                  F('polarizer', 1200, 450, 90, { radius: 46 })];
    var target = { x: 1480, y: 450 };
    var two = fixedP.concat([
      { type: 'polarizer', x: 680, y: 450, angle: rad(30), radius: 46 },
      { type: 'polarizer', x: 920, y: 450, angle: rad(60), radius: 46 }
    ]);
    var one = fixedP.concat([{ type: 'polarizer', x: 800, y: 450, angle: rad(45), radius: 46 }]);
    var eTwo = A.energyAt(two, [em], target, 30).intensity;
    var eOne = A.energyAt(one, [em], target, 30).intensity;

    multi({
      id: 'hzn-65', chapter: 'horizon', name: 'Polar Lock',
      blurb: 'Crossed filters again — but one filter in between no longer lets enough through.',
      hint: 'Light survives a big turn best in small steps. Two filters, evenly spaced, lose far less than one.',
      chains: [],
      fixed: fixedP,
      zones: [Z(500, 330, 600, 240)],
      extraEmitters: [em],
      extraReceivers: [
        /* Between the best single-filter result and the best two-filter
         * result: one filter at any angle is physically unable to pass. */
        R(target.x, target.y, { color: 'any', minIntensity: Math.round((eTwo + eOne) * 500) / 1000,
                                polarization: Math.PI / 2 }, { radius: 30 })
      ],
      extraSolution: two.slice(2),
      inventory: [{ type: 'polarizer', count: 2, preset: { radius: 46, angle: 0 } }],
      par: { objects: 2, bounces: 4 },
      tags: ['hard']
    });
  })();

  /* --- Level 66: a long route with no light to spare. ---------------------- */
  (function () {
    var spec = {
      id: 'hzn-66', chapter: 'horizon', name: 'Lightspeed',
      blurb: 'Six turns through thick air. There is exactly enough light for the shortest route.',
      hint: 'A detour costs a bounce and distance. Neither is affordable here.',
      fog: 0.0006,
      weather: 'murk',
      walls: [W(520, 260, 50, 640), W(980, 0, 50, 560)],
      zones: [Z(200, 60, 200, 820), Z(660, 60, 200, 720), Z(1120, 100, 200, 680)],
      chains: [{
        emitter: E(120, 820, 0, 'white', { intensity: 5.0 }),
        receiver: R(1480, 160, need(0.01)),
        path: [{ x: 300, y: 820 }, { x: 300, y: 120 }, { x: 760, y: 120 },
               { x: 760, y: 700 }, { x: 1220, y: 700 }, { x: 1220, y: 160 }]
      }],
      par: { objects: 6, bounces: 6 },
      tags: ['hard']
    };
    var lvl = multi(spec);
    /* Measure the reference route, then demand 85% of it. */
    var sc = LP.Scene.fromLevel(lvl);
    LP.Scene.applySolution(sc);
    var got = LP.Scene.evaluate(sc).receivers[0].intensity;
    lvl.receivers[0].require.minIntensity = Math.round(got * 850) / 1000;
  })();

  /* --- Level 67: one plate, two diffraction orders, two corners. ----------- */
  (function () {
    var grating = F('grating', 800, 450, 90, { length: 300, spacing: 1600, orders: 1 });
    var em = E(140, 450, 0, 'white', { intensity: 4.0 });
    var X = 1250;
    var redUp = A.bandCrossing([grating], [em], 664, 'x', X, 'grating1');
    var bluDn = A.bandCrossing([grating], [em], 416, 'x', X, 'grating-1');
    var UP_T = { x: 300, y: 110 }, DN_T = { x: 300, y: 790 };
    var relayU = { type: 'mirror', x: redUp.x, y: redUp.y, length: 60,
                   angle: A.aimAngle({ x: 800, y: 450 }, redUp, UP_T) };
    var relayD = { type: 'mirror', x: bluDn.x, y: bluDn.y, length: 60,
                   angle: A.aimAngle({ x: 800, y: 450 }, bluDn, DN_T) };
    var all = [grating, relayU, relayD];
    var eU = A.energyAt(all, [em], UP_T, 40).intensity;
    var eD = A.energyAt(all, [em], DN_T, 40).intensity;

    multi({
      id: 'hzn-67', chapter: 'horizon', name: 'Spectral Weave',
      blurb: 'The grating throws a rainbow up and another down. The red of one and the violet of the other go home.',
      hint: 'The upper and lower fans are mirror images: red is the outer edge of both.',
      chains: [],
      fixed: [grating],
      extraEmitters: [em],
      extraReceivers: [
        R(UP_T.x, UP_T.y, { wavelength: 630, wavelengthTolerance: 55,
                            minIntensity: Math.max(0.02, Math.round(eU * 700) / 1000) }, { radius: 40 }),
        R(DN_T.x, DN_T.y, { wavelength: 450, wavelengthTolerance: 55,
                            minIntensity: Math.max(0.02, Math.round(eD * 700) / 1000) }, { radius: 40 })
      ],
      extraSolution: [relayU, relayD],
      inventory: [{ type: 'mirror', count: 2, preset: { length: 60 } }],
      par: { objects: 2, bounces: 6 },
      tags: ['hard']
    });
  })();

  /* --- Level 68: two turntables, two targets, one instant. ----------------- */
  (function () {
    var V = LP.V;
    var SPEED = 0.3, TSTAR = 5.0;
    var T1 = { x: 780, y: 700 }, T2 = { x: 1180, y: 450 };
    var TGT1 = { x: 560, y: 820 }, TGT2 = { x: 1450, y: 160 };
    /* Solve each mounting angle so both reflections land at the SAME moment. */
    var a1 = A.aimAngle({ x: 780, y: 600 }, T1, TGT1) - SPEED * TSTAR;
    var a2 = A.aimAngle({ x: 1080, y: 450 }, T2, TGT2) - SPEED * TSTAR;
    var m1 = { type: 'mirror', x: 420, y: 800, length: 130,
               angle: A.aimAngle({ x: 120, y: 800 }, { x: 420, y: 800 }, { x: 420, y: 450 }) };
    var m2 = { type: 'mirror', x: 420, y: 450, length: 130,
               angle: A.aimAngle({ x: 420, y: 800 }, { x: 420, y: 450 }, { x: 780, y: 450 }) };
    void V;

    multi({
      id: 'hzn-68', chapter: 'horizon', name: 'Clockwork Singularity',
      blurb: 'Two turntables, two targets, and they only agree for a moment every ten seconds.',
      hint: 'You cannot change the machinery. Deliver the light and let the two tables come into line together.',
      fixed: [
        F('splitter', 780, 450, 45, { length: 220, ratio: 0.5 }),
        F('mirror', T1.x, T1.y, M.deg(a1), { length: 190, material: 'gold',
          motion: { type: 'turntable', speed: SPEED, baseAngle: a1 } }),
        F('mirror', T2.x, T2.y, M.deg(a2), { length: 190, material: 'gold',
          motion: { type: 'turntable', speed: SPEED, baseAngle: a2 } })
      ],
      chains: [],
      extraEmitters: [E(120, 800, 0, 'white', { intensity: 3.0 })],
      extraReceivers: [R(TGT1.x, TGT1.y, need(0.2), { radius: 48 }),
                       R(TGT2.x, TGT2.y, need(0.2), { radius: 48 })],
      extraSolution: [m1, m2],
      inventory: [{ type: 'mirror', count: 2, preset: { length: 130 } }],
      par: { objects: 2, bounces: 4 },
      holdTime: 0.25, simWindow: 30,
      tags: ['hard']
    });
  })();

  /* --- Level 69: a power budget with two customers. ------------------------ */
  multi({
    id: 'hzn-69', chapter: 'horizon', name: 'Thermal Runaway',
    blurb: 'The hot mirror needs less light. The far sensor needs more. Both come from one lamp.',
    hint: 'Set the splitter so the thermal mirror stays under its limit while the other arm still has enough.',
    fixed: [
      F('flex', 1050, 450, 75, { length: 240, curvature: 0, material: 'silver', thermal: true,
        motion: { type: 'thermal', rate: 1.6, cool: 1.0, maxCurve: -0.70,
                  threshold: 2.6, heatScale: 1.4, baseCurve: 0 } })
    ],
    chains: [],
    extraEmitters: [E(130, 450, 0, 'white', { width: 180, rays: 13, intensity: 2.6 })],
    extraReceivers: [R(444, 800, need(0.45), { radius: 58 }),
                     /* Wide enough to take the whole 180-unit bundle, so the
                      * reading depends on the split ratio -- not on whether
                      * one edge ray happens to graze the rim. */
                     R(1400, 140, need(0.7), { radius: 95 })],
    extraSolution: [
      { type: 'splitter', x: 700, y: 450, angle: rad(135), length: 240, ratio: 0.45 },
      { type: 'mirror', x: 700, y: 140, length: 270,
        angle: A.aimAngle({ x: 700, y: 450 }, { x: 700, y: 140 }, { x: 1400, y: 140 }) }
    ],
    inventory: [
      { type: 'splitter', count: 1, preset: { length: 240, ratio: 0.2 } },
      { type: 'mirror', count: 1, preset: { length: 270 } }
    ],
    par: { objects: 2, bounces: 40 },
    holdTime: 4.0, simWindow: 26,
    tags: ['hard', 'thermal']
  });

  /* --- Level 70: BOSS. White in, three pure colours out. ------------------- */
  multi({
    id: 'hzn-70', chapter: 'horizon', name: 'Accretion Disk',
    blurb: 'White light in, three pure colours out — and an alarm under the green line.',
    hint: 'Split twice and give each arm its own filter. The green arm needs one more turn, or it runs into the alarm.',
    walls: [W(1180, 540, 60, 360), W(300, 0, 60, 300)],
    chains: [],
    extraEmitters: [E(140, 450, 0, 'white', { intensity: 2.8 })],
    extraReceivers: [
      R(980, 820, { color: 'green', minIntensity: 0.3 }, { radius: 30 }),
      R(1050, 70, { color: 'blue', minIntensity: 0.16 }, { radius: 30 }),
      R(1480, 450, { color: 'red', minIntensity: 0.14 }, { radius: 30 }),
      dark(620, 880, 22)
    ],
    extraSolution: [
      { type: 'splitter', x: 620, y: 450, angle: rad(45), length: 200, ratio: 0.5 },
      { type: 'splitter', x: 1050, y: 450, angle: rad(135), length: 200, ratio: 0.5 },
      { type: 'filter', x: 620, y: 650, angle: 0, length: 170, color: 'green' },
      { type: 'filter', x: 1050, y: 250, angle: 0, length: 170, color: 'blue' },
      { type: 'filter', x: 1300, y: 450, angle: rad(90), length: 170, color: 'red' },
      { type: 'mirror', x: 620, y: 820, length: 140,
        angle: A.aimAngle({ x: 620, y: 650 }, { x: 620, y: 820 }, { x: 980, y: 820 }) }
    ],
    inventory: [
      { type: 'splitter', count: 2, preset: { length: 200, ratio: 0.5 } },
      { type: 'filter', count: 1, preset: { color: 'green', length: 170 } },
      { type: 'filter', count: 1, preset: { color: 'blue', length: 170 } },
      { type: 'filter', count: 1, preset: { color: 'red', length: 170 } },
      { type: 'mirror', count: 1, preset: { length: 140 } }
    ],
    par: { objects: 6, bounces: 8 },
    tags: ['boss']
  });

  /* --- Level 71: FINAL BOSS. Three primaries through one gate, into white. -- */
  (function () {
    var V = LP.V;
    var P1 = { x: 650, y: 450 }, P2 = { x: 960, y: 450 };
    var W_T = { x: 1350, y: 450 };
    var dR = V.norm({ x: P1.x - 420, y: P1.y - 140 });
    var dB = V.norm({ x: P1.x - 420, y: P1.y - 760 });
    var mr1 = { type: 'mirror', x: 420, y: 140, length: 120,
                angle: A.aimAngle({ x: 120, y: 140 }, { x: 420, y: 140 }, P1) };
    var mb1 = { type: 'mirror', x: 420, y: 760, length: 120,
                angle: A.aimAngle({ x: 120, y: 760 }, { x: 420, y: 760 }, P1) };
    var mr2p = { x: Math.round(P2.x + dR.x * 220), y: Math.round(P2.y + dR.y * 220) };
    var mb2p = { x: Math.round(P2.x + dB.x * 220), y: Math.round(P2.y + dB.y * 220) };
    var mr2 = { type: 'mirror', x: mr2p.x, y: mr2p.y, length: 120, angle: A.aimAngle(P2, mr2p, W_T) };
    var mb2 = { type: 'mirror', x: mb2p.x, y: mb2p.y, length: 120, angle: A.aimAngle(P2, mb2p, W_T) };
    var alarmR = { x: Math.round(P2.x + dR.x * 430), y: Math.round(P2.y + dR.y * 430) };
    var alarmB = { x: Math.round(P2.x + dB.x * 430), y: Math.round(P2.y + dB.y * 430) };

    var spec = {
      id: 'hzn-71', chapter: 'horizon', name: 'Event Horizon',
      blurb: 'Red, green and blue on one side of a sealed wall. White on the other. One gate between.',
      hint: 'Aim every lamp at the centre of the near gate; each comes out of the far gate on the same line. Then turn each onto the target.',
      walls: [W(780, 0, 50, 900)],
      fixed: [
        F('portal', P1.x, P1.y, 0, { id: 'hA', link: 'hB', radius: 36 }),
        F('portal', P2.x, P2.y, 0, { id: 'hB', link: 'hA', radius: 36 })
      ],
      zones: [Z(300, 60, 420, 780), Z(1000, 120, 240, 660)],
      chains: [],
      extraEmitters: [
        /* Green reaches the gate with no mirrors and a shorter route, so it
         * starts dimmer: the three must ARRIVE balanced to mix to white. */
        E(120, 140, 0, 'red', { intensity: 1.6 }),
        E(120, 450, 0, 'green', { intensity: 1.25 }),
        E(120, 760, 0, 'blue', { intensity: 1.6 })
      ],
      extraReceivers: [
        R(W_T.x, W_T.y, { color: 'white', minIntensity: 0.01 }, { radius: 44 }),
        dark(alarmR.x, alarmR.y, 26),
        dark(alarmB.x, alarmB.y, 26)
      ],
      extraSolution: [mr1, mb1, mr2, mb2],
      inventory: [{ type: 'mirror', count: 4 }],
      par: { objects: 4, bounces: 4 },
      tags: ['boss']
    };
    var lvl = multi(spec);
    /* Demand more than any two of the three beams can deliver together. */
    var sc = LP.Scene.fromLevel(lvl);
    LP.Scene.applySolution(sc);
    var total = LP.Scene.evaluate(sc).receivers[0].intensity;
    lvl.receivers[0].require.minIntensity = Math.round(total * 820) / 1000;
  })();

  /* ==========================================================================
   * HELPERS FOR THE LAST THREE CHAPTERS
   * ======================================================================= */

  /** Hardware that belongs to a phase of a timed level: installed as phase `n` begins. */
  function inPhase(n, def) { def.phase = n; return def; }

  /** Hardware a timed level takes away as phase `n` begins. */
  function untilPhase(n, def) { def.until = n; return def; }

  /** A wall that rises for phase `from`, and optionally sinks again for `until`. */
  function Wp(x, y, w, h, from, until) {
    var wl = W(x, y, w, h);
    if (from) wl.phase = from;
    if (until) wl.until = until;
    return wl;
  }

  /** A placement at `at`, angled to turn light arriving from `from` towards `to`. */
  function aim(type, at, from, to, extra) {
    var p = { type: type, x: at.x, y: at.y, angle: A.aimAngle(from, at, to) };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) p[k] = extra[k];
    return p;
  }

  /** Move an already-placed piece (the k-th placed) to turn light from `from` towards `to`. */
  function reaim(k, at, from, to) {
    return { move: k, x: at.x, y: at.y, angle: A.aimAngle(from, at, to) };
  }

  /**
   * A level played against the clock in phases (see src/engine/phases.js).
   * Lamps, sensors, walls and fixtures carry `phase` / `until`; each phase
   * lists its clock, its goals, any new pieces, and the reference moves the
   * verifier replays to prove the phase can be cleared in time.
   */
  function timed(spec) {
    return multi({
      id: spec.id, chapter: spec.chapter || 'zerohour', name: spec.name,
      blurb: spec.blurb, hint: spec.hint,
      fog: spec.fog, weather: spec.weather,
      walls: spec.walls, zones: spec.zones, fixed: spec.fixed,
      chains: [],
      extraEmitters: spec.emitters,
      extraReceivers: spec.receivers,
      extraSolution: [],
      inventory: spec.inventory || [],
      phases: spec.phases,
      par: { objects: LP.Phases.allPlacements(spec).length, bounces: 99 },
      holdTime: spec.holdTime,
      tags: ['timed'].concat(spec.tags || [])
    });
  }

  /* ==========================================================================
   * CHAPTER 11 -- HALL OF MIRAGES
   * Levels built to look far harder than they are. Every table is crowded:
   * mirrors bolted down at every angle, sensors by the dozen, machinery that
   * never stops, alarms everywhere. Almost all of it is set dressing -- or is
   * already doing the work for you. Each level has a short answer that only
   * appears once you stop looking at the clutter and follow the light.
   * ======================================================================= */

  /** Fixed mirrors that carry a beam along `pts`, from `from` to `to`. */
  function relay(from, pts, to, extra) {
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var prev = i === 0 ? from : pts[i - 1];
      var next = i === pts.length - 1 ? to : pts[i + 1];
      var e = { length: 120, material: 'silver' };
      if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) e[k] = extra[k];
      out.push(F('mirror', pts[i].x, pts[i].y, M.deg(A.aimAngle(prev, pts[i], next)), e));
    }
    return out;
  }

  /* --- Level 72: sixteen mirrors, and one of them is yours. ---------------- */
  (function () {
    var L = { x: 120, y: 820 }, S0 = { x: 1480, y: 110 };
    var P0 = { x: 300, y: 820 };
    var path = [{ x: 300, y: 520 }, { x: 760, y: 520 }, { x: 760, y: 200 }, { x: 1180, y: 200 },
                { x: 1180, y: 640 }, { x: 1480, y: 640 }];
    multi({
      id: 'mir-72', chapter: 'mirage', name: 'Hall of Mirrors',
      blurb: 'Sixteen mirrors bolted to the bench, five alarms, one sensor. You get a single mirror.',
      hint: 'Six of the bolted mirrors already make a road. Find where it starts.',
      fixed: relay(P0, path, S0).concat([
        /* Set dressing: every one of these leads somewhere that is not the sensor. */
        F('mirror', 560, 820, -45, { length: 120 }),
        F('mirror', 980, 820, 45, { length: 120 }),
        F('mirror', 520, 330, 30, { length: 110 }),
        F('mirror', 980, 420, -60, { length: 110 }),
        F('mirror', 1360, 360, 20, { length: 110 }),
        F('mirror', 420, 150, 70, { length: 110 }),
        F('mirror', 1400, 820, -30, { length: 110 }),
        F('mirror', 900, 700, 15, { length: 100 }),
        F('mirror', 180, 330, -75, { length: 100 }),
        F('mirror', 1060, 90, -20, { length: 100 })
      ]),
      chains: [],
      zones: [Z(200, 700, 200, 180), Z(820, 600, 220, 200), Z(1240, 420, 180, 160), Z(360, 380, 220, 110)],
      extraEmitters: [E(L.x, L.y, 0, 'white', { intensity: 2.4 })],
      extraReceivers: [
        R(S0.x, S0.y, need(0.5)),
        dark(560, 660), dark(980, 600), dark(1360, 820), dark(600, 90), dark(180, 560)
      ],
      extraSolution: [aim('mirror', P0, L, path[0], { length: 140 })],
      inventory: [{ type: 'mirror', count: 1, preset: { length: 140 } }],
      par: { objects: 1, bounces: 7 },
      tags: ['mirage']
    });
  })();

  /* --- Level 73: twelve locks on one lamp. ---------------------------------- */
  (function () {
    var L = { x: 120, y: 860 };
    var taps = [460, 620, 780, 940, 1100, 1260];
    var fixed = [
      /* Root: split the bus in two. */
      F('splitter', 300, 450, M.deg(A.aimAngle({ x: 120, y: 450 }, { x: 300, y: 450 }, { x: 300, y: 250 })),
        { length: 110, ratio: 0.5 }),
      F('mirror', 300, 250, M.deg(A.aimAngle({ x: 300, y: 450 }, { x: 300, y: 250 }, { x: 800, y: 250 })), { length: 100 }),
      F('mirror', 380, 450, M.deg(A.aimAngle({ x: 300, y: 450 }, { x: 380, y: 450 }, { x: 380, y: 650 })), { length: 100 }),
      F('mirror', 380, 650, M.deg(A.aimAngle({ x: 380, y: 450 }, { x: 380, y: 650 }, { x: 800, y: 650 })), { length: 100 })
    ];
    var receivers = [];
    taps.forEach(function (x, k) {
      var last = k === taps.length - 1;
      var ratio = last ? null : Math.min(0.9, Math.max(0.1, 1 / (taps.length - k)));
      var up = { x: x, y: 250 }, dn = { x: x, y: 650 };
      if (last) {
        fixed.push(F('mirror', x, 250, M.deg(A.aimAngle({ x: 0, y: 250 }, up, { x: x, y: 0 })), { length: 90 }));
        fixed.push(F('mirror', x, 650, M.deg(A.aimAngle({ x: 0, y: 650 }, dn, { x: x, y: 900 })), { length: 90 }));
      } else {
        fixed.push(F('splitter', x, 250, M.deg(A.aimAngle({ x: 0, y: 250 }, up, { x: x, y: 0 })), { length: 90, ratio: ratio }));
        fixed.push(F('splitter', x, 650, M.deg(A.aimAngle({ x: 0, y: 650 }, dn, { x: x, y: 900 })), { length: 90, ratio: ratio }));
      }
      receivers.push(R(x, 100, need(0.12), { radius: 26 }));
      receivers.push(R(x, 800, need(0.12), { radius: 26 }));
    });
    multi({
      id: 'mir-73', chapter: 'mirage', name: 'Twelve Locks',
      blurb: 'Twelve sensors, one lamp, and it is pointing at the ceiling.',
      hint: 'Somebody has already built the hard part. It only needs feeding.',
      fixed: fixed.concat([
        F('prism', 800, 450, 30, { radius: 60, material: 'flint' }),
        F('prism', 1180, 450, -30, { radius: 52, material: 'crown' }),
        F('grating', 1450, 450, 90, { length: 160 }),
        F('filter', 620, 450, 90, { length: 100, color: 'blue' }),
        F('polarizer', 1000, 450, 40, { radius: 40 })
      ]),
      chains: [],
      zones: [Z(60, 380, 180, 140), Z(1380, 700, 180, 160), Z(1380, 60, 180, 160)],
      extraEmitters: [E(L.x, L.y, -90, 'white', { intensity: 7.0 })],
      extraReceivers: receivers,
      extraSolution: [aim('mirror', { x: 120, y: 450 }, L, { x: 300, y: 450 }, { length: 120 })],
      inventory: [{ type: 'mirror', count: 1, preset: { length: 120 } }],
      par: { objects: 1, bounces: 30 },
      tags: ['mirage']
    });
  })();

  /* --- Level 74: all that machinery, and none of it matters. --------------- */
  (function () {
    var L = { x: 120, y: 450 }, S0 = { x: 1480, y: 120 };
    var mA = { x: 500, y: 450 }, mB = { x: 500, y: 120 };
    multi({
      id: 'mir-74', chapter: 'mirage', name: 'Clockwork Panic',
      blurb: 'Six moving machines, four alarms, and the lamp is pointed straight at the busiest one.',
      hint: 'Nothing that moves is on the way to the sensor. Go around all of it.',
      fixed: [
        F('mirror', 800, 450, 0, { length: 200, material: 'gold', motion: { type: 'turntable', speed: 0.9 } }),
        F('mirror', 1100, 650, 45, { length: 150, material: 'gold',
          motion: { type: 'orbit', center: { x: 1100, y: 650 }, radius: 150, speed: 0.8 } }),
        F('mirror', 300, 780, 60, { length: 140, material: 'gold',
          motion: { type: 'track', from: { x: 300, y: 780 }, to: { x: 900, y: 780 }, period: 4 } }),
        F('mirror', 1300, 320, 0, { length: 150, material: 'gold', motion: { type: 'turntable', speed: -0.7 } }),
        F('mirror', 650, 640, 0, { length: 140, material: 'gold',
          motion: { type: 'beat', bpm: 100, stepAngle: rad(22), cycle: 16 } }),
        F('mirror', 400, 700, 30, { length: 120, material: 'gold',
          motion: { type: 'orbit', center: { x: 400, y: 700 }, radius: 110, speed: -1.1 } })
      ],
      chains: [],
      zones: [Z(420, 380, 160, 140), Z(420, 60, 160, 120), Z(980, 60, 180, 150), Z(1380, 560, 180, 200)],
      extraEmitters: [E(L.x, L.y, 0, 'white', { intensity: 2.4 })],
      extraReceivers: [R(S0.x, S0.y, need(0.5)), dark(800, 700), dark(1220, 860), dark(1480, 640), dark(960, 300)],
      extraSolution: [aim('mirror', mA, L, mB, { length: 140 }), aim('mirror', mB, mA, S0, { length: 140 })],
      inventory: [{ type: 'mirror', count: 2, preset: { length: 140 } }],
      par: { objects: 2, bounces: 2 },
      holdTime: 0.4,
      tags: ['mirage']
    });
  })();

  /* --- Level 75: a wooden maze with a door nobody mentions. ---------------- */
  (function () {
    var L = { x: 120, y: 80 }, S0 = { x: 1480, y: 820 };
    var pA = { x: 420, y: 300 }, pB = { x: 1300, y: 600 };
    multi({
      id: 'mir-75', chapter: 'mirage', name: 'Maze Runner',
      blurb: 'Fourteen walls between the lamp and the sensor. Count the mirrors you would need. Then look again.',
      hint: 'Two of those rings are not decoration. One of them is right under the lamp’s row.',
      walls: [
        W(600, 0, 40, 260), W(200, 180, 180, 30), W(460, 180, 30, 220), W(200, 420, 500, 30),
        W(760, 120, 30, 400), W(760, 520, 400, 30), W(900, 250, 280, 30), W(1180, 250, 30, 270),
        W(1360, 100, 30, 400), W(200, 620, 30, 280), W(420, 600, 30, 300), W(620, 700, 500, 30),
        W(1000, 560, 30, 140), W(1400, 560, 200, 30)
      ],
      fixed: [
        F('portal', pA.x, pA.y, 0, { id: 'mzA', link: 'mzB', radius: 36 }),
        F('portal', pB.x, pB.y, 0, { id: 'mzB', link: 'mzA', radius: 36 }),
        F('mirror', 880, 400, 30, { length: 110 }), F('mirror', 1080, 400, -45, { length: 110 }),
        F('mirror', 560, 820, 60, { length: 110 })
      ],
      chains: [],
      extraEmitters: [E(L.x, L.y, 0, 'white', { intensity: 2.4 })],
      extraReceivers: [R(S0.x, S0.y, need(0.6)), dark(1480, 330), dark(900, 820)],
      extraSolution: [aim('mirror', { x: 420, y: 80 }, L, pA, { length: 120 }),
                      aim('mirror', { x: 1300, y: 820 }, pB, S0, { length: 120 })],
      inventory: [{ type: 'mirror', count: 8, preset: { length: 120 } }],
      par: { objects: 2, bounces: 2 },
      tags: ['mirage']
    });
  })();

  /* --- Level 76: filters of every colour but the right one. Nearly. -------- */
  (function () {
    var L = { x: 120, y: 450 }, S0 = { x: 1480, y: 120 };
    var mA = { x: 400, y: 450 }, mB = { x: 400, y: 120 };
    multi({
      id: 'mir-76', chapter: 'mirage', name: 'Colour Theory',
      blurb: 'The sensor wants pure red. The bench is covered in filters, prisms and a grating. You get mirrors.',
      hint: 'Somewhere on this bench is a red filter already. It is lying flat, waiting for a beam going up.',
      fixed: [
        F('filter', 400, 250, 0, { length: 110, color: 'red' }),
        F('filter', 700, 450, 90, { length: 120, color: 'blue' }),
        F('filter', 1100, 450, 90, { length: 120, color: 'green' }),
        F('filter', 800, 700, 0, { length: 120, color: 'cyan' }),
        F('filter', 1000, 300, 90, { length: 120, color: 'magenta' }),
        F('filter', 1250, 820, 90, { length: 110, color: 'yellow' }),
        F('prism', 600, 720, 15, { radius: 58, material: 'flint' }),
        F('prism', 1250, 620, -20, { radius: 58, material: 'flint' }),
        F('grating', 1300, 300, 80, { length: 140 }),
        F('glass', 900, 560, 20, { w: 120, h: 60, material: 'flint' })
      ],
      chains: [],
      zones: [Z(300, 380, 200, 140), Z(300, 60, 200, 120), Z(860, 60, 200, 150), Z(1380, 380, 180, 160)],
      extraEmitters: [E(L.x, L.y, 0, 'white', { intensity: 2.6 })],
      extraReceivers: [R(S0.x, S0.y, { color: 'red', minIntensity: 0.3 }), dark(1480, 450), dark(1480, 720)],
      extraSolution: [aim('mirror', mA, L, mB, { length: 140 }), aim('mirror', mB, mA, S0, { length: 140 })],
      inventory: [{ type: 'mirror', count: 2, preset: { length: 140 } }],
      par: { objects: 2, bounces: 2 },
      tags: ['mirage']
    });
  })();

  /* --- Level 77: polarisers at every angle except the obvious one. --------- */
  (function () {
    var L = { x: 120, y: 800 }, S0 = { x: 1480, y: 120 };
    var mA = { x: 380, y: 800 }, mB = { x: 1480, y: 560 };
    multi({
      id: 'mir-77', chapter: 'mirage', name: 'Polar Night',
      blurb: 'The lock wants light turned exactly upright. Seven filters stand ready, each at the wrong angle but one.',
      hint: 'Do not pass through any filter but the one already standing upright. Every other one steals light.',
      fixed: [
        F('polarizer', 620, 800, 30, { radius: 40 }),
        F('polarizer', 1200, 800, 10, { radius: 40 }),
        F('polarizer', 900, 480, 60, { radius: 40 }),
        F('polarizer', 700, 280, 120, { radius: 40 }),
        F('polarizer', 1100, 120, 0, { radius: 40 }),
        F('polarizer', 300, 350, 75, { radius: 40 }),
        F('polarizer', 1480, 460, 90, { radius: 44 })
      ],
      chains: [],
      extraEmitters: [E(L.x, L.y, 0, 'white', { intensity: 2.6 })],
      extraReceivers: [
        R(S0.x, S0.y, { color: 'any', minIntensity: 0.45, polarization: Math.PI / 2 }, { radius: 30 }),
        dark(1480, 800), dark(700, 120)
      ],
      extraSolution: [aim('mirror', mA, L, mB, { length: 140 }), aim('mirror', mB, mA, S0, { length: 140 })],
      inventory: [{ type: 'mirror', count: 3, preset: { length: 140 } },
                  { type: 'polarizer', count: 2, preset: { radius: 40 } }],
      par: { objects: 2, bounces: 3 },
      tags: ['mirage']
    });
  })();

  /* --- Level 78: six sensors, a drawer full of splitters -- and one bent mirror. */
  (function () {
    var em = E(120, 700, 0, 'white', { width: 150, rays: 25, intensity: 6.0 });
    var cvx = { type: 'convex', x: 520, y: 700, angle: rad(160), length: 170 };
    /* Where does the spread fan cross the row of sensors? Measured, not guessed. */
    var ROW = 110;
    var xs = A.probe([cvx], [em]).result.segments.filter(function (s) {
      return s.depth === 1 && s.b.y < s.a.y - 1;
    }).map(function (s) {
      return s.a.x + (s.b.x - s.a.x) * (ROW - s.a.y) / (s.b.y - s.a.y);
    }).filter(function (x) { return x > 160 && x < 1440; }).sort(function (a, b) { return a - b; });
    var picks = [];
    for (var i = 0; i < 6; i++) picks.push(xs[Math.round(i * (xs.length - 1) / 5)]);
    multi({
      id: 'mir-78', chapter: 'mirage', name: 'Crowd',
      blurb: 'Six sensors in a row and a tray of twelve pieces. You will not need eleven of them.',
      hint: 'One curved mirror can throw a single broad beam across a whole row.',
      fixed: [
        F('splitter', 1000, 800, 45, { length: 110 }), F('splitter', 1300, 660, -45, { length: 110 }),
        F('splitter', 780, 860, 30, { length: 100 }), F('mirror', 1450, 820, 60, { length: 100 }),
        F('mirror', 1180, 560, -20, { length: 100 })
      ],
      chains: [],
      zones: [Z(420, 600, 200, 200), Z(900, 560, 200, 160), Z(1380, 300, 180, 160)],
      extraEmitters: [em],
      extraReceivers: picks.map(function (x) { return R(Math.round(x), ROW, need(0.12), { radius: 30 }); })
        .concat([dark(1480, 560), dark(1250, 880)]),
      extraSolution: [cvx],
      inventory: [{ type: 'convex', count: 1, preset: { length: 170 } },
                  { type: 'splitter', count: 6, preset: { length: 110 } },
                  { type: 'mirror', count: 5, preset: { length: 120 } }],
      par: { objects: 1, bounces: 30 },
      tags: ['mirage']
    });
  })();

  /* --- Level 79: BOSS. Everything on one bench, and most of it is a lie. ---- */
  (function () {
    var WL = { x: 120, y: 300 }, BL = { x: 120, y: 760 }, RL = { x: 1480, y: 860 };
    var P1 = { x: 120, y: 150 }, P2 = { x: 400, y: 760 };
    var pA = { x: 400, y: 150 }, pB = { x: 700, y: 500 };
    var BUS = 500, TOP = 110, taps = [900, 1060, 1220, 1380];
    var fixed = [
      F('portal', pA.x, pA.y, 0, { id: 'giA', link: 'giB', radius: 36 }),
      F('portal', pB.x, pB.y, 0, { id: 'giB', link: 'giA', radius: 36 }),
      /* The blue relay, already built: up, along, and split between two sensors. */
      F('mirror', 400, 640, M.deg(A.aimAngle(P2, { x: 400, y: 640 }, { x: 1000, y: 640 })), { length: 110 }),
      F('splitter', 1000, 640, M.deg(A.aimAngle({ x: 400, y: 640 }, { x: 1000, y: 640 }, { x: 1000, y: 820 })),
        { length: 110, ratio: 0.5 }),
      F('mirror', 1300, 640, M.deg(A.aimAngle({ x: 1000, y: 640 }, { x: 1300, y: 640 }, { x: 1300, y: 820 })), { length: 110 }),
      F('filter', 1060, 300, 0, { length: 100, color: 'red' }),
      /* Decoys. */
      F('absorber', 1400, 860, 0, { w: 30, h: 70 }),
      F('mirror', 700, 760, 0, { length: 180, material: 'gold', motion: { type: 'turntable', speed: 0.8 } }),
      F('mirror', 250, 500, 30, { length: 110, material: 'gold',
        motion: { type: 'orbit', center: { x: 250, y: 500 }, radius: 80, speed: 1.2 } }),
      F('prism', 800, 330, 20, { radius: 52, material: 'flint' }),
      F('mirror', 1480, 420, 60, { length: 100 }),
      F('polarizer', 560, 860, 0, { radius: 34 }),
      F('grating', 1200, 860, 90, { length: 100 })
    ];
    taps.forEach(function (x, k) {
      var last = k === taps.length - 1;
      var at = { x: x, y: BUS };
      var ang = M.deg(A.aimAngle({ x: 0, y: BUS }, at, { x: x, y: 0 }));
      if (last) fixed.push(F('mirror', x, BUS, ang, { length: 90 }));
      else fixed.push(F('splitter', x, BUS, ang, { length: 90, ratio: 1 / (taps.length - k) }));
    });
    multi({
      id: 'mir-79', chapter: 'mirage', name: 'The Grand Illusion',
      blurb: 'Three lamps, six sensors, a portal, two machines and a dozen props. It is a two-piece puzzle.',
      hint: 'Two roads are already built and both are unfed. The red lamp is a prop.',
      walls: [W(520, 0, 40, 420)],
      fixed: fixed,
      chains: [],
      zones: [Z(50, 80, 150, 150), Z(330, 690, 140, 140), Z(1380, 680, 180, 110), Z(760, 180, 220, 110)],
      extraEmitters: [
        E(WL.x, WL.y, -90, 'white', { intensity: 6.0 }),
        E(BL.x, BL.y, 0, 'blue', { intensity: 3.0 }),
        E(RL.x, RL.y, 180, 'red', { intensity: 2.0 })
      ],
      extraReceivers: taps.map(function (x) {
        return R(x, TOP, x === 1060 ? { color: 'red', minIntensity: 0.15 } : need(0.3), { radius: 28 });
      }).concat([
        R(1000, 820, { color: 'blue', minIntensity: 0.4 }, { radius: 28 }),
        R(1300, 820, { color: 'blue', minIntensity: 0.4 }, { radius: 28 }),
        dark(1480, 640), dark(800, 860), dark(1150, 860)
      ]),
      extraSolution: [aim('mirror', P1, WL, pA, { length: 120 }), aim('mirror', P2, BL, { x: 400, y: 640 }, { length: 120 })],
      inventory: [{ type: 'mirror', count: 3, preset: { length: 120 } }],
      par: { objects: 2, bounces: 2 },
      holdTime: 0.4,
      tags: ['mirage', 'boss']
    });
  })();

  /* ==========================================================================
   * CHAPTER 12 -- ZERO HOUR
   * Timed levels, played in phases. Each phase has its own clock; beat it and
   * the bench changes under you -- walls rise, lamps swap, alarms arm. Miss it
   * and the phase rewinds, every piece back where the phase began, until you
   * beat it. tools/verify.js plays every phase with its reference moves and
   * checks each leaves a human enough seconds per move.
   * ======================================================================= */

  /* --- Level 80: the clock, introduced without mercy. ---------------------- */
  (function () {
    var L = { x: 120, y: 450 }, A0 = { x: 800, y: 110 }, B0 = { x: 1480, y: 110 };
    var RL = { x: 1000, y: 60 }, C0 = { x: 300, y: 800 };
    var m0 = aim('mirror', { x: 800, y: 450 }, L, A0, { length: 140 });
    timed({
      id: 'zro-80', name: 'Countdown',
      blurb: 'Three phases, three clocks. Miss one and it starts again.',
      hint: 'Each phase changes the bench. Read the new hardware before you touch anything.',
      emitters: [
        E(L.x, L.y, 0, 'white', { intensity: 1.8 }),
        inPhase(3, E(RL.x, RL.y, 90, 'red', { id: 'z80red', intensity: 1.6 }))
      ],
      receivers: [
        R(A0.x, A0.y, need(0.4), { id: 'z80A' }),
        inPhase(2, R(B0.x, B0.y, need(0.4), { id: 'z80B' })),
        inPhase(2, dark(1140, 280)),
        inPhase(3, R(C0.x, C0.y, { color: 'red', minIntensity: 0.4 }, { id: 'z80C' }))
      ],
      walls: [Wp(740, 170, 120, 40, 2), Wp(600, 700, 60, 200, 3)],
      inventory: [{ type: 'mirror', count: 1, preset: { length: 140 } }],
      phases: [
        { name: 'Power the relay', time: 30,
          hint: 'One mirror in the beam, turned up to the sensor.',
          solution: [m0] },
        { name: 'Around the block', time: 30,
          hint: 'The old route is walled off and the diagonal is alarmed. Carry the mirror to the far end.',
          solution: [reaim(0, { x: 1480, y: 450 }, L, B0)] },
        { name: 'Crossfire', time: 25, goals: ['z80B', 'z80C'],
          hint: 'Keep the white route. Fold the red lamp across, above the new wall, then down.',
          inventory: [{ type: 'mirror', count: 2, preset: { length: 140 } }],
          solution: [
            aim('mirror', { x: 1000, y: 600 }, RL, { x: 300, y: 600 }, { length: 140 }),
            aim('mirror', { x: 300, y: 600 }, { x: 1000, y: 600 }, C0, { length: 140 })
          ] }
      ]
    });
  })();

  /* --- Level 81: the lamps change colour under you. ------------------------ */
  (function () {
    var RED = { x: 120, y: 150 }, BLUE = { x: 120, y: 750 }, RED2 = { x: 800, y: 60 };
    var G = { x: 1450, y: 450 };
    var p0 = { x: 1200, y: 150 }, p1 = { x: 1200, y: 450 };
    timed({
      id: 'zro-81', name: 'Hot Swap',
      blurb: 'One gate, three colours, three clocks. The lamp you just aimed is about to go out.',
      hint: 'A mirror turns light differently depending on which way it arrives.',
      emitters: [
        untilPhase(2, E(RED.x, RED.y, 0, 'red', { id: 'z81red', intensity: 1.7 })),
        inPhase(2, E(BLUE.x, BLUE.y, 0, 'blue', { id: 'z81blue', intensity: 1.7 })),
        inPhase(3, E(RED2.x, RED2.y, 90, 'red', { id: 'z81red2', intensity: 1.7 }))
      ],
      receivers: [
        untilPhase(2, R(G.x, G.y, { color: 'red', minIntensity: 0.45 }, { id: 'z81gR', radius: 30 })),
        inPhase(2, untilPhase(3, R(G.x, G.y, { color: 'blue', minIntensity: 0.45 }, { id: 'z81gB', radius: 30 }))),
        inPhase(3, R(G.x, G.y, { color: 'magenta', minIntensity: 1.0 }, { id: 'z81gM', radius: 30 }))
      ],
      walls: [W(700, 300, 60, 300), W(1300, 220, 300, 40), Wp(1300, 560, 40, 340, 2)],
      inventory: [{ type: 'mirror', count: 2, preset: { length: 130 } }],
      phases: [
        { name: 'Red gate', time: 30,
          hint: 'Over the top and down: the gate is only open from the left.',
          solution: [
            aim('mirror', p0, RED, p1, { length: 130 }),
            aim('mirror', p1, p0, G, { length: 130 })
          ] },
        { name: 'Blue gate', time: 30,
          hint: 'Bring blue up the same column. The mirror at the corner has to face the other way now.',
          inventory: [{ type: 'mirror', count: 1, preset: { length: 130 } }],
          solution: [
            aim('mirror', { x: 1200, y: 750 }, BLUE, p1, { length: 130 }),
            reaim(1, p1, { x: 1200, y: 750 }, G)
          ] },
        { name: 'Magenta', time: 25,
          hint: 'Keep blue where it is. Red comes down from above, under the ledge, and meets it on the gate.',
          inventory: [{ type: 'mirror', count: 2, preset: { length: 130 } }],
          solution: [
            aim('mirror', { x: 800, y: 300 }, RED2, { x: 1350, y: 300 }, { length: 130 }),
            aim('mirror', { x: 1350, y: 300 }, { x: 800, y: 300 }, G, { length: 130 })
          ] }
      ]
    });
  })();

  /* --- Level 82: the room fills with smoke, phase by phase. ---------------- */
  (function () {
    var L = { x: 120, y: 450 }, A0 = { x: 1480, y: 820 }, B0 = { x: 1480, y: 300 }, C0 = { x: 560, y: 100 };
    var mA = { x: 400, y: 450 }, mB = { x: 400, y: 820 };
    timed({
      id: 'zro-82', name: 'Smoke',
      blurb: 'Every phase the smoke gets thicker. A route that works now will not reach later.',
      hint: 'Thick air punishes distance. When the smoke rises, shorten everything.',
      fog: 0.0003, weather: 'murk',
      emitters: [E(L.x, L.y, 0, 'white', { intensity: 2.6 })],
      receivers: [
        R(A0.x, A0.y, need(0.6), { id: 'z82A' }),
        inPhase(2, R(B0.x, B0.y, need(0.6), { id: 'z82B' })),
        inPhase(3, R(C0.x, C0.y, need(0.3), { id: 'z82C' }))
      ],
      walls: [Wp(700, 150, 60, 600, 0, 2), Wp(500, 200, 120, 40, 3)],
      inventory: [{ type: 'mirror', count: 2, preset: { length: 140 } }],
      phases: [
        { name: 'Under the wall', time: 30, fog: 0.0003,
          hint: 'Down and along the bottom, under the wall.',
          solution: [aim('mirror', mA, L, mB, { length: 140 }), aim('mirror', mB, mA, A0, { length: 140 })] },
        { name: 'The wall comes down', time: 30, fog: 0.0007,
          hint: 'The long way round is too long in this air. Take both mirrors across the open floor.',
          solution: [reaim(0, { x: 1300, y: 450 }, L, { x: 1300, y: 300 }),
                     reaim(1, { x: 1300, y: 300 }, { x: 1300, y: 450 }, B0)] },
        { name: 'Thick as soup', time: 25, fog: 0.0016,
          hint: 'Only a short route survives. Up past the new block, then back to the sensor.',
          solution: [reaim(0, { x: 660, y: 450 }, L, { x: 660, y: 100 }),
                     reaim(1, { x: 660, y: 100 }, { x: 660, y: 450 }, C0)] }
      ]
    });
  })();

  /* --- Level 83: one lamp, more and more mouths to feed. ------------------- */
  (function () {
    var L = { x: 120, y: 450 }, A0 = { x: 700, y: 110 }, B0 = { x: 1480, y: 800 }, C0 = { x: 1480, y: 110 };
    var S0 = { x: 700, y: 450 };
    timed({
      id: 'zro-83', name: 'Split Second',
      blurb: 'The first sensor must stay lit while every new one comes on, from the same lamp.',
      hint: 'A splitter’s green knob decides who gets fed. The sensors are not equally hungry.',
      emitters: [E(L.x, L.y, 0, 'white', { intensity: 3.0 })],
      receivers: [
        R(A0.x, A0.y, need(0.75), { id: 'z83A' }),
        inPhase(2, R(B0.x, B0.y, need(0.6), { id: 'z83B' })),
        inPhase(3, R(C0.x, C0.y, need(0.45), { id: 'z83C' }))
      ],
      walls: [Wp(1000, 380, 40, 140, 2)],
      inventory: [{ type: 'splitter', count: 1, preset: { length: 160, ratio: 0.5 } }],
      phases: [
        { name: 'Tap the line', time: 30,
          hint: 'Only a splitter this time. Half up, half onward.',
          solution: [aim('splitter', S0, L, A0, { length: 160, ratio: 0.5 })] },
        { name: 'Second customer', time: 30, keep: true,
          hint: 'The wall cuts the straight line. Drop the onward half down and along the floor.',
          inventory: [{ type: 'mirror', count: 2, preset: { length: 140 } }],
          solution: [aim('mirror', { x: 900, y: 450 }, S0, { x: 900, y: 800 }, { length: 140 }),
                     aim('mirror', { x: 900, y: 800 }, { x: 900, y: 450 }, B0, { length: 140 })] },
        { name: 'Third, and hungry', time: 25, keep: true,
          hint: 'Split the upward arm again -- and turn the new splitter down, or the first sensor starves.',
          inventory: [{ type: 'splitter', count: 1, preset: { length: 160, ratio: 0.5 } },
                      { type: 'mirror', count: 1, preset: { length: 140 } }],
          solution: [aim('splitter', { x: 700, y: 250 }, S0, { x: 1480, y: 250 }, { length: 160, ratio: 0.4 }),
                     aim('mirror', { x: 1480, y: 250 }, { x: 700, y: 250 }, C0, { length: 140 })] }
      ]
    });
  })();

  /* --- Level 84: alarms rise out of the bench, right under your beam. ------ */
  (function () {
    var L = { x: 120, y: 150 }, A0 = { x: 1480, y: 750 }, B0 = { x: 820, y: 820 }, C0 = { x: 1250, y: 770 };
    timed({
      id: 'zro-84', name: 'Tripwire',
      blurb: 'See those sockets? Next phase they are alarms, and they are sitting on your route.',
      hint: 'Plan the next phase while you solve this one: the sockets show where the alarms will stand.',
      emitters: [E(L.x, L.y, 0, 'white', { intensity: 2.2 })],
      receivers: [
        R(A0.x, A0.y, need(0.5), { id: 'z84A' }),
        inPhase(2, R(B0.x, B0.y, need(0.5), { id: 'z84B' })),
        inPhase(3, R(C0.x, C0.y, need(0.45), { id: 'z84C' })),
        inPhase(2, dark(1300, 450)), inPhase(2, dark(1000, 150)),
        inPhase(3, dark(500, 520)), inPhase(3, dark(660, 820))
      ],
      walls: [W(1150, 300, 40, 400), Wp(560, 450, 80, 40, 2)],
      inventory: [{ type: 'mirror', count: 2, preset: { length: 130 } }],
      phases: [
        { name: 'Clean run', time: 30,
          hint: 'Across the top, down the right-hand side, into the sensor.',
          solution: [aim('mirror', { x: 1300, y: 150 }, L, { x: 1300, y: 750 }, { length: 130 }),
                     aim('mirror', { x: 1300, y: 750 }, { x: 1300, y: 150 }, A0, { length: 130 })] },
        { name: 'Armed', time: 30,
          hint: 'The top line is alarmed past the middle. Turn down early, left of the new block.',
          solution: [reaim(0, { x: 500, y: 150 }, L, { x: 500, y: 820 }),
                     reaim(1, { x: 500, y: 820 }, { x: 500, y: 150 }, B0)] },
        { name: 'Nowhere to stand', time: 25,
          hint: 'Your column and your floor run are both alarmed. Further left, and across just above them.',
          solution: [reaim(0, { x: 300, y: 150 }, L, { x: 300, y: 770 }),
                     reaim(1, { x: 300, y: 770 }, { x: 300, y: 150 }, C0)] }
      ]
    });
  })();

  /* --- Level 85: machinery bolted down mid-level. -------------------------- */
  (function () {
    var L = { x: 120, y: 450 }, A0 = { x: 620, y: 110 }, T = { x: 1100, y: 450 };
    var mA = { x: 400, y: 450 }, mB = { x: 400, y: 110 };
    timed({
      id: 'zro-85', name: 'Clockwork',
      blurb: 'Phase two bolts a turntable into the bench. Phase three makes you catch what it throws.',
      hint: 'A turntable only works if light reaches it -- check nothing of yours is in the way.',
      emitters: [E(L.x, L.y, 0, 'white', { intensity: 2.4 })],
      fixed: [inPhase(2, F('mirror', T.x, T.y, 0, { id: 'z85turn', length: 200, material: 'gold',
                            motion: { type: 'turntable', speed: 0.45 } }))],
      receivers: [
        R(A0.x, A0.y, need(0.4), { id: 'z85A' }),
        inPhase(2, R(1100, 820, need(0.3), { id: 'z85B', radius: 60 })),
        inPhase(3, R(760, 700, need(0.2), { id: 'z85C', radius: 60 }))
      ],
      /* The third-phase block shields the catch sensor from the turntable's
       * own sweep: it can only be fed off a mirror. */
      walls: [W(560, 250, 120, 40), Wp(880, 500, 80, 160, 3)],
      inventory: [{ type: 'mirror', count: 2, preset: { length: 140 } }],
      holdTime: 0.25,
      phases: [
        { name: 'Over the bar', time: 30, holdTime: 0.5,
          hint: 'Up before the bar, then along the top.',
          solution: [aim('mirror', mA, L, mB, { length: 140 }), aim('mirror', mB, mA, A0, { length: 140 })] },
        { name: 'Wind it up', time: 30,
          hint: 'The turntable cannot throw light it never gets. Clear the line to it, then wait.',
          solution: [{ remove: 0 }] },
        { name: 'Catch', time: 25, holdTime: 0.2,
          hint: 'Stand a mirror in the path of the downward sweep and send it along the floor.',
          solution: [aim('mirror', { x: 1100, y: 700 }, T, { x: 160, y: 700 }, { length: 140 })] }
      ]
    });
  })();

  /* --- Level 86: one mirror, four lamps, less time each round. -------------- */
  (function () {
    var L1 = { x: 120, y: 120 }, L2 = { x: 900, y: 860 }, L3 = { x: 1400, y: 50 }, L4 = { x: 380, y: 840 };
    var S1 = { x: 800, y: 820 }, S2 = { x: 1480, y: 120 }, S3 = { x: 300, y: 760 }, S4 = { x: 800, y: 450 };
    timed({
      id: 'zro-86', name: 'Chain Reaction',
      blurb: 'Each sensor fires the next lamp. You get one mirror, and less time every round.',
      hint: 'Do not admire the last sensor. Look for the lamp that just came on.',
      emitters: [
        untilPhase(2, E(L1.x, L1.y, 0, 'white', { id: 'z86l1', intensity: 1.8 })),
        inPhase(2, untilPhase(3, E(L2.x, L2.y, 0, 'white', { id: 'z86l2', intensity: 1.8 }))),
        inPhase(3, untilPhase(4, E(L3.x, L3.y, 180, 'white', { id: 'z86l3', intensity: 1.8 }))),
        inPhase(4, E(L4.x, L4.y, -90, 'white', { id: 'z86l4', intensity: 1.8 }))
      ],
      receivers: [
        R(S1.x, S1.y, need(0.4), { id: 'z86s1' }),
        inPhase(2, R(S2.x, S2.y, need(0.4), { id: 'z86s2' })),
        inPhase(3, R(S3.x, S3.y, need(0.4), { id: 'z86s3' })),
        inPhase(4, R(S4.x, S4.y, need(0.4), { id: 'z86s4' }))
      ],
      inventory: [{ type: 'mirror', count: 1, preset: { length: 140 } }],
      phases: [
        { name: 'Spark', time: 18, solution: [aim('mirror', { x: 800, y: 120 }, L1, S1, { length: 140 })] },
        { name: 'Fuse', time: 15, solution: [reaim(0, { x: 1480, y: 860 }, L2, S2)] },
        { name: 'Charge', time: 12, solution: [reaim(0, { x: 300, y: 50 }, L3, S3)] },
        { name: 'Bang', time: 10, solution: [reaim(0, { x: 380, y: 450 }, L4, S4)] }
      ]
    });
  })();

  /* --- Level 87: BOSS. Four phases, and every one of them tampers with the last. */
  (function () {
    var RED = { x: 120, y: 150 }, GRN = { x: 120, y: 750 }, WHT = { x: 800, y: 880 };
    var Y = { x: 1450, y: 450 }, Z = { x: 300, y: 450 };
    timed({
      id: 'zro-87', name: 'Detonator',
      blurb: 'Yellow on the gate, then keep it yellow while the bench is sabotaged three times.',
      hint: 'Yellow is red plus green, arriving together and in balance.',
      emitters: [
        untilPhase(3, E(RED.x, RED.y, 0, 'red', { id: 'z87red', intensity: 1.7 })),
        E(GRN.x, GRN.y, 0, 'green', { id: 'z87grn', intensity: 1.7 }),
        inPhase(3, E(WHT.x, WHT.y, -90, 'white', { id: 'z87wht', intensity: 5.2 }))
      ],
      receivers: [
        R(Y.x, Y.y, { color: 'yellow', minIntensity: 1.8 }, { id: 'z87Y', radius: 34 }),
        inPhase(2, dark(1275, 300)), inPhase(2, dark(1275, 600)),
        inPhase(4, R(Z.x, Z.y, { color: 'green', minIntensity: 0.3 }, { id: 'z87Z' }))
      ],
      inventory: [{ type: 'mirror', count: 2, preset: { length: 140 } }],
      phases: [
        { name: 'Arm', time: 30,
          hint: 'Each lamp needs one mirror, aimed straight at the gate.',
          solution: [aim('mirror', { x: 1100, y: 150 }, RED, Y, { length: 140 }),
                     aim('mirror', { x: 1100, y: 750 }, GRN, Y, { length: 140 })] },
        { name: 'Tamper', time: 30, keep: true,
          hint: 'Both diagonals are alarmed. Come at the gate straight from above and below.',
          solution: [reaim(0, { x: 1450, y: 150 }, RED, Y), reaim(1, { x: 1450, y: 750 }, GRN, Y)] },
        { name: 'Swap', time: 25, keep: true,
          hint: 'The red lamp is dead. Make red out of the white one and bring it to the corner mirror.',
          inventory: [{ type: 'filter', count: 1, preset: { color: 'red', length: 120 } },
                      { type: 'mirror', count: 1, preset: { length: 140 } }],
          solution: [{ type: 'filter', x: 800, y: 600, angle: 0, length: 120, color: 'red' },
                     aim('mirror', { x: 800, y: 150 }, WHT, { x: 1450, y: 150 }, { length: 140 })] },
        { name: 'Detonate', time: 20, keep: true,
          hint: 'Feed the last sensor from the green line -- lightly, or the gate turns orange.',
          inventory: [{ type: 'splitter', count: 1, preset: { length: 140, ratio: 0.5 } }],
          solution: [aim('splitter', { x: 300, y: 750 }, GRN, Z, { length: 140, ratio: 0.2 })] }
      ],
      tags: ['boss']
    });
  })();

  /* ==========================================================================
   * CHAPTER 13 -- THE IMPOSSIBLE
   * The last chapter looks unsolvable on purpose: a sensor sealed in a box, a
   * sensor behind solid wood, a lock that wants three beams and not too much
   * light, filters that pass MORE the more of them you add. Every one has a
   * real answer, proven by tools/verify.js; test-content.js proves the
   * obvious answers really do fail.
   * ======================================================================= */

  /* --- Level 88: the sensor is inside a closed box. ------------------------ */
  (function () {
    var L = { x: 120, y: 820 }, P = { x: 700, y: 450 }, S0 = { x: 1440, y: 450 };
    var m0 = { x: 300, y: 820 }, m1 = { x: 300, y: 150 }, m2 = { x: 700, y: 150 };
    multi({
      id: 'imp-88', chapter: 'impossible', name: 'Sealed',
      blurb: 'The sensor is shut inside a wooden box. No gaps, no glass. It still wants green.',
      hint: 'There is a gate inside the box. Its twin outside is turned a quarter: light must fall into it from above to come out facing the sensor.',
      walls: [
        W(1150, 270, 380, 30), W(1150, 600, 380, 30), W(1150, 300, 30, 300), W(1500, 300, 30, 300),
        W(450, 250, 40, 650)
      ],
      fixed: [
        F('portal', P.x, P.y, 90, { id: 'sbOut', link: 'sbIn', radius: 30 }),
        F('portal', 1250, 450, 0, { id: 'sbIn', link: 'sbOut', radius: 30 }),
        F('portal', 1000, 800, 0, { id: 'sbX', link: 'sbY', radius: 30 }),
        F('portal', 200, 450, 0, { id: 'sbY', link: 'sbX', radius: 30 })
      ],
      zones: [Z(220, 740, 160, 140), Z(220, 70, 160, 140), Z(620, 70, 160, 120), Z(620, 190, 160, 90),
              Z(900, 620, 180, 120), Z(1000, 80, 160, 140)],
      chains: [],
      extraEmitters: [E(L.x, L.y, 0, 'white', { intensity: 3.0 })],
      extraReceivers: [
        R(S0.x, S0.y, { color: 'green', minIntensity: 0.35 }),
        dark(640, 330, 26), dark(760, 330, 26), dark(600, 450, 26), dark(800, 450, 26), dark(700, 560, 26)
      ],
      extraSolution: [
        aim('mirror', m0, L, m1, { length: 120 }),
        aim('mirror', m1, m0, m2, { length: 120 }),
        aim('mirror', m2, m1, P, { length: 120 }),
        { type: 'filter', x: 700, y: 230, angle: 0, length: 100, color: 'green' }
      ],
      inventory: [{ type: 'mirror', count: 3, preset: { length: 120 } },
                  { type: 'filter', count: 1, preset: { color: 'green', length: 100 } }],
      par: { objects: 4, bounces: 5 },
      tags: ['impossible']
    });
  })();

  /* --- Level 89: three slits, not one of them square to anything. ---------- */
  (function () {
    var L = { x: 120, y: 150 };
    var pts = [{ x: 300, y: 150 }, { x: 300, y: 700 }, { x: 700, y: 520 }, { x: 700, y: 180 },
               { x: 1100, y: 300 }, { x: 1100, y: 820 }, { x: 1450, y: 640 }];
    var S0 = { x: 1450, y: 110 };
    var WALLS_X = [400, 800, 1200], GAP = 40, TH = 40;
    var walls = [], alarms = [];
    /* Each wall's slit sits exactly where the authored beam crosses it. */
    [[1, 2], [3, 4], [5, 6]].forEach(function (seg, k) {
      var a = pts[seg[0]], b = pts[seg[1]];
      var cx = WALLS_X[k] + TH / 2;
      var y = a.y + (b.y - a.y) * (cx - a.x) / (b.x - a.x);
      walls.push(W(WALLS_X[k], 0, TH, Math.round(y - GAP / 2)));
      walls.push(W(WALLS_X[k], Math.round(y + GAP / 2), TH, 900 - Math.round(y + GAP / 2)));
      alarms.push(dark(WALLS_X[k] + TH + 34, Math.round(y - 52), 20));
      alarms.push(dark(WALLS_X[k] + TH + 34, Math.round(y + 52), 20));
    });
    var spec = {
      id: 'imp-89', chapter: 'impossible', name: 'Needle’s Thread',
      blurb: 'Seven turns, three slits forty wide, set at angles no snap will find. Alarms wait past every slit.',
      hint: 'Work backwards from each slit: the beam through it is a straight line you can see from both sides.',
      fog: 0.0005, weather: 'murk',
      walls: walls,
      zones: [Z(220, 80, 160, 160), Z(220, 620, 160, 160), Z(620, 440, 160, 160), Z(620, 100, 160, 160),
              Z(1020, 220, 160, 160), Z(1020, 740, 160, 150), Z(1370, 560, 160, 160)],
      chains: [{ emitter: E(L.x, L.y, 0, 'white', { intensity: 3.2 }), receiver: R(S0.x, S0.y, need(0.01)),
                 path: pts, length: 90 }],
      extraReceivers: alarms,
      par: { objects: 7, bounces: 7 },
      tags: ['impossible']
    };
    var lvl = multi(spec);
    var sc = LP.Scene.fromLevel(lvl);
    LP.Scene.applySolution(sc);
    lvl.receivers[0].require.minIntensity = Math.round(LP.Scene.evaluate(sc).receivers[0].intensity * 800) / 1000;
  })();

  /* --- Level 90: BOSS. Three beams into one lock -- and not too much light. -- */
  (function () {
    var L = { x: 120, y: 820 }, S0 = { x: 800, y: 450 };
    var s1 = { x: 400, y: 820 }, s2 = { x: 800, y: 820 };
    var m1 = { x: 400, y: 450 }, m3a = { x: 1300, y: 820 }, m3b = { x: 1300, y: 120 }, m3c = { x: 800, y: 120 };
    function build(r1, r2) {
      return [
        aim('splitter', s1, L, m1, { length: 120, ratio: r1 }),
        aim('mirror', m1, s1, S0, { length: 110 }),
        aim('splitter', s2, s1, S0, { length: 120, ratio: r2 }),
        aim('mirror', m3a, s2, m3b, { length: 110 }),
        aim('mirror', m3b, m3a, m3c, { length: 110 }),
        aim('mirror', m3c, m3b, S0, { length: 110 })
      ];
    }
    var walls = [
      W(700, 340, 70, 20), W(830, 340, 70, 20), W(700, 540, 70, 20), W(830, 540, 70, 20),
      W(680, 340, 20, 80), W(680, 480, 20, 80), W(900, 340, 20, 220)
    ];
    var FOG = 0.0006;
    function total(sol) {
      var sc = LP.Scene.fromLevel({ id: '_p', emitters: [E(L.x, L.y, 0, 'white', { intensity: 3.0 })],
        receivers: [R(S0.x, S0.y, need(0.0001), { radius: 30 })], walls: walls, fixed: [],
        inventory: [{ type: 'splitter', count: 2 }, { type: 'mirror', count: 4 }], fog: FOG });
      LP.Scene.applySolution(sc, sol);
      return LP.Scene.evaluate(sc).receivers[0];
    }
    var ref = total(build(0.25, 0.35));
    multi({
      id: 'imp-90', chapter: 'impossible', name: 'Paradox',
      blurb: 'The lock opens for three separate beams of white -- and jams if they bring too much light.',
      hint: 'The long road through the smoke loses light. Send more of the lamp the long way than feels right.',
      fog: FOG, weather: 'murk',
      walls: walls,
      chains: [],
      extraEmitters: [E(L.x, L.y, 0, 'white', { intensity: 3.0 })],
      extraReceivers: [
        R(S0.x, S0.y, { color: 'white', minBeams: 3,
                        minIntensity: Math.round(ref.intensity * 940) / 1000,
                        maxIntensity: Math.round(ref.intensity * 1060) / 1000 }, { radius: 30 }),
        dark(600, 650), dark(1050, 280), dark(560, 120), dark(1480, 450)
      ],
      extraSolution: build(0.25, 0.35),
      inventory: [{ type: 'splitter', count: 2, preset: { length: 120, ratio: 0.5 } },
                  { type: 'mirror', count: 4, preset: { length: 110 } }],
      par: { objects: 6, bounces: 8 },
      tags: ['impossible', 'boss']
    });
  })();

  /* --- Level 92: more filters, more light. --------------------------------- */
  (function () {
    var L = { x: 120, y: 800 }, S0 = { x: 1480, y: 150 };
    var m0 = { x: 560, y: 800 }, m1 = { x: 560, y: 150 };
    var fixedP = [F('polarizer', 250, 800, 0, { radius: 40 }), F('polarizer', 1300, 150, 90, { radius: 40 })];
    var em = E(L.x, L.y, 0, 'white', { intensity: 3.0 });
    function withPolars(angles, spots) {
      return fixedP.concat([aim('mirror', m0, L, m1, { length: 120 }), aim('mirror', m1, m0, S0, { length: 120 })])
        .concat(angles.map(function (a, i) {
          return { type: 'polarizer', x: spots[i].x, y: spots[i].y, angle: rad(a), radius: 40 };
        }));
    }
    var spots3 = [{ x: 560, y: 600 }, { x: 560, y: 350 }, { x: 900, y: 150 }];
    var three = A.energyAt(withPolars([15, 45, 75], spots3), [em], S0, 30).intensity;
    var two = A.energyAt(withPolars([30, 60], spots3), [em], S0, 30).intensity;
    multi({
      id: 'imp-92', chapter: 'impossible', name: 'Malus Maze',
      blurb: 'A lock that wants upright light, behind crossed filters. Two filters in between let through too little.',
      hint: 'Each filter costs light, but a small turn costs far less than a big one. Three small turns beat two big ones.',
      walls: [W(640, 250, 40, 650), W(760, 0, 40, 100), W(0, 520, 180, 40)],
      fixed: fixedP,
      zones: [Z(480, 680, 160, 180), Z(480, 60, 160, 180), Z(480, 240, 150, 440), Z(700, 90, 540, 130)],
      chains: [],
      extraEmitters: [em],
      extraReceivers: [
        R(S0.x, S0.y, { color: 'any', minIntensity: Math.round((two + three) * 500) / 1000,
                        polarization: Math.PI / 2 }, { radius: 30 }),
        dark(1000, 280), dark(400, 650), dark(1480, 400)
      ],
      extraSolution: withPolars([15, 45, 75], spots3).slice(2),
      inventory: [{ type: 'mirror', count: 2, preset: { length: 120 } },
                  { type: 'polarizer', count: 3, preset: { radius: 40, angle: 0 } }],
      par: { objects: 5, bounces: 8 },
      tags: ['impossible']
    });
  })();

  /* --- Level 95: the sensor is behind solid wood. -------------------------- */
  (function () {
    var L = { x: 120, y: 120 };
    var glass = F('glass', 860, 450, 0, { w: 200, h: 140, material: 'flint' });
    var slabWalls = [W(760, 0, 200, 380), W(760, 520, 200, 380)];
    var asAbsorbers = slabWalls.map(function (w) {
      return { type: 'absorber', x: w.x + w.w / 2, y: w.y + w.h / 2, w: w.w, h: w.h, angle: 0 };
    });
    var em = E(L.x, L.y, 0, 'green', { intensity: 2.6 });
    var DIR = 35;
    var entry = { x: 760, y: 420 };
    var mp = { x: Math.round(entry.x - (entry.y - L.y) / Math.tan(rad(DIR))), y: L.y };
    var mirror = aim('mirror', mp, L, entry, { length: 120 });
    /* Where does the beam leave the pane, and where does it land? Measured. */
    var out = A.beamEnd([glass, mirror].concat(asAbsorbers), [em], { depth: 3, via: null, inside: false });
    var X = 1400;
    var land = { x: X, y: Math.round(out.a.y + (X - out.a.x) * out.dir.y / out.dir.x) };
    var naive = { x: X, y: Math.round(entry.y + (X - entry.x) * Math.tan(rad(DIR))) };
    multi({
      id: 'imp-95', chapter: 'impossible', name: 'The Wall',
      blurb: 'Two hundred units of solid wood between the lamp and the sensor. One pane of glass. The pane is not in line.',
      hint: 'A thick pane does not bend a beam -- it shifts it sideways. Aim for where the shifted beam will land, not where it looks like it goes.',
      walls: slabWalls.concat([W(1150, 0, 30, 560), W(1150, 880, 450, 20)]),
      fixed: [glass],
      zones: [Z(260, 60, 260, 130), Z(260, 700, 260, 150), Z(1250, 80, 300, 200)],
      chains: [],
      extraEmitters: [em],
      extraReceivers: [R(land.x, land.y, { color: 'green', minIntensity: 0.6 }, { radius: 28 }),
                       dark(naive.x, naive.y, 22), dark(X, land.y - 70, 22)],
      extraSolution: [mirror],
      inventory: [{ type: 'mirror', count: 2, preset: { length: 120 } }],
      par: { objects: 1, bounces: 4 },
      tags: ['impossible']
    });
  })();

  /* --- Level 96: ten turns through smoke, and no light to spare. ----------- */
  (function () {
    var spec = {
      id: 'imp-96', chapter: 'impossible', name: 'Last Light',
      blurb: 'Ten turns through smoke. Ninety per cent of the best route’s light is demanded at the end.',
      hint: 'There is exactly one shortest serpent through these walls. Every stray unit of path costs you.',
      fog: 0.0004, weather: 'murk',
      walls: [W(410, 220, 40, 680), W(670, 0, 40, 680), W(930, 220, 40, 680), W(1190, 0, 40, 640)],
      zones: [Z(230, 740, 140, 150), Z(230, 50, 140, 150), Z(490, 50, 140, 150), Z(490, 700, 140, 160),
              Z(750, 700, 140, 160), Z(750, 80, 140, 160), Z(1010, 80, 140, 160), Z(1010, 660, 140, 160),
              Z(1270, 660, 140, 160), Z(1270, 50, 140, 150)],
      chains: [{
        emitter: E(120, 820, 0, 'white', { intensity: 5.0 }),
        receiver: R(1480, 120, need(0.01)),
        path: [{ x: 300, y: 820 }, { x: 300, y: 120 }, { x: 560, y: 120 }, { x: 560, y: 780 },
               { x: 820, y: 780 }, { x: 820, y: 160 }, { x: 1080, y: 160 }, { x: 1080, y: 740 },
               { x: 1340, y: 740 }, { x: 1340, y: 120 }],
        length: 90
      }],
      par: { objects: 10, bounces: 10 },
      tags: ['impossible']
    };
    var lvl = multi(spec);
    var sc = LP.Scene.fromLevel(lvl);
    LP.Scene.applySolution(sc);
    lvl.receivers[0].require.minIntensity = Math.round(LP.Scene.evaluate(sc).receivers[0].intensity * 900) / 1000;
  })();

  /* --- Level 91: three colours out of one rainbow, each through the eye of a needle. */
  (function () {
    var prism = F('prism', 700, 470, 45, { radius: 96, material: 'flint' });
    var em = E(160, 530, 0, 'white', { intensity: 5.0 });
    var fanOrigin = A.beamEnd([prism], [em], { depth: 2, pick: 'brightest' }).a;
    /* The brightest crossing of a band -- the main fan, not a faint internal
     * reflection that happens to share its wavelength. */
    function crossing(fixed, nm, y) {
      var segs = A.probe(fixed, [em]).result.segments, best = null;
      segs.forEach(function (sg) {
        if (sg.wl === null || sg.inside || sg.via === 'fresnel' || sg.via === 'tir') return;
        if (Math.abs(sg.wl - nm) > 16) return;
        var dy = sg.b.y - sg.a.y;
        if (Math.abs(dy) < 1e-9) return;
        var t = (y - sg.a.y) / dy;
        if (t < 0 || t > 1) return;
        if (!best || sg.i0 > best.i) best = { x: Math.round((sg.a.x + (sg.b.x - sg.a.x) * t) * 10) / 10, y: y, i: sg.i0, from: sg.a };
      });
      if (!best) throw new Error('imp-91: no ' + nm + 'nm band crosses y=' + y);
      return best;
    }
    var mid = crossing([prism], 540, 150);
    var fold = F('mirror', mid.x, mid.y, M.deg(A.aimAngle(fanOrigin, mid, { x: 1320, y: 840 })), { length: 360 });
    var PICK_Y = 600;
    var base = [prism, fold];
    var picks = [
      { nm: 664, want: 640, to: { x: 1480, y: 130 } },
      { nm: 540, want: 540, to: { x: 900, y: 870 } },
      { nm: 416, want: 440, to: { x: 140, y: 840 } }
    ];
    var solution = [], receivers = [], all = base.slice();
    picks.forEach(function (p) {
      var c = crossing(base, p.nm, PICK_Y);
      var at = { x: c.x, y: c.y };
      p.at = at;
      var m = aim('mirror', at, c.from, p.to, { length: 34 });
      solution.push(m);
      all.push(m);
    });
    picks.forEach(function (p) {
      var e = A.energyAt(all, [em], p.to, 30).intensity;
      /* Under half of what the reference delivers: a pick mirror that catches
       * one band fewer than the answer still passes, a sloppy one does not. */
      receivers.push(R(p.to.x, p.to.y, { wavelength: p.want, wavelengthTolerance: 40,
                                         minIntensity: Math.max(0.02, Math.round(e * 450) / 1000) }, { radius: 30 }));
      /* Alarms either side of the approach, just short of the sensor. */
      var d = { x: p.to.x - p.at.x, y: p.to.y - p.at.y }, L = Math.sqrt(d.x * d.x + d.y * d.y);
      var u = { x: d.x / L, y: d.y / L }, n = { x: -u.y, y: u.x };
      var c = { x: p.to.x - u.x * 110, y: p.to.y - u.y * 110 };
      receivers.push(dark(Math.round(c.x + n.x * 72), Math.round(c.y + n.y * 72), 18));
      receivers.push(dark(Math.round(c.x - n.x * 72), Math.round(c.y - n.y * 72), 18));
    });
    multi({
      id: 'imp-91', chapter: 'impossible', name: 'Spectral Lock',
      blurb: 'Three locks, three colours, one white lamp. Each colour must be plucked out of a rainbow thinner than a finger.',
      hint: 'The fold mirror spreads the rainbow across the bench. The further it travels, the easier each colour is to pick out alone.',
      fixed: [prism, fold],
      chains: [],
      extraEmitters: [em],
      extraReceivers: receivers,
      extraSolution: solution,
      inventory: [{ type: 'mirror', count: 3, preset: { length: 34 } }],
      par: { objects: 3, bounces: 40 },
      tags: ['impossible']
    });
  })();

  /* --- Level 93: two mirrors that warp if you give them too much. ---------- */
  (function () {
    function thermal(x, y, deg, id) {
      return F('flex', x, y, deg, { id: id, length: 240, curvature: 0, material: 'silver', thermal: true,
        motion: { type: 'thermal', rate: 1.6, cool: 1.0, maxCurve: -0.70, threshold: 2.2, heatScale: 1.4, baseCurve: 0 } });
    }
    var L = { x: 130, y: 450 }, S = { x: 560, y: 450 };
    var T1 = { x: 1050, y: 450 }, T2 = { x: 1350, y: 120 };
    var A0 = { x: 1050, y: 800 }, B0 = { x: 1350, y: 600 };
    function build(r) {
      return [
        aim('splitter', S, L, { x: 560, y: 120 }, { length: 240, ratio: r }),
        aim('mirror', { x: 560, y: 120 }, S, T2, { length: 270 })
      ];
    }
    multi({
      id: 'imp-93', chapter: 'impossible', name: 'Heat Death',
      blurb: 'Two sensors, two heat-sensitive mirrors, one hot lamp. Too much light on either mirror and it warps.',
      hint: 'Each mirror can take only so much. Find the split that keeps both cool and both sensors fed -- the window is narrow.',
      fixed: [thermal(T1.x, T1.y, M.deg(A.aimAngle(S, T1, A0)), 'hdT1'),
              thermal(T2.x, T2.y, M.deg(A.aimAngle({ x: 560, y: 120 }, T2, B0)), 'hdT2')],
      chains: [],
      extraEmitters: [E(L.x, L.y, 0, 'white', { width: 180, rays: 13, intensity: 4.0 })],
      extraReceivers: [R(A0.x, A0.y, need(0.9), { radius: 95 }), R(B0.x, B0.y, need(0.9), { radius: 95 }),
                       dark(1480, 860), dark(700, 860)],
      extraSolution: build(0.5),
      inventory: [{ type: 'splitter', count: 1, preset: { length: 240, ratio: 0.2 } },
                  { type: 'mirror', count: 1, preset: { length: 270 } }],
      par: { objects: 2, bounces: 40 },
      holdTime: 4.0, simWindow: 26,
      tags: ['impossible', 'thermal']
    });
  })();

  /* --- Level 94: two orbits that agree for a moment every twenty-five seconds. */
  (function () {
    var L = { x: 120, y: 60 };
    var C1 = { x: 700, y: 500 }, R1 = 140, W1 = 0.5;
    var C2 = { x: 1150, y: 350 }, R2 = 120, W2 = -0.75;
    var TSTAR = 6.0;
    var P1 = { x: 700, y: 360 }, P2 = { x: 1150, y: 470 }, S0 = { x: 1450, y: 800 };
    var feed = { x: 700, y: 60 };
    var ph1 = -Math.PI / 2 - W1 * TSTAR, ph2 = Math.PI / 2 - W2 * TSTAR;
    var a1 = A.aimAngle(feed, P1, P2), a2 = A.aimAngle(P1, P2, S0);
    multi({
      id: 'imp-94', chapter: 'impossible', name: 'Orrery',
      blurb: 'Two mirrors orbiting at different speeds. The light gets through only when both are in the right place at once.',
      hint: 'Neither orbiting mirror ever turns -- only moves. Feed the first one straight down from above, then wait for the planets.',
      fixed: [
        F('mirror', P1.x, P1.y, M.deg(a1), { length: 150, material: 'gold',
          motion: { type: 'orbit', center: C1, radius: R1, speed: W1, phase: ph1 } }),
        F('mirror', P2.x, P2.y, M.deg(a2), { length: 150, material: 'gold',
          motion: { type: 'orbit', center: C2, radius: R2, speed: W2, phase: ph2 } }),
        F('mirror', 400, 700, 20, { length: 130, material: 'gold',
          motion: { type: 'orbit', center: { x: 400, y: 700 }, radius: 110, speed: 0.9 } }),
        F('mirror', 1400, 150, 0, { length: 120, material: 'gold', motion: { type: 'turntable', speed: 0.6 } })
      ],
      zones: [Z(620, 26, 160, 110), Z(1000, 700, 200, 150), Z(200, 380, 200, 160)],
      chains: [],
      extraEmitters: [E(L.x, L.y, 0, 'white', { intensity: 2.6 })],
      extraReceivers: [R(S0.x, S0.y, need(0.3), { radius: 56 }), dark(1480, 560), dark(1180, 860)],
      extraSolution: [aim('mirror', feed, L, P1, { length: 130 })],
      inventory: [{ type: 'mirror', count: 2, preset: { length: 130 } }],
      par: { objects: 1, bounces: 3 },
      holdTime: 0.25, simWindow: 26,
      tags: ['impossible']
    });
  })();

  /* --- Level 97: FINAL BOSS. Four phases against the clock, each one harder. -- */
  (function () {
    var V = LP.V;
    var LR = { x: 120, y: 140 }, LG = { x: 120, y: 450 }, LB = { x: 120, y: 760 };
    var P1 = { x: 650, y: 450 }, P2 = { x: 960, y: 450 }, GATE = { x: 1350, y: 450 };
    var dR = V.norm({ x: P1.x - 420, y: P1.y - 140 }), dB = V.norm({ x: P1.x - 420, y: P1.y - 760 });
    var mr1 = aim('mirror', { x: 420, y: 140 }, LR, P1, { length: 120 });
    var mb1 = aim('mirror', { x: 420, y: 760 }, LB, P1, { length: 120 });
    var mr2p = { x: Math.round(P2.x + dR.x * 220), y: Math.round(P2.y + dR.y * 220) };
    var mb2p = { x: Math.round(P2.x + dB.x * 220), y: Math.round(P2.y + dB.y * 220) };
    var mr2 = aim('mirror', mr2p, P2, GATE, { length: 120 });
    var mb2 = aim('mirror', mb2p, P2, GATE, { length: 120 });
    var alarmR = { x: Math.round(P2.x + dR.x * 430), y: Math.round(P2.y + dR.y * 430) };
    var alarmB = { x: Math.round(P2.x + dB.x * 430), y: Math.round(P2.y + dB.y * 430) };
    var lamps = [E(LR.x, LR.y, 0, 'red', { id: 'imR', intensity: 1.6 }),
                 E(LG.x, LG.y, 0, 'green', { id: 'imG', intensity: 1.25 }),
                 E(LB.x, LB.y, 0, 'blue', { id: 'imB', intensity: 1.6 })];
    var portals = [F('portal', P1.x, P1.y, 0, { id: 'imPA', link: 'imPB', radius: 36 }),
                   F('portal', P2.x, P2.y, 0, { id: 'imPB', link: 'imPA', radius: 36 })];
    var wallAbs = { type: 'absorber', x: 805, y: 450, w: 50, h: 900, angle: 0 };

    /* Measure what the gate receives in phases one and three, so each white
     * lock asks for most -- but not all -- of three balanced beams. */
    var gate1 = A.energyAt(portals.concat([wallAbs, mr1, mb1, mr2, mb2]), lamps, GATE, 44).intensity;
    var mr3 = aim('mirror', { x: 420, y: 140 }, LR, GATE, { length: 120 });
    var mb3 = aim('mirror', { x: 420, y: 760 }, LB, GATE, { length: 120 });
    var gate3 = A.energyAt([mr2, mb2, mr3, mb3], lamps, GATE, 44).intensity;

    timed({
      id: 'imp-97', chapter: 'impossible', name: 'The Impossible',
      blurb: 'Four phases, four clocks, and the bench is rebuilt under you every time. This is the last door.',
      hint: 'Every phase undoes something the last one needed. Read what changed before you move a single piece.',
      emitters: lamps,
      fixed: [untilPhase(3, portals[0]), untilPhase(3, portals[1])],
      walls: [Wp(780, 0, 50, 900, 0, 3)],
      zones: [Z(300, 60, 420, 780), Z(1000, 120, 240, 660)],
      receivers: [
        untilPhase(2, R(GATE.x, GATE.y, { color: 'white', minIntensity: Math.round(gate1 * 820) / 1000 }, { id: 'imW', radius: 44 })),
        inPhase(2, untilPhase(3, R(GATE.x, GATE.y, { color: 'green', minIntensity: 0.25, polarization: Math.PI / 2 },
                                   { id: 'imPZ', radius: 44 }))),
        inPhase(3, R(GATE.x, GATE.y, { color: 'white', minIntensity: Math.round(gate3 * 850) / 1000 }, { id: 'imW3', radius: 44 })),
        inPhase(4, R(320, 330, { color: 'red', minIntensity: 0.2 }, { id: 'imZ4', radius: 26 })),
        dark(alarmR.x, alarmR.y, 26), dark(alarmB.x, alarmB.y, 26),
        inPhase(4, dark(320, 36, 22))
      ],
      inventory: [{ type: 'mirror', count: 4, preset: { length: 120 } }],
      phases: [
        { name: 'White light', time: 45,
          hint: 'Aim every lamp at the centre of the near gate; each leaves the far gate on the same line. Then turn each onto the lock.',
          solution: [mr1, mb1, mr2, mb2] },
        { name: 'Polar lock', time: 35,
          hint: 'The lock wants green alone, turned upright. Cut red and blue before the gate -- not after, or the alarms see them.',
          inventory: [{ type: 'polarizer', count: 1, preset: { radius: 36, angle: 0 } }],
          solution: [{ remove: 0 }, { remove: 1 }, { type: 'polarizer', x: 1150, y: 450, angle: rad(90), radius: 36 }] },
        { name: 'Collapse', time: 30,
          hint: 'The wall and the gates are gone. White again, straight across -- and that filter is now in green’s way.',
          solution: [{ remove: 4 }, mr3, mb3] },
        { name: 'The last door', time: 30, goals: ['imW3', 'imZ4'],
          hint: 'Tap red before its mirror, downward, with a splitter set low. Too much and the white lock goes cold.',
          inventory: [{ type: 'splitter', count: 1, preset: { length: 90, ratio: 0.5 } }],
          solution: [aim('splitter', { x: 320, y: 140 }, LR, { x: 320, y: 330 }, { length: 90, ratio: 0.2 })] }
      ],
      tags: ['impossible', 'boss', 'finale']
    });
  })();


  /* ==========================================================================
   * SANDBOXES -- no targets, no par. Just the optics and room to play.
   * ======================================================================= */

  multi({
    id: 'sbx-1', chapter: 'sandbox', name: 'Optical Bench',
    blurb: 'One white source and a full drawer. Nothing to solve.',
    chains: [],
    extraEmitters: [E(120, 450, 0, 'white', { intensity: 1.6 })],
    extraReceivers: [],
    extraSolution: [],
    inventory: [
      { type: 'mirror', count: 6 }, { type: 'concave', count: 2 },
      { type: 'convex', count: 2 }, { type: 'flex', count: 2 },
      { type: 'prism', count: 2 }, { type: 'lens', count: 2 },
      { type: 'splitter', count: 3 }, { type: 'filter', count: 3 },
      { type: 'polarizer', count: 2 }, { type: 'grating', count: 1 },
      { type: 'oneway', count: 2 }, { type: 'glass', count: 2 }
    ],
    sandbox: true
  });

  multi({
    id: 'sbx-2', chapter: 'sandbox', name: 'Prism Table',
    blurb: 'Four sources, four wavelengths, and as much glass as you like.',
    chains: [],
    extraEmitters: [
      E(120, 200, 15, 'white', { intensity: 1.4 }),
      E(120, 400, 5, 650, { intensity: 1.2 }),
      E(120, 600, -5, 530, { intensity: 1.2 }),
      E(120, 800, -15, 460, { intensity: 1.2 })
    ],
    extraReceivers: [],
    extraSolution: [],
    inventory: [
      { type: 'prism', count: 4 }, { type: 'lens', count: 3 },
      { type: 'glass', count: 3 }, { type: 'mirror', count: 4 },
      { type: 'grating', count: 2 }
    ],
    sandbox: true
  });

  multi({
    id: 'sbx-3', chapter: 'sandbox', name: 'Colour Mixer',
    blurb: 'Three primaries. See what lands where.',
    chains: [],
    extraEmitters: [
      E(120, 200, 20, 'red', { intensity: 1.5 }),
      E(120, 450, 0, 'green', { intensity: 1.5 }),
      E(120, 700, -20, 'blue', { intensity: 1.5 })
    ],
    extraReceivers: [
      R(1450, 250, { color: 'any', minIntensity: 0.2 }, { radius: 40 }),
      R(1450, 450, { color: 'any', minIntensity: 0.2 }, { radius: 40 }),
      R(1450, 650, { color: 'any', minIntensity: 0.2 }, { radius: 40 })
    ],
    extraSolution: [],
    inventory: [
      { type: 'mirror', count: 6 }, { type: 'splitter', count: 4 },
      { type: 'filter', count: 4 }, { type: 'convex', count: 2 }
    ],
    sandbox: true
  });

  multi({
    id: 'sbx-4', chapter: 'sandbox', name: 'Moving Parts',
    blurb: 'A turntable, a pendulum and a rail, all running at once.',
    chains: [],
    fixed: [
      F('mirror', 600, 300, 0, { length: 180, material: 'gold',
        motion: { type: 'turntable', speed: 0.5 } }),
      F('mirror', 1000, 600, 0, { length: 180, material: 'gold',
        motion: { type: 'pendulum', pivot: { x: 1000, y: 260 }, len: 340,
                  release: 0.7, damping: 0.02 } }),
      F('mirror', 500, 750, 45, { length: 160, material: 'gold',
        motion: { type: 'track', from: { x: 400, y: 750 }, to: { x: 900, y: 750 },
                  period: 6 } })
    ],
    chains: [],
    extraEmitters: [E(120, 300, 0, 'white', { intensity: 1.8 })],
    extraReceivers: [],
    extraSolution: [],
    inventory: [
      { type: 'mirror', count: 5 }, { type: 'splitter', count: 2 },
      { type: 'prism', count: 2 }, { type: 'concave', count: 2 }
    ],
    sandbox: true
  });


  LP.Levels = { CHAPTERS: CHAPTERS, LEVELS: LEVELS, _multi: multi, _clone: clone };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
