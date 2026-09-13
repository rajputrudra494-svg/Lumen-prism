/* =============================================================================
 * Lumen Path - tools/probe.js
 * -----------------------------------------------------------------------------
 * Authoring aid: trace an ad-hoc arrangement and print every segment, so a
 * level designer can see exactly where the light goes before committing a
 * receiver position. Usage:
 *
 *     node tools/probe.js '<json>'
 *
 * where <json> is { fixed: [...], emitters: [...] } using the same shapes the
 * level format uses. Angles are in DEGREES here for convenience.
 * ========================================================================== */
'use strict';
const { loadCore } = require('./load');
const LP = loadCore(null, { engineOnly: true });
const { V, M, Scene, Tracer } = LP;

const spec = JSON.parse(process.argv[2]);
function deg2rad(list) {
  return (list || []).map(o => {
    const c = Object.assign({}, o);
    if (c.angle !== undefined) c.angle = M.rad(c.angle);
    return c;
  });
}
const lvl = {
  id: '_probe', world: spec.world || { w: 1600, h: 900 },
  emitters: deg2rad(spec.emitters), receivers: deg2rad(spec.receivers),
  fixed: deg2rad(spec.fixed), inventory: [], fog: spec.fog
};
const sc = Scene.fromLevel(lvl);
const res = Tracer.trace(sc, {});
console.log('segments: ' + res.segments.length + '   rays: ' + res.stats.rays);
for (const s of res.segments) {
  const d = V.norm(V.sub(s.b, s.a));
  console.log(
    ` d${String(s.depth).padStart(2)}` +
    ` ${(s.wl === null ? 'white' : s.wl.toFixed(0) + 'nm').padStart(7)}` +
    ` in=${(s.inside || '-').padEnd(4)}` +
    ` via=${String(s.via).padEnd(9)}` +
    ` (${s.a.x.toFixed(0)},${s.a.y.toFixed(0)})->(${s.b.x.toFixed(0)},${s.b.y.toFixed(0)})` +
    ` ang=${M.deg(Math.atan2(d.y, d.x)).toFixed(1)}deg i=${s.i1.toFixed(3)}`
  );
}
for (const id in res.deposits) {
  const dep = res.deposits[id];
  console.log(`deposit ${id}: I=${dep.intensity.toFixed(3)} beams=${dep.count}`);
}
