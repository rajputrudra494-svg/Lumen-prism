/* =============================================================================
 * Lumen Path - src/game/ui.js
 * -----------------------------------------------------------------------------
 * All chrome: the HUD, the inventory tray, the phase clock on timed levels,
 * every overlay screen, and the toasts.
 *
 * The DOM is built in JavaScript rather than written into index.html. That
 * keeps the markup file to a single canvas and a script list, and it means the
 * UI can be rebuilt from state without hunting for elements that may or may not
 * exist yet. `h()` is a three-line hyperscript helper -- no framework, because
 * the only thing that redraws frequently is the canvas, and that is not the
 * DOM's problem.
 *
 * The UI reads game state and calls back into `game` (main.js). It never
 * touches the scene directly, so nothing here can put the simulation into a
 * state the game controller does not know about.
 * ========================================================================== */
(function (LP) {
  'use strict';

  var E = LP.Elements, M = LP.M, S = LP.Spectrum;

  /* --------------------------------------------------------------------------
   * Tiny DOM helper.  h('div.cls#id', {attrs}, [children])
   * ------------------------------------------------------------------------ */
  function h(sel, attrs, children) {
    var m = sel.match(/^([a-zA-Z0-9]+)?(#[^.\s]+)?((?:\.[^.\s]+)*)$/);
    var el = document.createElement((m && m[1]) || 'div');
    if (m && m[2]) el.id = m[2].slice(1);
    if (m && m[3]) el.className = m[3].split('.').filter(Boolean).join(' ');
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') {
          for (var s in v) el.style[s] = v[s];
        } else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          el.addEventListener(k.slice(2).toLowerCase(), v);
        } else if (k === 'value') { el.value = v; }
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  /* --------------------------------------------------------------------------
   * Element icons. Small inline SVGs so the tray reads at a glance without any
   * image assets.
   * ------------------------------------------------------------------------ */
  var ICONS = {
    mirror:    '<line x1="4" y1="20" x2="20" y2="4" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
    concave:   '<path d="M5 3 Q13 12 5 21" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
    convex:    '<path d="M9 3 Q1 12 9 21" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>',
    flex:      '<path d="M6 3 Q12 12 6 21" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="3 2"/>',
    oneway:    '<line x1="8" y1="3" x2="8" y2="21" stroke="currentColor" stroke-width="3"/><line x1="14" y1="3" x2="14" y2="21" stroke="currentColor" stroke-width="2" stroke-dasharray="3 3" opacity="0.6"/>',
    prism:     '<path d="M12 3 L21 20 L3 20 Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>',
    lens:      '<path d="M12 3 Q19 12 12 21 Q5 12 12 3 Z" fill="none" stroke="currentColor" stroke-width="2.2"/>',
    glass:     '<rect x="4" y="7" width="16" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="2.2"/>',
    splitter:  '<line x1="4" y1="20" x2="20" y2="4" stroke="currentColor" stroke-width="3" stroke-dasharray="4 3" stroke-linecap="round"/>',
    filter:    '<rect x="4" y="9" width="16" height="6" rx="2" fill="currentColor" opacity="0.55"/><rect x="4" y="9" width="16" height="6" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/>',
    polarizer: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6 9 H18 M6 12 H18 M6 15 H18" stroke="currentColor" stroke-width="1.3" opacity="0.75"/>',
    grating:   '<line x1="12" y1="3" x2="12" y2="21" stroke="currentColor" stroke-width="2.4"/><path d="M9 5 H15 M9 8 H15 M9 11 H15 M9 14 H15 M9 17 H15 M9 20 H15" stroke="currentColor" stroke-width="1.1" opacity="0.8"/>',
    portal:    '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="6 4"/><circle cx="12" cy="12" r="3" fill="currentColor" opacity="0.5"/>',
    absorber:  '<rect x="4" y="8" width="16" height="8" rx="1" fill="currentColor" opacity="0.55"/>',
    emitter:   '<rect x="3" y="8" width="9" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13 12 H21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    receiver:  '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/>'
  };

  function icon(type, size) {
    var sz = size || 24;
    var wrap = document.createElement('span');
    wrap.className = 'ico';
    wrap.innerHTML = '<svg viewBox="0 0 24 24" width="' + sz + '" height="' + sz +
                     '" aria-hidden="true">' + (ICONS[type] || ICONS.mirror) + '</svg>';
    return wrap;
  }

  /* --------------------------------------------------------------------------
   * Seven-segment digits for the phase clock -- drawn, not typeset, so the
   * timer looks like the LED display on a real bench timer: every segment
   * faintly visible when unlit, the lit ones glowing.
   * ------------------------------------------------------------------------ */
  var SEGMENTS = {
    '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg', '5': 'acdfg',
    '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': ''
  };

  function segPath(ctx, x1, y1, x2, y2, t) {
    var dx = x2 - x1, dy = y2 - y1, L = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / L, uy = dy / L, nx = -uy * t / 2, ny = ux * t / 2, k = t / 2;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1 + ux * k + nx, y1 + uy * k + ny);
    ctx.lineTo(x2 - ux * k + nx, y2 - uy * k + ny);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2 - ux * k - nx, y2 - uy * k - ny);
    ctx.lineTo(x1 + ux * k - nx, y1 + uy * k - ny);
    ctx.closePath();
  }

  /** One digit cell at (x, y), w wide and h tall, italicised like real LEDs. */
  function segDigit(ctx, ch, x, y, w, h, t, on, off) {
    var skew = 0.12, gap = t * 0.55;
    function P(px, py) { return { x: x + px + (h - py) * skew, y: y + py }; }
    var pts = {
      a: [P(0, 0), P(w, 0)], b: [P(w, 0), P(w, h / 2)], c: [P(w, h / 2), P(w, h)],
      d: [P(0, h), P(w, h)], e: [P(0, h / 2), P(0, h)], f: [P(0, 0), P(0, h / 2)],
      g: [P(0, h / 2), P(w, h / 2)]
    };
    var lit = SEGMENTS[ch] || '';
    ['a', 'b', 'c', 'd', 'e', 'f', 'g'].forEach(function (key) {
      var p = pts[key], dx = p[1].x - p[0].x, dy = p[1].y - p[0].y;
      var L = Math.sqrt(dx * dx + dy * dy) || 1, ux = dx / L * gap, uy = dy / L * gap;
      ctx.beginPath();
      segPath(ctx, p[0].x + ux, p[0].y + uy, p[1].x - ux, p[1].y - uy, t);
      var isOn = lit.indexOf(key) >= 0;
      ctx.fillStyle = isOn ? on : off;
      ctx.shadowBlur = isOn ? t * 2.2 : 0;
      ctx.fill();
    });
    ctx.shadowBlur = 0;
  }

  /** "27.3" under a minute, "1:05" above it. */
  function clockText(sec) {
    var s = Math.max(0, sec);
    if (s >= 59.95) {
      var m = Math.floor(s / 60), r = Math.floor(s - m * 60);
      return (m < 10 ? ' ' + m : String(m)) + ':' + (r < 10 ? '0' + r : r);
    }
    var tenths = Math.floor(s * 10 + 1e-6);
    var whole = Math.floor(tenths / 10);
    return (whole < 10 ? ' ' + whole : String(whole)) + '.' + (tenths % 10);
  }

  function drawClockDigits(canvas, text, on, off) {
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var cssW = canvas.clientWidth || 120, cssH = canvas.clientHeight || 40;
    var W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.shadowColor = on;
    var h = H * 0.72, w = h * 0.5, t = Math.max(2, h * 0.13);
    var y = (H - h) / 2, x = W * 0.06;
    var cell = w + t * 2.4;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === '.' || ch === ':') {
        ctx.fillStyle = on;
        ctx.shadowBlur = t * 2;
        var cx = x + t * 0.4;
        if (ch === '.') {
          ctx.beginPath(); ctx.arc(cx, y + h - t * 0.5, t * 0.62, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.beginPath(); ctx.arc(cx + h * 0.08, y + h * 0.3, t * 0.55, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(cx, y + h * 0.72, t * 0.55, 0, Math.PI * 2); ctx.fill();
        }
        ctx.shadowBlur = 0;
        x += t * 1.8;
        continue;
      }
      segDigit(ctx, ch, x, y, w, h, t, on, off);
      x += cell;
    }
  }

  function starRow(n, max) {
    var row = h('span.stars');
    for (var i = 0; i < (max || 3); i++) {
      row.appendChild(h('span.star' + (i < n ? '.on' : ''), { text: '★' }));
    }
    return row;
  }

  /**
   * Wood for the interface, grown by the same code as the bench and handed to
   * the stylesheet as data URLs -- every panel, button and menu cut from
   * planks, without a single image file. Where canvas is unavailable the flat
   * panel colours in the stylesheet stand in.
   */
  function applyWood() {
    if (!LP.Bench || !LP.Bench.panelTexture) return;
    try {
      var html = document.documentElement;
      var panel = LP.Bench.panelTexture('walnut', 420, 360, 6, 0.3, 21);
      var button = LP.Bench.panelTexture('teak', 300, 240, 4, 0.2, 33);
      html.style.setProperty('--wood-panel', 'url("' + panel.toDataURL('image/jpeg', 0.85) + '")');
      html.style.setProperty('--wood-button', 'url("' + button.toDataURL('image/jpeg', 0.85) + '")');
      html.classList.add('has-wood');
    } catch (e) { /* no canvas here: keep the flat colours */ }
  }

  /* ==========================================================================
   * UI
   * ======================================================================= */
  function create(game, root) {
    applyWood();
    var ui = {
      game: game,
      root: root,
      screen: null,
      els: {},
      toastTimer: null
    };

    /* ---- Static shell ------------------------------------------------- */
    var canvas = h('canvas#stage', { 'aria-label': 'Optical bench' });

    var hudTop = h('div.hud.hud-top', {}, [
      ui.els.hudLeft = h('div.hud-left', {}, [
        ui.els.btnMenu = h('button.icon-btn', {
          title: 'Level select (Esc)', onclick: function () { ui.showScreen('levels'); }
        }, [h('span', { html: '☰' })]),
        h('div.level-id', {}, [
          ui.els.levelName = h('div.level-name', { text: '' }),
          ui.els.levelSub = h('div.level-sub', { text: '' })
        ])
      ]),
      ui.els.hudRight = h('div.hud-right', {}, [
        ui.els.parBox = h('div.par-box'),
        ui.els.btnHint = h('button.icon-btn', {
          title: 'Hint (H)', onclick: function () { game.hint(); }
        }, [h('span', { html: '?' })]),
        ui.els.btnUndo = h('button.icon-btn', {
          title: 'Undo (Ctrl+Z)', onclick: function () { game.undo(); }
        }, [h('span', { html: '↶' })]),
        ui.els.btnRedo = h('button.icon-btn', {
          title: 'Redo (Ctrl+Shift+Z)', onclick: function () { game.redo(); }
        }, [h('span', { html: '↷' })]),
        ui.els.btnReset = h('button.icon-btn', {
          title: 'Reset level (R)', onclick: function () { game.resetLevel(); }
        }, [h('span', { html: '⟲' })]),
        ui.els.btnSettings = h('button.icon-btn', {
          title: 'Settings', onclick: function () { ui.showScreen('settings'); }
        }, [h('span', { html: '⚙' })])
      ])
    ]);

    ui.els.tray = h('div.tray');
    var hudBottom = h('div.hud.hud-bottom', {}, [ui.els.tray]);

    ui.els.overlay = h('div.overlay', { hidden: true });
    ui.els.toasts = h('div.toasts', { 'aria-live': 'polite' });
    ui.els.statusStrip = h('div.status-strip', { hidden: true });
    /* Only shown on a portrait phone when the level cannot turn the stage
     * sideways (pendulums). Advisory, never blocking. */
    ui.els.rotateHint = h('div.rotate-hint', { hidden: true }, [
      h('span', { html: '⟳' }), 'Turn your phone sideways for a bigger bench'
    ]);

    /* Timed levels: the clock, the banners that announce each phase, and the
     * card that holds the level until the player starts the clock. */
    ui.els.phaseClock = h('div.phase-clock', { hidden: true, 'aria-live': 'off' }, [
      h('div.pc-side', {}, [
        h('span.pc-label', { text: 'Phase' }),
        ui.els.pcPips = h('span.pc-pips')
      ]),
      h('div.pc-glass', {}, [ui.els.pcDigits = h('canvas.pc-digits', { 'aria-hidden': 'true' })]),
      h('div.pc-side.pc-right', {}, [
        ui.els.pcName = h('span.pc-name', { text: '' }),
        ui.els.pcTry = h('span.pc-try', { text: '' })
      ])
    ]);
    ui.els.banner = h('div.phase-banner', { hidden: true, role: 'status' });
    ui.els.phaseStart = h('div.phase-start', { hidden: true });

    root.appendChild(h('div.stage-wrap', {}, [canvas, ui.els.statusStrip, ui.els.rotateHint,
                                               ui.els.phaseClock, ui.els.banner, ui.els.phaseStart]));
    root.appendChild(hudTop);
    root.appendChild(hudBottom);
    root.appendChild(ui.els.overlay);
    root.appendChild(ui.els.toasts);

    ui.canvas = canvas;

    /* ---- Toasts ------------------------------------------------------- */
    ui.toast = function (msg, kind, ms) {
      var t = h('div.toast' + (kind ? '.' + kind : ''), { text: msg });
      ui.els.toasts.appendChild(t);
      setTimeout(function () { t.classList.add('in'); }, 10);
      setTimeout(function () {
        t.classList.remove('in');
        setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 400);
      }, ms || 2600);
    };

    /* ---- Status strip (used by timed levels and multiplayer) ---------- */
    ui.setStatus = function (html) {
      if (!html) { ui.els.statusStrip.hidden = true; return; }
      ui.els.statusStrip.hidden = false;
      ui.els.statusStrip.innerHTML = html;
    };

    /* ==================================================================
     * Timed levels
     * ================================================================ */
    var clockShown = { text: null, cls: null, pips: null, name: null, tries: null };

    ui.updatePhaseClock = function (v) {
      var el = ui.els.phaseClock;
      if (!v) {
        if (!el.hidden) { el.hidden = true; clockShown.text = null; ui.measureInsets(); }
        return;
      }
      if (el.hidden) { el.hidden = false; ui.measureInsets(); }

      var running = v.state === 'running';
      var cls = 'phase-clock is-' + v.state +
        (running && v.timeLeft <= 10 ? ' danger' : '') +
        (running && v.timeLeft <= 5 ? ' critical' : '');
      if (cls !== clockShown.cls) { el.className = cls; clockShown.cls = cls; clockShown.text = null; }

      var pipKey = v.count + ':' + v.index + ':' + v.state;
      if (pipKey !== clockShown.pips) {
        clockShown.pips = pipKey;
        clear(ui.els.pcPips);
        for (var i = 0; i < v.count; i++) {
          var done = i < v.index || (i === v.index && (v.state === 'clear' || v.state === 'done'));
          ui.els.pcPips.appendChild(h('i' + (done ? '.done' : (i === v.index ? '.now' : ''))));
        }
      }

      var shown = v.state === 'armed' ? v.time : v.timeLeft;
      var text = clockText(shown);
      if (text !== clockShown.text) {
        clockShown.text = text;
        var on = '#ff3b2e', off = 'rgba(255,59,46,0.10)';
        if (v.state === 'clear' || v.state === 'done') { on = '#62ff8c'; off = 'rgba(98,255,140,0.10)'; }
        else if (v.state === 'armed' || v.state === 'intro') { on = '#ffb13b'; off = 'rgba(255,177,59,0.10)'; }
        drawClockDigits(ui.els.pcDigits, text, on, off);
      }

      var name = (v.index + 1) + '/' + v.count + (v.name ? ' · ' + v.name : '');
      if (name !== clockShown.name) { clockShown.name = name; ui.els.pcName.textContent = name; }
      var tries = v.attempt > 1 ? 'Attempt ' + v.attempt : (v.failures ? v.failures + ' rewind' + (v.failures > 1 ? 's' : '') : 'First attempt');
      if (tries !== clockShown.tries) { clockShown.tries = tries; ui.els.pcTry.textContent = tries; }
    };

    var bannerTimer = null;
    ui.banner = function (kicker, title, sub, kind, ms) {
      var b = ui.els.banner;
      clear(b);
      b.className = 'phase-banner' + (kind ? ' ' + kind : '');
      if (kicker) b.appendChild(h('div.pb-kicker', { text: kicker }));
      b.appendChild(h('div.pb-title', { text: title }));
      if (sub) b.appendChild(h('div.pb-sub', { text: sub }));
      b.hidden = false;
      void b.offsetWidth;
      b.classList.add('in');
      clearTimeout(bannerTimer);
      if (ms) bannerTimer = setTimeout(ui.hideBanner, ms);
    };
    ui.hideBanner = function () {
      clearTimeout(bannerTimer);
      ui.els.banner.classList.remove('in');
      ui.els.banner.hidden = true;
    };

    ui.showPhaseStart = function (level) {
      var c = clear(ui.els.phaseStart);
      var total = level.phases.reduce(function (a, p) { return a + p.time; }, 0);
      c.appendChild(h('div.ps-head', {}, [
        h('span.ps-kicker', { text: '⏱ Timed level · ' + level.phases.length + ' phases · ' + Math.round(total) + ' seconds' }),
        h('span.ps-rule', { text: 'Miss a phase’s clock and it rewinds, pieces and all — again and again, until you beat it.' })
      ]));
      c.appendChild(h('ol.ps-list', {}, level.phases.map(function (p, i) {
        return h('li', {}, [
          h('span.ps-n', { text: String(i + 1) }),
          h('span.ps-name', { text: p.name || 'Phase ' + (i + 1) }),
          h('span.ps-time', { text: Math.round(p.time) + 's' })
        ]);
      })));
      c.appendChild(h('button.big-btn.primary.ps-go', {
        onclick: function () { game.startClock(); }
      }, [h('span', { text: 'Start the clock' }), h('kbd', { text: 'Enter' })]));
      c.hidden = false;
    };
    ui.hidePhaseStart = function () {
      ui.els.phaseStart.hidden = true;
      clear(ui.els.phaseStart);
    };

    /* ==================================================================
     * HUD
     * ================================================================ */
    ui.refreshHUD = function () {
      var lvl = game.level;
      if (!lvl) return;
      var chapter = game.chapterOf(lvl);
      ui.els.levelName.textContent = lvl.name;
      var tags = lvl.tags || [];
      if (tags.indexOf('boss') >= 0) {
        ui.els.levelName.appendChild(h('span.boss-chip', {
          text: tags.indexOf('finale') >= 0 ? 'Final boss' : 'Boss'
        }));
      }
      if (tags.indexOf('impossible') >= 0 && tags.indexOf('boss') < 0) {
        ui.els.levelName.appendChild(h('span.boss-chip.impossible-chip', { text: 'Impossible' }));
      }
      if (lvl.phases) {
        ui.els.levelName.appendChild(h('span.boss-chip.timed-chip', { text: '⏱ Timed' }));
      }
      ui.els.levelSub.textContent = (chapter ? chapter.name : '') +
        (lvl.blurb ? ' — ' + lvl.blurb : '');

      var par = lvl.par || {};
      clear(ui.els.parBox);
      if (lvl.sandbox) {
        ui.els.parBox.appendChild(h('span.par-label', { text: 'Sandbox' }));
      } else if (lvl.phases) {
        var ps = game.scene && game.scene.phase;
        ui.els.parBox.appendChild(h('span.par-item', { title: 'Current phase' }, [
          h('span.par-k', { text: 'phase' }),
          h('span.par-v.good', { text: ((ps ? ps.index : 0) + 1) + '/' + lvl.phases.length })
        ]));
        ui.els.parBox.appendChild(h('span.par-item', { title: 'Rewinds so far -- none for three stars' }, [
          h('span.par-k', { text: 'rewinds' }),
          h('span.par-v' + (ps && ps.failures ? '.over' : '.good'), { text: String(ps ? ps.failures : 0) })
        ]));
        ui.els.parBox.appendChild(starRow(game.starsFor(lvl.id)));
      } else {
        var ev = game.lastEval || { objects: 0, bounces: 0 };
        ui.els.parBox.appendChild(h('span.par-item', {
          title: 'Objects placed / par'
        }, [h('span.par-k', { text: 'obj' }),
            h('span.par-v' + (ev.objects <= (par.objects || 99) ? '.good' : '.over'),
              { text: ev.objects + '/' + (par.objects === undefined ? '—' : par.objects) })]));
        ui.els.parBox.appendChild(h('span.par-item', {
          title: 'Interactions with your objects / par'
        }, [h('span.par-k', { text: 'hits' }),
            h('span.par-v' + (ev.bounces <= (par.bounces || 999) ? '.good' : '.over'),
              { text: ev.bounces + '/' + (par.bounces === undefined ? '—' : par.bounces) })]));
        ui.els.parBox.appendChild(starRow(game.starsFor(lvl.id)));
      }

      ui.els.btnUndo.disabled = !LP.History.canUndo(game.history);
      ui.els.btnRedo.disabled = !LP.History.canRedo(game.history);
      ui.els.btnHint.hidden = !lvl.solution || lvl.sandbox;
    };

    /* ==================================================================
     * Inventory tray
     * ================================================================ */
    ui.refreshTray = function () {
      var tray = clear(ui.els.tray);
      var scene = game.scene;
      if (!scene) return;

      if (!scene.inventory.length) {
        var msg = '';
        if (game.mode === 'editorBuild') {
          msg = 'Editing the level itself — drag anything. Open the editor panel to add objects.';
        } else if (!game.level.sandbox) {
          msg = 'Nothing to place on this one — the machinery is already in the room.';
        }
        if (msg) tray.appendChild(h('div.tray-empty', { text: msg }));
        return;
      }

      /* Group identical slots so a tray of six mirrors is one button. */
      var groups = [];
      scene.inventory.forEach(function (slot, index) {
        var key = slot.type + '|' + JSON.stringify(slot.preset || {});
        var g = groups.find(function (x) { return x.key === key; });
        if (!g) { g = { key: key, type: slot.type, preset: slot.preset, total: 0, used: 0, indices: [] };
                  groups.push(g); }
        g.total += slot.count;
        g.used += slot.used;
        g.indices.push(index);
      });

      groups.forEach(function (g) {
        var left = g.total - g.used;
        var T = E.TYPES[g.type];
        var swatch = g.preset && g.preset.color ? S.toCSS(S.resolveColor(g.preset.color)) : null;
        var btn = h('button.tray-item' + (left <= 0 ? '.spent' : '') +
                    (game.armedType === g.type ? '.armed' : ''), {
          title: T.name + ' — ' + T.blurb,
          disabled: left <= 0,
          onclick: function () { game.armPlacement(g.type, g.preset); }
        }, [
          h('span.tray-ico', { style: swatch ? { color: swatch } : null }, [icon(g.type, 26)]),
          h('span.tray-name', { text: T.short }),
          h('span.tray-count', { text: '×' + left })
        ]);
        tray.appendChild(btn);
      });

      if (game.armedType) {
        tray.appendChild(h('div.tray-hint', { text: 'Tap the bench to place it. Tap the piece again to cancel.' }));
      }
    };

    /* ==================================================================
     * Layout: fit the stage inside whatever the HUD leaves free.
     *
     * The HUD floats over the canvas, and on a phone it can take a quarter of
     * the height. Rather than guess, measure the real HUD boxes and hand the
     * renderer the bands they occupy; it fits (and, in portrait, rotates) the
     * world inside what is left. So no emitter, sensor or mirror can ever sit
     * underneath a button on any screen.
     * ================================================================ */
    ui.measureInsets = function () {
      var r = game.renderer;
      if (!r) return;
      var vw = window.innerWidth, vh = window.innerHeight;
      var top = 0, right = 0, bottom = 0;

      [ui.els.hudLeft, ui.els.hudRight].forEach(function (el) {
        var b = el.getBoundingClientRect();
        if (b.height > 0) top = Math.max(top, b.bottom);
      });
      /* A timed level's clock hangs under the HUD, and the stage fits below
       * it -- the clock must never cover the bench it is timing. */
      root.style.setProperty('--hud-bottom', Math.round(top) + 'px');
      if (!ui.els.phaseClock.hidden) {
        var cb = ui.els.phaseClock.getBoundingClientRect();
        if (cb.height > 0) top = Math.max(top, cb.bottom);
      }

      var tray = ui.els.tray;
      var tb = tray.getBoundingClientRect();
      if (tb.width > 0 && tb.height > 0 && tray.childElementCount > 0) {
        var vertical = window.getComputedStyle(tray).flexDirection === 'column';
        if (vertical) right = Math.max(0, vw - tb.left);
        else bottom = Math.max(0, vh - tb.top);
      }

      r.insets = {
        top: top + 6,
        right: right ? right + 6 : 4,
        bottom: bottom ? bottom + 6 : 4,
        left: 4
      };
      root.style.setProperty('--inset-top', Math.round(r.insets.top) + 'px');
      root.style.setProperty('--inset-bottom', Math.round(r.insets.bottom) + 'px');
      root.style.setProperty('--inset-right', Math.round(r.insets.right) + 'px');
      LP.Renderer.resize(r);

      var portraitPhone = vh > vw && vw < 720;
      ui.els.rotateHint.hidden = !(portraitPhone && !r.allowRotate);
    };

    /* ==================================================================
     * Overlay screens
     * ================================================================ */
    function overlayShell(title, subtitle, body, actions, opts) {
      var o = opts || {};
      return h('div.sheet' + (o.wide ? '.wide' : ''), {}, [
        h('div.sheet-head', {}, [
          h('h2', { text: title }),
          subtitle ? h('p.sheet-sub', { text: subtitle }) : null,
          o.noClose ? null : h('button.icon-btn.sheet-close', {
            title: 'Close', onclick: function () { ui.hideScreen(); }
          }, [h('span', { html: '×' })])
        ]),
        h('div.sheet-body', {}, body),
        actions && actions.length ? h('div.sheet-actions', {}, actions) : null
      ]);
    }

    ui.showScreen = function (name, data) {
      ui.screen = name;
      var ov = clear(ui.els.overlay);
      ov.hidden = false;
      ov.className = 'overlay screen-' + name;
      game.setInputEnabled(name === null);

      var builder = SCREENS[name];
      if (!builder) { ui.hideScreen(); return; }
      ov.appendChild(builder(ui, game, data));
    };

    ui.hideScreen = function () {
      ui.screen = null;
      ui.els.overlay.hidden = true;
      clear(ui.els.overlay);
      game.setInputEnabled(true);
    };

    ui.refresh = function () {
      ui.refreshHUD();
      ui.refreshTray();
    };

    ui.h = h;
    ui.icon = icon;
    ui.starRow = starRow;
    ui.overlayShell = overlayShell;
    ui.clear = clear;
    return ui;
  }

  /* ==========================================================================
   * SCREEN BUILDERS
   * ======================================================================= */
  var SCREENS = {};

  /* ---- Title ------------------------------------------------------------- */
  SCREENS.title = function (ui, game) {
    var progress = game.progress;
    var solved = Object.keys(progress.levels).filter(function (k) {
      return progress.levels[k].solved;
    }).length;
    var storyTotal = LP.Levels.LEVELS.filter(function (l) { return !l.sandbox; }).length;

    return ui.overlayShell('Lumen Path',
      'Bend light until it arrives where it is wanted.',
      [
        h('div.title-art', { html: titleArtSVG() }),
        h('div.title-stats', { text: solved + ' of ' + storyTotal + ' levels solved · ' +
                                     progress.totalStars + ' stars' })
      ],
      [
        h('button.big-btn.primary', {
          text: solved ? 'Continue' : 'Start',
          onclick: function () { game.continueGame(); }
        }),
        h('button.big-btn', { text: 'Levels', onclick: function () { ui.showScreen('levels'); } }),
        h('button.big-btn', { text: 'Daily', onclick: function () { ui.showScreen('daily'); } }),
        h('button.big-btn', { text: 'Editor', onclick: function () { game.openEditor(); } }),
        h('button.big-btn', { text: 'Multiplayer', onclick: function () { ui.showScreen('multiplayer'); } }),
        h('button.big-btn.ghost', { text: 'Settings', onclick: function () { ui.showScreen('settings'); } })
      ], { noClose: true });
  };

  /** A glass prism throwing its rainbow toward a flagged destination. */
  function titleArtSVG() {
    return '<svg viewBox="0 0 320 120" width="100%" height="120" aria-hidden="true">' +
      '<defs>' +
      '<linearGradient id="lp-fan" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#8b5cff"/><stop offset="0.24" stop-color="#3b8bff"/>' +
      '<stop offset="0.44" stop-color="#38e08c"/><stop offset="0.63" stop-color="#ffe23c"/>' +
      '<stop offset="0.8" stop-color="#ff8a2a"/><stop offset="1" stop-color="#ff3b30"/>' +
      '</linearGradient>' +
      '<filter id="lp-soft" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="2.4"/></filter>' +
      '</defs>' +
      '<path d="M10 70 L126 64" stroke="#fff3df" stroke-width="9" stroke-linecap="round" opacity="0.35" filter="url(#lp-soft)"/>' +
      '<path d="M10 70 L126 64" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>' +
      '<path d="M150 62 L262 20 L262 96 Z" fill="url(#lp-fan)" opacity="0.5" filter="url(#lp-soft)"/>' +
      '<path d="M150 62 L262 30 L262 86 Z" fill="url(#lp-fan)" opacity="0.78"/>' +
      '<path d="M140 28 L168 82 L112 82 Z" fill="rgba(255,255,255,0.07)" stroke="#ffffff" ' +
      'stroke-width="2" stroke-linejoin="round"/>' +
      '<path d="M140 28 L140 64 M168 82 L140 64 M112 82 L140 64" stroke="#ffffff" stroke-width="0.8" opacity="0.35"/>' +
      '<circle cx="288" cy="66" r="18" fill="rgba(255,255,255,0.08)" stroke="#ffffff" stroke-width="1.6"/>' +
      '<circle cx="288" cy="66" r="12" fill="none" stroke="#ffffff" stroke-width="2.2"/>' +
      '<circle cx="288" cy="66" r="6" fill="none" stroke="#ffffff" stroke-width="1.6"/>' +
      '<line x1="288" y1="62" x2="288" y2="12" stroke="#eef1f5" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M288 13 C297 9 305 17 315 15 L307 25 C299 26 295 22 288 27 Z" fill="#e0382a"/>' +
      '</svg>';
  }

  /* ---- Level select ------------------------------------------------------ */
  SCREENS.levels = function (ui, game) {
    var body = [];
    var progress = game.progress;

    LP.Levels.CHAPTERS.forEach(function (ch) {
      var levels = LP.Levels.LEVELS.filter(function (l) { return l.chapter === ch.id; });
      if (!levels.length) return;
      var unlocked = game.chapterUnlocked(ch.id);
      var need = game.starsNeededFor(ch.id);

      body.push(h('section.chapter' + (unlocked ? '' : '.locked'), {}, [
        h('div.chapter-head', {
          style: { borderColor: ch.accent }
        }, [
          h('div', {}, [
            h('h3', { text: ch.name, style: { color: ch.accent } }),
            h('p.chapter-blurb', { text: ch.blurb })
          ]),
          h('div.chapter-meta', {}, [
            h('span.chapter-teaches', { text: ch.teaches }),
            unlocked ? null : h('span.lock-note', { text: '🔒 ' + need + ' stars to open' })
          ])
        ]),
        h('div.level-grid', {}, levels.map(function (lvl, i) {
          var rec = progress.levels[lvl.id];
          var stars = rec ? rec.stars : 0;
          var isBoss = lvl.tags && lvl.tags.indexOf('boss') >= 0;
          return h('button.level-card' +
                   (rec && rec.solved ? '.solved' : '') +
                   (isBoss ? '.boss' : '') +
                   (unlocked ? '' : '.disabled'), {
            disabled: !unlocked,
            onclick: function () { game.loadLevelById(lvl.id); ui.hideScreen(); },
            title: lvl.blurb || lvl.name
          }, [
            h('span.level-num', { text: lvl.sandbox ? '∞' : String(i + 1) }),
            h('span.level-title', { text: lvl.name }),
            lvl.sandbox ? h('span.level-tag', { text: 'sandbox' }) : ui.starRow(stars),
            lvl.phases ? h('span.level-tag.timed', { text: '⏱ ' + lvl.phases.length + ' phases' }) : null,
            isBoss ? h('span.boss-flag', {
              text: lvl.tags.indexOf('finale') >= 0 ? 'FINAL' : 'BOSS'
            }) : (lvl.tags && lvl.tags.indexOf('impossible') >= 0
              ? h('span.boss-flag.impossible', { text: 'IMPOSSIBLE' }) : null)
          ]);
        }))
      ]));
    });

    /* Player-made levels. */
    var lib = LP.Storage.loadLibrary();
    if (lib.length) {
      body.push(h('section.chapter', {}, [
        h('div.chapter-head', {}, [
          h('div', {}, [h('h3', { text: 'Your Levels' }),
                        h('p.chapter-blurb', { text: 'Built in the editor, stored in this browser.' })])
        ]),
        h('div.level-grid', {}, lib.map(function (entry) {
          return h('button.level-card', {
            onclick: function () { game.loadSharedCode(entry.code); ui.hideScreen(); }
          }, [
            h('span.level-num', { text: '✎' }),
            h('span.level-title', { text: entry.name }),
            h('span.level-tag', { text: new Date(entry.savedAt).toLocaleDateString() })
          ]);
        }))
      ]));
    }

    return ui.overlayShell('Levels',
      game.progress.totalStars + ' stars collected', body,
      [h('button.big-btn.ghost', { text: 'Title', onclick: function () { ui.showScreen('title'); } })],
      { wide: true });
  };

  /* ---- Win ---------------------------------------------------------------- */
  SCREENS.win = function (ui, game, data) {
    var lvl = data.level, ev = data.ev, stars = data.stars;
    var par = lvl.par || {};
    var next = game.nextLevelAfter(lvl.id);

    var lines;
    var ph = data.phases;
    if (ph) {
      lines = [
        ['Phases', ph.count + ' cleared'],
        ['Rewinds', String(ph.failures)],
        ['Attempts per phase', ph.results.map(function (r) { return r ? r.attempts : '—'; }).join(' · ')],
        ['Clock used', data.seconds.toFixed(1) + 's'],
        ['Pieces on the bench', String(ev.objects)]
      ];
    } else {
      lines = [
        ['Objects used', ev.objects + (par.objects !== undefined ? ' (par ' + par.objects + ')' : '')],
        ['Interactions', ev.bounces + (par.bounces !== undefined ? ' (par ' + par.bounces + ')' : '')],
        ['Light delivered', ev.receivers.map(function (r) {
          return r.intensity.toFixed(2);
        }).join(' · ')]
      ];
      if (data.seconds) lines.push(['Time', data.seconds.toFixed(1) + 's']);
    }

    var body = [
      h('div.win-stars', {}, [ui.starRow(stars)]),
      h('p.win-note', { text: ph ? phaseStarMessage(stars) : starMessage(stars, par) }),
      h('div.win-table', {}, lines.map(function (l) {
        return h('div.readout-line', {}, [
          h('span.rk', { text: l[0] }), h('span.rv', { text: l[1] })
        ]);
      }))
    ];

    if (data.isDaily) {
      body.push(h('p.win-note', {
        text: LP.Storage.remote.online
          ? 'Score submitted to the global board.'
          : 'Saved locally. Connect a leaderboard backend to compete globally — see the README.'
      }));
    }

    var actions = [
      h('button.big-btn', {
        text: 'Watch replay', onclick: function () { ui.hideScreen(); game.playReplay(); }
      }),
      h('button.big-btn', {
        text: 'Save clip', onclick: function (e) { game.exportClip(e.target); }
      }),
      h('button.big-btn', {
        text: 'Retry', onclick: function () {
          ui.hideScreen();
          if (ph) game.restartLevel(); else game.resetLevel();
        }
      })
    ];
    if (next) {
      actions.push(h('button.big-btn.primary', {
        text: 'Next: ' + next.name,
        onclick: function () { ui.hideScreen(); game.loadLevelById(next.id); }
      }));
    } else {
      actions.push(h('button.big-btn.primary', {
        text: 'Level select', onclick: function () { ui.showScreen('levels'); }
      }));
    }

    return ui.overlayShell('Solved — ' + lvl.name, lvl.blurb || '', body, actions);
  };

  function phaseStarMessage(stars) {
    if (stars >= 3) return 'Every phase on its first attempt. Nerves of steel.';
    if (stars === 2) return 'Two rewinds or fewer. Beat every clock first time for three stars.';
    return 'Done, the hard way. Now try it without a rewind.';
  }

  function starMessage(stars, par) {
    if (stars >= 3) return 'At or under par on both counts. Nothing wasted.';
    if (stars === 2) return 'Solid. There is a tidier arrangement worth finding.';
    return 'It works. Now try it with fewer pieces.';
  }

  /* ---- Settings ----------------------------------------------------------- */
  SCREENS.settings = function (ui, game) {
    var s = game.settings;
    function toggle(label, key, note, onChange) {
      return h('label.setting-row', {}, [
        h('input', {
          type: 'checkbox', checked: s[key],
          onchange: function (e) {
            s[key] = e.target.checked;
            LP.Storage.saveSettings(s);
            (onChange || function () {})(s[key]);
          }
        }),
        h('span', {}, [
          h('span.setting-label', { text: label }),
          note ? h('span.setting-note', { text: note }) : null
        ])
      ]);
    }

    var body = [
      toggle('Sound effects', 'sound', 'Clicks, chimes and the burst when a sensor lights.',
        function (v) { LP.Audio.setEnabled(v); }),
      toggle('Ambient music', 'music', 'A generated pad that changes with each chapter.',
        function (v) { LP.Audio.setMusic(v); }),
      (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function')
        ? toggle('Vibration', 'haptics', 'A short buzz when you place a piece or light a sensor.')
        : null,
      toggle('Colourblind mode', 'colorblind',
        'Beams also carry a dash pattern, and colour targets show a symbol, so hue is never the only cue.',
        function () { game.applySettings(); }),
      toggle('Open every chapter', 'openAll',
        'Play any chapter without collecting stars first. Stars still count.'),
      toggle('Reduced motion', 'reducedMotion',
        'Beams appear instantly instead of travelling; weather and particles are switched off.',
        function () { game.applySettings(); }),
      h('label.setting-row', {}, [
        h('select', {
          onchange: function (e) {
            s.quality = e.target.value;
            LP.Storage.saveSettings(s);
            game.applySettings();
          }
        }, ['high', 'medium', 'low'].map(function (q) {
          return h('option', { value: q, selected: s.quality === q, text: q });
        })),
        h('span', {}, [
          h('span.setting-label', { text: 'Graphics quality' }),
          h('span.setting-note', { text: 'Lower settings reduce the glow blur and render resolution.' })
        ])
      ])
    ];

    if (!LP.Storage.persistent) {
      body.push(h('p.warn-note', {
        text: 'This browser is not allowing local storage, so progress will not survive a reload. ' +
              'Use "Export progress" below to keep a copy.'
      }));
    }

    body.push(h('div.setting-actions', {}, [
      h('button.wide-btn', {
        text: 'Export progress',
        onclick: function () {
          var blob = new Blob([LP.Storage.exportAll()], { type: 'application/json' });
          LP.Replay.download(blob, 'lumen-path-save.json');
        }
      }),
      h('label.wide-btn.filelabel', {}, [
        'Import progress',
        h('input', {
          type: 'file', accept: 'application/json',
          onchange: function (e) {
            var f = e.target.files && e.target.files[0];
            if (!f) return;
            var fr = new FileReader();
            fr.onload = function () {
              try {
                LP.Storage.importAll(String(fr.result));
                game.reloadProgress();
                ui.toast('Progress imported.', 'good');
                ui.showScreen('settings');
              } catch (err) { ui.toast('That file could not be read.', 'bad'); }
            };
            fr.readAsText(f);
          }
        })
      ]),
      h('button.wide-btn.danger', {
        text: 'Erase all progress',
        onclick: function (e) {
          if (e.target.dataset.confirm) {
            LP.Storage.clearAll();
            game.reloadProgress();
            ui.toast('Progress erased.', 'bad');
            ui.showScreen('settings');
          } else {
            e.target.dataset.confirm = '1';
            e.target.textContent = 'Really erase everything?';
          }
        }
      })
    ]));

    body.push(h('div.keyhelp', {}, [
      h('h4', { text: 'Controls' }),
      h('dl', {}, [
        ['Tap tray, then bench', 'Place a piece'],
        ['Drag the piece', 'Move it'],
        ['Blue knob', 'Rotate — Shift for 15° steps, Ctrl for 45°'],
        ['White end knobs / scroll', 'Resize'],
        ['Amber knob', 'Flex a curved mirror or lens'],
        ['Green knob  ·  + −', 'Beam splitter ratio'],
        ['Red × badge  ·  Delete', 'Return the piece to the tray'],
        ['⇄ badge  ·  F', 'Flip a one-way mirror'],
        ['↻ badge  ·  C', 'Next filter colour'],
        ['n badge  ·  M', 'Next type of glass'],
        ['Pinch / twist', 'Resize and rotate with two fingers'],
        ['Arrow keys', 'Nudge — Shift for fine'],
        ['[ and ]', 'Rotate one degree — Shift for a quarter'],
        ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
        ['R  ·  H', 'Reset  ·  hint'],
        ['Enter', 'Start a timed level’s clock'],
        ['R on a timed level', 'Restart the phase (counts as an attempt)']
      ].reduce(function (acc, pair) {
        acc.push(h('dt', { text: pair[0] }));
        acc.push(h('dd', { text: pair[1] }));
        return acc;
      }, []))
    ]));

    return ui.overlayShell('Settings', null, body,
      [h('button.big-btn.primary', { text: 'Done', onclick: function () { ui.hideScreen(); } })]);
  };

  /* ---- Daily -------------------------------------------------------------- */
  SCREENS.daily = function (ui, game) {
    var key = LP.Daily.dateKey();
    var results = LP.Storage.loadDaily();
    var mine = results[key];
    var body = [
      h('p.sheet-lead', {
        text: 'One level a day, generated from the date so everyone gets the same puzzle. ' +
              'Ranked on fewest objects, then fewest interactions.'
      }),
      h('div.daily-row', {}, [
        h('span.daily-date', { text: key }),
        h('span.daily-count', { id: 'daily-countdown', text: 'next in ' +
          LP.Daily.formatCountdown(LP.Daily.timeUntilNext()) })
      ])
    ];

    if (mine) {
      body.push(h('div.win-table', {}, [
        h('div.readout-line', {}, [h('span.rk', { text: 'Your best today' }),
          h('span.rv', { text: mine.objects + ' objects · ' + mine.bounces + ' interactions' })])
      ]));
    }

    var board = h('div.leaderboard', { text: 'Loading the board…' });
    body.push(board);

    LP.Storage.remote.fetchLeaderboard('daily-' + key, key, 25).then(function (res) {
      ui.clear(board);
      if (res.offline) {
        board.appendChild(h('p.board-note', {
          text: 'No leaderboard backend is configured, so scores stay on this device. ' +
                'Point LP.Storage.remote.endpoint at a server to turn on global ranking — ' +
                'the expected API is documented at the top of src/engine/storage.js.'
        }));
        var localRuns = Object.keys(results).sort().reverse().slice(0, 10);
        if (localRuns.length) {
          board.appendChild(h('h4', { text: 'Your recent runs' }));
          board.appendChild(h('ol.board-list', {}, localRuns.map(function (k) {
            var r = results[k];
            return h('li', {}, [
              h('span.board-name', { text: k }),
              h('span.board-score', { text: r.objects + ' obj · ' + r.bounces + ' hits' })
            ]);
          })));
        }
      } else {
        board.appendChild(h('ol.board-list', {}, (res.entries || []).map(function (e, i) {
          return h('li', {}, [
            h('span.board-rank', { text: '#' + (i + 1) }),
            h('span.board-name', { text: e.name || 'anon' }),
            h('span.board-score', { text: e.objects + ' obj · ' + e.bounces + ' hits' })
          ]);
        })));
      }
    });

    return ui.overlayShell('Daily Challenge', null, body, [
      h('button.big-btn.primary', {
        text: mine ? 'Play again' : 'Play today’s',
        onclick: function () { ui.hideScreen(); game.loadDaily(); }
      }),
      h('button.big-btn.ghost', { text: 'Back', onclick: function () { ui.showScreen('title'); } })
    ]);
  };

  /* ---- Share / import ----------------------------------------------------- */
  SCREENS.share = function (ui, game, data) {
    var code = data.code;
    var url = data.url;
    var ta = h('textarea.code-box', { readonly: true, rows: 4, value: url });
    return ui.overlayShell('Share this level',
      'Anyone with the link gets the level exactly as you built it.', [
        ta,
        h('p.sheet-lead', { text: 'Code length: ' + code.length + ' characters.' })
      ], [
        h('button.big-btn.primary', {
          text: 'Copy link',
          onclick: function () {
            ta.select();
            navigator.clipboard ? navigator.clipboard.writeText(url).then(function () {
              ui.toast('Link copied.', 'good');
            }, function () { ui.toast('Select and copy the text above.', 'bad'); })
              : ui.toast('Select and copy the text above.');
          }
        }),
        h('button.big-btn', { text: 'Done', onclick: function () { ui.hideScreen(); } })
      ]);
  };

  SCREENS.import = function (ui, game) {
    var ta = h('textarea.code-box', { rows: 4, placeholder: 'Paste a Lumen Path link or code…' });
    return ui.overlayShell('Open a shared level', null, [ta], [
      h('button.big-btn.primary', {
        text: 'Open',
        onclick: function () {
          var v = ta.value.trim();
          var m = v.match(/[#&]lvl=([A-Za-z0-9\-_]+)/);
          var code = m ? m[1] : v;
          try {
            game.loadSharedCode(code);
            ui.hideScreen();
          } catch (e) {
            ui.toast(e.message || 'That code could not be read.', 'bad', 4000);
          }
        }
      }),
      h('button.big-btn', { text: 'Cancel', onclick: function () { ui.hideScreen(); } })
    ]);
  };

  /* ---- Multiplayer -------------------------------------------------------- */
  SCREENS.multiplayer = function (ui, game) {
    var relayInput = h('input.text-input', {
      type: 'text', value: LP.Net.DEFAULT_RELAY, placeholder: 'ws://host:port'
    });
    var roomInput = h('input.text-input', {
      type: 'text', value: LP.Net.makeRoomCode(), placeholder: 'Room code'
    });
    var modeSel = h('select', {}, [
      h('option', { value: 'coop', text: 'Co-op — the inventory is split between you' }),
      h('option', { value: 'versus', text: 'Versus — race to light your own sensor' })
    ]);

    return ui.overlayShell('Multiplayer',
      'Two players, one optical bench.', [
        h('p.sheet-lead', {
          text: 'Hotseat needs nothing at all. Online play needs a relay: run ' +
                '"node server/relay.js" on any machine you both can reach, then put its ' +
                'address below. The relay only forwards messages — both browsers run the ' +
                'same deterministic optics, so they always agree on where the light goes.'
        }),
        h('label.prop-row.column', {}, [h('span.prop-label', { text: 'Mode' }), modeSel]),
        h('label.prop-row.column', {}, [h('span.prop-label', { text: 'Relay address' }), relayInput]),
        h('label.prop-row.column', {}, [h('span.prop-label', { text: 'Room code' }), roomInput])
      ], [
        h('button.big-btn.primary', {
          text: 'Start hotseat',
          onclick: function () {
            ui.hideScreen();
            game.startMultiplayer({ transport: 'local', mode: modeSel.value });
          }
        }),
        h('button.big-btn', {
          text: 'Connect',
          onclick: function (e) {
            e.target.disabled = true;
            e.target.textContent = 'Connecting…';
            game.startMultiplayer({
              transport: 'socket', mode: modeSel.value,
              url: relayInput.value.trim(), room: roomInput.value.trim().toUpperCase()
            }).then(function () {
              ui.hideScreen();
            }, function (err) {
              e.target.disabled = false;
              e.target.textContent = 'Connect';
              ui.toast(err.message || 'Could not connect.', 'bad', 5000);
            });
          }
        }),
        h('button.big-btn.ghost', { text: 'Back', onclick: function () { ui.showScreen('title'); } })
      ]);
  };

  /* ---- Editor panel ------------------------------------------------------- */
  SCREENS.editor = function (ui, game) {
    var ed = game.editor;
    var lvl = ed.level;

    var nameInput = h('input.text-input', {
      type: 'text', value: lvl.name,
      oninput: function (e) { lvl.name = e.target.value; ed.dirty = true; }
    });
    var authorInput = h('input.text-input', {
      type: 'text', value: lvl.author || '', placeholder: 'optional',
      oninput: function (e) { lvl.author = e.target.value; ed.dirty = true; }
    });

    var palette = h('div.palette', {}, LP.Editor.PALETTE.map(function (grp) {
      return h('div.palette-group', {}, [
        h('h4', { text: grp.group }),
        h('div.palette-items', {}, grp.types.map(function (t) {
          return h('button.palette-item', {
            title: E.TYPES[t].name,
            onclick: function () { game.editorPlace(t); ui.hideScreen(); }
          }, [icon(t, 22), h('span', { text: E.TYPES[t].short })]);
        }))
      ]);
    }));

    var invRows = h('div.inv-editor', {}, Object.keys(E.TYPES)
      .filter(function (t) { return !['emitter', 'receiver', 'absorber'].includes(t); })
      .map(function (t) {
        var n = ed.inventoryCount(t);
        return h('label.inv-row', {}, [
          icon(t, 18),
          h('span.inv-name', { text: E.TYPES[t].short }),
          h('input', {
            type: 'number', min: 0, max: 20, value: n,
            oninput: function (e) { ed.setInventory(t, parseInt(e.target.value, 10) || 0); }
          })
        ]);
      }));

    var check = ed.validate();
    var checkBox = h('div.validate' + (check.ok ? '.ok' : '.bad'), {}, [
      h('h4', { text: check.ok ? 'Ready to share' : 'Needs attention' })
    ].concat(
      check.problems.map(function (p) { return h('p.v-problem', { text: '✕ ' + p }); }),
      check.warnings.map(function (w) { return h('p.v-warn', { text: '! ' + w }); })
    ));

    return ui.overlayShell('Editor', ed.mode === 'test' ? 'Test mode' : 'Build mode', [
      h('div.editor-cols', {}, [
        h('div', {}, [
          h('label.prop-row.column', {}, [h('span.prop-label', { text: 'Title' }), nameInput]),
          h('label.prop-row.column', {}, [h('span.prop-label', { text: 'Author' }), authorInput]),
          h('h4', { text: 'Add objects' }),
          palette
        ]),
        h('div', {}, [
          h('h4', { text: 'Player inventory' }),
          h('p.sheet-lead', { text: 'What the solver gets to place.' }),
          invRows,
          checkBox
        ])
      ])
    ], [
      h('button.big-btn', {
        text: ed.mode === 'test' ? 'Back to building' : 'Test play',
        onclick: function () {
          ui.hideScreen();
          if (ed.mode === 'test') game.editorExitTest(); else game.editorEnterTest();
        }
      }),
      h('button.big-btn', {
        text: 'Save answer',
        onclick: function () {
          var r = ed.captureSolution();
          ui.toast(r.ok ? 'Answer saved: ' + r.objects + ' objects, ' + r.bounces + ' interactions.'
                        : r.why, r.ok ? 'good' : 'bad', 4200);
          if (r.ok) ui.showScreen('editor');
        }
      }),
      h('button.big-btn', {
        text: 'Save to library',
        onclick: function () { ed.save(); ui.toast('Saved to your levels.', 'good'); }
      }),
      h('button.big-btn.primary', {
        text: 'Share',
        onclick: function () {
          var v = ed.validate();
          if (!v.ok) { ui.toast(v.problems[0], 'bad', 4200); return; }
          ui.showScreen('share', { code: ed.exportCode(), url: ed.exportURL() });
        }
      }),
      h('button.big-btn.ghost', { text: 'Leave editor', onclick: function () { game.closeEditor(); } })
    ], { wide: true });
  };

  LP.UI = { create: create, h: h, icon: icon, SCREENS: SCREENS, clear: clear };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
