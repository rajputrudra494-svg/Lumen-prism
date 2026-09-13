/* =============================================================================
 * Lumen Path - tools/test-relay.js
 * -----------------------------------------------------------------------------
 * End-to-end check of server/relay.js: two clients join a room, exchange the
 * message types the game actually sends, and see each other's identities.
 * Start the relay first:  node server/relay.js
 * ========================================================================== */
'use strict';
const URL = process.env.RELAY || 'ws://localhost:8787';
const ROOM = 'TEST1';

let pass = 0, fail = 0;
const notes = [];
function ok(name, cond, detail) {
  if (cond) pass++; else { fail++; notes.push(name + (detail ? ' -> ' + detail : '')); }
}

function open(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.inbox = [];
    ws.addEventListener('message', (e) => {
      try { ws.inbox.push(JSON.parse(e.data)); } catch (err) { /* ignore */ }
    });
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', () => reject(new Error('could not connect to ' + URL)));
    setTimeout(() => reject(new Error('timed out connecting to ' + URL)), 4000);
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let a, b;
  try {
    a = await open('A');
    b = await open('B');
  } catch (e) {
    console.log('\n  relay test\n  ----------');
    console.log('  SKIPPED: ' + e.message);
    console.log('  Start it with:  node server/relay.js\n');
    process.exit(0);
  }

  a.send(JSON.stringify({ t: 'hello', room: ROOM, name: 'A' }));
  await wait(150);
  b.send(JSON.stringify({ t: 'hello', room: ROOM, name: 'B' }));
  await wait(250);

  const aPeers = a.inbox.filter((m) => m.t === 'peers').pop();
  const bPeers = b.inbox.filter((m) => m.t === 'peers').pop();
  ok('both clients receive a peer list', !!aPeers && !!bPeers);
  ok('the room holds both players', aPeers && aPeers.ids.length === 2,
     aPeers ? JSON.stringify(aPeers.ids) : 'none');
  ok('each client is told its own id', aPeers && bPeers && aPeers.you !== bPeers.you,
     aPeers && bPeers ? aPeers.you + ' vs ' + bPeers.you : '');

  /* A placement from A must reach B, stamped with A's id, and must not echo. */
  a.inbox.length = 0; b.inbox.length = 0;
  a.send(JSON.stringify({ t: 'place', id: 'm1', type: 'mirror', x: 700, y: 240, props: {} }));
  await wait(200);
  const got = b.inbox.find((m) => m.t === 'place');
  ok('a placement reaches the other player', !!got);
  ok('the relay stamps the sender id', got && got.by === aPeers.you, got ? got.by : '');
  ok('the sender does not receive its own message', !a.inbox.some((m) => m.t === 'place'));
  ok('payload survives intact', got && got.x === 700 && got.y === 240 && got.type === 'mirror');

  /* A large message (a share code is the biggest thing the game sends). */
  a.inbox.length = 0; b.inbox.length = 0;
  const big = 'x'.repeat(20000);
  a.send(JSON.stringify({ t: 'start', levelCode: big }));
  await wait(300);
  const gotBig = b.inbox.find((m) => m.t === 'start');
  ok('a 20KB message survives framing', gotBig && gotBig.levelCode.length === 20000,
     gotBig ? String(gotBig.levelCode.length) : 'not received');

  /* Rooms are isolated. */
  const c = await open('C');
  c.send(JSON.stringify({ t: 'hello', room: 'OTHER', name: 'C' }));
  await wait(200);
  c.inbox.length = 0;
  a.send(JSON.stringify({ t: 'move', id: 'm1', x: 1, y: 2 }));
  await wait(200);
  ok('rooms are isolated', !c.inbox.some((m) => m.t === 'move'));

  /* A bad room code is refused. */
  const d = await open('D');
  d.send(JSON.stringify({ t: 'hello', room: 'no lowercase or spaces!' }));
  await wait(200);
  ok('a malformed room code is refused', d.inbox.some((m) => m.t === 'error'));

  /* Leaving updates the remaining players. */
  b.inbox.length = 0;
  a.close();
  await wait(300);
  const after = b.inbox.filter((m) => m.t === 'peers').pop();
  ok('the peer list updates when someone leaves', after && after.ids.length === 1,
     after ? JSON.stringify(after.ids) : 'no update');

  [b, c, d].forEach((s) => { try { s.close(); } catch (e) {} });

  console.log('\n  relay test');
  console.log('  ----------');
  notes.forEach((n) => console.log('  FAIL  ' + n));
  console.log(`  ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
})();
