/* =============================================================================
 * Lumen Path - src/game/replay.js
 * -----------------------------------------------------------------------------
 * Ghost replay: after a solve, re-run the beam from the emitter and watch it
 * walk the path you built.
 *
 * A replay stores the PLACEMENTS, not a frame-by-frame recording. The optics
 * are deterministic, so replaying the placements reproduces the light exactly
 * -- which keeps a replay to a few hundred bytes and means it can double as a
 * share code for the solution itself.
 *
 * CLIP EXPORT uses MediaRecorder on a canvas capture stream, which produces
 * WebM. Browsers have no native GIF encoder, so shipping a real .gif would mean
 * bundling an encoder; the export is honest about giving you a video file
 * instead, and falls back to a still PNG where MediaRecorder is unavailable.
 * ========================================================================== */
(function (LP) {
  'use strict';

  var Sc = LP.Scene, R = LP.Renderer, E = LP.Elements;

  /** Capture everything needed to reproduce a solve. */
  function record(scene, meta) {
    var placements = [];
    for (var i = 0; i < scene.elements.length; i++) {
      var el = scene.elements[i];
      if (!el.fromInventory) continue;
      placements.push(E.serialize(el));
    }
    return {
      levelId: scene.level.id,
      levelName: scene.level.name,
      placements: placements,
      stars: meta && meta.stars,
      objects: meta && meta.objects,
      bounces: meta && meta.bounces,
      seconds: meta && meta.seconds,
      at: Date.now()
    };
  }

  /**
   * Rebuild a scene from a replay. Returns a fresh scene with the recorded
   * placements applied -- the caller can then run the normal render loop over
   * it with the light front reset.
   */
  function restore(level, replay) {
    var scene = Sc.fromLevel(level);
    Sc.reset(scene);
    for (var i = 0; i < replay.placements.length; i++) {
      var p = replay.placements[i];
      var extra = {}, k;
      for (k in p) if (k !== 'type' && k !== 'x' && k !== 'y' && k !== 'id') extra[k] = p[k];
      Sc.place(scene, p.type, p.x, p.y, extra);
    }
    Sc.run(scene);
    return scene;
  }

  /* --------------------------------------------------------------------------
   * Playback controller. Drives the renderer's light front at a chosen speed
   * and reports when the beam has finished travelling.
   * ------------------------------------------------------------------------ */
  function createPlayer(renderer, scene, opts) {
    var o = opts || {};
    var res = scene.lastResult || Sc.run(scene);
    return {
      scene: scene,
      renderer: renderer,
      maxPath: res.stats.maxPath,
      speed: o.speed || 1400,          /* world units per second: slower than
                                        * live play, so the path reads clearly */
      done: false,
      elapsed: 0,
      hold: o.hold === undefined ? 1.6 : o.hold,
      holdLeft: 0,

      step: function (dt) {
        if (this.done) return true;
        this.elapsed += dt;
        renderer.lightFront += this.speed * dt;
        if (renderer.lightFront >= this.maxPath) {
          if (this.holdLeft === 0) this.holdLeft = this.hold;
          this.holdLeft -= dt;
          if (this.holdLeft <= 0) this.done = true;
        }
        return this.done;
      },

      restart: function () {
        renderer.lightFront = 0;
        this.done = false;
        this.elapsed = 0;
        this.holdLeft = 0;
      }
    };
  }

  /* ==========================================================================
   * Clip export
   * ======================================================================= */

  function canRecord() {
    return typeof window !== 'undefined' &&
           typeof window.MediaRecorder !== 'undefined' &&
           typeof HTMLCanvasElement !== 'undefined' &&
           typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  /** Pick a container/codec the browser will actually accept. */
  function pickMime() {
    var candidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
      'video/mp4'
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (window.MediaRecorder.isTypeSupported &&
          window.MediaRecorder.isTypeSupported(candidates[i])) return candidates[i];
    }
    return '';
  }

  /**
   * Record `seconds` of the canvas into a video Blob.
   * Resolves with { blob, ext, mime } or rejects with a reason the UI can show.
   */
  function captureClip(canvas, seconds, onTick) {
    return new Promise(function (resolve, reject) {
      if (!canRecord()) {
        reject(new Error('This browser cannot record canvas video.'));
        return;
      }
      var stream;
      try {
        stream = canvas.captureStream(30);
      } catch (e) {
        reject(new Error('Canvas capture was refused: ' + e.message));
        return;
      }
      var mime = pickMime();
      var rec;
      try {
        rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 4000000 } : undefined);
      } catch (e) {
        reject(new Error('Could not start the recorder: ' + e.message));
        return;
      }

      var chunks = [];
      rec.ondataavailable = function (ev) { if (ev.data && ev.data.size) chunks.push(ev.data); };
      rec.onerror = function (ev) { reject(new Error('Recording failed.')); };
      rec.onstop = function () {
        var type = rec.mimeType || mime || 'video/webm';
        var blob = new Blob(chunks, { type: type });
        resolve({ blob: blob, mime: type, ext: type.indexOf('mp4') >= 0 ? 'mp4' : 'webm' });
      };

      rec.start();
      var started = Date.now();
      var iv = setInterval(function () {
        var t = (Date.now() - started) / 1000;
        if (onTick) onTick(Math.min(1, t / seconds));
        if (t >= seconds) {
          clearInterval(iv);
          try { rec.stop(); } catch (e) { reject(e); }
          stream.getTracks().forEach(function (tr) { tr.stop(); });
        }
      }, 100);
    });
  }

  /** Still frame fallback, and a handy "share a screenshot" path in its own right. */
  function captureStill(canvas) {
    return new Promise(function (resolve, reject) {
      try {
        canvas.toBlob(function (b) {
          if (b) resolve({ blob: b, mime: 'image/png', ext: 'png' });
          else reject(new Error('Could not read the canvas.'));
        }, 'image/png');
      } catch (e) { reject(e); }
    });
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  }

  LP.Replay = {
    record: record,
    restore: restore,
    createPlayer: createPlayer,
    canRecord: canRecord,
    captureClip: captureClip,
    captureStill: captureStill,
    download: download
  };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
