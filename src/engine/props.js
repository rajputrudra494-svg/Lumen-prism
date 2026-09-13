/* =============================================================================
 * Lumen Path - src/engine/props.js
 * -----------------------------------------------------------------------------
 * Physical motion for elements that move. This is a small purpose-built rigid
 * body layer, not a general physics engine: every motion type below drives an
 * element's transform (x, y, angle, curvature) and nothing else, which keeps
 * the optics solver completely unaware that anything is moving.
 *
 * Motion is declared on the element:
 *
 *   el.motion = { type: 'pendulum', pivot: {x,y}, len: 220, release: 0.6, ... }
 *
 * All of them are deterministic given (level, elapsed time, player parameters),
 * so a replay only has to store the parameters, not a frame-by-frame recording.
 * ========================================================================== */
(function (LP) {
  'use strict';

  var M = LP.M, E = LP.Elements;

  var GRAVITY = 900;      /* world units / s^2 -- tuned for readable swings */

  var HANDLERS = {};

  /* --------------------------------------------------------------------------
   * PENDULUM
   * Integrates the real pendulum equation
   *
   *      theta'' = -(g / L) sin(theta)  -  damping * theta'
   *
   * with semi-implicit Euler. The small-angle approximation is deliberately
   * NOT used: at the large release angles these puzzles use, a real pendulum
   * is noticeably slower than the linearised one, and the levels are timed
   * against the real behaviour.
   *
   * The player sets `release` (the angle it is let go from) and never the live
   * position -- that is the puzzle.
   * ------------------------------------------------------------------------ */
  HANDLERS.pendulum = {
    init: function (el) {
      var m = el.motion;
      m.damping = m.damping === undefined ? 0.12 : m.damping;

      if (m.pivot && m.release === undefined) {
        /* THE RELEASE ANGLE IS WHERE THE PLAYER DROPPED IT.
         * A pendulum mirror is placed, not aimed: wherever on the arc it is
         * let go becomes its amplitude, and gravity does the rest. Deriving
         * the angle from the drop position is what makes that read as a
         * physical act rather than a hidden slider. */
        var dx = el.x - m.pivot.x, dy = el.y - m.pivot.y;
        var r = Math.sqrt(dx * dx + dy * dy);
        if (r > 1) {
          m.len = m.len || r;
          m.release = Math.atan2(dx, dy);   /* measured from straight down */
        }
      }
      m.len = m.len || 200;
      m.pivot = m.pivot || { x: el.x, y: el.y - m.len };
      m.theta = m.release || 0;
      m.omega = 0;
    },
    step: function (el, dt) {
      var m = el.motion;
      /* Sub-step so large dt (a stalled tab, say) cannot blow up the swing. */
      var steps = Math.max(1, Math.ceil(dt / 0.008));
      var h = dt / steps;
      for (var i = 0; i < steps; i++) {
        var alpha = -(GRAVITY / m.len) * Math.sin(m.theta) - m.damping * m.omega;
        m.omega += alpha * h;
        m.theta += m.omega * h;
      }
      /* theta is measured from straight down. */
      el.x = m.pivot.x + Math.sin(m.theta) * m.len;
      el.y = m.pivot.y + Math.cos(m.theta) * m.len;
      /* The mirror face stays perpendicular to the rod unless told otherwise. */
      el.angle = (m.baseAngle || 0) + m.theta;
      E.touch(el);
    },
    reset: function (el) { HANDLERS.pendulum.init(el); HANDLERS.pendulum.step(el, 0); }
  };

  /* --------------------------------------------------------------------------
   * TURNTABLE -- constant angular velocity, optionally with a phase offset the
   * player can dial in. Timing puzzles: the beam only lines up for a window.
   * ------------------------------------------------------------------------ */
  HANDLERS.turntable = {
    init: function (el) {
      var m = el.motion;
      m.speed = m.speed === undefined ? 0.6 : m.speed;   /* rad/s */
      m.baseAngle = m.baseAngle === undefined ? el.angle : m.baseAngle;
      m.phase = m.phase || 0;
    },
    step: function (el, dt, t) {
      var m = el.motion;
      el.angle = m.baseAngle + m.phase + m.speed * t;
      E.touch(el);
    },
    reset: function (el) { HANDLERS.turntable.init(el); }
  };

  /* --------------------------------------------------------------------------
   * TRACK -- an element carried back and forth along a rail. Uses a smooth
   * (cosine) profile so it eases at the ends like a real carriage rather than
   * snapping direction.
   * ------------------------------------------------------------------------ */
  HANDLERS.track = {
    init: function (el) {
      var m = el.motion;
      m.from = m.from || { x: el.x, y: el.y };
      m.to = m.to || { x: el.x + 200, y: el.y };
      m.period = m.period || 4;
      m.phase = m.phase || 0;
    },
    step: function (el, dt, t) {
      var m = el.motion;
      var u = 0.5 - 0.5 * Math.cos(((t / m.period) + m.phase) * M.TAU);
      el.x = m.from.x + (m.to.x - m.from.x) * u;
      el.y = m.from.y + (m.to.y - m.from.y) * u;
      if (m.rotateWithTrack) {
        el.angle = Math.atan2(m.to.y - m.from.y, m.to.x - m.from.x);
      }
      E.touch(el);
    },
    reset: function (el) { HANDLERS.track.init(el); }
  };

  /* --------------------------------------------------------------------------
   * ORBIT -- circular path around a centre.
   * ------------------------------------------------------------------------ */
  HANDLERS.orbit = {
    init: function (el) {
      var m = el.motion;
      m.center = m.center || { x: el.x - 150, y: el.y };
      m.radius = m.radius === undefined ? 150 : m.radius;
      m.speed = m.speed === undefined ? 0.5 : m.speed;
      m.phase = m.phase || 0;
      m.baseAngle = m.baseAngle === undefined ? el.angle : m.baseAngle;
    },
    step: function (el, dt, t) {
      var m = el.motion;
      var a = m.phase + m.speed * t;
      el.x = m.center.x + Math.cos(a) * m.radius;
      el.y = m.center.y + Math.sin(a) * m.radius;
      if (m.faceCenter) el.angle = a + Math.PI / 2;
      else el.angle = m.baseAngle;
      E.touch(el);
    },
    reset: function (el) { HANDLERS.orbit.init(el); }
  };

  /* --------------------------------------------------------------------------
   * BEAT -- rotates by a fixed step on every beat of the chapter's rhythm
   * track. Used by the sound-triggered mirrors in the Clockwork Tower chapter.
   * The step is quantised, so the puzzle is "which beat do I need" rather than
   * "can I click at the right millisecond".
   * ------------------------------------------------------------------------ */
  HANDLERS.beat = {
    init: function (el) {
      var m = el.motion;
      m.bpm = m.bpm || 100;
      m.stepAngle = m.stepAngle === undefined ? Math.PI / 6 : m.stepAngle;
      m.baseAngle = m.baseAngle === undefined ? el.angle : m.baseAngle;
      m.offset = m.offset || 0;         /* beats of head start, player-set */
      m.cycle = m.cycle || 12;          /* steps before it wraps */
    },
    step: function (el, dt, t) {
      var m = el.motion;
      var beat = Math.floor(t * (m.bpm / 60)) + m.offset;
      var n = ((beat % m.cycle) + m.cycle) % m.cycle;
      el.angle = m.baseAngle + n * m.stepAngle;
      m.beatIndex = n;
      E.touch(el);
    },
    reset: function (el) { HANDLERS.beat.init(el); }
  };

  /* --------------------------------------------------------------------------
   * THERMAL DRIFT -- not motion but deformation.
   *
   * A thermal mirror absorbs a little of every beam that lands on it. Above a
   * threshold the substrate expands and the mirror bows; below it, it cools
   * and relaxes back. The player has to keep total incident power on the
   * mirror inside a band, which turns "just point the beam" into an ongoing
   * heat-management problem.
   * ------------------------------------------------------------------------ */
  HANDLERS.thermal = {
    init: function (el) {
      var m = el.motion;
      m.heat = 0;
      m.rate = m.rate === undefined ? 0.55 : m.rate;      /* heating gain */
      m.cool = m.cool === undefined ? 0.32 : m.cool;      /* cooling rate */
      m.maxCurve = m.maxCurve === undefined ? 0.6 : m.maxCurve;
      m.baseCurve = m.baseCurve === undefined ? (el.curvature || 0) : m.baseCurve;
      /* ONSET THRESHOLD. Below this the substrate conducts heat away as fast
       * as the beam delivers it and the surface stays true; only the excess
       * above it distorts anything. Without a threshold the mirror bows a
       * little for any beam at all, and "send it less light" stops being a
       * decision -- it just trades brightness for flatness at a fixed rate.
       * With one, there is a real power budget to stay under. */
      m.threshold = m.threshold === undefined ? 0 : m.threshold;
      /* Excess heat above the threshold at which it reaches its full bow. */
      m.heatScale = m.heatScale === undefined ? 1.6 : m.heatScale;
    },
    step: function (el, dt, t, energy) {
      var m = el.motion;
      var incoming = energy || 0;
      m.heat += (incoming * m.rate - m.heat * m.cool) * dt;
      if (m.heat < 0) m.heat = 0;
      if (m.heat > 3) m.heat = 3;
      var excess = Math.max(0, m.heat - m.threshold);
      var target = m.baseCurve + M.clamp(excess / m.heatScale, 0, 1) * m.maxCurve;
      m.stress = m.threshold > 0 ? M.clamp(m.heat / m.threshold, 0, 2) : 0;
      /* Substrate responds slowly -- this lag is what makes it a puzzle. */
      el.curvature = M.lerp(el.curvature || 0, target, Math.min(1, dt * 1.6));
      E.touch(el);
    },
    reset: function (el) {
      HANDLERS.thermal.init(el);
      el.curvature = el.motion.baseCurve;
      E.touch(el);
    }
  };

  /* --------------------------------------------------------------------------
   * Public API
   * ------------------------------------------------------------------------ */

  function initAll(elements) {
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (!el.motion) continue;
      var h = HANDLERS[el.motion.type];
      if (h && h.init) h.init(el);
    }
  }

  /**
   * Advance every moving element by dt seconds.
   * `energyByElement` comes from the previous frame's trace and only matters
   * to thermal elements.
   */
  function step(elements, dt, t, energyByElement) {
    var moved = false;
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (!el.motion || el.motion.paused) continue;
      var h = HANDLERS[el.motion.type];
      if (!h) continue;
      var en = energyByElement ? (energyByElement[el.id] || 0) : 0;
      h.step(el, dt, t, en);
      moved = true;
    }
    return moved;
  }

  function resetAll(elements) {
    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      if (!el.motion) continue;
      var h = HANDLERS[el.motion.type];
      if (h && h.reset) h.reset(el);
    }
  }

  /** Does this level contain anything that moves? Static levels skip the sim. */
  function hasMotion(elements) {
    for (var i = 0; i < elements.length; i++) if (elements[i].motion) return true;
    return false;
  }

  LP.Props = {
    GRAVITY: GRAVITY,
    HANDLERS: HANDLERS,
    initAll: initAll,
    step: step,
    resetAll: resetAll,
    hasMotion: hasMotion
  };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
