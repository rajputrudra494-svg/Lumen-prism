/* =============================================================================
 * Lumen Path - src/game/levels.js
 * -----------------------------------------------------------------------------
 * The level catalogue: 71 hand-designed levels across 10 themed chapters, plus
 * sandboxes.
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
      weather: spec.weather
    };
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
                 angle: A.aimAngle(fanOrigin, mid, { x: 430, y: 800 }) };

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
    var wedge = { type: 'glass', x: 820, y: 420, angle: rad(22),
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

  /* --- Level 43: a pendulum you aim by choosing where to let it go. ------- */
  (function () {
    /* A pendulum is momentarily STILL at the top of its swing, so that is the
     * only place it can hold a beam on target. Fixing the mirror's mounting
     * angle and letting the release point set the rest means there is exactly
     * one height it can be let go from -- which is the whole puzzle. */
    var PIVOT = { x: 850, y: 200 };
    var DROP = { x: 980, y: 560 };
    var SRC = { x: 140, y: 560 }, TGT = { x: 1420, y: 300 };
    var release = Math.atan2(DROP.x - PIVOT.x, DROP.y - PIVOT.y);
    var BASE = A.aimAngle(SRC, DROP, TGT) - release;

    multi({
      id: 'clk-43', chapter: 'clockwork', name: 'Release',
      blurb: 'You do not steer this mirror. You choose the height you drop it from.',
      hint: 'Drop it further out and it swings wider and slower. Gravity handles the rest.',
      chains: [],
      zones: [Z(620, 260, 460, 420)],
      extraEmitters: [E(SRC.x, SRC.y, 0, 'white', { intensity: 1.8 })],
      extraReceivers: [R(TGT.x, TGT.y, need(0.25), { radius: 46 })],
      extraSolution: [{
        type: 'mirror', x: DROP.x, y: DROP.y, length: 170, angle: 0,
        motion: { type: 'pendulum', pivot: PIVOT, damping: 0.0, baseAngle: BASE }
      }],
      inventory: [{ type: 'mirror', count: 1, preset: {
        length: 170,
        motion: { type: 'pendulum', pivot: PIVOT, damping: 0.0, baseAngle: BASE }
      } }],
      par: { objects: 1, bounces: 1 },
      holdTime: 0.25, simWindow: 30
    });
  })();

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
      tags: ['boss', 'finale']
    };
    var lvl = multi(spec);
    /* Demand more than any two of the three beams can deliver together. */
    var sc = LP.Scene.fromLevel(lvl);
    LP.Scene.applySolution(sc);
    var total = LP.Scene.evaluate(sc).receivers[0].intensity;
    lvl.receivers[0].require.minIntensity = Math.round(total * 820) / 1000;
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
