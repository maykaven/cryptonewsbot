// Optional Claude-powered scoring. Enabled automatically when the Anthropic SDK is
// installed and credentials are available (ANTHROPIC_API_KEY or `ant auth login`).
// Any failure falls back to the built-in lexicon score, so the app never stalls.

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.CLAUDE_EFFORT || 'low';
const BATCH_SIZE = 12;

const SYSTEM = `You are a crypto market analyst. For each news item, estimate its likely short-term impact on crypto market prices (the asset(s) it concerns, or the overall market for macro/regulatory news).

Score on an integer scale from -100 to +100:
- +60..+100: major bullish catalyst (e.g. landmark ETF approval, huge institutional buy, decisive regulatory win)
- +20..+59: clearly positive
- -19..+19: neutral, mixed, minor, or not market-moving (opinion pieces, explainers, small project updates)
- -20..-59: clearly negative
- -60..-100: major bearish shock (e.g. large exchange hack, major insolvency, sweeping ban)

Judge market impact, not the article's tone. Price predictions and speculative headlines deserve smaller magnitudes than reported facts. Give a reason of at most 15 words.

Also provide Simplified Chinese versions for Chinese-speaking readers:
- title_zh: a natural Chinese headline (use standard Chinese crypto terms such as 比特币, 以太坊, 交易所, 稳定币; keep tickers like BTC and proper names that have no common Chinese form)
- summary_zh: a one-sentence Chinese summary of the story, at most 60 characters
- reason_zh: your reason, in Chinese`;

const SCHEMA = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          score: { type: 'integer' },
          reason: { type: 'string' },
          title_zh: { type: 'string' },
          summary_zh: { type: 'string' },
          reason_zh: { type: 'string' },
        },
        required: ['id', 'score', 'reason', 'title_zh', 'summary_zh', 'reason_zh'],
        additionalProperties: false,
      },
    },
  },
  required: ['results'],
  additionalProperties: false,
};

let client = null;
let Anthropic = null;
let disabledReason = '';
let consecutiveFailures = 0;

export async function initAI() {
  if (process.env.AI_SCORING === 'off') {
    disabledReason = 'disabled via AI_SCORING=off';
    return false;
  }
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    disabledReason = '@anthropic-ai/sdk not installed';
    return false;
  }
  try {
    client = new Anthropic();
    return true;
  } catch (err) {
    disabledReason = `no Claude credentials (${err.message.split('\n')[0]})`;
    client = null;
    return false;
  }
}

export function aiStatus() {
  return client ? { enabled: true, model: MODEL } : { enabled: false, reason: disabledReason };
}

async function scoreBatch(items) {
  const list = items
    .map((it) => `id: ${it.id}\nsource: ${it.source}\ntitle: ${it.title}\nsummary: ${it.description.slice(0, 300)}`)
    .join('\n\n');

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: EFFORT, format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: 'user', content: `Score these ${items.length} news items:\n\n${list}` }],
  });

  if (response.stop_reason === 'refusal') throw new Error('request declined');
  if (response.stop_reason === 'max_tokens') throw new Error('response truncated');
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('empty response');
  return JSON.parse(text).results;
}

// Scores (and translates) items in batches; calls onScored(item, result) as results land.
export async function scoreWithAI(items, onScored) {
  if (!client || items.length === 0) return;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    try {
      const results = await scoreBatch(batch);
      const byId = new Map(batch.map((it) => [it.id, it]));
      for (const r of results) {
        const item = byId.get(r.id);
        if (!item || !Number.isFinite(r.score)) continue;
        onScored(item, {
          score: Math.max(-100, Math.min(100, Math.round(r.score))),
          reason: r.reason,
          titleZh: r.title_zh,
          summaryZh: r.summary_zh,
          reasonZh: r.reason_zh,
        });
      }
      consecutiveFailures = 0;
    } catch (err) {
      if (++consecutiveFailures >= 5) {
        console.warn(`[ai] ${consecutiveFailures} failed batches in a row — Claude scoring disabled, using built-in engine`);
        disabledReason = `repeated failures (last: ${err.message.split('\n')[0]})`;
        client = null;
        return;
      }
      if (err instanceof Anthropic.AuthenticationError) {
        console.warn('[ai] authentication failed — Claude scoring disabled, using built-in engine');
        disabledReason = 'authentication failed';
        client = null;
        return;
      } else if (err instanceof Anthropic.RateLimitError) {
        console.warn('[ai] rate limited — will retry these items next cycle');
        return;
      } else if (err instanceof Anthropic.APIError) {
        console.warn(`[ai] API error ${err.status}: ${err.message}`);
      } else {
        console.warn(`[ai] batch failed: ${err.message}`);
      }
    }
  }
}
