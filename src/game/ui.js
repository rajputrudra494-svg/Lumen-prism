/* =============================================================================
 * Lumen Path - src/game/ui.js
 * -----------------------------------------------------------------------------
 * All chrome: the HUD, the inventory tray, the properties panel, every overlay
 * screen, and the toasts.
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

  function starRow(n, max) {
    var row = h('span.stars');
    for (var i = 0; i < (max || 3); i++) {
      row.appendChild(h('span.star' + (i < n ? '.on' : ''), { text: '★' }));
    }
    return row;
  }

  /* ==========================================================================
   * UI
   * ======================================================================= */
  function create(game, root) {
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

    root.appendChild(h('div.stage-wrap', {}, [canvas, ui.els.statusStrip, ui.els.rotateHint]));
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
      ui.els.levelSub.textContent = (chapter ? chapter.name : '') +
        (lvl.blurb ? ' — ' + lvl.blurb : '');

      var par = lvl.par || {};
      clear(ui.els.parBox);
      if (lvl.sandbox) {
        ui.els.parBox.appendChild(h('span.par-label', { text: 'Sandbox' }));
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

  function titleArtSVG() {
    return '<svg viewBox="0 0 320 120" width="100%" height="120" aria-hidden="true">' +
      '<defs><linearGradient id="lp-beam" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0" stop-color="#ffffff" stop-opacity="0.15"/>' +
      '<stop offset="0.5" stop-color="#7ef0ff" stop-opacity="0.95"/>' +
      '<stop offset="1" stop-color="#ff5ec4" stop-opacity="0.9"/></linearGradient></defs>' +
      '<path d="M8 60 H120 L200 24 L200 96 L312 60" fill="none" stroke="url(#lp-beam)" ' +
      'stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<line x1="106" y1="40" x2="134" y2="80" stroke="#dff2ff" stroke-width="4" stroke-linecap="round"/>' +
      '<line x1="186" y1="10" x2="214" y2="38" stroke="#dff2ff" stroke-width="4" stroke-linecap="round"/>' +
      '<line x1="186" y1="110" x2="214" y2="82" stroke="#dff2ff" stroke-width="4" stroke-linecap="round"/>' +
      '<circle cx="312" cy="60" r="9" fill="none" stroke="#ff9ede" stroke-width="3"/>' +
      '<circle cx="8" cy="60" r="6" fill="#7ef0ff"/></svg>';
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
            isBoss ? h('span.boss-flag', { text: 'BOSS' }) : null
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

    var lines = [
      ['Objects used', ev.objects + (par.objects !== undefined ? ' (par ' + par.objects + ')' : '')],
      ['Interactions', ev.bounces + (par.bounces !== undefined ? ' (par ' + par.bounces + ')' : '')],
      ['Light delivered', ev.receivers.map(function (r) {
        return r.intensity.toFixed(2);
      }).join(' · ')]
    ];
    if (data.seconds) lines.push(['Time', data.seconds.toFixed(1) + 's']);

    var body = [
      h('div.win-stars', {}, [ui.starRow(stars)]),
      h('p.win-note', { text: starMessage(stars, par) }),
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
        text: 'Retry', onclick: function () { ui.hideScreen(); game.resetLevel(); }
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
        ['R  ·  H', 'Reset  ·  hint']
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
