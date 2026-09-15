/* =============================================================================
 * Lumen Path - tools/timeline.js
 * -----------------------------------------------------------------------------
 * Authoring aid for the moving chapters. Steps a level through time and reports
 * what each receiver sees, so you can tell "never aligned" apart from "aligned
 * but only for two frames".
 *
 *     node tools/timeline.js clk-44            reference solution
 *     node tools/timeline.js clk-44 --bare     nothing placed
 * ========================================================================== */
'use strict';

const { loadCore } = require('./load');
const LP = loadCore();
const { Scene, Levels, M } = LP;

const id = process.argv[2];
const bare = process.argv.includes('--bare');
const lvl = Levels.LEVELS.find(l => l.id === id);
if (!lvl) { console.log('no such level: ' + id); process.exit(1); }

const scene = Scene.fromLevel(lvl);
if (!bare) Scene.applySolution(scene);

console.log(`${lvl.id}  "${lvl.name}"  holdTime=${lvl.holdTime || 0}s`);
console.log('receivers: ' + lvl.receivers.map((r, i) =>
  `${i}@(${Math.round(r.x)},${Math.round(r.y)}) r=${r.radius || 24} need=${JSON.stringify(r.require)}`
).join('\n           '));
console.log('');

const dt = 1 / 60;
const window = lvl.simWindow || 24;
let t = 0;
let bestHold = 0, solvedAt = null;
const peak = lvl.receivers.map(() => 0);
const litFrames = lvl.receivers.map(() => 0);
const samples = [];

while (t < window) {
  const ev = Scene.tickSolve(scene, dt);
  ev.receivers.forEach((r, i) => {
    if (r.intensity > peak[i]) peak[i] = r.intensity;
    if (r.lit) litFrames[i]++;
  });
  bestHold = Math.max(bestHold, ev.holdProgress || 0);
  if (samples.length < 999 && Math.abs(t % 0.5) < dt) {
    samples.push({ t, I: ev.receivers.map(r => r.intensity) });
  }
  if (ev.solved && solvedAt === null) { solvedAt = t; break; }
  t += dt;
}

console.log('peak intensity per receiver: ' + peak.map(v => v.toFixed(3)).join('  '));
console.log('frames lit per receiver:     ' + litFrames.join('  ') +
            `   (of ${Math.round(window / dt)})`);
console.log('best hold progress:          ' + (bestHold * 100).toFixed(0) + '%');
console.log('solved at:                   ' + (solvedAt === null ? 'never' : solvedAt.toFixed(2) + 's'));
console.log('');
console.log('  t      ' + lvl.receivers.map((_, i) => 'rx' + i).join('      '));
for (const s of samples.slice(0, 40)) {
  console.log('  ' + s.t.toFixed(1).padStart(5) + '  ' +
              s.I.map(v => v.toFixed(3).padStart(6)).join('  '));
}
