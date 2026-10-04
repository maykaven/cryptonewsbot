# Crypto News Pulse

Real-time crypto news aggregator that scores every story for its likely impact on the market, from **−100 (very bearish)** to **+100 (very bullish)**, and rolls those scores up into a live market mood index.

## Quick start

```bash
npm install
npm start
```

Open http://localhost:3000. New stories stream into the page as soon as they're published (checked every 60 seconds).

Requires Node.js 22.9+.

## What you get

- **Live feed** of 10 major crypto news sources (CoinDesk, Cointelegraph, Decrypt, The Block, Bitcoin Magazine, CryptoSlate, Bitcoinist, NewsBTC, CryptoPotato, U.Today), de-duplicated and pushed to the browser over Server-Sent Events.
- **Per-story score**, with the reason behind it: either Claude's one-line rationale or the keywords that drove the built-in score.
- **Market mood index**: a 24h average of story scores, weighted by market impact and by recency (a story's influence halves every 6h). Bitcoin and macro/regulatory news count more; altcoin-only news counts less; off-topic tech news barely counts.
- **48h mood trend**, a bullish/neutral/bearish split, top movers, and **per-coin sentiment** (click a coin to filter).
- Filters for search, sentiment, source and coin; sort by latest, most bullish, most bearish or biggest movers.
- Optional **desktop alerts** (bell icon) for stories scoring ±60 or more.
- Light/dark theme, mobile layout.

## Scoring engines

| Engine | When it runs | Notes |
|---|---|---|
| **Claude** | `ANTHROPIC_API_KEY` is set and `@anthropic-ai/sdk` is installed | Scores stories from the last 24h in batches of 12 and judges *market impact*, not tone. Uses `claude-opus-5-5` at low effort, with server-side refusal fallbacks enabled. |
| **Built-in** | Always, as the instant first score and the fallback | Crypto-specific weighted lexicon (hacks, ETF flows, regulation, liquidations, macro…) with negation handling, % move detection, and dampening for questions and predictions. Free, works offline. |

Each story shows its built-in score immediately, and that score is replaced in place once Claude's result arrives. If Claude errors repeatedly, the app switches to the built-in engine automatically.

## Configuration

Copy `.env.example` to `.env`. Every setting is optional:

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Enables Claude scoring |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model used for scoring |
| `CLAUDE_EFFORT` | `low` | `low` / `medium` / `high` |
| `AI_SCORING` | — | Set to `off` to force the built-in engine |
| `PORT` | `3000` | HTTP port |
| `POLL_SECONDS` | `60` | Feed refresh interval (min 20) |

## API

| Endpoint | Description |
|---|---|
| `GET /api/stream` | SSE stream: `init`, `items` (new stories), `update` (re-scored story), `stats`, `status` |
| `GET /api/news?limit=200` | Latest stories as JSON |
| `GET /api/stats` | Mood index, trend, counts, per-coin sentiment |
| `GET /api/status` | Feed health and scoring engine |
| `POST /api/refresh` | Poll all feeds now |

## Project layout

```
server.js           HTTP server, polling loop, SSE broadcast, persistence (data/news.json)
lib/feeds.js        Feed list + dependency-free RSS/Atom parser
lib/sentiment.js    Built-in sentiment lexicon, coin tagging, market-impact weights
lib/ai.js           Optional Claude scorer (structured JSON output)
lib/stats.js        Mood index, hourly trend, per-coin aggregates
public/             Dashboard (vanilla HTML/CSS/JS, no build step)
test/               Unit tests: npm test
```

To add a source, append `{ id, name, url }` to `FEEDS` in `lib/feeds.js`.

---

Scores are automated estimates from headlines. They are not financial advice.
