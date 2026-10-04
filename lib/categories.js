// Classifies headlines by what kind of news they are, so catalysts (hacks, regulation,
// ETF flows, macro...) can be told apart from stories that recap or forecast price moves.

export const CATEGORIES = [
  { id: 'hack', label: 'Hack / exploit', re: /\b(hack(s|ed|er|ers)?|exploit(s|ed)?|breach(es|ed)?|stolen|drain(s|ed)?|phishing|attack(s|ed|ers?)?|vulnerab\w*|rug ?pulls?|scam(s|mers?)?)\b/i },
  { id: 'regulation', label: 'Regulation / legal', re: /\b(sec|cftc|doj|fbi|irs|regulat\w*|lawsuits?|sues?|sued|court|judge|congress|senate|lawmakers?|legislation|ban(s|ned)?|licen[cs]\w*|enforcement|settle(s|d|ment)?|charged|indict\w*|sanction\w*|clarity act|genius act|mica)\b/i },
  { id: 'etf', label: 'ETF / fund flows', re: /\b(etfs?|etps?|inflows?|outflows?|blackrock|ibit|fidelity|grayscale|gbtc)\b/i },
  { id: 'scheduled', label: 'Scheduled data / Fed meetings', re: /\b(cpi|pce|ppi|fomc|jobs report|payrolls|nonfarm|jackson hole|rate decision|fed (meeting|decision|minutes)|powell (speech|speaks|testimony))\b/i },
  { id: 'macro', label: 'Macro / Fed / politics', re: /\b(fed|federal reserve|fomc|powell|rate (cut|hike)s?|interest rates?|inflation|cpi|pce|ppi|jobs (report|data)|payrolls?|unemployment|gdp|tariffs?|recession|yields?|dxy|dollar|trump|white house|nasdaq|s&p ?500|stocks?|equities|gold)\b/i },
  { id: 'institutional', label: 'Institutional / treasuries', re: /\b(microstrategy|strategy inc|saylor|metaplanet|treasur(y|ies)|buys|bought|acquir\w*|purchas\w*|jpmorgan|goldman|morgan stanley|citi(group)?|visa|mastercard|paypal|stripe|banks?|institution\w*)\b/i },
  { id: 'derivatives', label: 'Liquidations / derivatives', re: /\b(liquidat\w*|open interest|funding rates?|futures|options|short squeeze|leverage\w*|longs|shorts)\b/i },
  { id: 'onchain', label: 'Whales / on-chain', re: /\b(whales?|on-?chain|exchange reserves|miners?|hash ?rate|dormant|mt\.? ?gox|transfers?|accumulat\w*)\b/i },
  { id: 'exchange', label: 'Exchanges', re: /\b(binance|coinbase|kraken|okx|bybit|upbit|bitget|robinhood|listings?|delist\w*|withdrawals?)\b/i },
  { id: 'stablecoin', label: 'Stablecoins', re: /\b(stablecoins?|usdt|usdc|tether|circle|depeg\w*)\b/i },
];

const PRICE_WORDS = /\b(price|prices|rall(y|ies|ied)|surg\w*|soar\w*|plung\w*|dip(s|ped)?|jump(s|ed)?|slid(e|es)?|fall(s|en)?|fell|drop(s|ped)?|tumbl\w*|climb\w*|gains?|rebound\w*|crash\w*|breakout|break(s|ing)? (above|below)|support|resistance|chart|pattern|rsi|macd|fibonacci|technical|bulls?|bears?|bullish|bearish|ath|all-time high|reclaim\w*)\b|\d+(\.\d+)?%|\$\d/i;
const FORECAST = /\b(predict\w*|forecast\w*|could|may|might|expects?|eyes|targets?|analysts?|next|outlook|what's next)\b|\?\s*$/i;

// Returns { categories: [ids], kind: 'catalyst' | 'price' | 'forecast' | 'other' }.
// kind is 'price' for stories that only recap a price move (no catalyst category),
// and 'forecast' for predictions/analysis pieces (also without a catalyst category).
export function categorize(title) {
  const categories = CATEGORIES.filter((c) => c.re.test(title)).map((c) => c.id);
  let kind = 'other';
  if (categories.length) kind = 'catalyst';
  else if (FORECAST.test(title)) kind = 'forecast';
  else if (PRICE_WORDS.test(title)) kind = 'price';
  return { categories, kind };
}
