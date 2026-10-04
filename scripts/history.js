// Historical data for research scripts: headlines from news sites that expose a
// WordPress archive API, plus hourly BTC-USD candles from Coinbase.
// Downloads are cached in data/backtest/ and reused for the same start date.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeSentiment, detectCoins, marketImpact } from '../lib/sentiment.js';
import { cleanText } from '../lib/feeds.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(root, 'data', 'backtest');
export const H = 3600_000;
export const DAY = 24 * H;

// Sources from the live feed list whose full archives are publicly queryable.
export const ARCHIVES = [
  { id: 'bitcoinist', name: 'Bitcoinist', base: 'https://bitcoinist.com' },
  { id: 'newsbtc', name: 'NewsBTC', base: 'https://www.newsbtc.com' },
  { id: 'cryptopotato', name: 'CryptoPotato', base: 'https://cryptopotato.com' },
];

export const iso = (t) => new Date(t).toISOString().replace(/\.\d+Z$/, 'Z');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (CryptoNewsBot backtest)' }, signal: AbortSignal.timeout(30000) });
      if (res.status === 400) return { data: [], headers: res.headers }; // WP: page past the end
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { data: await res.json(), headers: res.headers };
    } catch (err) {
      if (i >= tries) throw new Error(`${url}: ${err.message}`);
      await sleep(2000 * i);
    }
  }
}

async function cached(name, fn) {
  const file = path.join(CACHE, name);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const data = await fn();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
  return data;
}

async function fetchArchive(src, start, end) {
  const posts = [];
  for (let page = 1; ; page++) {
    const url = `${src.base}/wp-json/wp/v2/posts?per_page=100&page=${page}&orderby=date&order=asc` +
      `&after=${iso(start)}&before=${iso(end)}&_fields=date_gmt,title,excerpt,link`;
    const { data, headers } = await getJSON(url);
    posts.push(...data);
    const pages = Number(headers.get('x-wp-totalpages')) || 1;
    process.stdout.write(`\r  ${src.name}: page ${page}/${pages} (${posts.length} posts)   `);
    if (page >= pages || data.length === 0) break;
    await sleep(400);
  }
  process.stdout.write('\n');
  return posts.map((p) => ({
    source: src.name,
    published: Date.parse(p.date_gmt + 'Z'),
    title: cleanText(p.title?.rendered ?? '', 300),
    description: cleanText(p.excerpt?.rendered ?? ''),
    link: p.link,
  }));
}

async function fetchCandles(start, end) {
  const out = [];
  for (let t = start; t < end; t += 300 * H) {
    const to = Math.min(t + 300 * H, end);
    const url = `https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=3600&start=${iso(t)}&end=${iso(to - H)}`;
    const { data } = await getJSON(url);
    for (const [ts, low, high, open, close, volume] of data) out.push({ t: ts * 1000, open, close, low, high, volume });
    await sleep(300);
  }
  return [...new Map(out.map((c) => [c.t, c])).values()].sort((a, b) => a.t - b.t).filter((c) => c.t >= start && c.t < end);
}

// Returns { start, end, items (scored, de-duplicated, oldest first), candles }.
export async function loadHistory(days) {
  const start = Math.floor((Date.now() - days * DAY) / DAY) * DAY;
  // Reuse an earlier download with the same start date so repeated runs line up.
  const prefix = `btc_${iso(start).slice(0, 10)}_`;
  const prior = fs.existsSync(CACHE) ? fs.readdirSync(CACHE).filter((f) => f.startsWith(prefix)).sort().at(-1) : null;
  const tag = prior ? prior.slice(4, -5) : `${iso(start).slice(0, 10)}_${iso(Math.floor(Date.now() / H) * H).slice(0, 13)}`;
  const end = Date.parse(tag.slice(11) + ':00:00Z');

  console.log(`Window: ${iso(start)} → ${iso(end)} (${days} days)${prior ? ' — using cached download' : ''}`);
  const raw = [];
  for (const src of ARCHIVES) {
    try {
      raw.push(...(await cached(`${src.id}_${tag}.json`, () => fetchArchive(src, start, end))));
    } catch (err) {
      console.warn(`  ${src.name} failed: ${err.message}`);
    }
  }
  const candles = await cached(`btc_${tag}.json`, () => fetchCandles(start, end));

  const seen = new Set();
  const items = raw
    .filter((it) => it.title && Number.isFinite(it.published) && it.published >= start && it.published < end)
    .filter((it) => { const k = it.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .map((it) => {
      const text = `${it.title} ${it.description}`;
      const coins = detectCoins(text);
      return { ...it, coins, impact: marketImpact(text, coins), score: analyzeSentiment(it.title, it.description).score };
    })
    .sort((a, b) => a.published - b.published);

  return { start, end, items, candles };
}
