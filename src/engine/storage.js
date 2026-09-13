/* =============================================================================
 * Lumen Path - src/engine/storage.js
 * -----------------------------------------------------------------------------
 * Progress and settings persistence.
 *
 * localStorage is the primary store. It can throw or come back empty in plenty
 * of ordinary situations -- a private window, cleared site data, a browser set
 * to block storage, or the file:// origin some browsers treat as opaque -- so
 * every access is wrapped and falls back to an in-memory store. The game stays
 * fully playable when persistence is unavailable; you just lose progress on
 * reload, and the UI says so.
 *
 * ---------------------------------------------------------------------------
 * BACKEND PLUG POINT
 * ---------------------------------------------------------------------------
 * Everything here is local. Two features are specified to be online -- the
 * daily challenge leaderboard and versus matchmaking -- and both are wired
 * through `LP.Storage.remote`, which is a no-op stub by default.
 *
 * To attach a real backend, set `LP.Storage.remote.endpoint` to a base URL and
 * the calls below become live POST/GET requests:
 *
 *   POST <endpoint>/scores      { levelId, seed, objects, bounces, ms, name }
 *   GET  <endpoint>/scores?levelId=..&seed=..&limit=50   -> [{name, objects, ...}]
 *   POST <endpoint>/levels      { code, title, author }   -> { id }
 *   GET  <endpoint>/levels/:id                            -> { code, title }
 *
 * server/relay.js contains a reference implementation of the multiplayer relay;
 * a leaderboard service would sit alongside it. Nothing else in the codebase
 * needs to change -- see `submitScore` and `fetchLeaderboard` below.
 * ========================================================================== */
(function (LP) {
  'use strict';

  var PREFIX = 'lumenpath.';
  var memory = {};
  var available = null;

  function probe() {
    if (available !== null) return available;
    try {
      var k = PREFIX + '__probe';
      window.localStorage.setItem(k, '1');
      window.localStorage.removeItem(k);
      available = true;
    } catch (e) {
      available = false;
    }
    return available;
  }

  function readRaw(key) {
    if (probe()) {
      try { return window.localStorage.getItem(PREFIX + key); } catch (e) { /* fall through */ }
    }
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
  }

  function writeRaw(key, value) {
    memory[key] = value;
    if (probe()) {
      try { window.localStorage.setItem(PREFIX + key, value); return true; }
      catch (e) { /* quota or blocked -- memory copy still holds */ }
    }
    return false;
  }

  function readJSON(key, fallback) {
    var raw = readRaw(key);
    if (raw === null || raw === undefined) return fallback;
    try { return JSON.parse(raw); } catch (e) { return fallback; }
  }

  function writeJSON(key, obj) { return writeRaw(key, JSON.stringify(obj)); }

  function remove(key) {
    delete memory[key];
    if (probe()) { try { window.localStorage.removeItem(PREFIX + key); } catch (e) {} }
  }

  /* ==========================================================================
   * Progress
   * ======================================================================= */
  var DEFAULT_PROGRESS = { levels: {}, unlockedChapters: ['lab'], totalStars: 0, version: 1 };

  function loadProgress() {
    var p = readJSON('progress', null);
    if (!p || typeof p !== 'object') return JSON.parse(JSON.stringify(DEFAULT_PROGRESS));
    p.levels = p.levels || {};
    p.unlockedChapters = p.unlockedChapters || ['lab'];
    return p;
  }

  function saveProgress(p) {
    p.totalStars = Object.keys(p.levels).reduce(function (n, k) {
      return n + (p.levels[k].stars || 0);
    }, 0);
    return writeJSON('progress', p);
  }

  /**
   * Record a completed level. Only ever improves a record -- replaying a level
   * badly never takes stars away.
   */
  function recordSolve(progress, levelId, stars, objects, bounces, seconds) {
    var e = progress.levels[levelId] || { stars: 0, objects: Infinity, bounces: Infinity };
    e.solved = true;
    e.stars = Math.max(e.stars || 0, stars);
    if (objects < (e.objects === undefined ? Infinity : e.objects)) e.objects = objects;
    if (bounces < (e.bounces === undefined ? Infinity : e.bounces)) e.bounces = bounces;
    if (seconds !== undefined && (!e.bestTime || seconds < e.bestTime)) e.bestTime = seconds;
    e.plays = (e.plays || 0) + 1;
    progress.levels[levelId] = e;
    saveProgress(progress);
    return e;
  }

  function starsFor(progress, levelId) {
    var e = progress.levels[levelId];
    return e ? (e.stars || 0) : 0;
  }

  function isSolved(progress, levelId) {
    var e = progress.levels[levelId];
    return !!(e && e.solved);
  }

  /* ==========================================================================
   * Settings
   * ======================================================================= */
  var DEFAULT_SETTINGS = {
    sound: true,
    music: true,
    colorblind: false,
    reducedMotion: false,
    quality: 'high',
    showHints: true,
    snapDefault: false
  };

  function loadSettings() {
    var s = readJSON('settings', null) || {};
    var out = {};
    for (var k in DEFAULT_SETTINGS) {
      out[k] = Object.prototype.hasOwnProperty.call(s, k) ? s[k] : DEFAULT_SETTINGS[k];
    }
    /* Respect the OS-level reduced-motion preference on first run. */
    if (!Object.prototype.hasOwnProperty.call(s, 'reducedMotion') &&
        window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      out.reducedMotion = true;
    }
    return out;
  }

  function saveSettings(s) { return writeJSON('settings', s); }

  /* ==========================================================================
   * Player-made levels (local library; sharing is via URL codes)
   * ======================================================================= */
  function loadLibrary() { return readJSON('library', []); }
  function saveLibrary(list) { return writeJSON('library', list); }

  function addToLibrary(entry) {
    var lib = loadLibrary();
    var i = lib.findIndex(function (e) { return e.id === entry.id; });
    if (i >= 0) lib[i] = entry; else lib.push(entry);
    saveLibrary(lib);
    return lib;
  }

  function removeFromLibrary(id) {
    var lib = loadLibrary().filter(function (e) { return e.id !== id; });
    saveLibrary(lib);
    return lib;
  }

  /* ==========================================================================
   * Daily challenge results
   * ======================================================================= */
  function loadDaily() { return readJSON('daily', {}); }
  function recordDaily(dateKey, result) {
    var d = loadDaily();
    var prev = d[dateKey];
    if (!prev || result.objects < prev.objects ||
        (result.objects === prev.objects && result.bounces < prev.bounces)) {
      d[dateKey] = result;
      writeJSON('daily', d);
    }
    return d[dateKey];
  }

  /* ==========================================================================
   * Remote stub. See the header for the expected API shape.
   * ======================================================================= */
  var remote = {
    endpoint: null,          /* e.g. 'https://api.example.com/lumenpath' */
    playerName: null,

    get online() { return !!remote.endpoint; },

    submitScore: function (payload) {
      if (!remote.endpoint) {
        /* Offline: the local record IS the leaderboard. */
        return Promise.resolve({ offline: true, rank: null });
      }
      return fetch(remote.endpoint + '/scores', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(function (r) { return r.json(); })
        .catch(function (e) { return { offline: true, error: String(e) }; });
    },

    fetchLeaderboard: function (levelId, seed, limit) {
      if (!remote.endpoint) return Promise.resolve({ offline: true, entries: [] });
      var q = '?levelId=' + encodeURIComponent(levelId) +
              '&seed=' + encodeURIComponent(seed || '') +
              '&limit=' + (limit || 50);
      return fetch(remote.endpoint + '/scores' + q)
        .then(function (r) { return r.json(); })
        .catch(function (e) { return { offline: true, entries: [], error: String(e) }; });
    },

    publishLevel: function (code, title) {
      if (!remote.endpoint) return Promise.resolve({ offline: true });
      return fetch(remote.endpoint + '/levels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: code, title: title })
      }).then(function (r) { return r.json(); })
        .catch(function (e) { return { offline: true, error: String(e) }; });
    }
  };

  function exportAll() {
    return JSON.stringify({
      progress: loadProgress(),
      settings: loadSettings(),
      library: loadLibrary(),
      daily: loadDaily(),
      exportedAt: new Date().toISOString()
    }, null, 2);
  }

  function importAll(json) {
    var d = typeof json === 'string' ? JSON.parse(json) : json;
    if (d.progress) writeJSON('progress', d.progress);
    if (d.settings) writeJSON('settings', d.settings);
    if (d.library) writeJSON('library', d.library);
    if (d.daily) writeJSON('daily', d.daily);
    return true;
  }

  function clearAll() {
    ['progress', 'settings', 'library', 'daily'].forEach(remove);
  }

  LP.Storage = {
    get persistent() { return probe(); },
    loadProgress: loadProgress,
    saveProgress: saveProgress,
    recordSolve: recordSolve,
    starsFor: starsFor,
    isSolved: isSolved,
    loadSettings: loadSettings,
    saveSettings: saveSettings,
    loadLibrary: loadLibrary,
    saveLibrary: saveLibrary,
    addToLibrary: addToLibrary,
    removeFromLibrary: removeFromLibrary,
    loadDaily: loadDaily,
    recordDaily: recordDaily,
    remote: remote,
    exportAll: exportAll,
    importAll: importAll,
    clearAll: clearAll,
    readJSON: readJSON,
    writeJSON: writeJSON
  };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
