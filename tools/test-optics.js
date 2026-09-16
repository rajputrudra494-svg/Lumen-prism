/* =============================================================================
 * Lumen Path - tools/test-optics.js
 * -----------------------------------------------------------------------------
 * Physics assertions for the ray tracer. Run with:  node tools/test-optics.js
 *
 * These check the optics against closed-form answers (Snell, Malus, the
 * grating equation, the mirror equation) rather than against snapshots, so a
 * regression in the solver shows up as a number that no longer matches theory.
 * ========================================================================== */
'use strict';

const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FILES = [
  'src/math/vec2.js',
  'src/optics/spectrum.js',
  'src/optics/materials.js',
  'src/optics/geometry.js',
  'src/optics/elements.js',
  'src/optics/raytracer.js',
  'src/engine/props.js',
  'src/engine/scene.js',
  'src/game/authoring.js'
];
for (const f of FILES) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const LP = globalThis.LP;
const { V, M, Geom: G, Spectrum: S, Materials: Mat, Elements: E, Tracer, Scene, Authoring: A } = LP;

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (detail ? '  -> ' + detail : '')); }
}
function near(name, got, want, tol) {
  const t = tol === undefined ? 1e-6 : tol;
  const good = Math.abs(got - want) <= t;
  ok(name, good, good ? '' : `got ${got}, want ${want} (tol ${t})`);
}

/* Build a bare scene around a list of element definitions. */
function makeScene(defs, emitters, receivers, extra) {
  const lvl = Object.assign({
    id: 'test', world: { w: 1600, h: 900 },
    emitters: emitters || [], receivers: receivers || [],
    fixed: defs || [], inventory: []
  }, extra || {});
  return Scene.fromLevel(lvl);
}

/* ===========================================================================
 * 1. REFLECTION -- angle in equals angle out, at arbitrary mirror rotation.
 * ======================================================================== */
(function testReflection() {
  for (let deg = -80; deg <= 80; deg += 7) {
    const mirrorAngle = M.rad(deg);
    const sc = makeScene(
      [{ type: 'mirror', x: 800, y: 450, angle: mirrorAngle, length: 600, material: 'dielectric' }],
      [A.emitter(200, 450, 0, 'white')]
    );
    const res = Tracer.trace(sc, {});
    const seg = res.segments.find(s => s.depth === 1);
    ok('reflection produces a bounce at ' + deg + 'deg', !!seg);
    if (!seg) continue;

    /* Surface normal from the mirror angle. */
    const n = V.norm(V.perp(V.fromAngle(mirrorAngle)));
    const incoming = { x: 1, y: 0 };
    const outgoing = V.norm(V.sub(seg.b, seg.a));

    const cosIn = Math.abs(V.dot(incoming, n));
    const cosOut = Math.abs(V.dot(outgoing, n));
    near('angle of incidence == angle of reflection @' + deg, cosOut, cosIn, 1e-9);

    /* And the tangential component must be preserved exactly. */
    const t = V.perp(n);
    near('tangential component preserved @' + deg, V.dot(outgoing, t), V.dot(incoming, t), 1e-9);
  }
})();

/* ===========================================================================
 * 2. SNELL'S LAW -- measured bend must satisfy n1 sin(t1) = n2 sin(t2).
 * ======================================================================== */
(function testSnell() {
  /* Big flat-faced block, beam entering the left face at a known angle. */
  const incidenceDegs = [10, 20, 30, 40, 50];
  for (const inc of incidenceDegs) {
    const sc = makeScene(
      [{ type: 'glass', x: 900, y: 450, angle: 0, w: 500, h: 700,
         material: 'crown', noFresnel: true, disperse: false }],
      [A.emitter(300, 450 - Math.tan(M.rad(inc)) * 350, inc, 'green')]
    );
    const res = Tracer.trace(sc, {});
    /* The refracted segment is the one that starts on the left face. */
    const refr = res.segments.find(s => s.depth === 1 && s.inside);
    ok('snell: refracted ray exists at ' + inc + 'deg', !!refr);
    if (!refr) continue;

    const d = V.norm(V.sub(refr.b, refr.a));
    const t2 = Math.abs(Math.atan2(d.y, d.x));           /* face normal is +x */
    const n2 = Mat.iorAt('crown', 530);
    const lhs = 1.0 * Math.sin(M.rad(inc));
    const rhs = n2 * Math.sin(t2);
    near('snell holds at ' + inc + 'deg', rhs, lhs, 2e-3);
  }
})();

/* ===========================================================================
 * 3. TOTAL INTERNAL REFLECTION -- no light escapes past the critical angle.
 * ======================================================================== */
(function testTIR() {
  const n = Mat.iorAt('crown', 589);
  const critDeg = M.deg(Math.asin(1 / n));
  ok('crown critical angle is sane (~41deg)', critDeg > 39 && critDeg < 43, critDeg.toFixed(2));

  /* A 45-45-90 prism used as a retroreflector: 45deg internal incidence is
   * past the ~41deg critical angle, so the beam must turn a full 90deg. */
  const sc = makeScene(
    [{ type: 'glass', x: 800, y: 450, angle: M.rad(45), w: 260, h: 260,
       material: 'crown', disperse: false }],
    [A.emitter(300, 450, 0, 'green')]
  );
  const res = Tracer.trace(sc, {});
  const tir = res.segments.find(s => s.via === 'tir');
  ok('TIR occurs inside a 45deg prism face', !!tir);

  /* And below the critical angle, light does get out. */
  const sc2 = makeScene(
    [{ type: 'glass', x: 800, y: 450, angle: 0, w: 200, h: 400, material: 'crown', disperse: false }],
    [A.emitter(300, 450, 0, 'green')]
  );
  const res2 = Tracer.trace(sc2, {});
  const exited = res2.segments.some(s => s.depth >= 2 && !s.inside && s.b.x > 900);
  ok('light exits a slab at normal incidence', exited);
})();

/* ===========================================================================
 * 4. DISPERSION -- a prism must fan white light out by wavelength, with blue
 *    deviated more than red.
 * ======================================================================== */
(function testDispersion() {
  /* --- (a) Rigorous: dispersion at a single flat interface. ---------------
   * Each wavelength must satisfy Snell with ITS OWN Cauchy index, and short
   * wavelengths (higher n) must bend further from the interface normal. */
  const incidence = M.rad(45);
  let prevAngle = null, monotonic = true;
  for (const nm of [420, 480, 540, 600, 660]) {
    const sc = makeScene(
      [{ type: 'glass', x: 900, y: 450, angle: 0, w: 500, h: 900,
         material: 'flint', noFresnel: true, disperse: false }],
      [A.emitter(300, 450 - Math.tan(incidence) * 350, 45, nm)]
    );
    const refr = Tracer.trace(sc, {}).segments.find(s => s.depth === 1 && s.inside);
    ok('dispersion: ' + nm + 'nm refracts', !!refr);
    if (!refr) continue;
    const d = V.norm(V.sub(refr.b, refr.a));
    const t2 = Math.abs(Math.atan2(d.y, d.x));
    near('snell holds per-wavelength at ' + nm + 'nm',
         Mat.iorAt('flint', nm) * Math.sin(t2), Math.sin(incidence), 2e-3);
    if (prevAngle !== null && t2 <= prevAngle) monotonic = false;
    prevAngle = t2;
  }
  ok('longer wavelengths bend less (blue refracts most)', monotonic);

  /* --- (b) A prism throws a real fan. --------------------------------------
   * Entry face, exit face, no total internal reflection in between. */
  const sc = makeScene(
    [{ type: 'prism', x: 800, y: 450, angle: M.rad(45), radius: 90, material: 'flint' }],
    [A.emitter(200, 510, 0, 'white')]
  );
  const res = Tracer.trace(sc, {});
  /* Only true exit-refraction rays. The Fresnel ghosts off the entry face are
   * monochromatic too but all leave in one direction, which would mask the
   * dispersion this is testing for. */
  const exits = res.segments.filter(s => s.wl !== null && !s.inside &&
                                         s.depth >= 2 && s.via !== 'fresnel');
  ok('prism produces monochromatic exit rays', exits.length >= 9, 'count=' + exits.length);

  const byWl = new Map();
  for (const s of exits) {
    const d = V.norm(V.sub(s.b, s.a));
    if (!byWl.has(Math.round(s.wl))) byWl.set(Math.round(s.wl), Math.atan2(d.y, d.x));
  }
  const wls = [...byWl.keys()].sort((a, b) => a - b);
  ok('every dispersion band exits the prism', wls.length === 9, 'wls=' + wls.length);
  if (wls.length === 9) {
    const blue = byWl.get(wls[0]);
    const red = byWl.get(wls[8]);
    const fanDeg = Math.abs(M.deg(blue - red));
    ok('prism fans white light into a visible spectrum', fanDeg > 3,
       fanDeg.toFixed(2) + ' degrees');

    /* The fan must be ordered by wavelength, not merely wide. */
    let ordered = true;
    for (let i = 1; i < 9; i++) {
      if (!(byWl.get(wls[i]) > byWl.get(wls[i - 1]))) ordered = false;
    }
    ok('spectrum is ordered by wavelength', ordered);

    const nBlue = Mat.iorAt('flint', wls[0]);
    const nRed = Mat.iorAt('flint', wls[8]);
    ok('n(blue) > n(red) for flint', nBlue > nRed, `${nBlue.toFixed(4)} vs ${nRed.toFixed(4)}`);
    ok('game glass fans a rainbow wide enough to see', fanDeg > 12, fanDeg.toFixed(2) + ' degrees');
  }

  /* The game's glass: Cauchy's law with the spread between colours multiplied,
   * anchored at violet so no colour's index ever rises above the real one. */
  (function () {
    const F = Mat.MATERIALS.flint;
    const real = nm => F.A + F.B / Math.pow(nm / 1000, 2);
    ok('violet keeps its real Cauchy index', Math.abs(Mat.iorAt('flint', 400) - real(400)) < 1e-12);
    let risesAbove = false, widens = true;
    for (let nm = 410; nm <= 700; nm += 10) {
      if (Mat.iorAt('flint', nm) > real(nm) + 1e-12) risesAbove = true;
      const realGap = real(400) - real(nm), gameGap = Mat.iorAt('flint', 400) - Mat.iorAt('flint', nm);
      if (Math.abs(gameGap - Mat.SPREAD * realGap) > 1e-9) widens = false;
    }
    ok('no colour index rises above the real one', !risesAbove);
    ok('the gap to violet is exactly SPREAD times the real gap', widens, 'SPREAD=' + Mat.SPREAD);
    ok('unsplit white light keeps the catalogue index at 589nm',
       Math.abs(Mat.iorAt('flint', null) - real(589)) < 1e-12);
  })();

  /* Each band must then behave independently: put a red filter downstream and
   * only the red end of the spectrum should survive. */
  const scF = makeScene(
    [{ type: 'prism', x: 800, y: 450, angle: M.rad(45), radius: 90, material: 'flint' },
     /* The fan climbs from (834,496) and is ~100px wide by y=150. */
     { type: 'filter', x: 1050, y: 150, angle: 0, length: 500, color: 'red' }],
    [A.emitter(200, 510, 0, 'white')]
  );
  const after = Tracer.trace(scF, {}).segments.filter(s => s.via === null && s.wl !== null &&
                                                           s.depth >= 3);
  if (after.length) {
    const meanNm = after.reduce((a, s) => a + s.wl * s.i0, 0) /
                   after.reduce((a, s) => a + s.i0, 0);
    ok('a red filter keeps only the red end of a dispersed spectrum', meanNm > 560,
       'mean ' + meanNm.toFixed(0) + 'nm');
  } else {
    ok('a red filter keeps only the red end of a dispersed spectrum', false, 'no rays survived');
  }
})();

/* ===========================================================================
 * 5. BEAM SPLITTER -- energy conservation and two children.
 * ======================================================================== */
(function testSplitter() {
  const sc = makeScene(
    [{ type: 'splitter', x: 800, y: 450, angle: M.rad(45), length: 400, ratio: 0.5 }],
    [A.emitter(200, 450, 0, 'white')]
  );
  const res = Tracer.trace(sc, {});
  const kids = res.segments.filter(s => s.depth === 1);
  ok('splitter yields two beams', kids.length === 2, 'got ' + kids.length);
  if (kids.length === 2) {
    const total = kids[0].i0 + kids[1].i0;
    ok('split energy is conserved (minus coating loss)', total > 0.9 && total <= 1.0,
       'total=' + total.toFixed(4));
    /* The two beams must be perpendicular for a 45deg splitter. */
    const d1 = V.norm(V.sub(kids[0].b, kids[0].a));
    const d2 = V.norm(V.sub(kids[1].b, kids[1].a));
    near('45deg splitter separates beams by 90deg', Math.abs(V.dot(d1, d2)), 0, 1e-9);
  }

  /* Asymmetric ratio must actually change the split. */
  const sc2 = makeScene(
    [{ type: 'splitter', x: 800, y: 450, angle: M.rad(45), length: 400, ratio: 0.8 }],
    [A.emitter(200, 450, 0, 'white')]
  );
  const k2 = Tracer.trace(sc2, {}).segments.filter(s => s.depth === 1);
  const refl = k2.find(s => s.via === 'split-r');
  ok('ratio 0.8 sends most energy to the reflected arm', refl && refl.i0 > 0.7,
     refl ? refl.i0.toFixed(3) : 'missing');
})();

/* ===========================================================================
 * 6. MALUS' LAW -- crossed polarisers extinguish; 45deg passes a quarter.
 * ======================================================================== */
(function testPolarizer() {
  function throughTwo(secondDeg) {
    const sc = makeScene(
      [{ type: 'polarizer', x: 600, y: 450, angle: 0, length: 400 },
       { type: 'polarizer', x: 900, y: 450, angle: M.rad(secondDeg), length: 400 }],
      [A.emitter(200, 450, 0, 'white')],
      [A.receiver(1300, 450, { color: 'any', minIntensity: 0.001 })]
    );
    const res = Tracer.trace(sc, {});
    const dep = res.deposits[sc.receivers[0].id];
    return dep ? dep.intensity : 0;
  }
  const i0 = throughTwo(0);   /* axes parallel */
  const i45 = throughTwo(45);
  const i90 = throughTwo(90);

  ok('parallel polarisers pass about half', i0 > 0.42 && i0 < 0.5, i0.toFixed(4));
  /* Malus: cos^2(45) = 0.5, so the second filter halves it again. */
  near('45deg pair passes half of the first filter', i45 / i0, 0.5, 0.02);
  ok('crossed polarisers extinguish', i90 < 1e-3, i90.toFixed(6));

  /* Unpolarised light must lose exactly half at the first filter. */
  const sc1 = makeScene(
    [{ type: 'polarizer', x: 600, y: 450, angle: 0, length: 400 }],
    [A.emitter(200, 450, 0, 'white')],
    [A.receiver(1300, 450, { color: 'any', minIntensity: 0.001 })]
  );
  const d1 = Tracer.trace(sc1, {}).deposits[sc1.receivers[0].id];
  const bare = makeScene([], [A.emitter(200, 450, 0, 'white')],
    [A.receiver(1300, 450, { color: 'any', minIntensity: 0.0001 })]);
  const d0 = Tracer.trace(bare, {}).deposits[bare.receivers[0].id];
  /* Relative to an unobstructed beam, one polariser must remove half the
   * energy (plus a few percent of substrate absorption). */
  const ratio = d1.intensity / d0.intensity;
  ok('unpolarised light halves at one polariser', ratio > 0.46 && ratio <= 0.5,
     ratio.toFixed(4));
})();

/* ===========================================================================
 * 7. GRATING EQUATION -- d sin(theta_m) = m lambda at normal incidence.
 * ======================================================================== */
(function testGrating() {
  const spacing = 1600;
  const sc = makeScene(
    [{ type: 'grating', x: 800, y: 450, angle: M.rad(90), length: 400, spacing, orders: 1 }],
    [A.emitter(200, 450, 0, 650)]     /* 650nm red, monochromatic */
  );
  const res = Tracer.trace(sc, {});
  const kids = res.segments.filter(s => s.depth === 1);
  ok('grating produces at least 3 orders', kids.length >= 3, 'got ' + kids.length);

  const angles = kids.map(s => {
    const d = V.norm(V.sub(s.b, s.a));
    return Math.atan2(d.y, d.x);
  }).sort((a, b) => a - b);

  const want = Math.asin(650 / spacing);
  const measured = Math.max(...angles.map(Math.abs));
  near('first order angle matches d.sin(theta)=m.lambda', measured, want, 2e-6);
})();

/* ===========================================================================
 * 8. CONCAVE MIRROR FOCUS -- a parallel bundle must converge near r/2.
 * ======================================================================== */
(function testFocus() {
  const el = E.create('concave', { x: 1000, y: 450, angle: M.rad(90), length: 300, curvature: 0.5 });
  const arc = el._prims[0];
  ok('concave mirror builds an arc primitive', arc.kind === 'arc');

  const sc = makeScene(
    [{ type: 'concave', x: 1000, y: 450, angle: M.rad(90), length: 300,
       curvature: 0.5, material: 'dielectric' }],
    [A.emitter(200, 450, 0, 'white', { width: 220, rays: 15 })]
  );
  const res = Tracer.trace(sc, {});
  const reflected = res.segments.filter(s => s.depth === 1);
  ok('all bundle rays reflect off the concave mirror', reflected.length === 15,
     'got ' + reflected.length);

  /* Find where the reflected rays cross the optical axis (y = 450). */
  const crossings = [];
  for (const s of reflected) {
    const d = V.sub(s.b, s.a);
    if (Math.abs(d.y) < 1e-9) continue;
    const t = (450 - s.a.y) / d.y;
    if (t > 0 && t <= 1.0001) crossings.push(s.a.x + d.x * t);
  }
  ok('rays cross the axis (they converge)', crossings.length >= 10, 'n=' + crossings.length);
  if (crossings.length >= 10) {
    const mean = crossings.reduce((a, b) => a + b, 0) / crossings.length;
    /* The focal point of a spherical mirror is midway between its vertex and
     * its centre of curvature. The vertex is the point of the arc furthest
     * from the centre along the axis. */
    const vertexX = arc.c.x + arc.r * Math.sign(1000 - arc.c.x);
    const focusX = (vertexX + arc.c.x) / 2;
    ok('focus sits at the mirror-equation focal point',
       Math.abs(mean - focusX) < arc.r * 0.10,
       `crossing=${mean.toFixed(1)} predicted=${focusX.toFixed(1)} r=${arc.r.toFixed(1)}`);
    ok('the focus is in front of the mirror surface', mean < vertexX && mean > arc.c.x,
       `${arc.c.x.toFixed(0)} < ${mean.toFixed(0)} < ${vertexX.toFixed(0)}`);
  }

  /* Convex must diverge instead. */
  const sc2 = makeScene(
    [{ type: 'convex', x: 1000, y: 450, angle: M.rad(90), length: 300,
       curvature: -0.5, material: 'dielectric' }],
    [A.emitter(200, 450, 0, 'white', { width: 220, rays: 9 })]
  );
  const r2 = Tracer.trace(sc2, {}).segments.filter(s => s.depth === 1);
  const spreadStart = 220;
  const ends = r2.map(s => s.b.y);
  const spreadEnd = Math.max(...ends) - Math.min(...ends);
  ok('convex mirror diverges the bundle', spreadEnd > spreadStart, 'spread=' + spreadEnd.toFixed(1));
})();

/* ===========================================================================
 * 9. ADDITIVE COLOUR MIXING at a receiver: red + green must read as yellow.
 * ======================================================================== */
(function testColorMixing() {
  /* One red beam and one green beam arriving at the same receiver from
   * different directions. */
  const sc2 = makeScene([],
    [A.emitter(200, 450, 0, 'red', { intensity: 0.7 }),
     A.emitter(800, 120, 90, 'green', { intensity: 0.7 })],
    [A.receiver(800, 450, { color: 'yellow', minIntensity: 0.2 })]
  );
  const res = Tracer.trace(sc2, {});
  const dep = res.deposits[sc2.receivers[0].id];
  ok('two beams reach the same receiver', dep && dep.count >= 2, dep ? 'count=' + dep.count : 'none');
  if (dep) {
    const st = Scene.evalReceiver(sc2.receivers[0], dep);
    ok('red + green is accepted as yellow', st.lit, st.reason + ' match=' + st.match.toFixed(3));
  }

  /* Sanity: red alone must NOT satisfy a yellow requirement. */
  const sc3 = makeScene([], [A.emitter(200, 450, 0, 'red')],
    [A.receiver(1200, 450, { color: 'yellow', minIntensity: 0.2 })]);
  const r3 = Tracer.trace(sc3, {});
  const st3 = Scene.evalReceiver(sc3.receivers[0], r3.deposits[sc3.receivers[0].id]);
  ok('red alone does not pass as yellow', !st3.lit, st3.reason);
})();

/* ===========================================================================
 * 10. ATTENUATION -- a beam must fade with distance and fail a dim receiver.
 * ======================================================================== */
(function testAttenuation() {
  function reach(fog) {
    const sc = makeScene([], [A.emitter(60, 450, 0, 'white')],
      [A.receiver(1500, 450, { color: 'any', minIntensity: 0.0001 })], { fog });
    const res = Tracer.trace(sc, {});
    const dep = res.deposits[sc.receivers[0].id];
    return dep ? dep.intensity : 0;
  }
  const clear = reach(0);
  const foggy = reach(0.0008);
  ok('clear air loses a little over a screen width', clear < 1 && clear > 0.8, clear.toFixed(4));
  ok('fog attenuates much harder', foggy < clear * 0.4, `${foggy.toFixed(4)} vs ${clear.toFixed(4)}`);

  /* Beer-Lambert check: I = I0 exp(-k d), measured over the actual segment
   * rather than a nominal distance (the beam stops at the receiver's rim). */
  (function () {
    const sc = makeScene([], [A.emitter(60, 450, 0, 'white')],
      [A.receiver(1500, 450, { color: 'any', minIntensity: 0.0001 })], { fog: 0.0008 });
    const seg = Tracer.trace(sc, {}).segments[0];
    const len = V.dist(seg.a, seg.b);
    const k = Tracer.DEFAULTS.airAbsorb + 0.0008;
    near('fog follows Beer-Lambert', seg.i1 / seg.i0, Math.exp(-k * len), 1e-9);
  })();

  /* A too-dim beam must not trigger a receiver. */
  /* Thick fog: the beam should fade below the receiver's threshold. */
  const sc = makeScene([], [A.emitter(60, 450, 0, 'white')],
    [A.receiver(1500, 450, { color: 'any', minIntensity: 0.5 })], { fog: 0.0012 });
  const st = Scene.evalReceiver(sc.receivers[0], Tracer.trace(sc, {}).deposits[sc.receivers[0].id]);
  ok('faded beam fails to trigger the receiver', !st.lit, st.reason);
})();

/* ===========================================================================
 * 11. COLOUR FILTERS -- pass matching light, block the rest.
 * ======================================================================== */
(function testFilters() {
  function through(emitColor, filterColor) {
    const sc = makeScene(
      [{ type: 'filter', x: 800, y: 450, angle: M.rad(90), length: 400, color: filterColor }],
      [A.emitter(200, 450, 0, emitColor)],
      [A.receiver(1400, 450, { color: 'any', minIntensity: 0.0001 })]
    );
    const dep = Tracer.trace(sc, {}).deposits[sc.receivers[0].id];
    return dep ? dep.intensity : 0;
  }
  /* Compare against an unfiltered baseline so distance attenuation cancels. */
  const baseline = (function () {
    const sc = makeScene([], [A.emitter(200, 450, 0, 'red')],
      [A.receiver(1400, 450, { color: 'any', minIntensity: 0.0001 })]);
    return Tracer.trace(sc, {}).deposits[sc.receivers[0].id].intensity;
  })();
  ok('red light passes a red filter', through('red', 'red') / baseline > 0.85,
     (through('red', 'red') / baseline).toFixed(3));
  ok('green light is blocked by a red filter', through('green', 'red') < 0.12,
     through('green', 'red').toFixed(3));
  const w = through('white', 'red');
  ok('white through red loses most of its energy', w > 0.2 && w < 0.55, w.toFixed(3));
})();

/* ===========================================================================
 * 12. ONE-WAY MIRROR -- reflects from the front, transmits from behind.
 * ======================================================================== */
(function testOneWay() {
  function probe(fromX, dirDeg) {
    const sc = makeScene(
      [{ type: 'oneway', x: 800, y: 450, angle: M.rad(90), length: 400 }],
      [A.emitter(fromX, 450, dirDeg, 'white')]
    );
    return Tracer.trace(sc, {}).segments.filter(s => s.depth === 1);
  }
  const a = probe(300, 0);      /* hits one face */
  const b = probe(1300, 180);   /* hits the other face */
  const aRefl = a.some(s => V.sub(s.b, s.a).x < 0);
  const bRefl = b.some(s => V.sub(s.b, s.a).x > 0);
  ok('one-way mirror reflects on exactly one side', aRefl !== bRefl,
     `frontRefl=${aRefl} backRefl=${bRefl}`);
})();

/* ===========================================================================
 * 13. PORTAL -- beam continues from the twin.
 * ======================================================================== */
(function testPortal() {
  const sc = makeScene(
    [{ type: 'portal', id: 'pA', x: 700, y: 450, angle: 0, radius: 34, link: 'pB' },
     { type: 'portal', id: 'pB', x: 700, y: 200, angle: 0, radius: 34, link: 'pA' }],
    [A.emitter(200, 450, 0, 'white')],
    [A.receiver(1400, 200, { color: 'any', minIntensity: 0.05 })]
  );
  const res = Tracer.trace(sc, {});
  const dep = res.deposits[sc.receivers[0].id];
  ok('a beam teleports through a linked portal pair', !!dep && dep.intensity > 0.5,
     dep ? dep.intensity.toFixed(3) : 'no arrival');
})();

/* ===========================================================================
 * 14. AUTHORING -- aimAngle must be the exact inverse of reflection.
 * ======================================================================== */
(function testAuthoring() {
  const rng = M.rng(1234);
  let worst = 0;
  for (let i = 0; i < 200; i++) {
    const from = { x: rng() * 1400 + 100, y: rng() * 700 + 100 };
    const at = { x: rng() * 1400 + 100, y: rng() * 700 + 100 };
    const to = { x: rng() * 1400 + 100, y: rng() * 700 + 100 };
    const ang = A.aimAngle(from, at, to);
    const n = V.norm(V.perp(V.fromAngle(ang)));
    const inDir = V.norm(V.sub(at, from));
    const want = V.norm(V.sub(to, at));
    const got = V.reflect(inDir, n);
    worst = Math.max(worst, V.dist(got, want));
  }
  ok('aimAngle inverts the reflection law exactly', worst < 1e-9, 'worst error ' + worst.toExponential(2));

  /* And a full authored chain must actually deliver light. */
  const spec = {
    id: 'chain-test', chapter: 'test', name: 'chain',
    emitter: A.emitter(120, 200, 0, 'white'),
    receiver: A.receiver(1400, 760, { color: 'any', minIntensity: 0.2 }),
    path: [{ x: 700, y: 200 }, { x: 700, y: 500 }, { x: 1100, y: 500 }, { x: 1100, y: 760 }]
  };
  const lvl = LP.Authoring.mirrorLevel(spec);
  const sc = Scene.fromLevel(lvl);
  const placed = Scene.applySolution(sc);
  ok('authored solution places every mirror', placed === 4, 'placed ' + placed);
  const ev = Scene.evaluate(sc);
  ok('authored 4-mirror chain lights the receiver', ev.allLit,
     JSON.stringify(ev.receivers.map(r => r.reason)));
})();

/* ===========================================================================
 * 15. PENDULUM -- period must approach the real (non-linearised) value.
 * ======================================================================== */
(function testPendulum() {
  const el = E.create('mirror', { x: 400, y: 400, angle: 0, length: 100 });
  el.motion = { type: 'pendulum', pivot: { x: 400, y: 200 }, len: 200, release: 0.30, damping: 0 };
  LP.Props.initAll([el]);

  /* Track zero crossings to measure the period. */
  let t = 0, last = el.motion.theta, crossings = [];
  const dt = 1 / 600;
  while (t < 14 && crossings.length < 5) {
    LP.Props.step([el], dt, t);
    t += dt;
    if (last > 0 && el.motion.theta <= 0) crossings.push(t);
    last = el.motion.theta;
  }
  ok('pendulum swings', crossings.length >= 3, 'crossings=' + crossings.length);
  if (crossings.length >= 3) {
    const period = crossings[1] - crossings[0];
    const small = 2 * Math.PI * Math.sqrt(200 / LP.Props.GRAVITY);
    /* A finite-amplitude pendulum is SLOWER than the small-angle formula.
     * First-order correction: T ~ T0 (1 + theta0^2/16). */
    const corrected = small * (1 + 0.30 * 0.30 / 16);
    near('pendulum period matches theory (with amplitude correction)', period, corrected, 0.02);
    ok('finite amplitude is slower than small-angle', period > small, `${period.toFixed(4)} > ${small.toFixed(4)}`);
  }
})();

/* ===========================================================================
 * 16. TRACER BUDGETS -- deep splitter cascades must terminate.
 * ======================================================================== */
(function testBudget() {
  const defs = [];
  for (let i = 0; i < 8; i++) {
    defs.push({ type: 'splitter', x: 300 + i * 130, y: 450, angle: M.rad(45), length: 300 });
  }
  const t0 = Date.now();
  const sc = makeScene(defs, [A.emitter(100, 450, 0, 'white')]);
  const res = Tracer.trace(sc, {});
  const ms = Date.now() - t0;
  ok('cascading splitters terminate', res.stats.rays <= Tracer.DEFAULTS.maxRays);
  ok('cascade traces fast enough for 60fps budget', ms < 60, ms + 'ms');

  /* A prism scene (which fans into 9 bands) must also stay bounded. */
  const sc2 = makeScene(
    [{ type: 'prism', x: 700, y: 450, angle: 0, radius: 90, material: 'flint' },
     { type: 'prism', x: 1000, y: 450, angle: M.rad(30), radius: 90, material: 'flint' }],
    [A.emitter(200, 450, 0, 'white')]
  );
  const t1 = Date.now();
  const r2 = Tracer.trace(sc2, {});
  ok('double-prism scene traces fast', Date.now() - t1 < 80, (Date.now() - t1) + 'ms');
  ok('double-prism scene produces a spectrum', r2.segments.filter(s => s.wl !== null).length > 20);
})();

/* ===========================================================================
 * Report
 * ======================================================================== */
console.log('');
console.log('  optics test suite');
console.log('  -----------------');
for (const f of failures) console.log('  FAIL  ' + f);
console.log(`  ${pass} passed, ${fail} failed`);
console.log('');
process.exit(fail === 0 ? 0 : 1);
