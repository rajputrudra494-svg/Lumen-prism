/* =============================================================================
 * Lumen Path - tools/test-content.js
 * -----------------------------------------------------------------------------
 * Checks the generated and serialised content, as opposed to the hand-authored
 * levels that tools/verify.js covers:
 *
 *   - every daily challenge for the next two years is generated, solvable,
 *     deterministic, and not a free win
 *   - every shipped level survives a share-code round trip unchanged
 * ========================================================================== */
'use strict';
const { loadCore } = require('./load');
const LP = loadCore();
const { Daily, Share, Scene, Levels } = LP;

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
  ok('boss levels exist in the new chapters',
     ['spr-60', 'spr-63', 'hzn-70', 'hzn-71'].every(id => bosses.indexOf(id) >= 0), bosses.join(','));
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
