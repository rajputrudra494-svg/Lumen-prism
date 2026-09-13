/* =============================================================================
 * Lumen Path - tools/serve.js
 * -----------------------------------------------------------------------------
 * A static file server for development.
 *
 *     node tools/serve.js            http://localhost:8123
 *     PORT=9000 node tools/serve.js
 *
 * The game does not need a server -- index.html opens straight off the
 * filesystem. This exists for the edit-reload loop, and its one real job is
 * sending `Cache-Control: no-store` so a browser never hands you a stale copy
 * of a script you just changed. (Python's http.server does not, which will
 * quietly cost you an afternoon.)
 *
 * Zero dependencies, and it refuses to serve anything outside the project root.
 * ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8123;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';

  /* Resolve, then confirm the result is still inside the project. This is the
   * check that stops "/../../etc/passwd" and its many spellings. */
  const full = path.resolve(ROOT, '.' + rel);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    res.writeHead(403, { 'content-type': 'text/plain' });
    res.end('Forbidden\n');
    return;
  }

  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found: ' + rel + '\n');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'content-length': st.size,
      /* The whole point of this file. */
      'cache-control': 'no-store, must-revalidate',
      'pragma': 'no-cache'
    });
    fs.createReadStream(full).pipe(res);
  });
});

server.listen(PORT, () => {
  process.stdout.write('Lumen Path dev server: http://localhost:' + PORT + '\n');
  process.stdout.write('Serving ' + ROOT + ' with caching disabled.\n');
});
