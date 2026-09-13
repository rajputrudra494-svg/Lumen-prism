/* =============================================================================
 * Lumen Path - src/game/levels.js
 * -----------------------------------------------------------------------------
 * The level catalogue: 55 hand-designed levels across 8 themed chapters, plus
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
      bg: '#0d1220', grid: '#1b2740', accent: '#5ad7ff', glow: '#7ef0ff', mood: 'clinical' },
    { id: 'observatory', name: 'The Observatory', teaches: 'Curved mirrors',
      blurb: 'Big glass under a colder sky. Learn to gather light, not just bend it.',
      bg: '#0a0f1e', grid: '#1d2242', accent: '#ffc46b', glow: '#ffd9a0', mood: 'vast' },
    { id: 'caves', name: 'Crystal Caves', teaches: 'Refraction & dispersion',
      blurb: 'Every wall is a prism. White light does not stay white down here.',
      bg: '#150a24', grid: '#31184a', accent: '#c98bff', glow: '#e7c0ff', mood: 'resonant' },
    { id: 'reef', name: 'Sunken Reef', teaches: 'Absorption & filters',
      blurb: 'Light drowns quickly. Waste none of it.',
      bg: '#031c24', grid: '#0b3742', accent: '#4fe0c4', glow: '#a5fff0', mood: 'muffled' },
    { id: 'neon', name: 'Neon Quarter', teaches: 'Splitting & polarisation',
      blurb: 'One beam is never enough in a city that runs on signal.',
      bg: '#12061c', grid: '#331046', accent: '#ff5ec4', glow: '#ff9ede', mood: 'pulsing' },
    { id: 'deepspace', name: 'Deep Space Relay', teaches: 'Portals & gratings',
      blurb: 'Photons are rationed out here. Spend them carefully.',
      bg: '#04040c', grid: '#141430', accent: '#8fa8ff', glow: '#cdd8ff', mood: 'sparse' },
    { id: 'clockwork', name: 'Clockwork Tower', teaches: 'Timing & motion',
      blurb: 'Nothing here holds still. Aim at where the mirror will be.',
      bg: '#1a1206', grid: '#3d2c11', accent: '#ffb347', glow: '#ffdca8', mood: 'ticking' },
    { id: 'aurora', name: 'Aurora Fields', teaches: 'Heat & colour mixing',
      blurb: 'The sky does the mixing. You just have to keep the glass cool.',
      bg: '#04140f', grid: '#0f3327', accent: '#6bffab', glow: '#c4ffe0', mood: 'shimmering' },
    { id: 'sandbox', name: 'Open Bench', teaches: 'Nothing at all',
      blurb: 'No targets, no par, no clock. Take the optics apart and see.',
      bg: '#0e0e14', grid: '#242434', accent: '#dddde8', glow: '#ffffff', mood: 'quiet' }
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
      hint: 'Select the splitter and drag its ratio dial. It does not have to be an even split.',
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
