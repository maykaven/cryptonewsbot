import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { FEEDS, fetchFeed } from './lib/feeds.js';
import { analyzeSentiment, detectCoins, marketImpact, labelFor } from './lib/sentiment.js';
import { computeStats } from './lib/stats.js';
import { initAI, aiStatus, scoreWithAI } from './lib/ai.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(here, 'public');
const DATA_DIR = path.join(here, 'data');
const DATA_FILE = path.join(DATA_DIR, 'news.json');

const PORT = Number(process.env.PORT) || 3000;
const POLL_SECONDS = Math.max(20, Number(process.env.POLL_SECONDS) || 60);
const MAX_AGE = 7 * 24 * 3600_000;
const MAX_ITEMS = 1500;
const AI_WINDOW = 24 * 3600_000; // only spend AI calls on stories from the last day
const AI_MAX_ATTEMPTS = 2;

/** @type {Map<string, any>} */
const store = new Map();
const titleIndex = new Set();
const feedStatus = Object.fromEntries(
  FEEDS.map((f) => [f.id, { name: f.name, ok: null, lastSuccess: null, error: null, items: 0 }]),
);
const clients = new Set();
let lastPoll = null;
let polling = false;

// ── Helpers ──
const normTitle = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const makeId = (link) => crypto.createHash('sha1').update(link.replace(/[?#].*$/, '')).digest('hex').slice(0, 12);

function applyScore(item) {
  const useAI = Number.isFinite(item.aiScore);
  item.score = useAI ? item.aiScore : item.lexScore;
  item.label = labelFor(item.score);
  item.scoredBy = useAI ? 'ai' : 'lexicon';
  return item;
}

function sortedItems() {
  return [...store.values()].sort((a, b) => b.published - a.published);
}

function addItem(raw, feed, now) {
  const id = makeId(raw.link);
  const nt = normTitle(raw.title);
  if (store.has(id) || titleIndex.has(nt)) return null;
  const published = raw.published > now + 5 * 60_000 ? now : raw.published;
  if (now - published > MAX_AGE) return null;

  const text = `${raw.title} ${raw.description}`;
  const coins = detectCoins(text);
  const s = analyzeSentiment(raw.title, raw.description);
  const item = applyScore({
    id,
    title: raw.title,
    description: raw.description,
    link: raw.link,
    image: raw.image,
    source: feed.name,
    sourceId: feed.id,
    published,
    fetched: now,
    coins,
    impact: marketImpact(text, coins),
    lexScore: s.score,
    drivers: s.drivers,
    aiAttempts: 0,
  });
  store.set(id, item);
  titleIndex.add(nt);
  return item;
}

function prune(now) {
  const items = sortedItems();
  items.forEach((it, i) => {
    if (i >= MAX_ITEMS || now - it.published > MAX_AGE) {
      store.delete(it.id);
      titleIndex.delete(normTitle(it.title));
    }
  });
}

// ── Persistence ──
function load() {
  try {
    const items = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const it of items) {
      store.set(it.id, applyScore(it));
      titleIndex.add(normTitle(it.title));
    }
    console.log(`Loaded ${store.size} cached stories`);
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
    fs.writeFileSync(tmp, JSON.stringify(sortedItems()));
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
function statusPayload() {
  return { feeds: feedStatus, ai: aiStatus(), lastPoll, pollSeconds: POLL_SECONDS };
}

// ── Polling ──
async function poll() {
  if (polling) return;
  polling = true;
  const now = Date.now();
  const fresh = [];

  const results = await Promise.allSettled(FEEDS.map((f) => fetchFeed(f)));
  results.forEach((r, i) => {
    const feed = FEEDS[i];
    const st = feedStatus[feed.id];
    if (r.status === 'fulfilled') {
      st.ok = true;
      st.error = null;
      st.lastSuccess = now;
      st.items = r.value.length;
      for (const raw of r.value) {
        const item = addItem(raw, feed, now);
        if (item) fresh.push(item);
      }
    } else {
      st.ok = false;
      st.error = r.reason?.message ?? String(r.reason);
    }
  });

  prune(now);
  lastPoll = now;
  const okCount = Object.values(feedStatus).filter((s) => s.ok).length;
  console.log(`[${new Date(now).toLocaleTimeString()}] ${okCount}/${FEEDS.length} feeds ok, ${fresh.length} new, ${store.size} total`);

  if (fresh.length) {
    fresh.sort((a, b) => b.published - a.published);
    broadcast('items', fresh);
    save();
  }
  broadcast('stats', computeStats([...store.values()]));
  broadcast('status', statusPayload());
  polling = false;

  await runAIScoring();
}

let aiRunning = false;
async function runAIScoring() {
  if (aiRunning || !aiStatus().enabled) return;
  aiRunning = true;
  const now = Date.now();
  const pending = sortedItems().filter(
    (it) => !it.titleZh && it.aiAttempts < AI_MAX_ATTEMPTS && now - it.published < AI_WINDOW,
  );
  pending.forEach((it) => it.aiAttempts++);
  let changed = 0;
  await scoreWithAI(pending, (item, { score, reason, titleZh, summaryZh, reasonZh }) => {
    item.aiScore = score;
    item.aiReason = reason;
    item.titleZh = titleZh;
    item.descZh = summaryZh;
    item.aiReasonZh = reasonZh;
    applyScore(item);
    changed++;
    broadcast('update', item);
  });
  if (changed) {
    console.log(`[ai] scored ${changed} stories with ${aiStatus().model ?? 'Claude'}`);
    broadcast('stats', computeStats([...store.values()]));
    save();
  }
  if (!aiStatus().enabled) broadcast('status', statusPayload());
  aiRunning = false;
}

// ── HTTP ──
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
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
    send(res, 'init', { items: sortedItems(), stats: computeStats([...store.values()]), status: statusPayload() });
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/news') {
    const limit = Math.min(Number(url.searchParams.get('limit')) || 200, MAX_ITEMS);
    return json(res, sortedItems().slice(0, limit));
  }
  if (url.pathname === '/api/stats') return json(res, computeStats([...store.values()]));
  if (url.pathname === '/api/status') return json(res, statusPayload());
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
setInterval(() => broadcast('stats', computeStats([...store.values()])), 5 * 60_000);

load();
await initAI();
const ai = aiStatus();
console.log(ai.enabled ? `Claude scoring: ON (${ai.model})` : `Claude scoring: off — ${ai.reason}; using built-in engine`);

server.listen(PORT, () => {
  console.log(`Crypto News Bot running at http://localhost:${PORT}  (polling every ${POLL_SECONDS}s)`);
  poll();
  setInterval(poll, POLL_SECONDS * 1000);
});
