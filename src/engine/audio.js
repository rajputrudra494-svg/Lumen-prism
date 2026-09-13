/* =============================================================================
 * Lumen Path - src/engine/audio.js
 * -----------------------------------------------------------------------------
 * All sound is synthesised with the Web Audio API -- there are no audio assets
 * to download, and every chapter's pad is generated from its own scale, so the
 * soundtrack reskins along with the visuals.
 *
 * Browsers block audio until a user gesture, so nothing is created until the
 * first call to `unlock()`, which the UI wires to the first click or tap.
 * ========================================================================== */
(function (LP) {
  'use strict';

  var A = {
    ctx: null,
    master: null,
    musicGain: null,
    sfxGain: null,
    enabled: true,
    musicOn: true,
    started: false,
    pad: null,
    chapter: null
  };

  /* Pentatonic-ish sets, one per chapter mood. Frequencies in Hz. */
  var SCALES = {
    clinical:    [261.63, 293.66, 329.63, 392.00, 440.00],
    vast:        [220.00, 246.94, 293.66, 329.63, 440.00],
    resonant:    [233.08, 277.18, 311.13, 369.99, 415.30],
    muffled:     [196.00, 233.08, 261.63, 311.13, 349.23],
    pulsing:     [246.94, 293.66, 349.23, 415.30, 493.88],
    sparse:      [174.61, 220.00, 261.63, 329.63, 392.00],
    ticking:     [261.63, 311.13, 349.23, 392.00, 466.16],
    shimmering:  [293.66, 329.63, 392.00, 440.00, 523.25],
    quiet:       [220.00, 261.63, 329.63, 392.00, 440.00],
    /* Obsidian Spire: a minor pentatonic with a flattened second -- tense. */
    ominous:     [207.65, 220.00, 261.63, 277.18, 329.63],
    /* Event Horizon: wide fifths, nothing to resolve to. */
    cosmic:      [196.00, 293.66, 392.00, 587.33, 783.99]
  };

  function unlock() {
    if (A.ctx) {
      if (A.ctx.state === 'suspended') A.ctx.resume();
      return A.ctx;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { A.enabled = false; return null; }
    A.ctx = new AC();
    A.master = A.ctx.createGain();
    A.master.gain.value = 0.85;
    A.master.connect(A.ctx.destination);

    A.musicGain = A.ctx.createGain();
    A.musicGain.gain.value = 0.16;
    A.musicGain.connect(A.master);

    A.sfxGain = A.ctx.createGain();
    A.sfxGain.gain.value = 0.5;
    A.sfxGain.connect(A.master);

    A.started = true;
    return A.ctx;
  }

  function now() { return A.ctx ? A.ctx.currentTime : 0; }

  /**
   * One synthesised note. `type` is an oscillator shape; the envelope is a
   * simple exponential decay, which is enough for clicks, chimes and pads.
   */
  function tone(freq, opts) {
    if (!A.enabled || !A.ctx) return;
    var o = opts || {};
    var t = now() + (o.delay || 0);
    var dur = o.dur || 0.18;

    var osc = A.ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.glide), t + dur);

    var g = A.ctx.createGain();
    var peak = (o.gain === undefined ? 0.3 : o.gain);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + (o.attack || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    var dest = o.music ? A.musicGain : A.sfxGain;
    if (o.filter) {
      var f = A.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(o.filter, t);
      osc.connect(g); g.connect(f); f.connect(dest);
    } else {
      osc.connect(g); g.connect(dest);
    }
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** Short filtered noise burst -- used for clicks and the overheat warning. */
  function noise(opts) {
    if (!A.enabled || !A.ctx) return;
    var o = opts || {};
    var dur = o.dur || 0.08;
    var len = Math.max(1, Math.floor(A.ctx.sampleRate * dur));
    var buf = A.ctx.createBuffer(1, len, A.ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);

    var src = A.ctx.createBufferSource();
    src.buffer = buf;
    var f = A.ctx.createBiquadFilter();
    f.type = o.filterType || 'bandpass';
    f.frequency.value = o.freq || 1400;
    f.Q.value = o.q || 1.2;
    var g = A.ctx.createGain();
    g.gain.value = o.gain === undefined ? 0.18 : o.gain;
    src.connect(f); f.connect(g); g.connect(A.sfxGain);
    src.start(now());
  }

  /* ==========================================================================
   * Game sounds
   * ======================================================================= */

  /** A placed object settling into the bench. */
  function click() { noise({ freq: 2200, q: 2.5, dur: 0.05, gain: 0.16 }); tone(880, { dur: 0.05, gain: 0.06, type: 'triangle' }); }

  /** Fine rotation feedback. Deliberately tiny -- it fires a lot. */
  function tick() { tone(1760, { dur: 0.03, gain: 0.035, type: 'square' }); }

  function pick() { tone(523.25, { dur: 0.09, gain: 0.12, type: 'triangle', glide: 784 }); }

  function drop() { tone(392, { dur: 0.12, gain: 0.14, type: 'triangle', glide: 261 }); }

  /** A receiver lighting up. Pitch follows the beam colour, low red to high violet. */
  function chime(hueFraction) {
    var scale = SCALES[A.chapter] || SCALES.clinical;
    var i = Math.floor(M_clamp(hueFraction, 0, 0.999) * scale.length);
    var f = scale[i];
    tone(f * 2, { dur: 0.5, gain: 0.22, type: 'sine' });
    tone(f * 3, { dur: 0.35, gain: 0.10, type: 'sine', delay: 0.02 });
    tone(f * 4, { dur: 0.25, gain: 0.05, type: 'sine', delay: 0.04 });
  }

  /** Level solved: a rising arpeggio in the chapter's own scale. */
  function fanfare() {
    var scale = SCALES[A.chapter] || SCALES.clinical;
    for (var i = 0; i < 5; i++) {
      tone(scale[i % scale.length] * 2, {
        dur: 0.42, gain: 0.19, type: 'triangle', delay: i * 0.085
      });
      tone(scale[i % scale.length] * 4, {
        dur: 0.3, gain: 0.06, type: 'sine', delay: i * 0.085 + 0.01
      });
    }
  }

  function error() {
    tone(160, { dur: 0.22, gain: 0.18, type: 'sawtooth', glide: 110, filter: 700 });
  }

  function warn() {
    noise({ freq: 420, q: 0.8, dur: 0.3, gain: 0.10, filterType: 'lowpass' });
  }

  function beat() { tone(1046, { dur: 0.05, gain: 0.10, type: 'square' }); }

  /* ==========================================================================
   * Ambient pad. Two slightly detuned oscillators per chapter root, which is
   * enough to sit under the puzzle without ever demanding attention.
   * ======================================================================= */
  function setChapter(mood) {
    A.chapter = mood && SCALES[mood] ? mood : 'clinical';
    if (A.pad) stopPad();
    if (A.musicOn && A.ctx) startPad();
  }

  function startPad() {
    if (!A.ctx || A.pad) return;
    var scale = SCALES[A.chapter] || SCALES.clinical;
    var root = scale[0] / 2;
    var g = A.ctx.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.5, now() + 2.5);
    g.connect(A.musicGain);

    var f = A.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    f.connect(g);

    var oscs = [];
    [1, 1.5, 2.005].forEach(function (mult, i) {
      var o = A.ctx.createOscillator();
      o.type = i === 0 ? 'sine' : 'triangle';
      o.frequency.value = root * mult;
      o.detune.value = (i - 1) * 6;
      var og = A.ctx.createGain();
      og.gain.value = i === 0 ? 0.5 : 0.18;
      o.connect(og); og.connect(f);
      o.start();
      oscs.push(o);
    });

    /* Slow filter sweep so the pad breathes. */
    var lfo = A.ctx.createOscillator();
    lfo.frequency.value = 0.045;
    var lfoGain = A.ctx.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain);
    lfoGain.connect(f.frequency);
    lfo.start();

    A.pad = { oscs: oscs, gain: g, lfo: lfo, filter: f };
  }

  function stopPad() {
    if (!A.pad) return;
    var p = A.pad;
    A.pad = null;
    try {
      p.gain.gain.cancelScheduledValues(now());
      p.gain.gain.setValueAtTime(p.gain.gain.value, now());
      p.gain.gain.linearRampToValueAtTime(0, now() + 0.8);
      setTimeout(function () {
        p.oscs.forEach(function (o) { try { o.stop(); } catch (e) {} });
        try { p.lfo.stop(); } catch (e) {}
      }, 1000);
    } catch (e) { /* context already gone */ }
  }

  function setMusic(on) {
    A.musicOn = on;
    if (!on) stopPad();
    else if (A.ctx) startPad();
  }

  function setEnabled(on) {
    A.enabled = on;
    if (A.master) A.master.gain.value = on ? 0.85 : 0;
  }

  function M_clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  LP.Audio = {
    state: A,
    unlock: unlock,
    click: click, tick: tick, pick: pick, drop: drop,
    chime: chime, fanfare: fanfare, error: error, warn: warn, beat: beat,
    setChapter: setChapter, setMusic: setMusic, setEnabled: setEnabled,
    tone: tone, noise: noise
  };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
