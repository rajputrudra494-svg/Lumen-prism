/* =============================================================================
 * Lumen Path - tools/test-content.js
 * -----------------------------------------------------------------------------
 * Checks the generated and serialised content, as opposed to the hand-authored
 * levels that tools/verify.js covers:
 *
 *   - every daily challenge for the next two years is generated, solvable,
 *     deterministic, and not a free win
 *   - every shipped level survives a share-code round trip unchanged
 *   - the rules of timed levels in phases: the clock, pausing, rewinds,
 *     restarts, stars
 *   - the hard levels are hard in the ways they claim
 * ========================================================================== */
'use strict';
const { loadCore } = require('./load');
const LP = loadCore();
const { Daily, Share, Scene, Levels, Phases } = LP;

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) pass++; else { fail++; failures.push(name + (detail ? '  -> ' + detail : '')); }
}

/* ---- 1. Daily challenges ------------------------------------------------ */
const DAYS = 730;
const start = new Date(Date.UTC(2026, 0, 1));
const templateCount = {};
let worstAttempts = 0;
let generated = 0;

for (let i = 0; i < DAYS; i++) {
  const d = new Date(start.getTime() + i * 86400000);
  const key = Daily.dateKey(d);
  const lvl = Daily.generate(key);
  generated++;
  templateCount[lvl.template] = (templateCount[lvl.template] || 0) + 1;
  worstAttempts = Math.max(worstAttempts, lvl.attempts || 1);

  if (!Daily.isPlayable(lvl)) {
    ok('daily ' + key + ' is playable', false, 'template=' + lvl.template);
    continue;
  }
  pass++;

  /* Determinism: the same key must produce an identical level. */
  if (i % 37 === 0) {
    const again = Daily.generate(key);
    ok('daily ' + key + ' is deterministic',
       JSON.stringify(again.solution) === JSON.stringify(lvl.solution) &&
       JSON.stringify(again.emitters) === JSON.stringify(lvl.emitters));
  }
}
ok('every daily used a real template, not the fallback',
   !templateCount.fallback, 'fallbacks=' + (templateCount.fallback || 0));
ok('daily generation rarely needs many retries', worstAttempts <= 12,
   'worst=' + worstAttempts);
ok('daily templates all get used', Object.keys(templateCount).length >= 4,
   JSON.stringify(templateCount));

/* ---- 2. Share-code round trips ------------------------------------------ */
for (const lvl of Levels.LEVELS) {
  let code, back;
  try {
    code = Share.encodeLevel(lvl);
    back = Share.decodeLevel(code);
  } catch (e) {
    ok('share round trip: ' + lvl.id, false, String(e.message || e));
    continue;
  }

  ok('share code is URL-safe: ' + lvl.id, /^[A-Za-z0-9\-_]+$/.test(code));

  /* The decoded level must still be solvable by its own solution. */
  if (lvl.sandbox) { pass++; continue; }
  if (lvl.phases) {
    try {
      const rep = Phases.simulate(back);
      ok('decoded timed level still plays through: ' + lvl.id,
         rep.completed && back.phases.length === lvl.phases.length,
         'failed at phase ' + (rep.failedAt + 1));
    } catch (e) {
      ok('decoded timed level still plays through: ' + lvl.id, false, String(e.message || e));
    }
    continue;
  }
  try {
    const sc = Scene.fromLevel(back);
    const placed = Scene.applySolution(sc, back.solution);
    const ev = lvl.holdTime
      ? (function () {
          let r = null;
          for (let t = 0; t < (lvl.simWindow || 24); t += 1 / 60) {
            r = Scene.tickSolve(sc, 1 / 60);
            if (r.solved) break;
          }
          return r;
        })()
      : Scene.evaluate(sc);
    ok('decoded level still solves: ' + lvl.id,
       placed === back.solution.length && (ev.solved || ev.allLit),
       'placed ' + placed + '/' + back.solution.length);
  } catch (e) {
    ok('decoded level still solves: ' + lvl.id, false, String(e.message || e));
  }
}

/* ---- 3. Malformed share codes must be rejected, not crash the game ------ */
const bad = [
  'not-base64!!', '', 'e30',
  Share.toB64Url(JSON.stringify({ v: 99, name: 'future' })),
  Share.toB64Url(JSON.stringify({ emitters: [] })),
  Share.toB64Url(JSON.stringify({ emitters: [{ t: 'emitter', x: 1, y: 1 }], world: { w: 9e9, h: 9e9 } }))
];
for (const b of bad) {
  let threw = false;
  try { Share.decodeLevel(b); } catch (e) { threw = true; }
  ok('rejects malformed code: ' + JSON.stringify(b.slice(0, 24)), threw);
}

/* An oversized inventory is clamped rather than rejected: a hostile code
 * should not be able to hang the game, but a merely greedy one should still
 * open. */
const clamped = Share.decodeLevel(Share.toB64Url(JSON.stringify({
  emitters: [{ t: 'emitter', x: 100, y: 100 }],
  inventory: [{ t: 'mirror', n: 9999 }]
})));
ok('clamps an absurd inventory instead of hanging',
   clamped.inventory[0].count <= 40, 'count=' + clamped.inventory[0].count);

/* Coordinates far outside the world must be pulled back into range. */
const wild = Share.decodeLevel(Share.toB64Url(JSON.stringify({
  emitters: [{ t: 'emitter', x: 1e9, y: -1e9 }]
})));
ok('clamps wild coordinates',
   Math.abs(wild.emitters[0].x) <= 2100 && Math.abs(wild.emitters[0].y) <= 2100,
   wild.emitters[0].x + ',' + wild.emitters[0].y);

/* ---- 4. Inventory slots with distinct presets ---------------------------
 * cav-18 hands out one red, one green and one blue filter. Asking for blue
 * three times must yield exactly one blue, not three built out of the other
 * two allowances. */
(function () {
  const lvl = Levels.LEVELS.find(l => l.id === 'cav-18');
  const sc = Scene.fromLevel(lvl);
  /* Exactly what the inventory tray hands to Scene.place. */
  const blue = sc.inventory.find(s => s.preset && s.preset.color === 'blue').preset;
  const placed = [];
  for (let i = 0; i < 3; i++) {
    const el = Scene.place(sc, 'filter', 300 + i * 60, 800, blue, blue);
    if (el) placed.push(el.color);
  }
  ok('a preset-bound slot cannot be overdrawn',
     placed.length === 1 && placed[0] === 'blue', JSON.stringify(placed));

  /* Returning it must credit the blue slot, not another colour's. */
  const el = sc.elements.filter(e => e.fromInventory).pop();
  Scene.remove(sc, el);
  const blueSlot = sc.inventory.find(s => s.preset && s.preset.color === 'blue');
  ok('returning an object credits its own slot', blueSlot.used === 0,
     sc.inventory.map(s => s.preset.color + ':' + s.used).join(' '));

  /* A level with one undifferentiated pool still hands out freely. */
  const plain = Scene.fromLevel(Levels.LEVELS.find(l => l.id === 'lab-6'));
  let n = 0;
  for (let i = 0; i < 6; i++) if (Scene.place(plain, 'mirror', 200 + i * 90, 500)) n++;
  ok('an undifferentiated pool is still fully usable', n === 4, 'placed ' + n);
})();

/* ---- 5. The editor ------------------------------------------------------
 * The editor never touches the DOM, so it can be driven headlessly. */
(function () {
  const { Editor, Share } = LP;
  const ed = Editor.create({});
  ed.load(Editor.blankLevel('Test Bench'));

  ok('a freshly loaded draft has nothing to save', ed.dirty === false);

  ed.beginPlace('prism');
  const placed = ed.placeAt(900, 300);
  ok('the editor places an object', !!placed && ed.level.fixed.length === 1);
  ok('placing marks the draft unsaved', ed.dirty === true);
  ok('the live scene picks the object up',
     ed.scene.elements.some(e => e.type === 'prism'));

  const code = ed.exportCode();
  const back = Share.decodeLevel(code);
  ok('the draft round-trips through a share code',
     back.fixed.length === 1 && back.fixed[0].type === 'prism' &&
     Math.round(back.fixed[0].x) === 900, JSON.stringify(back.fixed));

  /* A blank level aims its emitter straight at its sensor, so it must be
   * reported as an unpublishable free win. */
  const v1 = ed.validate();
  ok('an already-solved draft is refused',
     !v1.ok && v1.problems.some(p => /already lit/.test(p)), JSON.stringify(v1.problems));

  /* Portals are created and removed in pairs -- a lone one silently eats light. */
  const ed2 = Editor.create({});
  ed2.load(Editor.blankLevel('Portals'));
  ed2.beginPlace('portal');
  ed2.placeAt(600, 300);
  const portals = ed2.level.fixed.filter(f => f.type === 'portal');
  ok('portals are created as a linked pair', portals.length === 2 &&
     portals[0].link === portals[1].id && portals[1].link === portals[0].id);
  ok('a linked pair passes the portal check',
     !ed2.validate().problems.some(p => /no linked twin/.test(p)));

  ed2.selected = ed2.scene.elements.find(e => e.type === 'portal');
  ed2.deleteSelected();
  ok('deleting one portal removes its twin too',
     ed2.level.fixed.filter(f => f.type === 'portal').length === 0,
     String(ed2.level.fixed.filter(f => f.type === 'portal').length));

  /* Capturing an answer must refuse an unsolved board. */
  const r = ed.captureSolution();
  ok('an unsolved board cannot become the reference answer', r.ok === false, r.why);
})();

/* ---- 6. The hard levels are hard in the ways they claim -----------------
 * Solvability is checked by verify.js. These check the DIFFICULTY: that the
 * shortcut each level's blurb rules out really is ruled out by the physics. */
(function () {
  const { M } = LP;
  const find = id => Levels.LEVELS.find(l => l.id === id);
  function litWith(lvl, mutate) {
    const sc = Scene.fromLevel(lvl);
    const sol = JSON.parse(JSON.stringify(lvl.solution));
    mutate(sol, sc);
    Scene.applySolution(sc, sol);
    return Scene.evaluate(sc);
  }

  /* spr-59: an even first split must leave the hungry sensor short. */
  const s59 = find('spr-59');
  const even = litWith(s59, sol => { sol[0].ratio = 0.5; });
  ok('spr-59: an even split cannot feed the far sensor', !even.receivers[0].lit,
     even.receivers[0].reason + ' I=' + even.receivers[0].intensity.toFixed(3));
  const lean = litWith(s59, sol => { sol[0].ratio = 0.9; });
  ok('spr-59: over-leaning the split starves the far end', !lean.allLit);

  /* hzn-65: NO single intermediate polariser, at any angle, passes enough. */
  const h65 = find('hzn-65');
  let bestSingle = 0;
  for (let deg = 0; deg <= 90; deg += 1) {
    const ev = litWith(h65, sol => {
      sol.length = 0;
      sol.push({ type: 'polarizer', x: 800, y: 450, angle: M.rad(deg), radius: 46 });
    });
    bestSingle = Math.max(bestSingle, ev.receivers[0].intensity);
    if (ev.allLit) { ok('hzn-65: one polariser can never unlock it', false, 'lit at ' + deg + 'deg'); break; }
  }
  ok('hzn-65: the best single polariser still falls short',
     bestSingle < h65.receivers[0].require.minIntensity,
     bestSingle.toFixed(4) + ' < ' + h65.receivers[0].require.minIntensity);

  /* hzn-71: any two of the three lamps are not enough white. */
  const h71 = find('hzn-71');
  [[0, 2], [1, 3], [0, 1], [2, 3]].forEach(([a, b]) => {
    /* Dropping the relay pair for one lamp removes that lamp from the gate. */
    const ev = litWith(h71, sol => { sol.splice(b, 1); sol.splice(a, 1); });
    ok('hzn-71: removing one lamp path leaves the gate shut (' + a + ',' + b + ')', !ev.receivers[0].lit,
       ev.receivers[0].reason);
  });

  /* spr-60: neither red nor green alone opens the yellow gate. */
  const s60 = find('spr-60');
  const noGreen = litWith(s60, sol => { sol.splice(2, 1); });
  ok('spr-60: red alone does not open the yellow gate', !noGreen.receivers[0].lit, noGreen.receivers[0].reason);

  /* hzn-69: the default splitter setting overheats the thermal mirror. */
  const h69 = find('hzn-69');
  const sc = Scene.fromLevel(h69);
  const sol = JSON.parse(JSON.stringify(h69.solution));
  sol[0].ratio = 0.2;
  Scene.applySolution(sc, sol);
  let solved = false;
  for (let t = 0; t < 20; t += 1 / 60) { if (Scene.tickSolve(sc, 1 / 60).solved) { solved = true; break; } }
  ok('hzn-69: leaving the splitter at its default ratio fails', !solved);

  /* Every boss level is tagged, and the final chapter ends on one. */
  const bosses = Levels.LEVELS.filter(l => (l.tags || []).indexOf('boss') >= 0).map(l => l.id);
  ok('boss levels exist in the hard chapters',
     ['spr-60', 'spr-63', 'hzn-70', 'hzn-71', 'mir-79', 'zro-87', 'imp-90', 'imp-97']
       .every(id => bosses.indexOf(id) >= 0), bosses.join(','));
  const finales = Levels.LEVELS.filter(l => (l.tags || []).indexOf('finale') >= 0 && (l.tags || []).indexOf('boss') >= 0).map(l => l.id);
  ok('exactly one final boss, and it is the last story level',
     finales.length === 1 && finales[0] === Levels.LEVELS.filter(l => !l.sandbox).pop().id, finales.join(','));
  ok('the pendulum level "Release" is gone', !Levels.LEVELS.some(l => l.id === 'clk-43'));
})();

/* ---- 7. Timed levels in phases ----------------------------------------------
 * The rules a player lives by: the clock waits until started, stops for menus,
 * and a phase that runs out of time rewinds -- pieces, tray and all. */
(function () {
  const dt = 1 / 60;
  const lvl = Levels.LEVELS.find(l => l.id === 'zro-80');
  const sc = Scene.fromLevel(lvl);
  Phases.init(sc);
  const ps = sc.phase;
  ok('a timed level waits, armed, until the clock is started', ps.state === 'armed');
  for (let i = 0; i < 120; i++) Phases.tick(sc, dt);
  ok('an armed clock does not run', ps.state === 'armed' && ps.timeLeft === lvl.phases[0].time);
  ok('later hardware starts switched off',
     sc.elements.filter(e => e.phase === 2).every(e => e.disabled) &&
     sc.elements.filter(e => e.phase === undefined && e.until === undefined).every(e => !e.disabled));

  Phases.start(sc);
  let t = 0;
  while (ps.state !== 'running' && t < 5) { Phases.tick(sc, dt); t += dt; }
  ok('the count-in hands over to a running clock', ps.state === 'running' &&
     Math.abs(t - Phases.INTRO_TIME) < 0.05, t.toFixed(2));

  const before = ps.timeLeft;
  for (let i = 0; i < 60; i++) Phases.tick(sc, dt, { paused: true });
  ok('the clock stops while a menu is open', ps.timeLeft === before);

  /* A wrong piece, then let the clock run out. */
  Scene.place(sc, 'mirror', 500, 700, { angle: 0.4 });
  const events = [];
  for (let i = 0; i < 60 * 40 && !(ps.attempt > 1 && ps.state === 'intro'); i++) {
    Phases.tick(sc, dt).events.forEach(e => events.push(e.type));
  }
  ok('running out of time fires a timeout, then a rewind',
     events.indexOf('timeout') >= 0 && events.indexOf('rewound') > events.indexOf('timeout') &&
     events.indexOf('retry') > events.indexOf('rewound'), events.filter(e => e !== 'second').join(' '));
  ok('a rewind takes the phase’s pieces back to the tray',
     sc.elements.filter(e => e.fromInventory).length === 0 && sc.inventory.every(s => s.used === 0));
  ok('a rewind winds the clock back up and counts the attempt',
     ps.timeLeft === lvl.phases[0].time && ps.attempt === 2 && ps.failures === 1);

  const evs = Phases.restartPhase(sc);
  ok('restarting a phase costs an attempt, like a timeout', !!evs && ps.failures === 2 && ps.attempt === 3);

  ok('stars on a timed level: 3 clean, 2 for up to two rewinds, 1 beyond',
     Phases.stars({ failures: 0 }) === 3 && Phases.stars({ failures: 2 }) === 2 && Phases.stars({ failures: 3 }) === 1);

  /* Clearing phase one installs phase two. */
  while (ps.state !== 'running') Phases.tick(sc, dt);
  Phases.applyMoves(sc, lvl.phases[0].solution, []);
  while (ps.state === 'running' || ps.state === 'clear') Phases.tick(sc, dt);
  const byId = id => sc.receivers.find(r => r.id === id);
  ok('clearing a phase moves on to the next', ps.index === 1);
  ok('the next phase’s sensor becomes the goal; the last one is latched',
     byId('z80B').goal === true && !byId('z80B').disabled && byId('z80A').latched === true && byId('z80A').goal === false);
  ok('the next phase’s wall rises', sc.elements.filter(e => e.isWall && e.phase === 2).every(e => !e.disabled));
  ok('alarms are watched in every phase they stand in',
     sc.receivers.filter(r => r.require && r.require.dark && !r.disabled).every(r => r.goal === true));

  /* Every timed level: replays rebuild the last phase's bench. */
  Levels.LEVELS.filter(l => l.phases).forEach(l => {
    const f = Phases.fastForward(Scene.fromLevel(l));
    const granted = l.inventory.length + l.phases.reduce((a, p) => a + (p.inventory || []).length, 0);
    ok('fast-forward reaches the final phase with every piece handed out: ' + l.id,
       f.phase.index === l.phases.length - 1 && f.inventory.length === granted);
  });
})();

/* ---- 8. The last three chapters are hard in the ways they claim -------------- */
(function () {
  const { M, Authoring: A } = LP;
  const find = id => Levels.LEVELS.find(l => l.id === id);
  const copy = o => JSON.parse(JSON.stringify(o));
  function evalWith(lvl, sol) {
    const sc = Scene.fromLevel(lvl);
    Scene.applySolution(sc, sol);
    return Scene.evaluate(sc);
  }

  /* Hall of Mirages: a crowded bench, a short answer. */
  Levels.LEVELS.filter(l => l.chapter === 'mirage').forEach(l => {
    const clutter = (l.fixed || []).length + (l.walls || []).length + l.receivers.length;
    ok('mirage level looks crowded but has a short answer: ' + l.id,
       l.solution.length <= 2 && clutter >= 8, 'pieces ' + l.solution.length + ', clutter ' + clutter);
  });

  /* Paradox: even splits overload the lock; two beams are never enough. */
  const p90 = find('imp-90');
  const even = copy(p90.solution); even[0].ratio = 0.5; even[2].ratio = 0.5;
  const evEven = evalWith(p90, even).receivers[0];
  ok('imp-90: even splits bring too much light', !evEven.lit, evEven.reason + ' I=' + evEven.intensity.toFixed(3));
  const twoBeams = copy(p90.solution).slice(0, 3);
  const ev2 = evalWith(p90, twoBeams).receivers[0];
  ok('imp-90: two beams never open a three-beam lock', !ev2.lit, ev2.reason);

  /* Malus Maze: no pair of filters, at any angles, passes enough. */
  const p92 = find('imp-92');
  const need92 = p92.receivers[0].require.minIntensity;
  let best2 = 0, beaten = null;
  for (let a = 0; a <= 90; a += 5) {
    for (let b = a; b <= 90; b += 5) {
      const sol = copy(p92.solution).slice(0, 2).concat([
        { type: 'polarizer', x: 560, y: 600, angle: M.rad(a), radius: 40 },
        { type: 'polarizer', x: 900, y: 150, angle: M.rad(b), radius: 40 }
      ]);
      const r = evalWith(p92, sol).receivers[0];
      best2 = Math.max(best2, r.intensity);
      if (r.lit) beaten = a + '/' + b;
    }
  }
  ok('imp-92: two filters can never open the lock', beaten === null && best2 < need92,
     'best ' + best2.toFixed(3) + ' vs ' + need92 + (beaten ? ' lit at ' + beaten : ''));

  /* The Wall: aiming where the beam LOOKS like it goes misses. */
  const p95 = find('imp-95');
  const S95 = p95.receivers[0];
  const m95 = p95.solution[0];
  const naiveAim = { type: 'mirror', x: m95.x, y: m95.y, length: m95.length,
    angle: A.aimAngle({ x: 120, y: 120 }, m95, { x: S95.x, y: S95.y }) };
  ok('imp-95: aiming straight at the sensor through the pane misses it',
     !evalWith(p95, [naiveAim]).receivers[0].lit);

  /* Heat Death: the default split cooks one mirror; so does leaning the other way. */
  const p93 = find('imp-93');
  function heatSolved(ratio) {
    const sc = Scene.fromLevel(p93);
    const sol = copy(p93.solution); sol[0].ratio = ratio;
    Scene.applySolution(sc, sol);
    for (let t = 0; t < 26; t += 1 / 60) if (Scene.tickSolve(sc, 1 / 60).solved) return true;
    return false;
  }
  ok('imp-93: the splitter’s default setting fails', !heatSolved(0.2));
  ok('imp-93: leaning the split the other way fails too', !heatSolved(0.8));

  /* The Impossible: in the last phase, an even splitter chills the white lock. */
  const p97 = copy(find('imp-97'));
  p97.phases[3].solution[0].ratio = 0.5;
  ok('imp-97: the last phase fails with the splitter left at half', Phases.simulate(p97).failedAt === 3);

  /* Split Second: in phase three, an even new splitter starves the first sensor. */
  const z83 = copy(find('zro-83'));
  z83.phases[2].solution[0].ratio = 0.5;
  ok('zro-83: an even second split starves the first sensor', Phases.simulate(z83).failedAt === 2);

  /* Tripwire: the phase-one route is alarmed in phase two. */
  const z84 = copy(find('zro-84'));
  z84.phases[1].solution = [];
  ok('zro-84: the first route trips the second phase’s alarms', Phases.simulate(z84).failedAt === 1);
})();

console.log('');
console.log('  content test suite');
console.log('  ------------------');
for (const f of failures.slice(0, 30)) console.log('  FAIL  ' + f);
if (failures.length > 30) console.log('  ... and ' + (failures.length - 30) + ' more');
console.log('  dailies generated: ' + generated + '   templates: ' + JSON.stringify(templateCount));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('');
process.exit(fail === 0 ? 0 : 1);
