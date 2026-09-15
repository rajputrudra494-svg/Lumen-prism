/* =============================================================================
 * Lumen Path - src/engine/phases.js
 * -----------------------------------------------------------------------------
 * Timed levels played in parts.
 *
 * A phased level runs against a clock, one phase at a time. Clear a phase's
 * goals before its clock runs out and the next phase begins: new hardware
 * rises out of the bench, lamps switch on, fresh pieces arrive in the tray.
 * Run out of time and the phase REWINDS -- every piece goes back to exactly
 * where it stood when the phase began, the clock is wound back up, and the
 * phase starts again. As many times as it takes. The level is done when the
 * last phase clears.
 *
 * DECLARING PHASES
 *
 *   level.phases = [{ name, time, goals?, keep?, holdTime?, inventory?, fog?,
 *                     set?, hint?, solution }, ...]
 *
 *   Any emitter, receiver, fixed element or wall may carry
 *       phase: n   installed (switched on) when phase n begins
 *       until: n   removed (switched off) when phase n begins
 *   Phases are numbered from 1 in level data. Hardware waiting for its phase
 *   stays on the bench as a socket, a slot or a dark lamp -- visible, so the
 *   next phase can be planned for, but inert: the tracer skips `disabled`.
 *
 *   goals      receiver ids this phase needs lit. By default: the receivers
 *              installed for this phase. `keep: true` makes every live
 *              receiver a goal, so earlier sensors must STAY lit while the new
 *              ones come on. Live alarms are watched in every phase.
 *   holdTime   how long the goals must stay satisfied to count (default 0.5s)
 *   inventory  pieces added to the tray as the phase begins
 *   set        [{ id, ...props }] changes to fixed hardware as the phase begins
 *   fog        a new fog coefficient from this phase on
 *   solution   the reference moves for this phase -- replayed by the verifier,
 *              and revealed one at a time by the hint button:
 *                  { type, x, y, ... }    place a new piece
 *                  { move: k, ...props }  adjust the k-th piece placed so far
 *                  { remove: k }          send the k-th piece back to the tray
 *
 * Everything here is pure state -- no DOM, no canvas, no wall clock -- so the
 * verifier can play a phased level from the first second to the last in Node
 * and prove each phase can be cleared inside its time.
 * ========================================================================== */
(function (LP) {
  'use strict';

  var Sc = LP.Scene, E = LP.Elements;

  var INTRO_TIME = 1.8;      /* "PHASE 2 -- 30 SECONDS" before the clock runs */
  var CLEAR_TIME = 1.7;      /* the pause on a cleared phase */
  var TIMEOUT_TIME = 2.4;    /* the power cut before a phase rewinds */
  var DEFAULT_HOLD = 0.5;    /* goals must stay satisfied this long */

  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

  function isPhased(level) { return !!(level && level.phases && level.phases.length); }

  /** Is a piece of hardware switched on during phase n (numbered from 1)? */
  function enabledAt(def, n) {
    return (def.phase === undefined || n >= def.phase) &&
           (def.until === undefined || n < def.until);
  }

  /* --------------------------------------------------------------------------
   * Set-up
   * ------------------------------------------------------------------------ */
  function init(scene) {
    if (!isPhased(scene.level)) { scene.phase = null; return null; }
    scene.phase = {
      count: scene.level.phases.length,
      index: -1,
      state: 'armed',
      stateT: 0,
      time: 0,
      timeLeft: 0,
      lastSecond: 0,
      hold: 0,
      attempt: 1,         /* attempts at the current phase */
      failures: 0,        /* timeouts and restarts across the whole level */
      running: 0,         /* seconds of clock actually spent, all phases */
      phaseRunning: 0,    /* seconds spent on the current attempt */
      snapshot: null,
      fogAtStart: scene.fog,
      results: []         /* per cleared phase: { attempts, seconds } */
    };
    begin(scene, 0, []);
    scene.phase.state = 'armed';
    return scene.phase;
  }

  /**
   * Bring the bench to the start of phase `i`: install and retire hardware,
   * hand out the phase's pieces, pick its goals, and wind the clock.
   */
  function begin(scene, i, events) {
    var ps = scene.phase;
    var def = scene.level.phases[i];
    var n = i + 1;
    var k, el, key;
    ps.index = i;

    for (k = 0; k < scene.elements.length; k++) {
      el = scene.elements[k];
      if (el.phase === undefined && el.until === undefined) continue;
      var on = enabledAt(el, n);
      if (on && el.disabled) { el.disabled = false; events.push({ type: 'install', el: el }); }
      else if (!on && !el.disabled) { el.disabled = true; events.push({ type: 'retire', el: el }); }
    }

    (def.set || []).forEach(function (s) {
      var target = scene.byId[s.id];
      if (!target) return;
      for (key in s) if (has(s, key) && key !== 'id') target[key] = s[key];
      E.touch(target);
      events.push({ type: 'adjust', el: target });
    });
    if (def.fog !== undefined) scene.fog = def.fog;

    (def.inventory || []).forEach(function (inv) {
      scene.inventory.push({
        type: inv.type,
        count: inv.count === undefined ? 1 : inv.count,
        used: 0,
        preset: inv.preset || null,
        label: inv.label || null,
        phase: n
      });
    });

    var goals = def.goals || null;
    for (k = 0; k < scene.receivers.length; k++) {
      var rc = scene.receivers[k];
      var live = !rc.disabled;
      var alarm = !!(rc.require && rc.require.dark);
      var goal;
      /* A live alarm is always watching, whatever the phase asks for. */
      if (alarm) goal = true;
      else if (goals) goal = goals.indexOf(rc.id) >= 0;
      else if (def.keep) goal = true;
      else goal = (rc.phase || 1) === n;
      rc.goal = live && goal;
      rc.latched = live && !rc.goal && rc.completed === true;
    }

    ps.time = def.time;
    ps.timeLeft = def.time;
    ps.lastSecond = Math.ceil(def.time);
    ps.hold = 0;
    ps.phaseRunning = 0;
    ps.attempt = 1;
    scene.dirty = true;
    ps.fogAtStart = scene.fog;
    ps.snapshot = Sc.snapshot(scene);
  }

  /**
   * Wind the current phase back to its start. Reports every piece the rewind
   * takes off the bench, so the game can show them going.
   */
  function rewind(scene, events) {
    var ps = scene.phase;
    var before = scene.elements.filter(function (el) { return el.fromInventory; })
      .map(function (el) { return { x: el.x, y: el.y, type: el.type, id: el.id }; });
    Sc.restore(scene, ps.snapshot);
    var kept = {};
    scene.elements.forEach(function (el) { if (el.fromInventory) kept[el.id] = el; });
    var gone = before.filter(function (b) {
      var now = kept[b.id];
      return !now || Math.abs(now.x - b.x) > 0.5 || Math.abs(now.y - b.y) > 0.5;
    });
    scene.fog = ps.fogAtStart;
    ps.timeLeft = ps.time;
    ps.lastSecond = Math.ceil(ps.time);
    ps.hold = 0;
    ps.phaseRunning = 0;
    ps.attempt++;
    scene.dirty = true;
    events.push({ type: 'rewound', pieces: gone });
  }

  /** Start the clock on a level that is waiting for the player. */
  function start(scene) {
    var ps = scene.phase;
    if (!ps || ps.state !== 'armed') return false;
    ps.state = 'intro';
    ps.stateT = INTRO_TIME;
    return true;
  }

  /**
   * The player gave up on this attempt. Counts exactly like running out of
   * time -- otherwise a restart would be a free way to wind the clock back.
   */
  function restartPhase(scene) {
    var ps = scene.phase;
    if (!ps || (ps.state !== 'running' && ps.state !== 'intro')) return null;
    var events = [];
    ps.failures++;
    rewind(scene, events);
    ps.state = 'intro';
    ps.stateT = INTRO_TIME;
    events.push({ type: 'retry', index: ps.index, attempt: ps.attempt });
    return events;
  }

  function holdNeeded(scene) {
    var def = scene.level.phases[scene.phase.index];
    if (def.holdTime !== undefined) return def.holdTime;
    return scene.level.holdTime || DEFAULT_HOLD;
  }

  /* --------------------------------------------------------------------------
   * The clock
   * ------------------------------------------------------------------------ */

  /**
   * Advance a phased level by `dt`. Drop-in replacement for Scene.tickSolve,
   * returning the same evaluation plus `phase` (what the HUD shows) and
   * `events` (what the game should react to this frame).
   *
   * `opts.paused` freezes the phase machine -- menus are open -- while the
   * machinery on the bench keeps moving.
   */
  function tick(scene, dt, opts) {
    var o = opts || {};
    var ps = scene.phase;
    Sc.update(scene, dt);
    var ev = Sc.evaluate(scene);
    var events = [];
    ev.events = events;
    if (!ps) return ev;

    if (!o.paused) {
      switch (ps.state) {
        case 'intro':
          ps.stateT -= dt;
          if (ps.stateT <= 0) {
            ps.state = 'running';
            events.push({ type: 'live', index: ps.index });
          }
          break;

        case 'running':
          ps.timeLeft = Math.max(0, ps.timeLeft - dt);
          ps.running += dt;
          ps.phaseRunning += dt;
          var sec = Math.ceil(ps.timeLeft - 1e-9);
          if (sec !== ps.lastSecond) {
            ps.lastSecond = sec;
            events.push({ type: 'second', left: sec });
          }
          if (ev.allLit && ev.positive > 0) ps.hold += dt;
          else ps.hold = Math.max(0, ps.hold - dt * 2);

          if (ps.hold >= holdNeeded(scene)) {
            scene.receivers.forEach(function (rc) {
              if (rc.goal && !(rc.require && rc.require.dark)) rc.completed = true;
            });
            ps.results[ps.index] = { attempts: ps.attempt, seconds: ps.phaseRunning };
            ps.state = 'clear';
            ps.stateT = CLEAR_TIME;
            events.push({ type: 'clear', index: ps.index, last: ps.index + 1 >= ps.count });
          } else if (ps.timeLeft <= 0) {
            ps.failures++;
            ps.state = 'timeout';
            ps.stateT = TIMEOUT_TIME;
            events.push({ type: 'timeout', index: ps.index });
          }
          break;

        case 'clear':
          ps.stateT -= dt;
          if (ps.stateT <= 0) {
            if (ps.index + 1 >= ps.count) {
              ps.state = 'done';
              events.push({ type: 'done' });
            } else {
              begin(scene, ps.index + 1, events);
              ps.state = 'intro';
              ps.stateT = INTRO_TIME;
              events.push({ type: 'begin', index: ps.index });
            }
          }
          break;

        case 'timeout':
          ps.stateT -= dt;
          if (ps.stateT <= 0) {
            rewind(scene, events);
            ps.state = 'intro';
            ps.stateT = INTRO_TIME;
            events.push({ type: 'retry', index: ps.index, attempt: ps.attempt });
          }
          break;
      }
    }

    var def = scene.level.phases[ps.index];
    ev.phase = {
      index: ps.index, count: ps.count, name: def.name || '', hint: def.hint || '',
      state: ps.state, stateT: ps.stateT,
      time: ps.time, timeLeft: ps.timeLeft,
      attempt: ps.attempt, failures: ps.failures
    };
    ev.holdProgress = Math.min(1, ps.hold / Math.max(1e-6, holdNeeded(scene)));
    ev.solved = ps.state === 'done';
    if (ev.solved) ev.stars = stars(ps);
    return ev;
  }

  /**
   * Stars on a timed level reward nerve, not thrift:
   *   3 - every phase cleared on its first attempt
   *   2 - no more than two rewinds in the whole level
   *   1 - finished
   */
  function stars(ps) {
    if (ps.failures === 0) return 3;
    if (ps.failures <= 2) return 2;
    return 1;
  }

  /* --------------------------------------------------------------------------
   * Reference play-through (verifier, tests, replays)
   * ------------------------------------------------------------------------ */

  /** Apply one phase's reference moves. Returns false if any could not be made. */
  function applyMoves(scene, ops, pieces) {
    var ok = true;
    (ops || []).forEach(function (op) {
      var k;
      if (op.remove !== undefined) {
        var gone = pieces[op.remove];
        if (!gone || !Sc.remove(scene, gone)) ok = false;
        return;
      }
      if (op.move !== undefined) {
        var el = pieces[op.move];
        if (!el) { ok = false; return; }
        for (k in op) if (has(op, k) && k !== 'move') el[k] = op[k];
        E.touch(el);
        scene.dirty = true;
        return;
      }
      var extra = {};
      for (k in op) if (has(op, k) && k !== 'type' && k !== 'x' && k !== 'y') extra[k] = op[k];
      var placed = Sc.place(scene, op.type, op.x, op.y, extra);
      if (!placed) ok = false;
      pieces.push(placed);
    });
    return ok;
  }

  /**
   * Play a phased level with its reference moves, at 60 ticks a second, and
   * report how each phase went.
   *
   *   opts.withhold  phase index whose moves are NOT made -- that phase must
   *                  then run out of time, or it was a free clear
   */
  function simulate(level, opts) {
    var o = opts || {};
    var dt = 1 / 60;
    var scene = Sc.fromLevel(level);
    init(scene);
    start(scene);
    var ps = scene.phase;
    var pieces = [];
    var report = { completed: false, phases: [], failedAt: -1, scene: scene };
    var guard = 0;

    function step() {
      tick(scene, dt);
      if (++guard > 2e5) throw new Error('phase simulation did not settle');
    }

    for (var i = 0; i < ps.count; i++) {
      while (!(ps.state === 'running' && ps.index === i)) step();
      var def = level.phases[i];
      var made = o.withhold === i ? true : applyMoves(scene, def.solution, pieces);
      var used = ps.running;
      while (ps.state === 'running') step();
      var outcome = ps.state === 'clear' ? 'clear' : 'timeout';
      report.phases.push({
        index: i, outcome: outcome, madeMoves: made,
        seconds: ps.running - used, time: def.time,
        moves: (def.solution || []).length
      });
      if (outcome !== 'clear') { report.failedAt = i; return report; }
    }
    while (ps.state !== 'done') step();
    report.completed = true;
    return report;
  }

  /**
   * Bring a fresh scene straight to the final phase's bench, with every
   * phase's pieces in the tray -- how a replay of a phased level is rebuilt.
   */
  function fastForward(scene) {
    if (!init(scene)) return scene;
    for (var i = 1; i < scene.phase.count; i++) begin(scene, i, []);
    scene.phase.state = 'done';
    return scene;
  }

  /** Every piece a phased level's reference answer places, in order. */
  function allPlacements(level) {
    var out = [];
    (level.phases || []).forEach(function (p) {
      (p.solution || []).forEach(function (op) {
        if (op.move === undefined && op.remove === undefined) out.push(op);
      });
    });
    return out;
  }

  LP.Phases = {
    INTRO_TIME: INTRO_TIME,
    CLEAR_TIME: CLEAR_TIME,
    TIMEOUT_TIME: TIMEOUT_TIME,
    DEFAULT_HOLD: DEFAULT_HOLD,
    isPhased: isPhased,
    enabledAt: enabledAt,
    init: init,
    start: start,
    tick: tick,
    restartPhase: restartPhase,
    stars: stars,
    applyMoves: applyMoves,
    simulate: simulate,
    fastForward: fastForward,
    allPlacements: allPlacements
  };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
