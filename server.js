import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NewsPipeline } from './lib/pipeline.js';
import { initAI, aiStatus } from './lib/ai.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, 'public');
const DATA_DIR = path.join(here, 'data');
const DATA_FILE = path.join(DATA_DIR, 'news.json');

const PORT = Number(process.env.PORT) || 3000;
const POLL_SECONDS = Math.max(20, Number(process.env.POLL_SECONDS) || 60);

const news = new NewsPipeline({ pollSeconds: POLL_SECONDS });
const clients = new Set();

// ── Persistence ──
function load() {
  try {
    news.load(JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')));
    console.log(`Loaded ${news.store.size} cached stories`);
  } catch {
    /* first run */
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(news.items()));
    fs.renameSync(tmp, DATA_FILE);
  }, 2000);
}

// ── Live push (Server-Sent Events) ──
function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
function broadcast(event, data) {
  for (const res of clients) send(res, event, data);
}

// ── Polling ──
async function poll() {
  const fresh = await news.poll();
  if (fresh === null) return; // already polling
  if (fresh.length) {
    broadcast('items', fresh);
    save();
  }
  broadcast('stats', news.stats());
  broadcast('status', news.status());

  const changed = await news.scoreWithAI((item) => broadcast('update', item));
  if (changed) {
    broadcast('stats', news.stats());
    save();
  }
  if (!aiStatus().enabled) broadcast('status', news.status());
}

// ── HTTP ──
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    send(res, 'init', { items: news.items(), stats: news.stats(), status: news.status() });
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/news') {
    const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 1500);
    return json(res, news.items().slice(0, limit));
  }
  if (url.pathname === '/api/stats') return json(res, news.stats());
  if (url.pathname === '/api/status') return json(res, news.status());
  if (url.pathname === '/api/refresh' && req.method === 'POST') {
    poll();
    return json(res, { ok: true });
  }

  const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(buf);
  });
});

// Keep SSE connections alive through proxies
setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 25_000);

// Refresh stats periodically even without new stories (mood decays over time)
setInterval(() => broadcast('stats', news.stats()), 5 * 60_000);

load();
await initAI();
const ai = aiStatus();
console.log(ai.enabled ? `Claude scoring: ON (${ai.model})` : `Claude scoring: off — ${ai.reason}; using built-in engine`);

server.listen(PORT, () => {
  console.log(`Crypto News Bot running at http://localhost:${PORT}  (polling every ${POLL_SECONDS}s)`);
  poll();
  setInterval(poll, POLL_SECONDS * 1000);
});
