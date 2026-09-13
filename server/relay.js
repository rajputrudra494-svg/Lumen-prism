/* =============================================================================
 * Lumen Path - server/relay.js
 * -----------------------------------------------------------------------------
 * A minimal WebSocket relay for co-op and versus play.
 *
 *     node server/relay.js            listens on 8787
 *     PORT=9000 node server/relay.js  listens on 9000
 *
 * WHAT THIS DOES, AND DELIBERATELY DOES NOT DO
 * It forwards JSON messages between the members of a room. That is all. It has
 * no idea what a mirror is, never runs the optics, and holds no authoritative
 * game state.
 *
 * That works because the simulation is deterministic: both clients run the
 * identical tracer over the identical placements, so they arrive at the same
 * beam without anyone refereeing. The trade-off is the usual one for a trusted-
 * peer design -- a modified client could lie about its placements. For a
 * co-operative puzzle game played with someone you invited by room code, that
 * is the right trade. If you ever need authoritative play, the place to put it
 * is here: keep the scene server-side, run src/optics/ under Node exactly as
 * tools/verify.js does, and validate each 'place'/'move' before rebroadcasting.
 *
 * ZERO DEPENDENCIES. It speaks enough of RFC 6455 to do the job (text frames,
 * ping/pong, close) rather than pulling in a package, so it runs anywhere Node
 * does with nothing to install.
 * ========================================================================== */
'use strict';

const http = require('http');
const crypto = require('crypto');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8787;
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/* Room code -> Set of sockets. */
const rooms = new Map();
let nextClientId = 1;

const MAX_MESSAGE = 64 * 1024;      /* a share code plus slack */
const MAX_ROOM_SIZE = 8;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

/* ---------------------------------------------------------------------------
 * HTTP: a health endpoint, and a polite refusal for anything else. The game
 * itself is served as static files by whatever you like -- this process only
 * exists for the socket upgrade.
 * ------------------------------------------------------------------------ */
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    const stats = {
      ok: true,
      rooms: rooms.size,
      clients: [...rooms.values()].reduce((n, s) => n + s.size, 0),
      uptime: Math.round(process.uptime())
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(stats));
    return;
  }
  res.writeHead(426, { 'content-type': 'text/plain' });
  res.end('This is the Lumen Path relay. Connect over WebSocket.\n');
});

/* ---------------------------------------------------------------------------
 * WebSocket handshake
 * ------------------------------------------------------------------------ */
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }

  const accept = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );

  const client = {
    socket,
    id: 'P' + (nextClientId++),
    room: null,
    buffer: Buffer.alloc(0),
    alive: true,
    lastSeen: Date.now()
  };

  socket.setTimeout(0);
  socket.setNoDelay(true);

  socket.on('data', (chunk) => {
    client.lastSeen = Date.now();
    client.buffer = Buffer.concat([client.buffer, chunk]);
    /* A single TCP read can hold several frames, or part of one. */
    for (;;) {
      const frame = decodeFrame(client.buffer);
      if (!frame) break;
      client.buffer = client.buffer.slice(frame.consumed);

      if (frame.opcode === 0x8) { closeClient(client); return; }        /* close */
      if (frame.opcode === 0x9) { sendRaw(socket, 0xA, frame.payload); continue; } /* ping */
      if (frame.opcode === 0xA) continue;                                /* pong  */
      if (frame.opcode !== 0x1) continue;                                /* text only */

      if (frame.payload.length > MAX_MESSAGE) { closeClient(client); return; }
      handleMessage(client, frame.payload.toString('utf8'));
    }
  });

  socket.on('error', () => closeClient(client));
  socket.on('close', () => closeClient(client));
});

/* ---------------------------------------------------------------------------
 * Message handling.
 *
 * Only 'hello' is interpreted; everything else is relayed verbatim to the rest
 * of the room. Payloads are never trusted or inspected -- the clients validate
 * what they receive (see the `handle` function in src/game/net.js).
 * ------------------------------------------------------------------------ */
function handleMessage(client, text) {
  let msg;
  try { msg = JSON.parse(text); } catch (e) { return; }
  if (!msg || typeof msg !== 'object') return;

  if (msg.t === 'hello') {
    const room = sanitiseRoom(msg.room);
    if (!room) { send(client, { t: 'error', why: 'Bad room code.' }); return; }
    joinRoom(client, room);
    return;
  }

  if (!client.room) return;
  msg.by = client.id;                       /* the relay stamps identity */
  broadcast(client.room, msg, client);
}

function sanitiseRoom(code) {
  if (typeof code !== 'string') return null;
  const c = code.trim().toUpperCase();
  return /^[A-Z0-9]{3,12}$/.test(c) ? c : null;
}

function joinRoom(client, room) {
  let set = rooms.get(room);
  if (!set) { set = new Set(); rooms.set(room, set); }
  if (set.size >= MAX_ROOM_SIZE) {
    send(client, { t: 'error', why: 'That room is full.' });
    return;
  }
  client.room = room;
  set.add(client);

  const ids = [...set].map((c) => c.id);
  /* Everyone in the room learns the new membership; each is told which id
   * is theirs so the clients can agree on ownership without negotiating. */
  for (const peer of set) {
    send(peer, { t: 'peers', ids, you: peer.id });
  }
  log(`${client.id} joined ${room} (${set.size} in room)`);
}

function broadcast(room, msg, except) {
  const set = rooms.get(room);
  if (!set) return;
  const payload = JSON.stringify(msg);
  for (const peer of set) {
    if (peer === except) continue;
    sendText(peer.socket, payload);
  }
}

function send(client, msg) { sendText(client.socket, JSON.stringify(msg)); }

function closeClient(client) {
  if (!client.alive) return;
  client.alive = false;
  try { client.socket.destroy(); } catch (e) { /* already gone */ }

  if (client.room) {
    const set = rooms.get(client.room);
    if (set) {
      set.delete(client);
      if (set.size === 0) rooms.delete(client.room);
      else {
        const ids = [...set].map((c) => c.id);
        for (const peer of set) send(peer, { t: 'peers', ids, you: peer.id });
      }
    }
    log(`${client.id} left ${client.room}`);
  }
}

/* ---------------------------------------------------------------------------
 * RFC 6455 framing, only as much as is needed.
 * ------------------------------------------------------------------------ */
function decodeFrame(buf) {
  if (buf.length < 2) return null;

  const b0 = buf[0], b1 = buf[1];
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let len = b1 & 0x7f;
  let offset = 2;

  if (len === 126) {
    if (buf.length < offset + 2) return null;
    len = buf.readUInt16BE(offset);
    offset += 2;
  } else if (len === 127) {
    if (buf.length < offset + 8) return null;
    const hi = buf.readUInt32BE(offset);
    const lo = buf.readUInt32BE(offset + 4);
    /* Anything needing the high word is far past our size cap anyway. */
    if (hi !== 0) return { consumed: buf.length, opcode: 0x8, payload: Buffer.alloc(0) };
    len = lo;
    offset += 8;
  }

  /* A client MUST mask its frames; an unmasked one is a protocol error. */
  let mask = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    mask = buf.slice(offset, offset + 4);
    offset += 4;
  }

  if (buf.length < offset + len) return null;
  const payload = Buffer.from(buf.slice(offset, offset + len));
  if (mask) {
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  }
  return { consumed: offset + len, opcode, payload };
}

function sendText(socket, str) {
  sendRaw(socket, 0x1, Buffer.from(str, 'utf8'));
}

function sendRaw(socket, opcode, payload) {
  if (!socket.writable) return;
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  header[0] = 0x80 | opcode;      /* FIN + opcode; server frames are unmasked */
  try { socket.write(Buffer.concat([header, payload])); } catch (e) { /* dropped */ }
}

/* Drop clients that have gone quiet, so rooms do not leak. */
setInterval(() => {
  const now = Date.now();
  for (const set of rooms.values()) {
    for (const client of set) {
      if (now - client.lastSeen > IDLE_TIMEOUT_MS) closeClient(client);
      else sendRaw(client.socket, 0x9, Buffer.alloc(0));    /* ping */
    }
  }
}, 30000);

function log(msg) {
  process.stdout.write('[relay] ' + new Date().toISOString() + '  ' + msg + '\n');
}

server.listen(PORT, () => {
  log('listening on ws://localhost:' + PORT);
  log('health check: http://localhost:' + PORT + '/health');
  log('point the game\'s Multiplayer panel at this address');
});
