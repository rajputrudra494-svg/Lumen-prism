/* =============================================================================
 * Lumen Path - src/main.js
 * -----------------------------------------------------------------------------
 * The game controller. Owns the loop, the current level, and the transitions
 * between playing, editing, replaying and multiplayer.
 *
 * TIMED LEVELS
 * A level played in phases (src/engine/phases.js) waits, armed, until the
 * player starts the clock. From then on the phase engine reports events --
 * a second gone, a phase cleared, time up, a rewind -- and this file turns
 * them into what the player feels: the count-in, the ticking, the beacon in
 * the last ten seconds, the power cut, pieces lifting back into the tray.
 * The bench only takes input while a phase's clock is actually running.
 *
 * THE LOOP
 * Fixed work per frame is deliberately small. The tracer only re-runs when the
 * scene is dirty (something moved) or when a level contains moving parts, so a
 * static puzzle sitting untouched costs one canvas repaint and nothing else.
 * ========================================================================== */
(function (LP) {
  'use strict';

  var R = LP.Renderer, Sc = LP.Scene, E = LP.Elements, M = LP.M, S = LP.Spectrum, Ph = LP.Phases;

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
      running: true,
      /* What the lights are doing: `power` dips to nothing in a power cut,
       * `alarm` drives the beacon in a phase's last seconds. */
      fx: { power: 1, alarm: 0, from: 1, to: 1, t: 1, dur: 1 },
      countIn: 0
    };

    /* ---- Renderer + UI ------------------------------------------------ */
    game.ui = LP.UI.create(game, rootEl);
    game.renderer = R.create(game.ui.canvas, { quality: game.settings.quality });
    applySettings();

    game.input = LP.Input.attach(game.ui.canvas, {
      renderer: game.renderer,
      scene: function () { return game.scene; },
      onChange: onSceneChange,
      onSelect: function (el) { game.selected = el; },
      pushHistory: function () { if (game.history) LP.History.push(game.history); },
      placeElement: function (type, p) { return placeElement(type, p); },
      canRemove: function (el) { return game.canRemove(el); },
      tapHandle: function (kind, el) { game.tapHandle(kind, el); },
      onRejected: function () {
        game.ui.toast('Not a legal spot — stay inside the marked bays.', 'bad', 1800);
        LP.Audio.error();
      },
      undo: function () { game.undo(); },
      redo: function () { game.redo(); },
      resetLevel: function () { game.resetLevel(); },
      hint: function () { game.hint(); }
    });

    /* The stage is fitted into the space the HUD leaves, and the HUD itself
     * reflows with the window, so a resize has to re-measure before it
     * re-fits. Coalesced to one pass per frame -- mobile browsers fire resize
     * repeatedly while the address bar slides in and out. */
    var resizeQueued = false;
    function queueRelayout() {
      if (resizeQueued) return;
      resizeQueued = true;
      requestAnimationFrame(function () {
        resizeQueued = false;
        game.ui.measureInsets();
      });
      /* rAF may be throttled; make sure the relayout still happens. */
      setTimeout(function () { if (resizeQueued) { resizeQueued = false; game.ui.measureInsets(); } }, 120);
    }
    window.addEventListener('resize', queueRelayout);
    window.addEventListener('orientationchange', queueRelayout);
    game.queueRelayout = queueRelayout;

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

    /** A short vibration on devices that support it, if the player allows it. */
    function buzz(pattern) {
      if (!game.settings.haptics) return;
      if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
      try { navigator.vibrate(pattern); } catch (e) { /* not permitted here */ }
    }
    game.buzz = buzz;

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
        buzz(10);
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
      Ph.init(game.scene);
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
      /* A pendulum swings under gravity, so a sideways stage would show it
       * falling sideways. Those levels stay upright and letterbox instead. */
      game.renderer.allowRotate = !hasPendulum(game.scene);

      var ch = game.chapterOf(level);
      if (ch && LP.Audio.state.started) LP.Audio.setChapter(ch.mood);

      /* The lamps come on as the level loads, with a flicker. */
      game.fx.power = 0;
      powerTo(1, 0.5);
      game.fx.alarm = 0;
      game.countIn = 0;

      game.ui.refresh();
      game.ui.hideScreen();
      game.ui.hideBanner();
      updateStatusStrip();
      if (game.scene.phase) {
        game.ui.showPhaseStart(level);
        game.ui.updatePhaseClock(phaseView(game.scene));
      } else {
        game.ui.hidePhaseStart();
        game.ui.updatePhaseClock(null);
      }
      game.ui.measureInsets();
      return game.scene;
    };

    /** Start again from the very first phase -- or simply reload a level. */
    game.restartLevel = function () {
      if (game.level) game.loadLevel(game.level);
    };

    /** Start a timed level's clock. */
    game.startClock = function () {
      var sc = game.scene;
      if (!sc || !sc.phase || game.ui.screen) return;
      if (!Ph.start(sc)) return;
      LP.Audio.unlock();
      game.ui.hidePhaseStart();
      game.countIn = 4;
      announcePhase(sc, 'start');
    };

    function hasPendulum(scene) {
      return scene.elements.some(function (el) {
        return el.motion && el.motion.type === 'pendulum';
      }) || (scene.inventory || []).some(function (slot) {
        return slot.preset && slot.preset.motion && slot.preset.motion.type === 'pendulum';
      });
    }

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
      if (game.settings.openAll) return true;
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

    /** Can this object be taken off the bench? Player pieces always; in the
     *  editor's build mode, anything the author placed. */
    game.canRemove = function (el) {
      if (!el) return false;
      if (game.mode === 'editorBuild') return el.type !== 'emitter' || game.scene.emitters.length > 1;
      if (game.mode === 'replay') return false;
      if (game.session && !game.session.ownsElement(el)) return false;
      return !!el.fromInventory;
    };

    game.removeElement = function (el) {
      if (!game.canRemove(el)) return;
      if (game.mode === 'editorBuild' && game.editor) {
        game.editor.selected = el;
        if (game.editor.deleteSelected()) {
          game.scene = game.editor.scene;
          game.history = LP.History.create(game.scene);
        }
        game.select(null);
        R.restartLight(game.renderer);
        game.ui.refresh();
        LP.Audio.drop();
        buzz(12);
        return;
      }
      LP.History.push(game.history);
      if (game.session) game.session.remove(el);
      else Sc.remove(game.scene, el);
      game.select(null);
      onSceneChange(true);
      LP.Audio.drop();
      buzz(12);
    };

    game.removeSelected = function () { game.removeElement(game.selected); };

    /**
     * The badges on a selected object -- the on-bench replacement for the old
     * properties panel. Each one is a single tap with a visible result, and
     * each announces what it did, because a badge has no room for a label.
     */
    game.tapHandle = function (kind, el) {
      if (!el) return;
      var T = E.TYPES[el.type];
      var locked = el.fixedProps || [];
      if (kind === 'remove') { game.removeElement(el); return; }

      var note = null;
      if (kind === 'flip' && T.caps.flip) {
        LP.History.push(game.history);
        el.flipped = !el.flipped;
        note = 'Mirrored face flipped';
      } else if (kind === 'color' && T.caps.colorize && locked.indexOf('color') < 0) {
        LP.History.push(game.history);
        el.color = E.nextInCycle(E.COLOR_CYCLE, el.color);
        note = 'Filter passes ' + el.color;
      } else if (kind === 'material' && T.caps.material && locked.indexOf('material') < 0) {
        LP.History.push(game.history);
        el.material = E.nextInCycle(T.caps.material, el.material);
        var mat = LP.Materials.get(el.material);
        note = mat.name + '  n = ' + LP.Materials.iorAt(el.material, 589).toFixed(2);
      }
      if (!note) return;

      E.touch(el);
      game.scene.dirty = true;
      game.solveReported = false;
      R.restartLight(game.renderer);
      if (game.session) game.session.move(el);
      game.ui.refreshHUD();
      game.ui.toast(note, null, 1400);
      LP.Audio.tick();
      buzz(8);
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
      var ps = game.scene && game.scene.phase;
      if (ps) {
        /* On a timed level, reset means this phase, and it costs an attempt:
         * otherwise it would be a free way to wind the clock back up. */
        if (ps.state === 'done') { game.restartLevel(); return; }
        var evs = Ph.restartPhase(game.scene);
        if (!evs) return;
        onPhaseEvents(evs);
        game.ui.toast('Phase ' + (ps.index + 1) + ' restarted. That counts as an attempt.', 'bad', 2600);
        return;
      }
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
      var answer = lvl.solution;
      var ps = game.scene.phase;
      if (ps) {
        /* A timed level hints at the current phase's own pieces. */
        var def = lvl.phases[ps.index];
        answer = (def.solution || []).filter(function (op) {
          return op.move === undefined && op.remove === undefined;
        });
        if (!answer.length) {
          game.hintUsed = true;
          game.ui.toast(def.hint || 'No new pieces this phase: move the ones already down.', null, 4200);
          return;
        }
      }
      var target = answer.find(function (s) {
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
     * Solve detection
     * ================================================================ */
    function checkSolve(dt) {
      if (!game.scene || game.mode === 'editorBuild' || game.mode === 'replay') return;
      var ev = Sc.tickSolve(game.scene, dt, { paused: !!game.ui.screen });
      game.lastEval = ev;
      if (ev.events && ev.events.length) onPhaseEvents(ev.events);
      if (ev.phase) game.ui.updatePhaseClock(ev.phase);

      /* Chime once per receiver as it comes on. */
      ev.receivers.forEach(function (r, i) {
        var was = game.lastLit[r.id];
        /* Alarms count as satisfied while they stay DARK -- that is not a
         * moment to celebrate, so they get no chime and no burst. */
        if (r.lit && !was && !r.dark && !r.inactive) {
          var rc = game.scene.receivers[i];
          LP.Audio.chime(i / Math.max(1, ev.receivers.length));
          buzz(15);
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
      var ps = game.scene.phase;
      if (ps) seconds = ps.running;
      var stars = game.hintUsed ? Math.min(2, ev.stars || 1) : (ev.stars || 1);

      LP.Audio.fanfare();
      buzz([20, 60, 35]);
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
        game.ui.hideBanner();
        game.ui.showScreen('win', {
          level: game.level, ev: ev, stars: stars, seconds: seconds,
          isDaily: !!game.level.isDaily,
          phases: ps ? { count: ps.count, failures: ps.failures, results: ps.results } : null
        });
      }, ps ? 1200 : 900);
    }

    /* ==================================================================
     * Timed levels: turning phase events into light, sound and banners
     * ================================================================ */
    function phaseView(scene) {
      var ps = scene.phase;
      if (!ps) return null;
      var def = scene.level.phases[ps.index];
      return {
        index: ps.index, count: ps.count, name: def.name || '', state: ps.state,
        time: ps.time, timeLeft: ps.timeLeft, attempt: ps.attempt, failures: ps.failures
      };
    }

    function announcePhase(scene, why) {
      var ps = scene.phase;
      var def = scene.level.phases[ps.index];
      var kicker = 'Phase ' + (ps.index + 1) + ' of ' + ps.count;
      if (why === 'retry') kicker += ' · attempt ' + ps.attempt;
      game.ui.banner(kicker, def.name || 'Go', Math.round(def.time) + ' seconds on the clock',
                     why === 'retry' ? 'bad' : 'warn', 0);
    }

    function powerTo(target, dur) {
      var fx = game.fx;
      fx.from = fx.power;
      fx.to = target;
      fx.t = 0;
      fx.dur = game.renderer.reducedMotion ? 0.0001 : dur;
    }

    function stepFx(dt) {
      var fx = game.fx;
      if (fx.t < fx.dur) {
        fx.t += dt;
        var k = Math.min(1, fx.t / fx.dur);
        var base = fx.from + (fx.to - fx.from) * k;
        /* Lamps do not fade: they stutter, catch, and hold. */
        var stutter = k < 1 && Math.random() < 0.4 ? 0.15 + Math.random() * 0.6 : 1;
        fx.power = k < 1 ? base * stutter : fx.to;
      }
      var ps = game.scene && game.scene.phase;
      var want = 0;
      if (ps && ps.state === 'running' && ps.timeLeft <= 10 && !game.ui.screen) {
        want = 0.4 + 0.6 * (1 - ps.timeLeft / 10);
      }
      fx.alarm += (want - fx.alarm) * Math.min(1, dt * 5);

      /* The count-in: three pips, then the clock is live. */
      if (ps && ps.state === 'intro' && !game.ui.screen) {
        var beat = Math.ceil(ps.stateT / (Ph.INTRO_TIME / 3));
        if (beat < game.countIn && beat >= 1) LP.Audio.armBeep(false);
        game.countIn = beat;
      }
    }

    function onPhaseEvents(events) {
      var sc = game.scene, rr = game.renderer;
      var ps = sc.phase;
      events.forEach(function (e) {
        switch (e.type) {
          case 'live':
            LP.Audio.armBeep(true);
            game.ui.hideBanner();
            break;

          case 'second':
            if (e.left > 0) LP.Audio.clockTick(e.left);
            if (e.left <= 5 && e.left > 0) buzz(10);
            break;

          case 'clear': {
            LP.Audio.phaseClear();
            buzz([18, 50, 24]);
            sc.receivers.forEach(function (rc) {
              if (rc.goal && !(rc.require && rc.require.dark)) {
                R.burst(rr, { x: rc.x, y: rc.y }, { r: 0.6, g: 1, b: 0.7 }, 30);
              }
            });
            var next = e.last ? null : game.level.phases[e.index + 1];
            game.ui.banner('Phase ' + (e.index + 1) + ' clear',
                           e.last ? 'Every phase done' : 'Well held',
                           next ? 'Next: ' + (next.name || 'phase ' + (e.index + 2)) : '',
                           'good', 0);
            game.select(null);
            break;
          }

          case 'timeout':
            LP.Audio.buzzer();
            LP.Audio.powerDown();
            buzz([70, 50, 70]);
            powerTo(0, 0.45);
            rr.shake = 10;
            game.select(null);
            game.input.cancelGesture();
            game.armedType = null;
            game.ui.refreshTray();
            game.ui.banner('Time up', 'Phase ' + (e.index + 1) + ' rewinds',
                           'Every piece goes back to where the phase began', 'bad', 0);
            break;

          case 'rewound':
            (e.pieces || []).forEach(function (p) {
              R.burst(rr, p, { r: 1, g: 0.72, b: 0.45 }, 14);
            });
            break;

          case 'retry':
            LP.Audio.powerUp();
            powerTo(1, 0.6);
            afterBenchChange();
            game.countIn = 4;
            announcePhase(sc, 'retry');
            break;

          case 'install':
          case 'retire':
          case 'adjust':
            e.el._fxT = rr.time;
            if (e.type === 'install') R.burst(rr, { x: e.el.x, y: e.el.y }, { r: 1, g: 0.86, b: 0.62 }, 16);
            break;

          case 'begin': {
            LP.Audio.relay();
            afterBenchChange();
            game.countIn = 4;
            announcePhase(sc, 'begin');
            var def = game.level.phases[e.index];
            if (def.inventory && def.inventory.length) {
              game.ui.toast('New pieces in the tray for this phase.', 'good', 2400);
            }
            break;
          }
        }
      });
      if (ps) game.ui.updatePhaseClock(phaseView(sc));
    }

    /** The bench changed under the player: new history, tray and light. */
    function afterBenchChange() {
      game.history = LP.History.create(game.scene);
      game.select(null);
      game.armedType = null;
      game.hintGhost = null;
      game.lastLit = {};
      R.restartLight(game.renderer);
      game.ui.refresh();
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
      if (!lvl.holdTime || lvl.phases) { game.ui.setStatus(null); return; }
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
      game.renderer.allowRotate = true;
      R.restartLight(game.renderer);
      game.ui.showScreen('editor');
      game.ui.refresh();
      game.ui.measureInsets();
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
          return !l.sandbox && !l.holdTime && !l.phases && (l.inventory || []).length >= 2;
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
        /* The bench takes input only while nothing is in the way: no open
         * screen, and on a timed level, only while the clock is running. */
        var ps = game.scene.phase;
        var locked = !!(ps && game.mode === 'play' && ps.state !== 'running');
        var wantInput = !game.ui.screen && !locked;
        if (game.input.enabled !== wantInput) {
          game.input.enabled = wantInput;
          if (!wantInput) game.input.cancelGesture();
        }
        stepFx(animDt);

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
          removable: game.canRemove(game.selected),
          activeHandle: game.input.activeHandle,
          dragging: game.input.dragging,
          hoverTray: !!game.armedType,
          preview: game.input.preview,
          ghost: game.input.ghost,
          hint: game.hintGhost,
          fx: game.fx
        });

        if (game.level && game.level.holdTime && !game.level.phases) updateStatusStrip();
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

    /* Enter or Space starts a timed level's clock. */
    window.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      if (ev.target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(ev.target.tagName)) return;
      var ps = game.scene && game.scene.phase;
      if (ps && ps.state === 'armed' && !game.ui.screen) { ev.preventDefault(); game.startClock(); }
    });

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
