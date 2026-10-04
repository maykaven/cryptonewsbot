// Builds the static GitHub Pages site: fetches the news once, scores it, and writes
// site/ (the dashboard + data.json). Run on a schedule by .github/workflows/pages.yml.
//
// State carries over between runs by reading the previously published data.json
// from SITE_URL, so stories aren't re-scored (and re-billed) every run.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { NewsPipeline } from '../lib/pipeline.js';
import { initAI, aiStatus } from '../lib/ai.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(root, 'public');
const OUT_DIR = path.join(root, 'site');
const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');
const UPDATE_SECONDS = Number(process.env.UPDATE_SECONDS) || 600;

async function loadPrevious() {
  if (!SITE_URL) {
    console.log('SITE_URL not set — starting with no history');
    return null;
  }
  const res = await fetch(`${SITE_URL}/data.json`, { signal: AbortSignal.timeout(20000), cache: 'no-store' });
  if (res.status === 404) {
    console.log('No published data yet — first build');
    return null;
  }
  // Any other failure aborts the build so a transient error can't wipe the published history.
  if (!res.ok) throw new Error(`Could not load previous data.json: HTTP ${res.status}`);
  return res.json();
}

if (!process.env.ANTHROPIC_API_KEY) process.env.AI_SCORING = 'off';

const news = new NewsPipeline({ pollSeconds: UPDATE_SECONDS });
const prev = await loadPrevious();
if (prev) {
  news.load(prev.items, prev.status?.feeds);
  console.log(`Loaded ${news.store.size} stories from ${SITE_URL}/data.json`);
}

await initAI();
const ai = aiStatus();
console.log(ai.enabled ? `Claude scoring: ON (${ai.model})` : `Claude scoring: off — ${ai.reason}`);

await news.poll();
await news.scoreWithAI();

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const entry of fs.readdirSync(OUT_DIR)) fs.rmSync(path.join(OUT_DIR, entry), { recursive: true, force: true });
fs.cpSync(PUBLIC_DIR, OUT_DIR, { recursive: true });

const indexPath = path.join(OUT_DIR, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8').replace('<meta name="app-mode" content="live" />', '<meta name="app-mode" content="static" />');
if (!html.includes('content="static"')) throw new Error('index.html is missing the app-mode meta tag');
fs.writeFileSync(indexPath, html);

const data = { items: news.items(), stats: news.stats(), status: news.status() };
fs.writeFileSync(path.join(OUT_DIR, 'data.json'), JSON.stringify(data));
fs.writeFileSync(path.join(OUT_DIR, '.nojekyll'), '');

const kb = Math.round(fs.statSync(path.join(OUT_DIR, 'data.json')).size / 1024);
console.log(`Wrote site/ with ${data.items.length} stories (data.json ${kb} KB)`);
