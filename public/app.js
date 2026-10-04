'use strict';

const $ = (sel) => document.querySelector(sel);
const PAGE = 60;
const ALERT_THRESHOLD = 60;

const state = {
  items: [],
  pending: [],
  stats: null,
  status: null,
  freshIds: new Set(),
  filter: { q: '', sent: 'all', source: '', coin: '', sort: 'latest' },
  limit: PAGE,
  connected: false,
  notify: false,
};

// ── Utilities ──
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
const tone = (s) => (s >= 12 ? 'bull' : s <= -12 ? 'bear' : 'neutral');
const arrow = (s) => (s >= 12 ? '▲' : s <= -12 ? '▼' : '•');
const shortLabel = (label) => label.replace('Very ', 'V. ');

function timeAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

// ── Tooltip ──
const tip = $('#tooltip');
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let left = x + 14;
  let top = y + 14;
  if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}
const hideTip = () => { tip.hidden = true; };

// ── Gauge ──
const GX = 100, GY = 100, GR = 80;
function gaugePoint(score, r = GR) {
  const a = Math.PI * (1 - (score + 100) / 200);
  return [GX + r * Math.cos(a), GY - r * Math.sin(a)];
}
function arcPath(s1, s2, r = GR) {
  const [x1, y1] = gaugePoint(s1, r);
  const [x2, y2] = gaugePoint(s2, r);
  return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 0 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
}
function renderGauge(mood) {
  const svg = $('#gauge');
  const has = mood != null;
  const v = has ? mood : 0;
  const color = `var(--${tone(v)})`;
  const [mx, my] = gaugePoint(v);
  const ticks = [-100, -50, 0, 50, 100]
    .map((t) => {
      const [x1, y1] = gaugePoint(t, GR + 9);
      const [x2, y2] = gaugePoint(t, GR + 14);
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--text-3)" stroke-width="1"/>`;
    })
    .join('');
  svg.innerHTML = `
    <path d="${arcPath(-100, 100)}" fill="none" stroke="var(--surface-2)" stroke-width="14" stroke-linecap="round"/>
    <path d="${arcPath(-100, -12, GR + 9)}" fill="none" stroke="var(--bear)" stroke-opacity=".35" stroke-width="2"/>
    <path d="${arcPath(12, 100, GR + 9)}" fill="none" stroke="var(--bull)" stroke-opacity=".35" stroke-width="2"/>
    ${ticks}
    ${has && v !== 0 ? `<path d="${v > 0 ? arcPath(0, v) : arcPath(v, 0)}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"/>` : ''}
    ${has ? `<circle cx="${mx}" cy="${my}" r="9" fill="${color}" stroke="var(--surface)" stroke-width="3"/>` : ''}
    <text x="14" y="114" font-size="9" fill="var(--text-3)" text-anchor="middle">Bear</text>
    <text x="186" y="114" font-size="9" fill="var(--text-3)" text-anchor="middle">Bull</text>`;
}

// ── Trend chart ──
function renderTrend(trend) {
  const el = $('#trend');
  const W = el.clientWidth || 600;
  const H = el.clientHeight || 180;
  const P = { l: 34, r: 10, t: 8, b: 22 };
  const pts = trend.filter((d) => d.mood != null);
  if (pts.length < 2) {
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}"><text class="empty-msg" x="${W / 2}" y="${H / 2}" text-anchor="middle">Collecting data…</text></svg>`;
    return;
  }
  const maxAbs = Math.max(...pts.map((d) => Math.abs(d.mood)));
  const dom = Math.min(100, Math.max(25, Math.ceil(maxAbs / 25) * 25));
  const t0 = trend[0].t;
  const t1 = trend.at(-1).t;
  const x = (t) => P.l + ((t - t0) / (t1 - t0)) * (W - P.l - P.r);
  const y = (v) => P.t + ((dom - v) / (2 * dom)) * (H - P.t - P.b);

  // Split into contiguous segments (gaps where mood is null)
  const segs = [];
  let cur = [];
  for (const d of trend) {
    if (d.mood == null) { if (cur.length) segs.push(cur); cur = []; } else cur.push(d);
  }
  if (cur.length) segs.push(cur);
  const line = segs.map((s) => 'M' + s.map((d) => `${x(d.t).toFixed(1)},${y(d.mood).toFixed(1)}`).join('L')).join('');
  const area = segs
    .filter((s) => s.length > 1)
    .map((s) => `M${x(s[0].t)},${y(0)}L` + s.map((d) => `${x(d.t).toFixed(1)},${y(d.mood).toFixed(1)}`).join('L') + `L${x(s.at(-1).t)},${y(0)}Z`)
    .join('');

  const yTicks = [dom, dom / 2, 0, -dom / 2, -dom];
  const xTicks = trend.filter((d) => new Date(d.t).getHours() % 12 === 0);
  const fmtX = (t) => {
    const d = new Date(t);
    return d.getHours() === 0 ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : d.toLocaleTimeString(undefined, { hour: 'numeric' });
  };

  el.innerHTML = `
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Market mood over the last 48 hours">
    <defs>
      <clipPath id="clipUp"><rect x="0" y="0" width="${W}" height="${y(0)}"/></clipPath>
      <clipPath id="clipDn"><rect x="0" y="${y(0)}" width="${W}" height="${H}"/></clipPath>
    </defs>
    <g class="grid">${yTicks.filter((v) => v !== 0).map((v) => `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}"/>`).join('')}</g>
    <g class="axis">
      ${yTicks.map((v) => `<text x="${P.l - 6}" y="${y(v) + 3}" text-anchor="end">${signed(v)}</text>`).join('')}
      ${xTicks.map((d) => `<text x="${x(d.t)}" y="${H - 6}" text-anchor="middle">${fmtX(d.t)}</text>`).join('')}
    </g>
    <path class="area-bull" d="${area}" clip-path="url(#clipUp)"/>
    <path class="area-bear" d="${area}" clip-path="url(#clipDn)"/>
    <line class="zero" x1="${P.l}" x2="${W - P.r}" y1="${y(0)}" y2="${y(0)}"/>
    <path class="line" d="${line}"/>
    <g class="hover" visibility="hidden">
      <line class="crosshair" y1="${P.t}" y2="${H - P.b}"/>
      <circle class="marker" r="5"/>
    </g>
    <rect class="hit" x="${P.l}" y="0" width="${W - P.l - P.r}" height="${H}" fill="transparent"/>
  </svg>`;

  const svg = el.querySelector('svg');
  const hover = svg.querySelector('.hover');
  const cross = hover.querySelector('.crosshair');
  const marker = hover.querySelector('.marker');
  const hit = svg.querySelector('.hit');
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    const t = t0 + ((px - P.l) / (W - P.l - P.r)) * (t1 - t0);
    let best = null;
    for (const d of trend) if (d.mood != null && (!best || Math.abs(d.t - t) < Math.abs(best.t - t))) best = d;
    if (!best) return;
    hover.setAttribute('visibility', 'visible');
    cross.setAttribute('x1', x(best.t));
    cross.setAttribute('x2', x(best.t));
    marker.setAttribute('cx', x(best.t));
    marker.setAttribute('cy', y(best.mood));
    marker.setAttribute('fill', `var(--${tone(best.mood)})`);
    const when = new Date(best.t).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    showTip(
      `<div>${esc(when)}</div><div>Mood <b>${signed(best.mood)}</b> · ${esc(labelFor(best.mood))}</div><div class="muted">${best.count} ${best.count === 1 ? 'story' : 'stories'} that hour</div>`,
      ev.clientX,
      ev.clientY,
    );
  };
  hit.addEventListener('pointermove', move);
  hit.addEventListener('pointerleave', () => { hover.setAttribute('visibility', 'hidden'); hideTip(); });
}

function labelFor(score) {
  if (score >= 40) return 'Very Bullish';
  if (score >= 12) return 'Bullish';
  if (score > -12) return 'Neutral';
  if (score > -40) return 'Bearish';
  return 'Very Bearish';
}

// ── Stats cards ──
function renderStats() {
  const s = state.stats;
  if (!s) return;
  renderGauge(s.mood);
  const mv = $('#moodValue');
  mv.textContent = s.mood == null ? '—' : signed(s.mood);
  mv.className = `mood-value ${s.mood >= 12 ? 'bull-text' : s.mood <= -12 ? 'bear-text' : ''}`;
  $('#moodLabel').textContent = s.moodLabel;
  const ch = s.moodChange6h;
  $('#moodChange').innerHTML =
    ch == null ? '' : `<span class="${ch > 0 ? 'bull-text' : ch < 0 ? 'bear-text' : ''}">${ch > 0 ? '▲' : ch < 0 ? '▼' : '■'} ${Math.abs(ch)}</span> vs 6h ago`;

  renderTrend(s.trend);

  const { bullish, neutral, bearish } = s.counts;
  const total = bullish + neutral + bearish;
  $('#total24').textContent = `· ${total} stories`;
  const bar = $('#splitBar');
  bar.setAttribute('aria-label', `${bullish} bullish, ${neutral} neutral, ${bearish} bearish`);
  bar.innerHTML = total
    ? [['bull', bullish, 'Bullish'], ['neutral', neutral, 'Neutral'], ['bear', bearish, 'Bearish']]
        .filter(([, n]) => n > 0)
        .map(([k, n, l]) => `<span class="s-${k}" style="flex-grow:${n}" data-tip="${l}: <b>${n}</b> (${Math.round((n / total) * 100)}%)"></span>`)
        .join('')
    : '';
  $('#splitLegend').innerHTML = [
    ['bull', bullish, '▲ Bullish'],
    ['neutral', neutral, 'Neutral'],
    ['bear', bearish, '▼ Bearish'],
  ]
    .map(([k, n, l]) => `<li><b>${n}</b><span class="swatch" style="background:var(--${k})"></span>${l}</li>`)
    .join('');

  const ex = [];
  if (s.mostBullish) ex.push(extremeHtml(s.mostBullish, 'Top bullish'));
  if (s.mostBearish) ex.push(extremeHtml(s.mostBearish, 'Top bearish'));
  $('#extremes').innerHTML = ex.join('');

  const coins = $('#coins');
  coins.innerHTML = s.coins.length
    ? s.coins
        .map((c) => {
          const w = Math.abs(c.avg) / 2; // % of full bar (half bar = 100)
          const left = c.avg >= 0 ? 50 : 50 - w;
          return `<li><button data-coin="${esc(c.coin)}" class="${state.filter.coin === c.coin ? 'active' : ''}" title="Filter to ${esc(c.coin)}">
            <span class="coin-sym">${esc(c.coin)}</span>
            <span class="coin-bar"><i style="left:${left}%;width:${w}%;background:var(--${tone(c.avg)})"></i></span>
            <span class="coin-score">${signed(c.avg)}</span>
            <span class="coin-count">${c.count} ${c.count === 1 ? 'story' : 'stories'}</span>
          </button></li>`;
        })
        .join('')
    : '<li class="none">No coin-specific stories yet.</li>';
}

function extremeHtml(it, label) {
  return `<a class="extreme" href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">
    <span class="coin-score ${it.score > 0 ? 'bull-text' : 'bear-text'}">${arrow(it.score)}${signed(it.score)}</span>
    <span><span class="muted">${label} · ${esc(it.source)}</span><br><span class="ex-title">${esc(it.title)}</span></span>
  </a>`;
}

// ── Feed ──
function filtered() {
  const f = state.filter;
  const q = f.q.trim().toLowerCase();
  let list = state.items.filter((it) => {
    if (f.sent !== 'all' && tone(it.score) !== f.sent) return false;
    if (f.source && it.sourceId !== f.source) return false;
    if (f.coin && !it.coins.includes(f.coin)) return false;
    if (q && !`${it.title} ${it.description}`.toLowerCase().includes(q)) return false;
    return true;
  });
  if (f.sort === 'bull') list = [...list].sort((a, b) => b.score - a.score || b.published - a.published);
  else if (f.sort === 'bear') list = [...list].sort((a, b) => a.score - b.score || b.published - a.published);
  else if (f.sort === 'impact') list = [...list].sort((a, b) => Math.abs(b.score) * b.impact - Math.abs(a.score) * a.impact);
  return list;
}

function storyHtml(it) {
  const t = tone(it.score);
  const why =
    it.scoredBy === 'ai' && it.aiReason
      ? `<span class="ai-tag">Claude</span>${esc(it.aiReason)}`
      : (it.drivers || [])
          .slice(0, 4)
          .map((d) => `<span class="drv ${d.weight > 0 ? 'bull-text' : 'bear-text'}">${esc(d.term)} ${signed(d.weight)}</span>`)
          .join('') || '<span class="drv">no strong signals</span>';
  const coins = it.coins.map((c) => `<button class="chip" data-coin="${esc(c)}">${esc(c)}</button>`).join('');
  return `<li class="story${state.freshIds.has(it.id) ? ' fresh' : ''}" data-id="${esc(it.id)}">
    <div class="badge ${t}" title="${esc(it.label)} (score ${signed(it.score)} of ±100)">
      <span class="val">${arrow(it.score)}${Math.abs(it.score)}</span>
      <span class="lbl">${esc(shortLabel(it.label))}</span>
    </div>
    <div>
      <h3 class="story-title"><a href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">${esc(it.title)}</a></h3>
      <div class="meta"><span class="src">${esc(it.source)}</span><time data-ts="${it.published}">${timeAgo(it.published)}</time>${coins}</div>
      ${it.description ? `<p class="desc">${esc(it.description)}</p>` : ''}
      <div class="why">${why}</div>
    </div>
  </li>`;
}

function renderFeed() {
  const list = filtered();
  const shown = list.slice(0, state.limit);
  $('#feed').innerHTML = shown.map(storyHtml).join('');
  $('#moreBtn').hidden = list.length <= state.limit;
  $('#moreBtn').textContent = `Show more (${list.length - state.limit} remaining)`;
  $('#empty').hidden = list.length > 0 || state.items.length === 0;
  state.freshIds.clear();

  const cf = $('#coinFilter');
  cf.hidden = !state.filter.coin;
  if (state.filter.coin) cf.innerHTML = `Coin: ${esc(state.filter.coin)} <button aria-label="Clear coin filter">×</button>`;
}

function renderSkeleton() {
  $('#feed').innerHTML = Array.from({ length: 6 }, () => '<li class="skeleton"></li>').join('');
}

function renderSources() {
  const sel = $('#source');
  const feeds = state.status?.feeds ?? {};
  const current = sel.value;
  sel.innerHTML =
    '<option value="">All sources</option>' +
    Object.entries(feeds)
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([id, f]) => `<option value="${esc(id)}">${esc(f.name)}${f.ok === false ? ' (offline)' : ''}</option>`)
      .join('');
  sel.value = current;
}

// ── Status / header ──
function renderStatus() {
  const st = state.status;
  const live = $('#live');
  live.className = `live ${state.connected ? 'on' : 'off'}`;
  $('#liveText').textContent = !state.connected
    ? 'Reconnecting…'
    : st?.lastPoll
      ? `Live · checked ${timeAgo(st.lastPoll)}`
      : 'Live';
  if (!st) return;
  const engine = $('#engine');
  if (st.ai.enabled) {
    engine.textContent = 'Claude scoring';
    engine.title = `Stories scored by ${st.ai.model}; built-in engine fills in until Claude responds`;
  } else {
    engine.textContent = 'Built-in scoring';
    engine.title = `Crypto sentiment lexicon. Claude scoring off: ${st.ai.reason}`;
  }
  const feeds = Object.values(st.feeds);
  const ok = feeds.filter((f) => f.ok).length;
  const bad = feeds.filter((f) => f.ok === false);
  const health = $('#feedHealth');
  health.textContent = `${ok}/${feeds.length} sources online · refreshes every ${st.pollSeconds}s`;
  health.title = bad.length ? `Offline: ${bad.map((f) => `${f.name} (${f.error})`).join(', ')}` : 'All sources responding';
}

// ── Notifications ──
function maybeNotify(items) {
  if (!state.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const recent = Date.now() - 60 * 60_000;
  for (const it of items) {
    if (Math.abs(it.score) < ALERT_THRESHOLD || it.published < recent) continue;
    const n = new Notification(`${arrow(it.score)} ${signed(it.score)} ${it.label}`, { body: `${it.title}\n— ${it.source}`, tag: it.id });
    n.onclick = () => window.open(it.link, '_blank', 'noopener');
  }
}

async function toggleNotify() {
  if (!('Notification' in window)) return alert('This browser does not support notifications.');
  if (!state.notify && Notification.permission !== 'granted') {
    const p = await Notification.requestPermission();
    if (p !== 'granted') return;
  }
  state.notify = !state.notify;
  store.set('notify', state.notify ? '1' : '0');
  syncNotifyBtn();
}
function syncNotifyBtn() {
  const b = $('#notifyBtn');
  b.setAttribute('aria-pressed', String(state.notify));
  b.title = state.notify ? `Alerts on: stories scoring ±${ALERT_THRESHOLD} or more` : 'Alert me on major market-moving news';
}

// ── Live connection ──
function mergeItems(items) {
  const ids = new Set(state.items.map((i) => i.id));
  const fresh = items.filter((i) => !ids.has(i.id));
  fresh.forEach((i) => state.freshIds.add(i.id));
  state.items = [...fresh, ...state.items].sort((a, b) => b.published - a.published);
}

function showPendingBanner() {
  const b = $('#newBanner');
  b.hidden = state.pending.length === 0;
  b.textContent = `▲ ${state.pending.length} new ${state.pending.length === 1 ? 'story' : 'stories'} — show`;
}

function flushPending() {
  if (!state.pending.length) return;
  mergeItems(state.pending);
  state.pending = [];
  showPendingBanner();
  renderFeed();
}

function connect() {
  const es = new EventSource('/api/stream');
  es.addEventListener('open', () => { state.connected = true; renderStatus(); });
  es.addEventListener('error', () => { state.connected = false; renderStatus(); });
  es.addEventListener('init', (e) => {
    const d = JSON.parse(e.data);
    state.items = d.items;
    state.pending = [];
    state.stats = d.stats;
    state.status = d.status;
    state.connected = true;
    renderSources();
    renderStatus();
    renderStats();
    renderFeed();
    showPendingBanner();
  });
  es.addEventListener('items', (e) => {
    const items = JSON.parse(e.data);
    maybeNotify(items);
    if (window.scrollY > 400) {
      state.pending.push(...items);
      showPendingBanner();
    } else {
      mergeItems(items);
      renderFeed();
    }
  });
  es.addEventListener('update', (e) => {
    const it = JSON.parse(e.data);
    const i = state.items.findIndex((x) => x.id === it.id);
    if (i >= 0) {
      state.items[i] = it;
      const el = document.querySelector(`.story[data-id="${CSS.escape(it.id)}"]`);
      if (el) el.outerHTML = storyHtml(it);
    }
  });
  es.addEventListener('stats', (e) => { state.stats = JSON.parse(e.data); renderStats(); });
  es.addEventListener('status', (e) => {
    state.status = JSON.parse(e.data);
    renderSources();
    renderStatus();
    $('#refreshBtn').classList.remove('spin');
  });
}

// ── Events ──
let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.filter.q = e.target.value; state.limit = PAGE; renderFeed(); }, 150);
});
document.querySelectorAll('.seg button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('.seg button').forEach((x) => x.classList.toggle('active', x === b));
    state.filter.sent = b.dataset.sent;
    state.limit = PAGE;
    renderFeed();
  }),
);
$('#source').addEventListener('change', (e) => { state.filter.source = e.target.value; state.limit = PAGE; renderFeed(); });
$('#sort').addEventListener('change', (e) => { state.filter.sort = e.target.value; state.limit = PAGE; renderFeed(); });
$('#moreBtn').addEventListener('click', () => { state.limit += PAGE; renderFeed(); });
$('#newBanner').addEventListener('click', () => { flushPending(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
$('#coinFilter').addEventListener('click', (e) => {
  if (e.target.closest('button')) setCoin('');
});
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-coin]');
  if (c) setCoin(state.filter.coin === c.dataset.coin ? '' : c.dataset.coin);
});
function setCoin(coin) {
  state.filter.coin = coin;
  state.limit = PAGE;
  renderFeed();
  renderStats();
}

$('#splitBar').addEventListener('pointermove', (e) => {
  const seg = e.target.closest('[data-tip]');
  if (seg) showTip(seg.dataset.tip, e.clientX, e.clientY);
  else hideTip();
});
$('#splitBar').addEventListener('pointerleave', hideTip);

$('#refreshBtn').addEventListener('click', async () => {
  $('#refreshBtn').classList.add('spin');
  try { await fetch('/api/refresh', { method: 'POST' }); } catch { /* ignore */ }
  setTimeout(() => $('#refreshBtn').classList.remove('spin'), 15000);
});
$('#notifyBtn').addEventListener('click', toggleNotify);

function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
$('#themeBtn').addEventListener('click', () => {
  const current = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  store.set('theme', next);
  if (state.stats) renderStats();
});

window.addEventListener('scroll', () => { if (window.scrollY < 100) flushPending(); }, { passive: true });
new ResizeObserver(() => state.stats && renderTrend(state.stats.trend)).observe($('#trend'));

// Keep relative times fresh
setInterval(() => {
  document.querySelectorAll('time[data-ts]').forEach((t) => { t.textContent = timeAgo(Number(t.dataset.ts)); });
  renderStatus();
}, 15000);

// ── Boot ──
applyTheme(store.get('theme'));
state.notify = store.get('notify') === '1' && 'Notification' in window && Notification.permission === 'granted';
syncNotifyBtn();
renderGauge(null);
renderSkeleton();
connect();
