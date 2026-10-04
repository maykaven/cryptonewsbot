// News sources and a small dependency-free RSS/Atom parser.

export const FEEDS = [
  { id: 'coindesk', name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { id: 'cointelegraph', name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { id: 'decrypt', name: 'Decrypt', url: 'https://decrypt.co/feed' },
  { id: 'theblock', name: 'The Block', url: 'https://www.theblock.co/rss.xml' },
  { id: 'bitcoinmagazine', name: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/.rss/full/' },
  { id: 'cryptoslate', name: 'CryptoSlate', url: 'https://cryptoslate.com/feed/' },
  { id: 'bitcoinist', name: 'Bitcoinist', url: 'https://bitcoinist.com/feed/' },
  { id: 'newsbtc', name: 'NewsBTC', url: 'https://www.newsbtc.com/feed/' },
  { id: 'cryptopotato', name: 'CryptoPotato', url: 'https://cryptopotato.com/feed/' },
  { id: 'utoday', name: 'U.Today', url: 'https://u.today/rss' },
];

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™',
};

export function decodeEntities(str) {
  return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

function stripCdata(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

export function cleanText(s, maxLen = 400) {
  if (!s) return '';
  let t = stripCdata(s);
  t = decodeEntities(t); // descriptions are often entity-encoded HTML
  t = t.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  t = t.replace(/<[^>]+>/g, ' ');
  t = decodeEntities(t);
  t = t.replace(/\s+/g, ' ').trim();
  // Common feed boilerplate
  t = t.replace(/\s*The post .+? appeared first on .+?\.?$/i, '').replace(/\s*Read more\.?$/i, '');
  if (t.length > maxLen) t = t.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
  return t;
}

function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i');
  const m = block.match(re);
  return m ? m[1] : '';
}

function attr(block, name, attrName) {
  const re = new RegExp(`<${name}\\s[^>]*${attrName}=["']([^"']+)["'][^>]*\\/?>`, 'i');
  const m = block.match(re);
  return m ? m[1] : '';
}

function findImage(block) {
  return (
    attr(block, 'media:content', 'url') ||
    attr(block, 'media:thumbnail', 'url') ||
    (/<enclosure[^>]*type=["']image/i.test(block) ? attr(block, 'enclosure', 'url') : '') ||
    (decodeEntities(stripCdata(block)).match(/<img[^>]+src=["']([^"']+)["']/i)?.[1] ?? '')
  );
}

export function parseFeed(xml) {
  const items = [];
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const blockRe = isAtom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi;
  for (const block of xml.match(blockRe) ?? []) {
    const title = cleanText(tag(block, 'title'), 300);
    let link = isAtom ? attr(block, 'link', 'href') : cleanText(tag(block, 'link'), 1000);
    if (!link) link = cleanText(tag(block, 'guid'), 1000);
    const guid = cleanText(tag(block, 'guid') || tag(block, 'id'), 1000) || link;
    const dateStr = cleanText(
      tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'dc:date'),
      100,
    );
    const description = cleanText(
      tag(block, 'description') || tag(block, 'summary') || tag(block, 'content:encoded') || tag(block, 'content'),
    );
    const published = Date.parse(dateStr);
    if (!title || !link) continue;
    items.push({
      title,
      link,
      guid,
      description,
      image: findImage(block),
      published: Number.isFinite(published) ? published : Date.now(),
    });
  }
  return items;
}

export async function fetchFeed(feed, timeoutMs = 15000) {
  const res = await fetch(feed.url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; CryptoNewsBot/1.0; +https://localhost)',
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text());
}
