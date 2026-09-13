/* =============================================================================
 * Lumen Path - src/main.js
 * -----------------------------------------------------------------------------
 * The game controller. Owns the loop, the current level, and the transitions
 * between playing, editing, replaying and multiplayer.
 *
 * THE LOOP
 * Fixed work per frame is deliberately small. The tracer only re-runs when the
 * scene is dirty (something moved) or when a level contains moving parts, so a
 * static puzzle sitting untouched costs one canvas repaint and nothing else.
 * ========================================================================== */
(function (LP) {
  'use strict';

  var R = LP.Renderer, Sc = LP.Scene, E = LP.Elements, M = LP.M, S = LP.Spectrum;

  /* Stars required to open each successive chapter. */
  var STARS_PER_CHAPTER = 12;

  function boot(rootEl) {
    var game = {
      mode: 'play',
      level: null,
      scene: null,
      renderer: null,
      ui: null,
      input: null,
      history: null,
      editor: null,
      session: null,
      replayPlayer: null,
      progress: LP.Storage.loadProgress(),
      settings: LP.Storage.loadSettings(),
      selected: null,
      armedType: null,
      armedPreset: null,
      lastEval: { objects: 0, bounces: 0, receivers: [] },
      solveReported: false,
      hintUsed: false,
      hintGhost: null,
      levelStart: 0,
      lastLit: {},
      running: true
    };

    /* ---- Renderer + UI ------------------------------------------------ */
    game.ui = LP.UI.create(game, rootEl);
    game.renderer = R.create(game.ui.canvas, { quality: game.settings.quality });
    applySettings();

    game.input = LP.Input.attach(game.ui.canvas, {
      renderer: game.renderer,
      scene: function () { return game.scene; },
      onChange: onSceneChange,
      onSelect: function (el) { game.selected = el; game.ui.refreshProps(); },
      pushHistory: function () { if (game.history) LP.History.push(game.history); },
      placeElement: function (type, p) { return placeElement(type, p); },
      onRejected: function () {
        game.ui.toast('Not a legal spot — stay inside the marked bays.', 'bad', 1800);
        LP.Audio.error();
      },
      undo: function () { game.undo(); },
      redo: function () { game.redo(); },
      resetLevel: function () { game.resetLevel(); },
      hint: function () { game.hint(); }
    });

    window.addEventListener('resize', function () {
      R.resize(game.renderer);
    });

    /* Audio must wait for a gesture. */
    ['pointerdown', 'keydown'].forEach(function (evt) {
      window.addEventListener(evt, function once() {
        LP.Audio.unlock();
        LP.Audio.setEnabled(game.settings.sound);
        LP.Audio.setMusic(game.settings.music);
        var ch = game.chapterOf(game.level);
        if (ch) LP.Audio.setChapter(ch.mood);
        window.removeEventListener(evt, once);
      }, { once: true });
    });

    /* ==================================================================
     * Scene changes
     * ================================================================ */
    function onSceneChange(structural) {
      if (!game.scene) return;
      game.scene.dirty = true;
      if (structural) {
        R.restartLight(game.renderer);
        game.solveReported = false;
        if (game.session) syncSelectionToPeers();
      }
      game.ui.refreshHUD();
      game.ui.refreshTray();
    }

    /**
     * Single place where a new object enters the world, so the editor,
     * multiplayer and ordinary play cannot drift apart.
     */
    function placeElement(type, p) {
      if (game.mode === 'editorBuild' && game.editor) {
        game.editor.placeAt(p.x, p.y);
        game.scene = game.editor.scene;
        game.history = LP.History.create(game.scene);
        game.armedType = null;
        R.restartLight(game.renderer);
        game.ui.refresh();
        LP.Audio.click();
        return true;
      }

      if (!Sc.pointAllowed(game.scene, p)) {
        game.ui.toast('Not a legal spot — stay inside the marked bays.', 'bad', 1800);
        LP.Audio.error();
        game.armedType = null;
        game.ui.refreshTray();
        return null;
      }

      LP.History.push(game.history);
      var el = game.session
        ? game.session.place(type, p.x, p.y, game.armedPreset || {})
        : Sc.place(game.scene, type, p.x, p.y, game.armedPreset || {}, game.armedPreset);

      game.armedType = null;
      if (el) {
        LP.Audio.click();
        onSceneChange(true);
      } else {
        game.ui.toast('No more of those left.', 'bad');
      }
      game.ui.refreshTray();
      return el;
    }

    function syncSelectionToPeers() {
      if (!game.session || !game.selected) return;
      game.session.move(game.selected);
    }

    /* ==================================================================
     * Level loading
     * ================================================================ */
    game.loadLevel = function (level, opts) {
      var o = opts || {};
      game.level = level;
      game.scene = Sc.fromLevel(level);
      game.history = LP.History.create(game.scene);
      game.selected = null;
      game.armedType = null;
      game.solveReported = false;
      game.hintUsed = false;
      game.hintGhost = null;
      game.levelStart = performance.now();
      game.lastLit = {};
      game.mode = o.mode || 'play';
      game.replayPlayer = null;

      Sc.run(game.scene);
      R.restartLight(game.renderer);
      R.resize(game.renderer);

      var ch = game.chapterOf(level);
      if (ch && LP.Audio.state.started) LP.Audio.setChapter(ch.mood);

      game.ui.refresh();
      game.ui.hideScreen();
      updateStatusStrip();
      return game.scene;
    };

    game.loadLevelById = function (id) {
      var lvl = LP.Levels.LEVELS.find(function (l) { return l.id === id; });
      if (!lvl) { game.ui.toast('That level is missing.', 'bad'); return; }
      game.loadLevel(lvl);
    };

    game.loadSharedCode = function (code) {
      var lvl = LP.Share.decodeLevel(code);   /* throws on malformed input */
      game.loadLevel(lvl);
      game.ui.toast('Loaded "' + lvl.name + '"' + (lvl.author ? ' by ' + lvl.author : ''), 'good');
      return lvl;
    };

    game.loadDaily = function () {
      var key = LP.Daily.dateKey();
      var lvl = LP.Daily.generate(key);
      lvl.isDaily = true;
      game.loadLevel(lvl);
      game.ui.toast('Daily challenge for ' + key, 'good');
    };

    game.continueGame = function () {
      /* Resume at the first unsolved level of the furthest open chapter. */
      var story = LP.Levels.LEVELS.filter(function (l) { return !l.sandbox; });
      var next = story.find(function (l) {
        return game.chapterUnlocked(l.chapter) && !LP.Storage.isSolved(game.progress, l.id);
      });
      game.loadLevel(next || story[0]);
    };

    game.nextLevelAfter = function (id) {
      var list = LP.Levels.LEVELS.filter(function (l) { return !l.sandbox; });
      var i = list.findIndex(function (l) { return l.id === id; });
      if (i < 0 || i + 1 >= list.length) return null;
      var n = list[i + 1];
      return game.chapterUnlocked(n.chapter) ? n : null;
    };

    /* ==================================================================
     * Progression
     * ================================================================ */
    game.chapterOf = function (level) {
      if (!level) return null;
      return LP.Levels.CHAPTERS.find(function (c) { return c.id === level.chapter; }) || null;
    };

    game.starsNeededFor = function (chapterId) {
      if (chapterId === 'sandbox' || chapterId === 'daily') return 0;
      var i = LP.Levels.CHAPTERS.findIndex(function (c) { return c.id === chapterId; });
      return Math.max(0, i) * STARS_PER_CHAPTER;
    };

    game.chapterUnlocked = function (chapterId) {
      return game.progress.totalStars >= game.starsNeededFor(chapterId);
    };

    game.starsFor = function (id) { return LP.Storage.starsFor(game.progress, id); };

    game.reloadProgress = function () {
      game.progress = LP.Storage.loadProgress();
      game.settings = LP.Storage.loadSettings();
      applySettings();
      game.ui.refresh();
    };

    /* ==================================================================
     * Placement and editing
     * ================================================================ */
    game.armPlacement = function (type, preset) {
      if (game.armedType === type) {
        game.armedType = null;
        game.input.cancelPlacement();
      } else {
        game.armedType = type;
        game.armedPreset = preset || null;
        game.input.beginPlacement(type);
        LP.Audio.pick();
      }
      game.ui.refreshTray();
    };

    game.select = function (el) {
      game.selected = el;
      game.input.select(el);
      game.ui.refreshProps();
    };

    game.editElement = function (el, key, value) {
      if (key === 'angle') el.angle = value;
      else if (E.TYPES[el.type].limits && E.TYPES[el.type].limits[key]) {
        el[key] = E.clampProp(el, key, value);
      } else el[key] = value;
      E.touch(el);
      game.scene.dirty = true;
      game.solveReported = false;
    };

    game.commitEdit = function () {
      LP.History.push(game.history);
      R.restartLight(game.renderer);
      if (game.session) syncSelectionToPeers();
      game.ui.refreshHUD();
      LP.Audio.tick();
    };

    game.removeSelected = function () {
      if (!game.selected || !game.selected.fromInventory) return;
      LP.History.push(game.history);
      if (game.session) game.session.remove(game.selected);
      else Sc.remove(game.scene, game.selected);
      game.select(null);
      onSceneChange(true);
      LP.Audio.drop();
    };

    game.undo = function () {
      if (LP.History.undo(game.history)) {
        game.select(null);
        onSceneChange(true);
        LP.Audio.tick();
      }
    };
    game.redo = function () {
      if (LP.History.redo(game.history)) {
        game.select(null);
        onSceneChange(true);
        LP.Audio.tick();
      }
    };

    game.resetLevel = function () {
      LP.History.push(game.history);
      Sc.reset(game.scene);
      game.select(null);
      game.hintGhost = null;
      game.levelStart = performance.now();
      onSceneChange(true);
      game.ui.toast('Level reset.');
    };

    /* ==================================================================
     * Hints
     *
     * A hint reveals the NEXT placement from the level's reference answer --
     * the same data tools/verify.js uses to prove the level is solvable. It
     * shows where the object goes, not how to angle it, and caps the level at
     * two stars so the optimisation game stays honest.
     * ================================================================ */
    game.hint = function () {
      var lvl = game.level;
      if (!lvl || !lvl.solution || !lvl.solution.length) {
        game.ui.toast('No hint available for this one.', 'bad');
        return;
      }
      var placed = game.scene.elements.filter(function (el) { return el.fromInventory; });
      var target = lvl.solution.find(function (s) {
        return !placed.some(function (p) {
          return p.type === s.type && Math.hypot(p.x - s.x, p.y - s.y) < 45;
        });
      });
      if (!target) {
        game.ui.toast('Everything is roughly in the right place — check your angles.', 'good', 3500);
        return;
      }
      game.hintUsed = true;
      game.hintGhost = { x: target.x, y: target.y, type: target.type, until: performance.now() + 7000 };
      game.ui.toast('A ' + E.TYPES[target.type].short.toLowerCase() +
                    ' belongs here. Best stars are now capped at two.', null, 4200);
    };

    /* ==================================================================
     * Inspector readout for the properties panel
     * ================================================================ */
    game.inspect = function (el) {
      var out = [];
      var mat = el.material ? LP.Materials.get(el.material) : null;
      if (mat && mat.reflect) out.push(['Reflectance', Math.round(mat.reflect * 100) + '%']);
      if (mat && mat.B > 0.001) {
        out.push(['Index (n)', LP.Materials.iorAt(el.material, 486).toFixed(3) + ' blue → ' +
                               LP.Materials.iorAt(el.material, 656).toFixed(3) + ' red']);
        var crit = LP.Materials.criticalAngle(LP.Materials.iorAt(el.material, 589), 1);
        if (crit) out.push(['Critical angle', Math.round(M.deg(crit)) + '°']);
      }
      if (el.type === 'grating') {
        var first = Math.asin(Math.min(1, 550 / el.spacing));
        out.push(['1st order (550nm)', Math.round(M.deg(first)) + '°']);
      }
      if (el._prims && el._prims[0] && el._prims[0].kind === 'arc') {
        var arc = el._prims[0];
        out.push(['Focal length', Math.round(arc.r / 2) + ' units']);
      }
      if (el.thermal && el.motion) {
        out.push(['Heat', (el.motion.heat || 0).toFixed(2) +
                          (el.motion.threshold ? ' / ' + el.motion.threshold : '')]);
      }
      return out.length ? out : null;
    };

    /* ==================================================================
     * Solve detection
     * ================================================================ */
    function checkSolve(dt) {
      if (!game.scene || game.mode === 'editorBuild' || game.mode === 'replay') return;
      var ev = Sc.tickSolve(game.scene, dt);
      game.lastEval = ev;

      /* Chime once per receiver as it comes on. */
      ev.receivers.forEach(function (r, i) {
        var was = game.lastLit[r.id];
        if (r.lit && !was) {
          var rc = game.scene.receivers[i];
          LP.Audio.chime(i / Math.max(1, ev.receivers.length));
          R.burst(game.renderer, { x: rc.x, y: rc.y },
                  S.colNormalize(r.color.r + r.color.g + r.color.b > 0.01
                                 ? r.color : { r: 1, g: 1, b: 1 }), 26);
        }
        game.lastLit[r.id] = r.lit;
      });

      /* Keep the HUD's object/interaction counters honest. They change as a
       * side effect of the trace, not of any user action, so refreshing them
       * on scene edits alone leaves them stale on anything that moves. */
      if (ev.objects !== hudShown.objects || ev.bounces !== hudShown.bounces) {
        hudShown.objects = ev.objects;
        hudShown.bounces = ev.bounces;
        game.ui.refreshHUD();
      }

      if (ev.solved && !game.solveReported) {
        game.solveReported = true;
        onSolved(ev);
      }
      return ev;
    }
    var hudShown = { objects: -1, bounces: -1 };

    function onSolved(ev) {
      var seconds = (performance.now() - game.levelStart) / 1000;
      var stars = game.hintUsed ? Math.min(2, ev.stars || 1) : (ev.stars || 1);

      LP.Audio.fanfare();
      game.scene.receivers.forEach(function (rc) {
        R.burst(game.renderer, { x: rc.x, y: rc.y }, { r: 1, g: 1, b: 1 }, 34);
      });

      if (game.session) {
        game.session.declareSolved(ev);
        return;
      }

      if (game.mode === 'editorTest') {
        game.ui.toast('Solved in ' + ev.objects + ' objects. Press "Save answer" to lock it in.',
                      'good', 4200);
        return;
      }

      if (game.level.isDaily) {
        var key = game.level.seedKey;
        LP.Storage.recordDaily(key, {
          objects: ev.objects, bounces: ev.bounces, seconds: seconds, at: Date.now()
        });
        LP.Storage.remote.submitScore({
          levelId: 'daily-' + key, seed: key,
          objects: ev.objects, bounces: ev.bounces,
          ms: Math.round(seconds * 1000),
          name: LP.Storage.remote.playerName || 'anon'
        });
      } else if (!game.level.shared) {
        LP.Storage.recordSolve(game.progress, game.level.id, stars,
                               ev.objects, ev.bounces, seconds);
        var before = game.progress.totalStars;
        game.progress = LP.Storage.loadProgress();
        checkChapterUnlock(before);
      }

      game.lastReplay = LP.Replay.record(game.scene, {
        stars: stars, objects: ev.objects, bounces: ev.bounces, seconds: seconds
      });

      setTimeout(function () {
        game.ui.showScreen('win', {
          level: game.level, ev: ev, stars: stars, seconds: seconds,
          isDaily: !!game.level.isDaily
        });
      }, 900);
    }

    function checkChapterUnlock(before) {
      LP.Levels.CHAPTERS.forEach(function (ch) {
        var need = game.starsNeededFor(ch.id);
        if (need > 0 && before < need && game.progress.totalStars >= need) {
          game.ui.toast('New chapter unlocked: ' + ch.name, 'good', 4000);
        }
      });
    }

    /* ==================================================================
     * Timed-level status strip
     * ================================================================ */
    function updateStatusStrip() {
      var lvl = game.level;
      if (!lvl) return;
      if (game.session) return;                 /* multiplayer owns the strip */
      if (!lvl.holdTime) { game.ui.setStatus(null); return; }
      var p = Math.round((game.lastEval.holdProgress || 0) * 100);
      game.ui.setStatus(
        '<span class="strip-label">Hold all sensors lit</span>' +
        '<span class="strip-bar"><i style="width:' + p + '%"></i></span>' +
        '<span class="strip-val">' + p + '%</span>');
    }

    /* ==================================================================
     * Replay
     * ================================================================ */
    game.playReplay = function () {
      if (!game.lastReplay) { game.ui.toast('Nothing to replay yet.'); return; }
      var scene = LP.Replay.restore(game.level, game.lastReplay);
      game.scene = scene;
      game.mode = 'replay';
      game.selected = null;
      game.replayPlayer = LP.Replay.createPlayer(game.renderer, scene, { speed: 1500 });
      game.replayPlayer.restart();
      game.ui.setStatus('<span class="strip-label">Replay</span>');
      game.ui.refresh();
    };

    game.exportClip = function (btn) {
      if (!LP.Replay.canRecord()) {
        LP.Replay.captureStill(game.ui.canvas).then(function (r) {
          LP.Replay.download(r.blob, 'lumen-path-' + game.level.id + '.png');
          game.ui.toast('This browser cannot record video, so a still was saved instead.', null, 4200);
        }, function () { game.ui.toast('Could not capture the canvas.', 'bad'); });
        return;
      }
      game.ui.hideScreen();
      game.playReplay();
      var label = btn && btn.textContent;
      if (btn) btn.disabled = true;
      var seconds = Math.min(9, 2 + (game.scene.lastResult.stats.maxPath / 1500));
      LP.Replay.captureClip(game.ui.canvas, seconds, null).then(function (r) {
        LP.Replay.download(r.blob, 'lumen-path-' + game.level.id + '.' + r.ext);
        game.ui.toast('Clip saved as .' + r.ext + '.', 'good');
        if (btn) { btn.disabled = false; btn.textContent = label; }
      }, function (err) {
        game.ui.toast(err.message, 'bad', 4200);
        if (btn) { btn.disabled = false; btn.textContent = label; }
      });
    };

    /* ==================================================================
     * Editor
     * ================================================================ */
    game.openEditor = function (level) {
      game.editor = LP.Editor.create({ renderer: game.renderer });
      game.editor.load(level || LP.Editor.blankLevel());
      game.mode = 'editorBuild';
      game.scene = game.editor.scene;
      game.level = game.editor.level;
      game.history = LP.History.create(game.scene);
      game.selected = null;
      R.restartLight(game.renderer);
      game.ui.showScreen('editor');
      game.ui.refresh();
    };

    game.closeEditor = function () {
      if (game.editor && game.editor.dirty) {
        game.editor.save();
        game.ui.toast('Draft saved to your levels.', 'good');
      }
      game.editor = null;
      game.mode = 'play';
      game.ui.showScreen('title');
    };

    game.editorPlace = function (type) {
      game.editor.beginPlace(type);
      game.armedType = type;
      game.input.beginPlacement(type);
      game.ui.toast('Click the bench to drop a ' + E.TYPES[type].short.toLowerCase() + '.');
    };

    game.editorEnterTest = function () {
      game.scene = game.editor.enterTest();
      game.level = game.editor.level;
      game.history = LP.History.create(game.scene);
      game.mode = 'editorTest';
      game.solveReported = false;
      game.selected = null;
      R.restartLight(game.renderer);
      game.ui.refresh();
      game.ui.toast('Test mode — solve it, then save the answer.');
    };

    game.editorExitTest = function () {
      game.scene = game.editor.exitTest();
      game.mode = 'editorBuild';
      game.history = LP.History.create(game.scene);
      game.selected = null;
      R.restartLight(game.renderer);
      game.ui.refresh();
    };

    /* ==================================================================
     * Multiplayer
     * ================================================================ */
    game.startMultiplayer = function (cfg) {
      var transport = cfg.transport === 'socket'
        ? LP.Net.SocketTransport(cfg.url, cfg.room, 'player')
        : LP.Net.LocalTransport();

      return transport.connect().then(function () {
        game.session = LP.Net.createSession({
          transport: transport,
          mode: cfg.mode,
          you: cfg.transport === 'socket' ? 'A' : 'A',
          onUpdate: function (scene) {
            game.scene = scene;
            game.scene.dirty = true;
            game.ui.refresh();
          },
          onStatus: function (st) {
            if (st.error) game.ui.toast(st.error, 'bad', 4200);
            if (st.disconnected) {
              game.ui.toast('Disconnected from the relay.', 'bad', 4200);
              game.session = null;
              game.ui.setStatus(null);
            }
            renderSessionStrip(st);
          },
          onFinish: function (res) {
            var msg = cfg.mode === 'versus'
              ? (res.mine ? 'You took the round.' : 'Your opponent got there first.')
              : 'Solved together.';
            game.ui.toast(msg, res.mine ? 'good' : null, 5000);
          }
        });

        /* Pick a level that genuinely needs two sets of hands. */
        var pool = LP.Levels.LEVELS.filter(function (l) {
          return !l.sandbox && !l.holdTime && (l.inventory || []).length >= 2;
        });
        var lvl = pool[Math.floor(Math.random() * pool.length)];
        game.level = lvl;
        game.scene = game.session.start(lvl);
        game.history = LP.History.create(game.scene);
        game.mode = 'multiplayer';
        game.solveReported = false;
        R.restartLight(game.renderer);
        game.ui.refresh();
        renderSessionStrip({});
      });
    };

    function renderSessionStrip(st) {
      if (!game.session) return;
      var s = game.session;
      game.ui.setStatus(
        '<span class="strip-label">' + (s.mode === 'coop' ? 'Co-op' : 'Versus') + '</span>' +
        '<span class="strip-val">you are ' + s.you + '</span>' +
        (s.latency !== null ? '<span class="strip-val">' + s.latency + 'ms</span>' : '') +
        '<span class="strip-val">' + (s.transport.kind === 'local' ? 'hotseat' : 'online') + '</span>'
      );
    }

    /* ==================================================================
     * Settings
     * ================================================================ */
    function applySettings() {
      var r = game.renderer;
      r.colorblind = game.settings.colorblind;
      r.reducedMotion = game.settings.reducedMotion;
      r.quality = game.settings.quality;
      R.resize(r);
      LP.Audio.setEnabled(game.settings.sound);
      LP.Audio.setMusic(game.settings.music);
    }
    game.applySettings = applySettings;

    game.setInputEnabled = function (on) {
      if (game.input) game.input.enabled = on;
    };

    /* ==================================================================
     * Loop
     *
     * requestAnimationFrame drives it. Some embedded webviews and offscreen
     * contexts throttle rAF to nothing even while the document reports itself
     * visible, which would leave the game frozen with no error to show for it.
     * A watchdog notices that and drives the loop from a timer until rAF comes
     * back. `dt` is measured from the clock either way, so the simulation runs
     * at the right speed regardless of which one is ticking.
     * ================================================================ */
    var last = performance.now();
    var lastFrameAt = last;
    var lastRafAt = last;
    var rafPending = false;
    var fallbackTimer = null;

    function schedule() {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(function (now) {
        rafPending = false;
        lastRafAt = now;
        frame(now);
      });
    }

    function startFallback() {
      if (fallbackTimer) return;
      fallbackTimer = setInterval(function () { frame(performance.now()); }, 1000 / 30);
    }
    function stopFallback() {
      if (!fallbackTimer) return;
      clearInterval(fallbackTimer);
      fallbackTimer = null;
    }

    setInterval(function () {
      if (typeof document !== 'undefined' && document.hidden) { stopFallback(); return; }
      var now = performance.now();
      if (now - lastRafAt < 250) stopFallback();        /* rAF is healthy */
      else if (now - lastFrameAt > 400) startFallback();
    }, 500);

    function frame(now) {
      var elapsed = (now - last) / 1000;
      /* Physics is clamped: a long stall must not let the pendulum integrator
       * take one enormous step. The beam-travel animation is not physics, so
       * it gets the real elapsed time and catches up instead of crawling in
       * slow motion after the tab has been throttled. */
      var dt = Math.min(0.05, elapsed);
      var animDt = Math.min(1.0, elapsed);
      last = now;
      lastFrameAt = now;

      if (game.scene) {
        if (game.mode === 'replay' && game.replayPlayer) {
          if (game.replayPlayer.step(dt)) {
            game.mode = 'play';
            game.replayPlayer = null;
            game.ui.setStatus(null);
            game.ui.showScreen('win', {
              level: game.level, ev: game.lastEval,
              stars: game.lastReplay ? game.lastReplay.stars : 1,
              seconds: game.lastReplay ? game.lastReplay.seconds : 0,
              isDaily: !!game.level.isDaily
            });
          }
        } else {
          if (game.mode === 'editorBuild') {
            if (game.scene.dirty) Sc.run(game.scene);
          } else {
            checkSolve(dt);
          }
          R.stepLight(game.renderer, animDt,
            game.scene.lastResult ? game.scene.lastResult.stats.maxPath : 0);
        }

        R.stepParticles(game.renderer, dt);

        if (game.hintGhost && performance.now() > game.hintGhost.until) game.hintGhost = null;

        R.draw(game.renderer, {
          scene: game.scene,
          theme: game.chapterOf(game.level) || LP.Levels.CHAPTERS[0],
          selected: game.selected,
          activeHandle: game.input.activeHandle,
          dragging: game.input.dragging,
          hoverTray: !!game.armedType,
          preview: game.input.preview,
          ghost: game.input.ghost,
          hint: game.hintGhost
        });

        if (game.level && game.level.holdTime) updateStatusStrip();
      }
      schedule();
    }
    schedule();

    /* ==================================================================
     * Entry: a shared level in the URL wins; otherwise the title screen.
     * ================================================================ */
    var frag = LP.Share.readFragment();
    if (frag && frag.lvl) {
      try {
        game.loadSharedCode(frag.lvl);
      } catch (e) {
        game.ui.toast('That shared link could not be read: ' + e.message, 'bad', 5000);
        game.loadLevelById('lab-1');
        game.ui.showScreen('title');
      }
    } else if (frag && frag.daily !== undefined) {
      game.loadDaily();
    } else {
      game.loadLevelById('lab-1');
      game.ui.showScreen('title');
    }

    /* Global escape: leave whatever overlay is open. */
    window.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      if (game.ui.screen && game.ui.screen !== 'title') { game.ui.hideScreen(); }
      else if (game.armedType) { game.armPlacement(game.armedType); }
    });

    LP.game = game;
    return game;
  }

  LP.Main = { boot: boot, STARS_PER_CHAPTER: STARS_PER_CHAPTER };

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', function () {
      var root = document.getElementById('app');
      if (root) boot(root);
    });
  }
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
