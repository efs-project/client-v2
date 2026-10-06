// Serves a built directory as plain static files under an optional path prefix.
// No SPA fallback, no proxy, no rewriting: if this works, a dumb static host works.
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'apps/web/dist' },
    prefix: { type: 'string', default: '/' },
    port: { type: 'string', default: '0' },
    host: { type: 'string', default: '127.0.0.1' },
  },
});

const root = resolve(values.dir);
const prefix = values.prefix.endsWith('/') ? values.prefix : `${values.prefix}/`;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

const server = createServer(async (req, res) => {
  const send = (status: number, body = '') => {
    res.writeHead(status, {
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff',
    });
    res.end(body);
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(405);
  const url = new URL(req.url ?? '/', 'http://local');
  if (!url.pathname.startsWith(prefix)) return send(404, 'not found');
  let relative: string;
  try {
    relative = decodeURIComponent(url.pathname.slice(prefix.length));
  } catch {
    return send(400);
  }
  if (relative === '' || relative.endsWith('/')) relative += 'index.html';
  const file = resolve(root, relative);
  if (file !== root && !file.startsWith(root + sep)) return send(404, 'not found');
  try {
    if (!(await stat(file)).isFile()) return send(404, 'not found');
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
      'content-length': body.length,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    send(404, 'not found');
  }
});

server.listen(Number(values.port), values.host, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : values.port;
  console.log(
    JSON.stringify({ event: 'listening', url: `http://${values.host}:${port}${prefix}` }),
  );
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => server.close(() => process.exit(0)));
