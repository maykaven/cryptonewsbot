import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeSentiment, detectCoins, marketImpact } from '../lib/sentiment.js';
import { parseFeed } from '../lib/feeds.js';
import { computeStats, moodIndex } from '../lib/stats.js';

const score = (title, desc = '') => analyzeSentiment(title, desc).score;

test('bullish headlines score positive', () => {
  assert.ok(score('Bitcoin surges to new all-time high as ETF inflows hit record') > 40);
  assert.ok(score('SEC approves spot Solana ETF') > 12);
  assert.ok(score('Ethereum rallies 12% after Pectra upgrade goes live') > 25);
});

test('bearish headlines score negative', () => {
  assert.ok(score('Exchange hacked, $200M stolen in exploit') < -40);
  assert.ok(score('Bitcoin crashes below $80K as liquidations top $1B') < -40);
  assert.ok(score('XRP Sentiment Crashes to Lowest Level Since August') < 0);
  assert.ok(score('China bans crypto mining again') < -12);
});

test('neutral headlines stay near zero', () => {
  assert.equal(score('What is a blockchain oracle? A beginner guide'), 0);
  assert.ok(Math.abs(score('Ripple unlocks 1 billion XRP from escrow')) < 12);
});

test('negation flips and dampens', () => {
  assert.ok(score('SEC does not approve ETF') < 0);
  assert.ok(score('Bitcoin rally fails to hold') < score('Bitcoin rally'));
});

test('questions are dampened relative to statements', () => {
  assert.ok(Math.abs(score('Will Bitcoin crash?')) < Math.abs(score('Bitcoin crashes')));
});

test('scores are bounded', () => {
  const s = score('crash plunge hack exploit fraud ban collapse bankrupt depeg crackdown lawsuit');
  assert.ok(s >= -100 && s < -90);
});

test('coin detection is case-aware for ambiguous tickers', () => {
  assert.deepEqual(detectCoins('Bitcoin and Ethereum climb'), ['BTC', 'ETH']);
  assert.deepEqual(detectCoins('Solana and Cardano rally'), ['SOL', 'ADA']);
  assert.deepEqual(detectCoins('SOL and ADA jump'), ['SOL', 'ADA']);
  assert.deepEqual(detectCoins('I sold my ada for a link to the ton of dot files'), []);
});

test('market impact weights macro and off-topic stories', () => {
  assert.equal(marketImpact('Fed signals rate cut', []), 1.5);
  assert.equal(marketImpact('FBI warns employees about hackers', []), 0.3);
  assert.equal(marketImpact('Dogecoin jumps', ['DOGE']), 0.8);
});

test('parses RSS with CDATA and entities', () => {
  const xml = `<rss><channel>
    <item><title><![CDATA[Bitcoin &amp; Ether rise]]></title><link>https://x.test/a</link>
      <pubDate>Sat, 04 Oct 2026 10:00:00 GMT</pubDate>
      <description>&lt;p&gt;Prices &lt;b&gt;climb&lt;/b&gt;.&lt;/p&gt; The post X appeared first on Y.</description></item>
    <item><title>No link</title></item>
  </channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Bitcoin & Ether rise');
  assert.equal(items[0].description, 'Prices climb .');
  assert.equal(items[0].published, Date.parse('2026-10-04T10:00:00Z'));
});

test('parses Atom feeds', () => {
  const xml = `<feed><entry><title>Hello</title><link href="https://x.test/b"/><updated>2026-10-04T09:00:00Z</updated><summary>Hi</summary></entry></feed>`;
  const [it] = parseFeed(xml);
  assert.equal(it.link, 'https://x.test/b');
  assert.equal(it.description, 'Hi');
});

test('mood index decays older stories and weights impact', () => {
  const now = Date.now();
  const items = [
    { score: 80, impact: 1.5, published: now - 60_000 },
    { score: -80, impact: 1, published: now - 20 * 3600_000 },
  ];
  assert.ok(moodIndex(items, now) > 50);
  assert.equal(moodIndex([], now), null);
  const stats = computeStats(items.map((it, i) => ({ ...it, id: String(i), title: 't', link: 'l', source: 's', coins: ['BTC'] })), now);
  assert.equal(stats.counts.bullish, 1);
  assert.equal(stats.counts.bearish, 1);
  assert.equal(stats.trend.length, 48);
  assert.equal(stats.coins[0].coin, 'BTC');
});
