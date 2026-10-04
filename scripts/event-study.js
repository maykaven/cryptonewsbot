// Event study: which kinds of news are followed by bigger BTC moves?
//
// For every BTC-relevant headline, compares how much BTC moved in the hours BEFORE it
// was published with how much it moved AFTER. News that drives price should be
// followed by unusually large moves; news that just reports price moves shows the
// big move beforehand.
//
//   node scripts/event-study.js [days=90]

import { H, iso, loadHistory } from './history.js';
import { CATEGORIES, categorize } from '../lib/categories.js';

const DAYS = Number(process.argv[2]) || 90;
const DECLUSTER = 6 * H; // count a burst of same-type headlines as one event
const SIMS = 2000;

const { items, candles } = await loadHistory(DAYS);
const hourIdx = new Map(candles.map((c, i) => [c.t, i]));

// Return over hours i+from .. i+to (inclusive), relative to the hour i that contains the headline.
function move(i, from, to) {
  const a = i + from, b = i + to;
  if (a < 0 || b >= candles.length) return NaN;
  return candles[b].close / candles[a].open - 1;
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const valid = (i) => i >= 24 && i + 24 < candles.length;
const allHours = candles.map((_, i) => i).filter(valid);
const base4 = mean(allHours.map((i) => Math.abs(move(i, 1, 4))));
const base24 = mean(allHours.map((i) => Math.abs(move(i, 1, 24))));
const drift24 = mean(allHours.map((i) => move(i, 1, 24)));
// BTC is much more volatile at some hours (US open, data releases), so every comparison
// is made against hours at the same time of day.
const utcHour = (i) => new Date(candles[i].t).getUTCHours();
const byHour = Array.from({ length: 24 }, (_, h) => allHours.filter((i) => utcHour(i) === h));
const hourMean = (fn) => byHour.map((hs) => mean(hs.map(fn)));
const todBefore4 = hourMean((i) => Math.abs(move(i, -4, -1)));
const todAfter4 = hourMean((i) => Math.abs(move(i, 1, 4)));
const todAfter24 = hourMean((i) => Math.abs(move(i, 1, 24)));

// BTC-relevant: mentions BTC or isn't about a specific coin (altcoin news rarely moves BTC).
const events = items
  .filter((it) => it.coins.includes('BTC') || it.coins.length === 0)
  .map((it) => ({ ...it, ...categorize(it.title), i: hourIdx.get(Math.floor(it.published / H) * H) }))
  .filter((e) => e.i !== undefined && valid(e.i));

function decluster(list) {
  const out = [];
  let last = -Infinity;
  for (const e of list) if (e.published - last >= DECLUSTER) { out.push(e); last = e.published; }
  return out;
}

// Random-time benchmark: how often do the same number of random hours show at least
// this big an average move after them / this much directional edge?
// Random hours matched to each event's time of day.
function randomHoursLike(ev) {
  return ev.map((e) => { const hs = byHour[utcHour(e.i)]; return hs[Math.floor(Math.random() * hs.length)]; });
}

function analyze(list) {
  const ev = decluster(list);
  const n = ev.length;
  if (n < 8) return null;
  // Ratios vs the typical move at the same time of day (1.00 = normal).
  const before = mean(ev.map((e) => Math.abs(move(e.i, -4, -1)) / todBefore4[utcHour(e.i)]));
  const after = mean(ev.map((e) => Math.abs(move(e.i, 1, 4)) / todAfter4[utcHour(e.i)]));
  const after24 = mean(ev.map((e) => Math.abs(move(e.i, 1, 24)) / todAfter24[utcHour(e.i)]));
  let pAfter = 0;
  for (let s = 0; s < SIMS; s++) {
    const r = randomHoursLike(ev);
    if (mean(r.map((i) => Math.abs(move(i, 1, 4)) / todAfter4[utcHour(i)])) >= after) pAfter++;
  }

  // Direction: did BTC go the way the headline's sentiment pointed (beyond normal drift)?
  const dir = ev.filter((e) => Math.abs(e.score) >= 12);
  let edge = NaN, hit = NaN, pDir = NaN;
  if (dir.length >= 8) {
    const signed = dir.map((e) => Math.sign(e.score) * (move(e.i, 1, 24) - drift24));
    edge = mean(signed);
    hit = dir.filter((e) => Math.sign(move(e.i, 1, 24) - drift24) === Math.sign(e.score)).length / dir.length;
    let beat = 0;
    for (let s = 0; s < SIMS; s++) {
      const r = randomHoursLike(dir);
      if (mean(dir.map((e, k) => Math.sign(e.score) * (move(r[k], 1, 24) - drift24))) >= edge) beat++;
    }
    pDir = beat / SIMS;
  }
  return { n, before, after, after24, pAfter: pAfter / SIMS, nDir: dir.length, edge, hit, pDir };
}

const fmtX = (x) => (Number.isFinite(x) ? x.toFixed(2) + '×' : '  –  ');
const fmtP = (p) => (Number.isFinite(p) ? (p < 0.001 ? '<0.001' : p.toFixed(3)) : '   –  ');
const fmtPct = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%' : '   –  ');

function printTable(title, rows) {
  console.log(`\n${title}`);
  console.log('   ' + 'type'.padEnd(30) + 'events  move before  move after (4h)   p    after 24h │ dir. calls  hit rate  edge/24h    p');
  for (const [label, r] of rows) {
    if (!r) { console.log(`   ${label.padEnd(30)}(too few events)`); continue; }
    console.log(
      `   ${label.padEnd(30)}${String(r.n).padStart(6)}  ${fmtX(r.before).padStart(11)}  ${fmtX(r.after).padStart(15)} ${fmtP(r.pAfter).padStart(6)}  ${fmtX(r.after24).padStart(9)} │ ` +
      `${String(r.nDir).padStart(10)}  ${Number.isFinite(r.hit) ? (r.hit * 100).toFixed(0).padStart(7) + '%' : '       –'}  ${fmtPct(r.edge).padStart(8)}  ${fmtP(r.pDir).padStart(6)}`,
    );
  }
}

console.log(`\n${events.length} BTC-relevant headlines; typical BTC move: ${(base4 * 100).toFixed(2)}% per 4h, ${(base24 * 100).toFixed(2)}% per 24h`);
console.log('Move columns compare to a typical hour at the same time of day (1.00× = normal).');
console.log('p = chance that random same-time-of-day hours do at least as well (many rows are tested, so expect a few p<0.05 by luck).');
console.log('Bursts of same-type headlines within 6h count as one event.');

printTable('── By kind of story ──', [
  ['Catalyst (has a news category)', analyze(events.filter((e) => e.kind === 'catalyst'))],
  ['Price recap', analyze(events.filter((e) => e.kind === 'price'))],
  ['Forecast / analysis', analyze(events.filter((e) => e.kind === 'forecast'))],
  ['Other', analyze(events.filter((e) => e.kind === 'other'))],
  ['All headlines', analyze(events)],
]);

printTable('── By news category ──', CATEGORIES.map((c) => [c.label, analyze(events.filter((e) => e.categories.includes(c.id)))]));

// Strongest-sentiment catalysts only
printTable('── Strong-sentiment catalysts only (|score| ≥ 40) ──', [
  ['Strong catalysts', analyze(events.filter((e) => e.kind === 'catalyst' && Math.abs(e.score) >= 40))],
  ['Strong price recaps/forecasts', analyze(events.filter((e) => e.kind !== 'catalyst' && Math.abs(e.score) >= 40))],
]);

console.log('\n── Headlines followed by the biggest 4h BTC moves ──');
const biggest = [...events].sort((a, b) => Math.abs(move(b.i, 1, 4)) - Math.abs(move(a.i, 1, 4)));
const shown = new Set();
for (const e of biggest) {
  if (shown.size >= 12) break;
  if ([...shown].some((t) => Math.abs(t - e.published) < 12 * H)) continue;
  shown.add(e.published);
  console.log(`   ${iso(e.published).slice(0, 13)}  before ${fmtPct(move(e.i, -4, -1)).padStart(7)}  after ${fmtPct(move(e.i, 1, 4)).padStart(7)}  [${(e.categories.join(',') || e.kind).padEnd(18)}] ${String(e.score).padStart(4)}  ${e.title.slice(0, 75)}`);
}
