// The news pipeline shared by the live server and the static-site builder:
// fetch feeds -> de-duplicate -> score (lexicon, then optionally Claude) -> aggregate.

import crypto from 'node:crypto';

import { FEEDS, fetchFeed } from './feeds.js';
import { analyzeSentiment, detectCoins, marketImpact, labelFor } from './sentiment.js';
import { computeStats } from './stats.js';
import { aiStatus, scoreWithAI } from './ai.js';
import { classify, REACTIVE_WEIGHT } from './categories.js';

const MAX_AGE = 7 * 24 * 3600_000;
const MAX_ITEMS = 1500;
const AI_WINDOW = 24 * 3600_000; // only spend AI calls on stories from the last day
const AI_MAX_ATTEMPTS = 2;

const normTitle = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const makeId = (link) => crypto.createHash('sha1').update(link.replace(/[?#].*$/, '')).digest('hex').slice(0, 12);

// News type + market-impact weight (reactive stories count less in the mood index).
function applyType(item) {
  const text = `${item.title} ${item.description}`;
  Object.assign(item, classify(item.title));
  item.impact = marketImpact(text, item.coins) * (item.reactive ? REACTIVE_WEIGHT : 1);
  return item;
}

function applyScore(item) {
  const useAI = Number.isFinite(item.aiScore);
  item.score = useAI ? item.aiScore : item.lexScore;
  item.label = labelFor(item.score);
  item.scoredBy = useAI ? 'ai' : 'lexicon';
  return item;
}

export class NewsPipeline {
  constructor({ pollSeconds = 60 } = {}) {
    /** @type {Map<string, any>} */
    this.store = new Map();
    this.titleIndex = new Set();
    this.feedStatus = Object.fromEntries(
      FEEDS.map((f) => [f.id, { name: f.name, ok: null, lastSuccess: null, error: null, items: 0 }]),
    );
    this.lastPoll = null;
    this.pollSeconds = pollSeconds;
    this.polling = false;
    this.aiRunning = false;
  }

  load(items, feedStatus) {
    for (const it of items) {
      this.store.set(it.id, applyScore(applyType(it)));
      this.titleIndex.add(normTitle(it.title));
    }
    if (feedStatus) {
      for (const [id, st] of Object.entries(feedStatus)) if (this.feedStatus[id]) Object.assign(this.feedStatus[id], st);
    }
  }

  items() {
    return [...this.store.values()].sort((a, b) => b.published - a.published);
  }

  stats() {
    return computeStats([...this.store.values()]);
  }

  status() {
    return { feeds: this.feedStatus, ai: aiStatus(), lastPoll: this.lastPoll, pollSeconds: this.pollSeconds };
  }

  addItem(raw, feed, now) {
    const id = makeId(raw.link);
    const nt = normTitle(raw.title);
    if (this.store.has(id) || this.titleIndex.has(nt)) return null;
    const published = raw.published > now + 5 * 60_000 ? now : raw.published;
    if (now - published > MAX_AGE) return null;

    const text = `${raw.title} ${raw.description}`;
    const coins = detectCoins(text);
    const s = analyzeSentiment(raw.title, raw.description);
    const item = applyScore(applyType({
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
      lexScore: s.score,
      drivers: s.drivers,
      aiAttempts: 0,
    }));
    this.store.set(id, item);
    this.titleIndex.add(nt);
    return item;
  }

  prune(now) {
    this.items().forEach((it, i) => {
      if (i >= MAX_ITEMS || now - it.published > MAX_AGE) {
        this.store.delete(it.id);
        this.titleIndex.delete(normTitle(it.title));
      }
    });
  }

  // Fetches all feeds once. Returns the new stories (newest first), or null if a poll is already running.
  async poll() {
    if (this.polling) return null;
    this.polling = true;
    const now = Date.now();
    const fresh = [];
    try {
      const results = await Promise.allSettled(FEEDS.map((f) => fetchFeed(f)));
      results.forEach((r, i) => {
        const feed = FEEDS[i];
        const st = this.feedStatus[feed.id];
        if (r.status === 'fulfilled') {
          st.ok = true;
          st.error = null;
          st.lastSuccess = now;
          st.items = r.value.length;
          for (const raw of r.value) {
            const item = this.addItem(raw, feed, now);
            if (item) fresh.push(item);
          }
        } else {
          st.ok = false;
          st.error = r.reason?.message ?? String(r.reason);
        }
      });
      this.prune(now);
      this.lastPoll = now;
      const okCount = Object.values(this.feedStatus).filter((s) => s.ok).length;
      console.log(`[${new Date(now).toLocaleTimeString()}] ${okCount}/${FEEDS.length} feeds ok, ${fresh.length} new, ${this.store.size} total`);
      return fresh.sort((a, b) => b.published - a.published);
    } finally {
      this.polling = false;
    }
  }

  // Scores and translates recent stories with Claude; calls onUpdate(item) for each. Returns the count.
  async scoreWithAI(onUpdate = () => {}) {
    if (this.aiRunning || !aiStatus().enabled) return 0;
    this.aiRunning = true;
    const now = Date.now();
    const pending = this.items().filter(
      (it) => !it.titleZh && it.aiAttempts < AI_MAX_ATTEMPTS && now - it.published < AI_WINDOW,
    );
    pending.forEach((it) => it.aiAttempts++);
    let changed = 0;
    try {
      await scoreWithAI(pending, (item, { score, reason, titleZh, summaryZh, reasonZh }) => {
        item.aiScore = score;
        item.aiReason = reason;
        item.titleZh = titleZh;
        item.descZh = summaryZh;
        item.aiReasonZh = reasonZh;
        applyScore(item);
        changed++;
        onUpdate(item);
      });
    } finally {
      this.aiRunning = false;
    }
    if (changed) console.log(`[ai] scored ${changed} stories with ${aiStatus().model ?? 'Claude'}`);
    return changed;
  }
}
