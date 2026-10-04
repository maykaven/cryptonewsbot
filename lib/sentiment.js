// Crypto-market sentiment scoring: a weighted lexicon tuned for how crypto news
// moves prices (hacks, ETF flows, regulation, macro), not generic positivity.
// Output score is -100 (very bearish) .. +100 (very bullish).

// [pattern, weight]. Patterns are matched case-insensitively with a leading word boundary.
const TERMS = [
  // ── Bullish price action ──
  ['surg(e|es|ed|ing)\\b', 2],
  ['soar(s|ed|ing)?\\b', 2.5],
  ['skyrocket(s|ed|ing)?\\b', 2.5],
  ['rall(y|ies|ied|ying)\\b', 2],
  ['jump(s|ed|ing)?\\b', 1.5],
  ['climb(s|ed|ing)?\\b', 1.2],
  ['gain(s|ed|ing)?\\b', 1.2],
  ['(rise|rises|rising|rose)\\b', 1],
  ['rebound(s|ed|ing)?\\b', 1.5],
  ['recover(s|y|ed|ing)?\\b', 1.2],
  ['spik(e|es|ed|ing)\\b', 1],
  ['pump(s|ed|ing)?\\b', 1.2],
  ['bullish\\b', 2.5],
  ['bull (run|market|case)\\b', 2.5],
  ['(all-time highs?|ath|record highs?|new highs?|fresh highs?)\\b', 2.5],
  ['(multi-)?(week|month|year)(ly)? highs?\\b', 1.8],
  ['(breakout|breaks? out|break(s|ing)? above|reclaim(s|ed|ing)?)\\b', 1.5],
  ['outperform(s|ed|ing)?\\b', 1.2],
  ['upside\\b', 1.2],
  ['golden cross\\b', 2],
  ['short squeeze\\b', 1.5],
  ['tailwinds?\\b', 1.2],
  ['(strong|strength|robust)\\b', 0.8],
  ['optimis(m|tic)\\b', 1.5],
  ['boost(s|ed|ing)?\\b', 1.5],
  ['moon(s|ing)?\\b', 1],

  // ── Bullish flows / adoption / policy ──
  ['inflows?\\b', 2],
  ['accumulat(e|es|ed|ing|ion)\\b', 1.5],
  ['(buys|buying|bought)\\b', 0.8],
  ['purchas(e|es|ed|ing)\\b', 1],
  ['approv(e|es|ed|al|als|ing)\\b', 2],
  ['(green light|greenlight(s|ed)?)\\b', 2],
  ['adopt(s|ed|ion|ing)?\\b', 1.5],
  ['partner(s|ship|ships|ed|ing)?\\b', 1],
  ['launch(es|ed|ing)?\\b', 0.6],
  ['integrat(e|es|ed|ion|ing)\\b', 0.7],
  ['legal tender\\b', 2],
  ['(strategic )?(bitcoin|crypto) reserve\\b', 2],
  ['(regulatory )?clarity\\b', 1.2],
  ['upgrade(s|d)?\\b', 1],
  ['(clears|cleared)\\b', 1],
  ['milestone\\b', 1],
  ['(rate cuts?|cuts? rates|dovish|easing|stimulus)\\b', 1.8],
  ['(wins|won|victory)\\b', 1.5],
  ['dismiss(es|ed|al)\\b', 1.5],
  ['institutional (demand|adoption|interest)\\b', 1.5],

  // ── Bearish price action ──
  ['plung(e|es|ed|ing)\\b', 2.5, -1],
  ['crash(es|ed|ing)?\\b', 3, -1],
  ['tumbl(e|es|ed|ing)\\b', 2, -1],
  ['slump(s|ed|ing)?\\b', 2, -1],
  ['(sink|sinks|sank|sinking)\\b', 1.8, -1],
  ['(slide|slides|slid|sliding)\\b', 1.5, -1],
  ['(drop|drops|dropped|dropping)\\b', 1.5, -1],
  ['(fall|falls|fell|falling)\\b', 1.3, -1],
  ['declin(e|es|ed|ing)\\b', 1.2, -1],
  ['dips?\\b', 0.8, -1],
  ['dump(s|ed|ing)?\\b', 2, -1],
  ['(sell-?off|sells|selling)\\b', 1.5, -1],
  ['bearish\\b', 2.5, -1],
  ['bear (market|case|trap)\\b', 2.5, -1],
  ['correction\\b', 1.2, -1],
  ['capitulat(e|es|ed|ion|ing)\\b', 2, -1],
  ['death cross\\b', 2, -1],
  ['(multi-)?(week|month|year)(ly)? lows?\\b', 1.8, -1],
  ['(record lows?|new lows?|fresh lows?)\\b', 2, -1],
  ['liquidat(e|es|ed|ion|ions|ing)\\b', 2, -1],
  ['(loss|losses|lose|loses|losing)\\b', 1.5, -1],
  ['(downturn|downside)\\b', 1.8, -1],
  ['headwinds?\\b', 1.2, -1],
  ['(weak|weakness|weakens|weakened)\\b', 1, -1],
  ['struggl(e|es|ed|ing)\\b', 1.2, -1],
  ['outflows?\\b', 2, -1],

  // ── Bearish security / legal / macro ──
  ['hack(s|ed|er|ers)?\\b', 3, -1],
  ['exploit(s|ed)?\\b', 3, -1],
  ['(breach|breaches|breached)\\b', 2.5, -1],
  ['security (incident|issue|flaw)s?\\b', 2.5, -1],
  ['(stolen|theft|steal|steals|drained)\\b', 2.5, -1],
  ['(scam|scams|scammer|scammers|phishing)\\b', 2.2, -1],
  ['(fraud|fraudulent|ponzi|rug ?pull)\\b', 3, -1],
  ['(lawsuit|lawsuits|sues|sued|suing)\\b', 2, -1],
  ['(indict|indicted|indictment)\\b', 2.5, -1],
  ['(arrest|arrested|jailed|sentenced)\\b', 2, -1],
  ['charge[sd]\\b', 1, -1],
  ['(ban|bans|banned|banning)\\b', 2.5, -1],
  ['crackdown\\b', 2.5, -1],
  ['(probe|probes|investigat(e|es|ed|ion|ing))\\b', 1.3, -1],
  ['subpoena(s|ed)?\\b', 1.5, -1],
  ['(fined|fines|penalt(y|ies))\\b', 1.5, -1],
  ['(reject|rejects|rejected|rejection|denies|denied)\\b', 2, -1],
  ['(delay|delays|delayed|postpone[sd]?)\\b', 1.2, -1],
  ['(bankrupt|bankruptcy|insolven(t|cy))\\b', 3, -1],
  ['collaps(e|es|ed|ing)\\b', 3, -1],
  ['contagion\\b', 2.5, -1],
  ['depeg(s|ged|ging)?\\b', 3, -1],
  ['(halt|halts|halted|suspend|suspends|suspended|freez(e|es)|frozen)\\b', 1.5, -1],
  ['delist(s|ed|ing)?\\b', 2.5, -1],
  ['(shut ?down|shuts down|shutting down)\\b', 2, -1],
  ['layoffs?\\b', 1.5, -1],
  ['sanction(s|ed)?\\b', 1.5, -1],
  ['vulnerab(le|ility|ilities)\\b', 1.8, -1],
  ['attack(s|ed)?\\b', 2, -1],
  ['(fear|fears|panic)\\b', 1.5, -1],
  ['warn(s|ed|ing)?\\b', 1.2, -1],
  ['(concern|concerns|uncertain|uncertainty|turmoil)\\b', 1, -1],
  ['risks?\\b', 0.6, -1],
  ['(recession|stagflation)\\b', 2, -1],
  ['(rate hikes?|hikes? rates|hawkish)\\b', 1.8, -1],
  ['tariffs?\\b', 1.5, -1],
];

const COMPILED = TERMS.map(([src, weight, sign = 1]) => ({
  re: new RegExp(`\\b${src}`, 'gi'),
  weight: weight * sign,
}));

const NEGATORS = /\b(not|no|never|without|unlikely|hardly|fails? to|failed to|won't|isn't|aren't|wasn't|didn't|doesn't|can't|cannot|avoid(s|ed)?|ease[sd]?|eased)\b[^.!?]{0,20}$/i;
// "rally fails", "surge fizzles", "selloff ends"
const POST_NEGATORS = /^[\w-]*\s+(fails?|failed|fizzles?|fizzled|stalls?|stalled|falters?|faltered|ends?|ended|is over|reverses?|reversed)\b/i;
const INTENSIFIERS = /\b(massive|huge|biggest|largest|record|sharp(ly)?|extreme|historic|major|billions?)\b/i;
const SPECULATIVE = /\b(could|may|might|predicts?|prediction|forecast|analyst says|eyes|targets?)\b/i;

const PCT_UP = /\b(up|gains?|gained|rises?|rose|jumps?|jumped|surges?|surged|climbs?|climbed|soars?|soared|rall(y|ies|ied))\s+(by\s+|over\s+|more than\s+)?(\d+(?:\.\d+)?)\s?%/gi;
const PCT_DOWN = /\b(down|drops?|dropped|falls?|fell|plunges?|plunged|sinks?|sank|slides?|slid|loses?|lost|tumbles?|tumbled|crashes?|crashed)\s+(by\s+|over\s+|more than\s+)?(\d+(?:\.\d+)?)\s?%/gi;

function scoreText(text) {
  let raw = 0;
  const drivers = [];
  if (!text) return { raw, drivers };

  for (const { re, weight } of COMPILED) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (!m) continue;
    const before = text.slice(Math.max(0, m.index - 40), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 30);
    const negated = NEGATORS.test(before) || POST_NEGATORS.test(after);
    const w = negated ? -weight * 0.5 : weight;
    raw += w;
    drivers.push({ term: (negated ? 'not ' : '') + m[0].toLowerCase(), weight: w });
  }

  for (const [re, sign] of [[PCT_UP, 1], [PCT_DOWN, -1]]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const pct = parseFloat(m[m.length - 1]);
      const w = sign * Math.min(pct / 5, 2.5);
      raw += w;
      drivers.push({ term: m[0].toLowerCase(), weight: w });
    }
  }

  if (INTENSIFIERS.test(text)) raw *= 1.15;
  return { raw, drivers };
}

export function labelFor(score) {
  if (score >= 40) return 'Very Bullish';
  if (score >= 12) return 'Bullish';
  if (score > -12) return 'Neutral';
  if (score > -40) return 'Bearish';
  return 'Very Bearish';
}

export function analyzeSentiment(title, description = '') {
  const t = scoreText(title);
  const d = scoreText(description);
  let raw = t.raw + 0.5 * d.raw;

  // Questions and predictions are weaker signals than reported facts.
  if (/\?\s*$/.test(title)) raw *= 0.6;
  else if (SPECULATIVE.test(title)) raw *= 0.8;

  const score = Math.round(100 * Math.tanh(raw / 6));
  const drivers = [...t.drivers, ...d.drivers.map((x) => ({ ...x, weight: x.weight * 0.5 }))]
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .filter((x, i, arr) => arr.findIndex((y) => y.term === x.term) === i)
    .slice(0, 6)
    .map((x) => ({ term: x.term, weight: Math.round(x.weight * 10) / 10 }));

  return { score, label: labelFor(score), drivers };
}

// ── Coin tagging ──
// [symbol, name regex (any case), ticker regex (exact case)]. Tickers that are
// also ordinary words ("sol", "ada", "ton", "link") only match in uppercase.
const COINS = [
  ['BTC', /\b(bitcoin|btc)\b/i],
  ['ETH', /\b(ethereum|ether|eth)\b/i],
  ['SOL', /\bsolana\b/i, /\bSOL\b/],
  ['XRP', /\b(xrp|ripple)\b/i],
  ['BNB', /\b(bnb|bnb chain)\b/i],
  ['DOGE', /\b(dogecoin|doge)\b/i],
  ['ADA', /\bcardano\b/i, /\bADA\b/],
  ['TRX', /\b(tron|trx)\b/i],
  ['TON', /\btoncoin\b/i, /\bTON\b/],
  ['AVAX', /\b(avalanche|avax)\b/i],
  ['LINK', /\bchainlink\b/i, /\bLINK\b/],
  ['DOT', /\bpolkadot\b/i, /\bDOT\b/],
  ['SHIB', /\b(shiba inu|shib)\b/i],
  ['LTC', /\b(litecoin|ltc)\b/i],
  ['SUI', /\bsui network\b/i, /\b(Sui|SUI)\b/],
  ['PEPE', /\bpepe\b/i],
  ['HYPE', /\bhyperliquid\b/i, /\bHYPE\b/],
  ['USDT', /\b(tether|usdt)\b/i],
  ['USDC', /\busdc\b/i],
];

export function detectCoins(text) {
  return COINS.filter(([, name, ticker]) => name.test(text) || ticker?.test(text)).map(([sym]) => sym);
}

const MACRO = /\b(fed|federal reserve|fomc|sec|cftc|etf|etfs|regulat\w*|congress|senate|white house|treasury|inflation|cpi|interest rates?|crypto market|market-wide|stablecoin bill|tariffs?)\b/i;

// How much a story should move the overall market mood index.
const CRYPTO = /\b(crypto\w*|bitcoin|blockchain|tokens?|coins?|defi|nfts?|stablecoins?|exchanges?|web3|onchain|on-chain|wallets?|miners?|mining|altcoins?|memecoins?|layer[- ]?2|dex|protocol)\b/i;

export function marketImpact(text, coins) {
  if (coins.includes('BTC') || MACRO.test(text)) return 1.5;
  if (coins.length === 0 && !CRYPTO.test(text)) return 0.3; // off-topic (general tech news)
  if (coins.includes('ETH')) return 1.25;
  if (coins.length === 0) return 1;
  return 0.8; // altcoin-specific
}
