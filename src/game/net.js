/* =============================================================================
 * Lumen Path - src/game/net.js
 * -----------------------------------------------------------------------------
 * Multiplayer: co-operative and versus.
 *
 * TRANSPORT ABSTRACTION
 * Everything here talks to a transport with four methods -- connect, send,
 * onMessage, close -- so the same game logic runs over:
 *
 *   LocalTransport      two players at one keyboard (hotseat), and the
 *                       development path: no server required
 *   SocketTransport     a WebSocket relay; see server/relay.js for a working
 *                       reference implementation of the other end
 *
 * The relay is deliberately dumb: it forwards messages between the members of
 * a room and never simulates anything. Both clients run the same deterministic
 * optics over the same placements, so they agree on the beam without the
 * server knowing what a beam is.
 *
 * OWNERSHIP
 * In co-op each player owns a subset of the inventory. A player may only move
 * objects they own; the other player's objects arrive as remote updates. That
 * makes the mode genuinely co-operative -- neither player can solve the level
 * alone, because neither has all the pieces.
 *
 * PROTOCOL (JSON messages)
 *   { t:'hello',  room, name, mode }
 *   { t:'peers',  ids:[...], you }                  server -> client
 *   { t:'start',  levelCode, seed, assignments }
 *   { t:'place',  id, type, x, y, props }
 *   { t:'move',   id, x, y, angle, length, curvature, ratio }
 *   { t:'remove', id }
 *   { t:'solved', by, objects, bounces, ms }
 *   { t:'ping',   at }  /  { t:'pong', at }
 * ========================================================================== */
(function (LP) {
  'use strict';

  var Sc = LP.Scene, E = LP.Elements, Share = LP.Share;

  /* ==========================================================================
   * Transports
   * ======================================================================= */

  /** Two players sharing one screen. Messages loop straight back. */
  function LocalTransport() {
    var handlers = [];
    return {
      kind: 'local',
      connect: function () { return Promise.resolve(); },
      send: function (msg) {
        /* Deliver on a later tick so local play has the same async shape as
         * networked play -- bugs that only appear over a wire show up here. */
        setTimeout(function () {
          handlers.forEach(function (h) { h(msg); });
        }, 0);
      },
      onMessage: function (fn) { handlers.push(fn); },
      close: function () { handlers.length = 0; }
    };
  }

  /**
   * WebSocket relay client.
   * `url` should point at a server implementing the protocol above --
   * server/relay.js is a ready-made one (`node server/relay.js`).
   */
  function SocketTransport(url, room, name) {
    var ws = null;
    var handlers = [];
    var queue = [];
    var closed = false;

    return {
      kind: 'socket',
      url: url,
      room: room,

      connect: function () {
        return new Promise(function (resolve, reject) {
          try { ws = new WebSocket(url); }
          catch (e) { reject(new Error('Could not open a connection: ' + e.message)); return; }

          var settled = false;
          var timer = setTimeout(function () {
            if (!settled) { settled = true; try { ws.close(); } catch (e) {}
              reject(new Error('Connection timed out.')); }
          }, 8000);

          ws.onopen = function () {
            clearTimeout(timer);
            settled = true;
            ws.send(JSON.stringify({ t: 'hello', room: room, name: name }));
            queue.forEach(function (m) { ws.send(m); });
            queue.length = 0;
            resolve();
          };
          ws.onmessage = function (ev) {
            var msg;
            try { msg = JSON.parse(ev.data); } catch (e) { return; }
            /* Relay traffic is untrusted input: it is handled as data and
             * validated by the caller before it touches the scene. */
            handlers.forEach(function (h) { h(msg); });
          };
          ws.onerror = function () {
            if (!settled) { settled = true; clearTimeout(timer);
              reject(new Error('Could not reach the relay.')); }
          };
          ws.onclose = function () {
            closed = true;
            handlers.forEach(function (h) { h({ t: 'closed' }); });
          };
        });
      },

      send: function (msg) {
        var s = JSON.stringify(msg);
        if (ws && ws.readyState === 1) ws.send(s);
        else if (!closed) queue.push(s);
      },
      onMessage: function (fn) { handlers.push(fn); },
      close: function () { closed = true; if (ws) try { ws.close(); } catch (e) {} }
    };
  }

  /* ==========================================================================
   * Session
   * ======================================================================= */

  /**
   * mode: 'coop' | 'versus'
   *
   * coop   - the inventory is split between the players; every receiver must
   *          be lit, and neither player has enough objects alone.
   * versus - both players share one beam and one inventory pool, each with
   *          their own receiver. First to light theirs takes the round.
   */
  function createSession(opts) {
    var session = {
      transport: opts.transport,
      mode: opts.mode || 'coop',
      you: opts.you || 'A',
      peers: [],
      scene: null,
      level: null,
      assignments: {},        /* elementId -> player id */
      slotOwner: {},          /* inventory slot index -> player id */
      onUpdate: opts.onUpdate || function () {},
      onStatus: opts.onStatus || function () {},
      onFinish: opts.onFinish || function () {},
      startedAt: 0,
      finished: false,
      latency: null
    };

    session.transport.onMessage(function (msg) { handle(session, msg); });

    /* ---- Ownership ---------------------------------------------------- */

    /** Split inventory slots alternately so both sides get variety. */
    session.assignSlots = function (playerIds) {
      var ids = playerIds && playerIds.length ? playerIds : ['A', 'B'];
      session.slotOwner = {};
      if (!session.scene) return;
      for (var i = 0; i < session.scene.inventory.length; i++) {
        session.slotOwner[i] = ids[i % ids.length];
      }
    };

    session.ownsSlot = function (index) {
      if (session.mode === 'versus') return true;         /* shared pool */
      return session.slotOwner[index] === session.you;
    };

    session.ownsElement = function (el) {
      if (session.mode === 'versus') return true;
      if (!el.fromInventory) return false;
      return session.assignments[el.id] === session.you;
    };

    /* ---- Outgoing ----------------------------------------------------- */

    session.start = function (level) {
      session.level = level;
      session.scene = Sc.fromLevel(level);
      session.assignSlots(session.peers.length ? session.peers : ['A', 'B']);
      session.startedAt = Date.now();
      session.finished = false;
      session.transport.send({
        t: 'start',
        levelCode: Share.encodeLevel(level),
        assignments: session.slotOwner
      });
      session.onUpdate(session.scene);
      return session.scene;
    };

    session.place = function (type, x, y, extra) {
      var el = Sc.place(session.scene, type, x, y, extra);
      if (!el) return null;
      session.assignments[el.id] = session.you;
      session.transport.send({
        t: 'place', id: el.id, type: type, x: x, y: y,
        props: extra || {}, by: session.you
      });
      session.onUpdate(session.scene);
      return el;
    };

    session.move = function (el) {
      if (!session.ownsElement(el)) return false;
      session.transport.send({
        t: 'move', id: el.id, x: el.x, y: el.y, angle: el.angle,
        length: el.length, curvature: el.curvature, ratio: el.ratio,
        radius: el.radius, by: session.you
      });
      return true;
    };

    session.remove = function (el) {
      if (!session.ownsElement(el)) return false;
      session.transport.send({ t: 'remove', id: el.id, by: session.you });
      Sc.remove(session.scene, el);
      delete session.assignments[el.id];
      session.onUpdate(session.scene);
      return true;
    };

    session.declareSolved = function (ev) {
      if (session.finished) return;
      session.finished = true;
      session.transport.send({
        t: 'solved', by: session.you,
        objects: ev.objects, bounces: ev.bounces,
        ms: Date.now() - session.startedAt
      });
      session.onFinish({ winner: session.you, mine: true, ev: ev });
    };

    session.ping = function () {
      session.transport.send({ t: 'ping', at: Date.now(), by: session.you });
    };

    session.close = function () { session.transport.close(); };
    return session;
  }

  /* --------------------------------------------------------------------------
   * Incoming messages.
   *
   * Every field is treated as untrusted: ids are looked up rather than
   * constructed, numbers are validated, and an unknown element type is dropped
   * instead of being created.
   * ------------------------------------------------------------------------ */
  function handle(session, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.by && msg.by === session.you) return;        /* our own echo */

    switch (msg.t) {
      case 'peers':
        session.peers = Array.isArray(msg.ids) ? msg.ids.slice(0, 8) : [];
        if (msg.you) session.you = msg.you;
        session.onStatus({ peers: session.peers, you: session.you });
        break;

      case 'start':
        try {
          var lvl = Share.decodeLevel(msg.levelCode);
          session.level = lvl;
          session.scene = Sc.fromLevel(lvl);
          session.slotOwner = msg.assignments || {};
          session.startedAt = Date.now();
          session.finished = false;
          session.onUpdate(session.scene);
          session.onStatus({ started: true, level: lvl });
        } catch (e) {
          session.onStatus({ error: 'Could not load the shared level: ' + e.message });
        }
        break;

      case 'place': {
        if (!session.scene) break;
        if (!E.TYPES[msg.type]) break;
        var x = num(msg.x), y = num(msg.y);
        if (x === null || y === null) break;
        var el = Sc.place(session.scene, msg.type, x, y, sanitiseProps(msg.props));
        if (el) {
          /* Adopt the sender's id so later move/remove messages match up. */
          delete session.scene.byId[el.id];
          el.id = String(msg.id).slice(0, 40);
          session.scene.byId[el.id] = el;
          session.assignments[el.id] = msg.by;
          session.onUpdate(session.scene);
        }
        break;
      }

      case 'move': {
        if (!session.scene) break;
        var target = session.scene.byId[msg.id];
        if (!target || !target.fromInventory) break;
        if (session.mode === 'coop' && session.assignments[msg.id] === session.you) break;
        applyNum(target, 'x', msg.x);
        applyNum(target, 'y', msg.y);
        applyNum(target, 'angle', msg.angle);
        applyClamped(target, 'length', msg.length);
        applyClamped(target, 'curvature', msg.curvature);
        applyClamped(target, 'ratio', msg.ratio);
        applyClamped(target, 'radius', msg.radius);
        E.touch(target);
        session.scene.dirty = true;
        session.onUpdate(session.scene);
        break;
      }

      case 'remove': {
        if (!session.scene) break;
        var rem = session.scene.byId[msg.id];
        if (rem && rem.fromInventory) {
          Sc.remove(session.scene, rem);
          delete session.assignments[msg.id];
          session.onUpdate(session.scene);
        }
        break;
      }

      case 'solved':
        if (session.finished) break;
        session.finished = true;
        session.onFinish({ winner: msg.by, mine: false, objects: msg.objects,
                           bounces: msg.bounces, ms: msg.ms });
        break;

      case 'ping':
        session.transport.send({ t: 'pong', at: msg.at, by: session.you });
        break;

      case 'pong':
        session.latency = Date.now() - msg.at;
        session.onStatus({ latency: session.latency });
        break;

      case 'closed':
        session.onStatus({ disconnected: true });
        break;
    }
  }

  function num(v) {
    var n = +v;
    return (typeof v !== 'undefined' && isFinite(n)) ? n : null;
  }
  function applyNum(el, key, v) {
    var n = num(v);
    if (n !== null) el[key] = n;
  }
  function applyClamped(el, key, v) {
    var n = num(v);
    if (n === null || el[key] === undefined) return;
    el[key] = E.clampProp(el, key, n);
  }
  function sanitiseProps(p) {
    if (!p || typeof p !== 'object') return {};
    var out = {};
    var allow = ['angle', 'length', 'radius', 'curvature', 'ratio', 'color',
                 'material', 'spacing', 'orders', 'w', 'h', 'flipped'];
    for (var i = 0; i < allow.length; i++) {
      if (Object.prototype.hasOwnProperty.call(p, allow[i])) out[allow[i]] = p[allow[i]];
    }
    return out;
  }

  /** Build a room code that is easy to read out loud. */
  function makeRoomCode() {
    var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   /* no I/O/0/1 */
    var s = '';
    for (var i = 0; i < 5; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    return s;
  }

  LP.Net = {
    LocalTransport: LocalTransport,
    SocketTransport: SocketTransport,
    createSession: createSession,
    makeRoomCode: makeRoomCode,
    /* Default relay address. Override in the multiplayer panel, or point it at
     * your own deployment of server/relay.js. */
    DEFAULT_RELAY: 'ws://localhost:8787'
  };
})(typeof globalThis !== 'undefined' ? (globalThis.LP = globalThis.LP || {}) : (this.LP = this.LP || {}));
