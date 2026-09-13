/* =============================================================================
 * Lumen Path - src/game/share.js
 * -----------------------------------------------------------------------------
 * Level serialisation to a URL-safe share code.
 *
 * A code is base64url of a JSON payload that has been aggressively slimmed:
 * keys are shortened, numbers are rounded to sensible precision, and anything
 * matching an element type's default is dropped entirely. A typical hand-built
 * level comes out around 300-600 characters, short enough to paste into a chat
 * message or hang off a URL fragment.
 *
 * The fragment form is  index.html#lvl=<code>  -- a fragment rather than a
 * query string so the code never leaves the browser as part of a request.
 * ========================================================================== */
(function (LP) {
  'use strict';

  var E = LP.Elements, M = LP.M;
  var VERSION = 1;

  /* Long key -> short key. Anything not listed is passed through unchanged. */
  var KEYMAP = {
    type: 't', x: 'x', y: 'y', angle: 'a', length: 'l', radius: 'r',
    curvature: 'k', material: 'm', color: 'c', ratio: 'q', spacing: 'sp',
    orders: 'or', w: 'w', h: 'h', shape: 'sh', link: 'lk', flipped: 'fp',
    locked: 'lo', intensity: 'i', width: 'wd', rays: 'ry', spread: 'sr',
    wavelength: 'wl', require: 'rq', minIntensity: 'mi', maxIntensity: 'xi',
    minBeams: 'mb', wavelengthTolerance: 'wt', polarization: 'pz',
    dark: 'dk', count: 'n', preset: 'p', motion: 'mo', disperse: 'ds',
    thermal: 'th', exitOffset: 'eo', id: 'd'
  };
  var UNMAP = (function () {
    var u = {};
    for (var k in KEYMAP) u[KEYMAP[k]] = k;
    return u;
  })();

  function shorten(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(shorten);
    var out = {};
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      var v = obj[k];
      if (v === undefined) continue;
      out[KEYMAP[k] || k] = shorten(v);
    }
    return out;
  }

  function lengthen(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(lengthen);
    var out = {};
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      out[UNMAP[k] || k] = lengthen(obj[k]);
    }
    return out;
  }

  function round(v, dp) {
    var f = Math.pow(10, dp === undefined ? 1 : dp);
    return Math.round(v * f) / f;
  }

  /**
   * Round a placement's numbers but keep every property.
   *
   * Reference solutions must NOT be slimmed. A fixed element is rebuilt with
   * `Elements.create`, which reapplies the type defaults, so dropping a
   * default-matching value there is lossless. A solution placement is instead
   * replayed through `Scene.place`, which merges the INVENTORY SLOT's preset
   * first -- and that preset may specify something different. Drop `color:'red'`
   * from a red filter because red happens to be the type default, and the
   * replay can silently pick up a green preset instead.
   */
  function fullElement(def) {
    var out = {};
    for (var k in def) {
      if (!Object.prototype.hasOwnProperty.call(def, k)) continue;
      if (k.charAt(0) === '_' || k === 'fromInventory') continue;
      var v = def[k];
      if (v === undefined || v === null) continue;
      if (k === 'x' || k === 'y' || k === 'length' || k === 'radius' ||
          k === 'w' || k === 'h') v = round(v, 1);
      else if (k === 'angle' || k === 'curvature' || k === 'ratio') v = round(v, 4);
      out[k] = v;
    }
    return out;
  }

  /** Drop every property that already matches the type's default. */
  function slimElement(def) {
    var T = E.TYPES[def.type];
    var out = { type: def.type };
    for (var k in def) {
      if (!Object.prototype.hasOwnProperty.call(def, k)) continue;
      if (k === 'type' || k.charAt(0) === '_') continue;
      var v = def[k];
      if (v === undefined || v === null) continue;
      if (T && T.defaults && JSON.stringify(T.defaults[k]) === JSON.stringify(v)) continue;
      if (k === 'x' || k === 'y' || k === 'length' || k === 'radius' ||
          k === 'w' || k === 'h') v = round(v, 1);
      else if (k === 'angle' || k === 'curvature' || k === 'ratio') v = round(v, 4);
      if (k === 'fromInventory' || k === 'scale' && v === 1) continue;
      out[k] = v;
    }
    return out;
  }

  /* --------------------------------------------------------------------------
   * base64url, via UTF-8 bytes so non-ASCII level titles survive the trip.
   * ------------------------------------------------------------------------ */
  function toB64Url(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromB64Url(code) {
    var b = code.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    var bin = atob(b);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* ==========================================================================
   * Encode / decode
   * ======================================================================= */
  function encodeLevel(level) {
    var payload = {
      v: VERSION,
      name: level.name || 'Untitled',
      chapter: level.chapter || 'sandbox',
      author: level.author || '',
      blurb: level.blurb || '',
      world: level.world && (level.world.w !== 1600 || level.world.h !== 900)
             ? level.world : undefined,
      fog: level.fog || undefined,
      weather: level.weather || undefined,
      emitters: (level.emitters || []).map(slimElement),
      receivers: (level.receivers || []).map(slimElement),
      fixed: (level.fixed || []).map(slimElement),
      walls: level.walls && level.walls.length ? level.walls.map(function (w) {
        return [round(w.x, 0), round(w.y, 0), round(w.w, 0), round(w.h, 0)];
      }) : undefined,
      zones: level.zones && level.zones.length ? level.zones.map(function (z) {
        return [round(z.x, 0), round(z.y, 0), round(z.w, 0), round(z.h, 0)];
      }) : undefined,
      inventory: level.inventory || [],
      par: level.par || undefined,
      holdTime: level.holdTime || undefined,
      sandbox: level.sandbox || undefined,
      solution: level.solution ? level.solution.map(fullElement) : undefined
    };
    /* Strip undefined so they do not become "null" in the JSON. */
    for (var k in payload) if (payload[k] === undefined) delete payload[k];
    return toB64Url(JSON.stringify(shorten(payload)));
  }

  function decodeLevel(code) {
    var raw = JSON.parse(fromB64Url(code.trim()));
    var p = lengthen(raw);
    if (p.v && p.v > VERSION) {
      throw new Error('This level was made with a newer version of Lumen Path.');
    }
    var lvl = {
      id: 'shared-' + M.hash32(code).toString(36),
      name: p.name || 'Shared Level',
      chapter: p.chapter || 'sandbox',
      author: p.author || '',
      blurb: p.blurb || '',
      world: p.world || { w: 1600, h: 900 },
      fog: p.fog,
      weather: p.weather,
      emitters: p.emitters || [],
      receivers: p.receivers || [],
      fixed: p.fixed || [],
      walls: (p.walls || []).map(function (a) {
        return Array.isArray(a) ? { x: a[0], y: a[1], w: a[2], h: a[3] } : a;
      }),
      zones: (p.zones || []).map(function (a) {
        return Array.isArray(a) ? { x: a[0], y: a[1], w: a[2], h: a[3] } : a;
      }),
      inventory: p.inventory || [],
      par: p.par || { objects: (p.inventory || []).length, bounces: 99 },
      holdTime: p.holdTime,
      sandbox: p.sandbox,
      solution: p.solution,
      shared: true
    };
    if (!lvl.zones.length) delete lvl.zones;
    validate(lvl);
    return lvl;
  }

  /**
   * Reject anything malformed before it reaches the engine.
   * A share code is untrusted input -- it arrives from a URL or a paste box --
   * so this checks structure and clamps ranges rather than assuming good faith.
   */
  function validate(lvl) {
    if (!Array.isArray(lvl.emitters) || !lvl.emitters.length) {
      throw new Error('Level has no light source.');
    }
    if (lvl.emitters.length > 12) throw new Error('Too many emitters.');
    if ((lvl.receivers || []).length > 16) throw new Error('Too many receivers.');
    if ((lvl.fixed || []).length > 120) throw new Error('Too many fixed objects.');
    if ((lvl.inventory || []).length > 24) throw new Error('Inventory too large.');

    var w = lvl.world.w, h = lvl.world.h;
    if (!(w > 200 && w <= 4000 && h > 200 && h <= 4000)) {
      throw new Error('Level bounds are out of range.');
    }

    var total = 0;
    (lvl.inventory || []).forEach(function (slot) {
      if (!E.TYPES[slot.type]) throw new Error('Unknown object type: ' + slot.type);
      slot.count = Math.max(0, Math.min(40, slot.count | 0));
      total += slot.count;
    });
    if (total > 80) throw new Error('Inventory too large.');

    [].concat(lvl.emitters, lvl.receivers, lvl.fixed).forEach(function (d) {
      if (d.type && !E.TYPES[d.type]) throw new Error('Unknown object type: ' + d.type);
      d.x = M.clamp(+d.x || 0, -500, w + 500);
      d.y = M.clamp(+d.y || 0, -500, h + 500);
      if (d.angle !== undefined) d.angle = +d.angle || 0;
    });
    return true;
  }

  /* ==========================================================================
   * URLs
   * ======================================================================= */
  function shareURL(level) {
    var code = encodeLevel(level);
    var base = location.href.split('#')[0];
    return base + '#lvl=' + code;
  }

  /** Read a level (or daily seed) out of the current URL fragment. */
  function readFragment() {
    var frag = (location.hash || '').replace(/^#/, '');
    if (!frag) return null;
    var params = {};
    frag.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i < 0) return;
      params[kv.slice(0, i)] = kv.slice(i + 1);
    });
    return params;
  }

  LP.Share = {
    VERSION: VERSION,
    encodeLevel: encodeLevel,
    decodeLevel: decodeLevel,
    validate: validate,
    shareURL: shareURL,
    readFragment: readFragment,
    toB64Url: toB64Url,
    fromB64Url: fromB64Url
  };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
