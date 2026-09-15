/* =============================================================================
 * Lumen Path - tools/verify.js
 * -----------------------------------------------------------------------------
 * Proves every shipped level is actually solvable. Run with:
 *
 *     node tools/verify.js            summary
 *     node tools/verify.js -v         per-level detail
 *
 * For each level it checks, in order:
 *   1. the level loads and has at least one emitter and one receiver
 *   2. it is NOT already solved with nothing placed (no free wins)
 *   3. the reference solution fits the declared inventory exactly
 *   4. replaying the reference solution lights every receiver
 *   5. the reference solution earns three stars, so par is achievable
 *   6. for timed levels, the solve holds for the required duration
 *   7. tracing stays inside the per-frame performance budget
 *
 * Levels played in phases against a clock (see src/engine/phases.js) are
 * played start to finish instead, at 60 ticks a second, and must also show
 * that every phase's moves fit inside its time with room for a human hand,
 * and that no phase clears without its own moves.
 * ========================================================================== */
'use strict';

const { loadCore } = require('./load');
const LP = loadCore();
const { Scene, Levels, Tracer, Elements, Phases } = LP;

/* Seconds a player needs, at the very least, to make one move -- pick from
 * the tray, drop, aim. A phase that leaves less than this per move is not
 * hard, it is impossible. Under a comfortable pace is only worth a warning. */
const HUMAN_MIN_PER_MOVE = 3.5;
const HUMAN_EASY_PER_MOVE = 6;

const verbose = process.argv.includes('-v') || process.argv.includes('--verbose');
/* `--only zro` checks just the levels whose id starts with that prefix. */
const onlyAt = process.argv.indexOf('--only');
const only = onlyAt >= 0 ? process.argv[onlyAt + 1] : null;

let problems = 0;
let warnings = 0;
const rows = [];

function fail(lvl, msg) {
  problems++;
  console.log(`  FAIL  ${lvl.id.padEnd(14)} ${msg}`);
}
function warn(lvl, msg) {
  warnings++;
  console.log(`  warn  ${lvl.id.padEnd(14)} ${msg}`);
}

for (const lvl of Levels.LEVELS) {
  if (only && lvl.id.indexOf(only) !== 0) continue;
  /* --- 1. structure ------------------------------------------------------ */
  if (!lvl.emitters || !lvl.emitters.length) { fail(lvl, 'no emitters'); continue; }
  if (!lvl.sandbox && (!lvl.receivers || !lvl.receivers.length)) {
    fail(lvl, 'no receivers'); continue;
  }

  if (lvl.phases) { verifyPhased(lvl); continue; }

  /* --- 2. not already solved --------------------------------------------
   * On a timed level "solved" means the receivers stay lit for holdTime, so
   * the empty-board check has to run the simulation too. A moving mirror that
   * sweeps past a target for one frame is not a free win. */
  let scene = Scene.fromLevel(lvl);
  if (!lvl.sandbox) {
    let freeWin;
    if (lvl.holdTime) {
      freeWin = false;
      let t = 0;
      const dt = 1 / 60;
      while (t < (lvl.simWindow || 24)) {
        if (Scene.tickSolve(scene, dt).solved) { freeWin = true; break; }
        t += dt;
      }
    } else {
      freeWin = Scene.evaluate(scene).allLit;
    }
    if (freeWin) fail(lvl, 'already solved with nothing placed');
  }

  /* --- 3 + 4. replay the reference solution ------------------------------ */
  scene = Scene.fromLevel(lvl);
  const solution = lvl.solution || [];
  if (!lvl.sandbox && !solution.length) { fail(lvl, 'no reference solution'); continue; }

  const placed = Scene.applySolution(scene, solution);
  if (placed !== solution.length) {
    fail(lvl, `inventory mismatch: placed ${placed} of ${solution.length}`);
    const have = scene.inventory.map(s => `${s.type}x${s.count}`).join(' ');
    const want = {};
    solution.forEach(s => { want[s.type] = (want[s.type] || 0) + 1; });
    console.log(`        inventory: ${have}`);
    console.log(`        solution wants: ${Object.entries(want).map(([k, v]) => k + 'x' + v).join(' ')}`);
    continue;
  }

  const t0 = process.hrtime.bigint();
  let ev = Scene.evaluate(scene);
  const traceMs = Number(process.hrtime.bigint() - t0) / 1e6;

  /* --- 6. timed levels need the solve to hold --------------------------- */
  if (lvl.holdTime) {
    scene.time = 0; scene.holdAccum = 0;
    let solved = false, best = 0, t = 0;
    const dt = 1 / 60;
    /* Give it a couple of full cycles of whatever is moving. */
    while (t < (lvl.simWindow || 24)) {
      const r = Scene.tickSolve(scene, dt);
      best = Math.max(best, r.holdProgress || 0);
      if (r.solved) { solved = true; ev = r; break; }
      t += dt;
    }
    if (!solved) {
      fail(lvl, `timed solve never completed (best hold ${(best * 100).toFixed(0)}%)`);
      continue;
    }
  } else if (!lvl.sandbox && !ev.allLit) {
    const why = ev.receivers.map((r, i) =>
      `${i}:${r.reason}(I=${r.intensity.toFixed(3)}${r.match !== undefined ? ' m=' + r.match.toFixed(2) : ''})`
    ).join(' ');
    fail(lvl, `reference solution does not light every receiver -> ${why}`);
    continue;
  }

  /* --- 5. par must be reachable ----------------------------------------- */
  const stars = Scene.starsFor(scene, ev);
  if (!lvl.sandbox && stars < 3) {
    warn(lvl, `reference solution scores ${stars} stars ` +
              `(objects ${ev.objects}/${lvl.par.objects}, bounces ${ev.bounces}/${lvl.par.bounces})`);
  }

  /* --- 7. performance ---------------------------------------------------- */
  const res = scene.lastResult;
  if (traceMs > 12) warn(lvl, `slow trace: ${traceMs.toFixed(1)}ms`);
  if (res.stats.truncated) warn(lvl, `trace hit its ray budget (${res.stats.rays} rays)`);

  rows.push({
    id: lvl.id, ch: lvl.chapter, name: lvl.name,
    obj: ev.objects, par: lvl.par ? lvl.par.objects : '-',
    bounce: ev.bounces, parB: lvl.par ? lvl.par.bounces : '-',
    rays: res.stats.rays, segs: res.stats.segments, ms: traceMs.toFixed(1),
    minI: ev.receivers.map(r => r.intensity.toFixed(2)).join('/')
  });
}

function verifyPhased(lvl) {
  const before = problems;
  lvl.phases.forEach((p, i) => {
    if (!(p.time > 0)) fail(lvl, `phase ${i + 1} has no time limit`);
    if (!p.solution || !p.solution.length) fail(lvl, `phase ${i + 1} has no reference moves`);
  });
  if (problems > before) return;

  /* The whole level, played with its reference moves. */
  const t0 = process.hrtime.bigint();
  const rep = Phases.simulate(lvl);
  const simMs = Number(process.hrtime.bigint() - t0) / 1e6;
  rep.phases.forEach(ph => {
    const n = ph.index + 1;
    if (!ph.madeMoves) fail(lvl, `phase ${n}: its reference moves do not fit the tray`);
    if (ph.outcome !== 'clear') {
      const ev = Scene.evaluate(rep.scene);
      const why = ev.receivers.map((r, k) => r.inactive ? null :
        `${lvl.receivers[k].id || k}:${r.reason}(I=${r.intensity.toFixed(3)})`).filter(Boolean).join(' ');
      fail(lvl, `phase ${n} runs out of time with its own reference moves -> ${why}`);
      return;
    }
    const slack = ph.time - ph.seconds;
    if (slack < ph.moves * HUMAN_MIN_PER_MOVE) {
      fail(lvl, `phase ${n}: ${ph.moves} moves in ${slack.toFixed(1)}s of slack is beyond a human hand`);
    } else if (slack < ph.moves * HUMAN_EASY_PER_MOVE) {
      warn(lvl, `phase ${n}: ${ph.moves} moves with ${slack.toFixed(1)}s of slack is very tight`);
    }
  });
  if (!rep.completed) return;

  /* No phase may clear itself: withhold its moves and the clock must win. */
  lvl.phases.forEach((p, i) => {
    const r = Phases.simulate(lvl, { withhold: i });
    const ph = r.phases[i];
    if (ph && ph.outcome === 'clear') fail(lvl, `phase ${i + 1} clears without any of its own moves`);
  });

  const sc = rep.scene;
  const t1 = process.hrtime.bigint();
  const res = Scene.run(sc);
  const traceMs = Number(process.hrtime.bigint() - t1) / 1e6;
  if (traceMs > 12) warn(lvl, `slow trace: ${traceMs.toFixed(1)}ms`);
  if (res.stats.truncated) warn(lvl, `trace hit its ray budget (${res.stats.rays} rays)`);

  const moves = lvl.phases.reduce((a, p) => a + p.solution.length, 0);
  rows.push({
    id: lvl.id, ch: lvl.chapter, name: lvl.name,
    obj: moves, par: lvl.phases.length + 'ph',
    bounce: rep.phases.map(p => p.seconds.toFixed(1)).join('/'), parB: 's',
    rays: res.stats.rays, segs: res.stats.segments, ms: traceMs.toFixed(1),
    minI: `sim ${simMs.toFixed(0)}ms`
  });
}

if (verbose) {
  console.log('');
  console.log('  id             chapter      objects  bounces   rays  segs    ms   received');
  console.log('  ' + '-'.repeat(78));
  for (const r of rows) {
    console.log('  ' + r.id.padEnd(14) + r.ch.padEnd(13) +
      `${r.obj}/${r.par}`.padEnd(9) + `${r.bounce}/${r.parB}`.padEnd(10) +
      String(r.rays).padStart(5) + String(r.segs).padStart(6) +
      String(r.ms).padStart(6) + '   ' + r.minI);
  }
}

/* Catalogue-level sanity. */
const byChapter = {};
for (const l of Levels.LEVELS) byChapter[l.chapter] = (byChapter[l.chapter] || 0) + 1;
const ids = new Set();
for (const l of Levels.LEVELS) {
  if (ids.has(l.id)) { console.log(`  FAIL  duplicate level id: ${l.id}`); problems++; }
  ids.add(l.id);
}

console.log('');
console.log('  level verification');
console.log('  ------------------');
console.log('  levels:   ' + Levels.LEVELS.length);
console.log('  chapters: ' + Object.entries(byChapter).map(([k, v]) => `${k}(${v})`).join(' '));
const checked = only ? Levels.LEVELS.filter(l => l.id.indexOf(only) === 0).length : Levels.LEVELS.length;
console.log(`  ${checked - problems} verified, ${problems} failed, ${warnings} warnings`);
console.log('');
process.exit(problems === 0 ? 0 : 1);
