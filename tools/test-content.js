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

console.log('');
console.log('  content test suite');
console.log('  ------------------');
for (const f of failures.slice(0, 30)) console.log('  FAIL  ' + f);
if (failures.length > 30) console.log('  ... and ' + (failures.length - 30) + ' more');
console.log('  dailies generated: ' + generated + '   templates: ' + JSON.stringify(templateCount));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('');
process.exit(fail === 0 ? 0 : 1);
