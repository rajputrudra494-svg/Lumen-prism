/* =============================================================================
 * Lumen Path - tools/load.js
 * -----------------------------------------------------------------------------
 * Loads the game's source files into a Node process so the optics engine and
 * the level catalogue can be exercised headlessly (see tools/verify.js).
 *
 * The game ships as classic scripts sharing a single `LP` global rather than ES
 * modules, for two reasons: index.html then works when opened straight off the
 * filesystem with no server, and the exact same files can be `runInThisContext`
 * here without a build step or a module shim.
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* Engine files, in dependency order. Keep in sync with index.html. */
const CORE_FILES = [
  'src/math/vec2.js',
  'src/optics/spectrum.js',
  'src/optics/materials.js',
  'src/optics/geometry.js',
  'src/optics/elements.js',
  'src/optics/raytracer.js',
  'src/engine/props.js',
  'src/engine/scene.js',
  'src/engine/phases.js',
  'src/game/authoring.js',
  'src/game/levels.js',
  'src/game/share.js',
  'src/game/daily.js',
  'src/game/editor.js'
];

/**
 * `opts.engineOnly` stops before src/game/levels.js. Authoring tools need the
 * engine without the catalogue -- and a level that throws while probing the
 * tracer must not take the debugging tool down with it.
 */
function loadCore(root, opts) {
  const base = root || path.resolve(__dirname, '..');
  const files = (opts && opts.engineOnly)
    ? CORE_FILES.filter(f => f !== 'src/game/levels.js')
    : CORE_FILES;
  for (const rel of files) {
    const full = path.join(base, rel);
    if (!fs.existsSync(full)) {
      throw new Error('missing source file: ' + rel);
    }
    const code = fs.readFileSync(full, 'utf8');
    vm.runInThisContext(code, { filename: full });
  }
  return globalThis.LP;
}

module.exports = { loadCore, CORE_FILES };
