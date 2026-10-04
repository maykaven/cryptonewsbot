// Backtest: does news sentiment line up with, or predict, BTC price moves?
//
// Scores ~3 months of archived headlines with the built-in engine and compares
// them against hourly BTC-USD candles (see history.js for the data sources).
//
//   node scripts/backtest.js [days=90]

import { ARCHIVES, H, DAY, iso, loadHistory } from './history.js';
import { moodIndex } from '../lib/stats.js';

const DAYS = Number(process.argv[2]) || 90;

// ── Stats helpers ──
function pearson(a, b) {
  const p = [];
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]) && Number.isFinite(b[i])) p.push([a[i], b[i]]);
  const n = p.length;
  const mx = p.reduce((s, [x]) => s + x, 0) / n;
  const my = p.reduce((s, [, y]) => s + y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of p) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return { r: sxy / Math.sqrt(sxx * syy), n };
}
// Pairs a[t] with b[t+k].
function lagged(a, b, k) {
  const xa = [], xb = [];
  for (let t = 0; t < a.length; t++) if (t + k >= 0 && t + k < b.length) { xa.push(a[t]); xb.push(b[t + k]); }
  return pearson(xa, xb);
}
// Circular-shift p-value: share of time-shifted copies that correlate at least as strongly.
// Preserves each series' autocorrelation, unlike a plain shuffle.
function shiftP(a, b, minShift) {
  const r0 = Math.abs(pearson(a, b).r);
  let hits = 0, total = 0;
  for (let k = minShift; k <= a.length - minShift; k += Math.max(1, Math.floor(a.length / 400))) {
    total++;
    if (Math.abs(pearson(a, b.map((_, i) => b[(i + k) % b.length])).r) >= r0) hits++;
  }
  return hits / total;
}
const fmt = (x, d = 2) => (x >= 0 ? '+' : '') + x.toFixed(d);
const pct = (x) => fmt(x * 100, 1) + '%';

// ── Main ──
const { start, end, items, candles } = await loadHistory(DAYS);

const bySource = Object.fromEntries(ARCHIVES.map((s) => [s.name, items.filter((i) => i.source === s.name).length]));
console.log(`\n${items.length} headlines (${Object.entries(bySource).map(([k, v]) => `${k} ${v}`).join(', ')}), ${candles.length} hourly candles`);
const p0 = candles[0].open, p1 = candles.at(-1).close;
console.log(`BTC: $${p0.toFixed(0)} → $${p1.toFixed(0)} (${pct(p1 / p0 - 1)}), range $${Math.min(...candles.map((c) => c.low)).toFixed(0)}–$${Math.max(...candles.map((c) => c.high)).toFixed(0)}`);

// Hourly series. Signals at hour t only use stories published before the hour closes.
let j = 0;
const hours = candles.map((c) => {
  const close = c.t + H;
  const inHour = [];
  while (j < items.length && items[j].published < close) { if (items[j].published >= c.t) inHour.push(items[j]); j++; }
  return { ...c, ret: c.close / c.open - 1, flow: inHour.reduce((s, i) => s + i.score * i.impact, 0), n: inHour.length };
});
// Mood index at each hour close (same decay/weighting as the live site), computed incrementally over a 24h window.
let lo = 0;
for (const h of hours) {
  const close = h.t + H;
  while (lo < items.length && items[lo].published < close - DAY) lo++;
  let hi = lo;
  while (hi < items.length && items[hi].published < close) hi++;
  h.mood = moodIndex(items.slice(lo, hi), close) ?? 0;
}

const ret = hours.map((h) => h.ret);
const flow = hours.map((h) => h.flow);
const mood = hours.map((h) => h.mood);

console.log('\n── 1. Hourly: news flow at hour t vs BTC return at hour t+k ──');
console.log('   (k<0: price moved first, news followed · k=0 same hour · k>0: news first, price followed)');
const ks = [-24, -12, -6, -3, -2, -1, 0, 1, 2, 3, 6, 12, 24];
console.log('   k  ' + ks.map((k) => String(k).padStart(7)).join(''));
console.log('   r  ' + ks.map((k) => fmt(lagged(flow, ret, k).r).padStart(7)).join(''));
console.log(`   5% significance for n=${hours.length}: |r| > ${(1.96 / Math.sqrt(hours.length)).toFixed(3)}`);
const sumNext = (arr, from, n) => arr.slice(from, from + n).reduce((p, r) => p * (1 + r), 1) - 1;
const fwd = (n) => hours.map((_, i) => (i + n < hours.length ? sumNext(ret, i + 1, n) : NaN));
const back = (n) => hours.map((_, i) => (i - n >= 0 ? sumNext(ret, i - n + 1, n) : NaN));

console.log('\n── 2. Mood index (as shown on the site) vs BTC returns ──');
for (const [label, series, minShift] of [
  ['past 24h return  (does mood reflect price?)', back(24), 48],
  ['next 1h return   (does mood predict?)', fwd(1), 48],
  ['next 4h return', fwd(4), 48],
  ['next 24h return', fwd(24), 48],
]) {
  const { r, n } = pearson(mood, series);
  console.log(`   ${label.padEnd(46)} r=${fmt(r, 3)}  n=${n}  shift-test p=${shiftP(mood, series.map((x) => (Number.isFinite(x) ? x : 0)), minShift).toFixed(3)}`);
}

console.log('\n── 3. Daily ──');
const days = [];
for (let t = start; t + DAY <= end; t += DAY) {
  const dh = hours.filter((h) => h.t >= t && h.t < t + DAY);
  if (dh.length < 20) continue;
  const di = items.filter((i) => i.published >= t && i.published < t + DAY);
  const w = di.reduce((s, i) => s + i.impact, 0);
  days.push({ t, ret: dh.at(-1).close / dh[0].open - 1, mood: w ? di.reduce((s, i) => s + i.score * i.impact, 0) / w : 0, n: di.length });
}
const dRet = days.map((d) => d.ret);
const dMood = days.map((d) => d.mood);
console.log(`   ${days.length} days, avg ${(items.length / days.length).toFixed(0)} headlines/day`);
console.log(`   day's mood vs same-day return   r=${fmt(pearson(dMood, dRet).r, 3)}`);
console.log(`   day's mood vs NEXT-day return   r=${fmt(lagged(dMood, dRet, 1).r, 3)}`);
console.log(`   day's return vs NEXT-day mood   r=${fmt(lagged(dRet, dMood, 1).r, 3)}`);
console.log(`   5% significance for n=${days.length}: |r| > ${(1.96 / Math.sqrt(days.length)).toFixed(3)}`);
const q = [...dMood].sort((a, b) => a - b);
const lowCut = q[Math.floor(q.length / 3)], highCut = q[Math.floor((2 * q.length) / 3)];
const nextDayBy = (pred) => {
  const r = days.slice(0, -1).map((d, i) => [d, days[i + 1].ret]).filter(([d]) => pred(d.mood)).map(([, r]) => r);
  return { n: r.length, avg: r.reduce((s, x) => s + x, 0) / r.length, up: r.filter((x) => x > 0).length / r.length };
};
for (const [label, pred] of [['most bearish third', (m) => m <= lowCut], ['middle third', (m) => m > lowCut && m < highCut], ['most bullish third', (m) => m >= highCut]]) {
  const s = nextDayBy(pred);
  console.log(`   next day after ${label.padEnd(19)} avg ${pct(s.avg).padStart(6)}  BTC up ${(s.up * 100).toFixed(0)}% of days  (n=${s.n})`);
}

console.log('\n── 4. Trading rule: hold BTC while the mood index is above a threshold, else cash ──');
console.log('   (enter/exit at the next hour, 0.1% cost per trade; compare to just holding BTC)');
console.log('   "luck" = where the result ranks among the same rule run on time-shifted copies of the signal');
const holdRet = p1 / p0 - 1;
function runRule(signal) {
  let eq = 1, inPos = false, trades = 0, hoursIn = 0;
  for (let i = 0; i < hours.length - 1; i++) {
    if (signal[i] !== inPos) { eq *= 1 - 0.001; trades++; inPos = signal[i]; }
    if (inPos) { eq *= 1 + hours[i + 1].ret; hoursIn++; }
  }
  return { ret: eq - 1, trades, exposure: hoursIn / (hours.length - 1) };
}
for (const th of [-10, 0, 5, 10]) {
  const signal = mood.map((m) => m > th);
  const res = runRule(signal);
  const shifted = [];
  for (let k = 72; k < signal.length - 72; k += 24) shifted.push(runRule(signal.map((_, i) => signal[(i + k) % signal.length])).ret);
  const beat = shifted.filter((r) => r < res.ret).length / shifted.length;
  console.log(`   mood > ${String(th).padStart(3)}: ${pct(res.ret).padStart(7)}  (in market ${(res.exposure * 100).toFixed(0)}% of hours, ${res.trades} trades; beats ${(beat * 100).toFixed(0)}% of shifted copies)`);
}
console.log(`   buy & hold:  ${pct(holdRet).padStart(7)}`);

const top = [...items].sort((a, b) => Math.abs(b.score * b.impact) - Math.abs(a.score * a.impact)).slice(0, 8);
console.log('\n── Biggest-scored headlines and what BTC did next 24h ──');
for (const it of top) {
  const i = hours.findIndex((h) => h.t + H > it.published);
  const after = i >= 0 && i + 24 < hours.length ? hours[i + 24].close / hours[i].close - 1 : NaN;
  const before = i >= 24 ? hours[i].close / hours[i - 24].close - 1 : NaN;
  console.log(`   ${fmt(it.score, 0).padStart(4)}  ${iso(it.published).slice(0, 10)}  prior 24h ${pct(before).padStart(6)}  next 24h ${pct(after).padStart(6)}  ${it.title.slice(0, 70)}`);
}
