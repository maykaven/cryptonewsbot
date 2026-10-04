// Aggregate metrics derived from scored news items.

import { labelFor } from './sentiment.js';

const HOUR = 3600_000;
const HALF_LIFE = 6 * HOUR; // a story's influence on the mood index halves every 6h

// Time-decayed, impact-weighted average of scores. Returns null when no data.
export function moodIndex(items, now = Date.now(), windowMs = 24 * HOUR) {
  let sum = 0;
  let wsum = 0;
  for (const it of items) {
    const age = now - it.published;
    if (age < 0 || age > windowMs) continue;
    const w = it.impact * Math.pow(0.5, age / HALF_LIFE);
    sum += it.score * w;
    wsum += w;
  }
  return wsum > 0 ? Math.round(sum / wsum) : null;
}

export function computeStats(items, now = Date.now()) {
  const day = items.filter((it) => now - it.published <= 24 * HOUR);
  const mood = moodIndex(items, now);
  const moodPrev = moodIndex(items, now - 6 * HOUR);

  const counts = { bullish: 0, neutral: 0, bearish: 0 };
  for (const it of day) {
    if (it.score >= 12) counts.bullish++;
    else if (it.score <= -12) counts.bearish++;
    else counts.neutral++;
  }

  // Hourly mood for the last 48h (each point = the mood index as of that hour).
  const trend = [];
  const endHour = Math.floor(now / HOUR) * HOUR;
  for (let t = endHour - 47 * HOUR; t <= endHour; t += HOUR) {
    const at = Math.min(t + HOUR, now);
    const recent = items.filter((it) => it.published <= at);
    const inHour = items.filter((it) => it.published > t && it.published <= t + HOUR).length;
    trend.push({ t, mood: moodIndex(recent, at), count: inHour });
  }

  const coinMap = new Map();
  for (const it of day) {
    for (const c of it.coins) {
      const e = coinMap.get(c) ?? { coin: c, count: 0, sum: 0 };
      e.count++;
      e.sum += it.score;
      coinMap.set(c, e);
    }
  }
  const coins = [...coinMap.values()]
    .map((e) => ({ coin: e.coin, count: e.count, avg: Math.round(e.sum / e.count) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const sorted = [...day].sort((a, b) => b.score - a.score);
  const pick = (it) => it && { id: it.id, title: it.title, score: it.score, link: it.link, source: it.source };

  return {
    mood,
    moodLabel: mood == null ? 'No data' : labelFor(mood),
    moodChange6h: mood != null && moodPrev != null ? mood - moodPrev : null,
    counts,
    total24h: day.length,
    trend,
    coins,
    mostBullish: pick(sorted[0]?.score > 0 ? sorted[0] : null),
    mostBearish: pick(sorted.at(-1)?.score < 0 ? sorted.at(-1) : null),
    updated: now,
  };
}
