// TV home screen backend: one cached JSON for the Mi Box launcher.
// No dependencies. Sources (all free, no keys):
//   NEPTUN  https://neptun.in.ua/developers — threats + alerts (terms: visible link to NEPTUN)
//   ubilling aerialalerts — oblast alert states, fallback when NEPTUN alerts fail
//   Open-Meteo — weather and sunrise for the home city
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT ?? 8098);
const HOST = process.env.HOST ?? '127.0.0.1';
const WEB = path.resolve(process.env.WEB_DIR ?? new URL('../web', import.meta.url).pathname);
const DATA = process.env.DATA_DIR ?? '/data';
const CITY = { name: 'Львів', oblast: 'Львівська область', raion: 'Львівський район', lat: 49.8397, lon: 24.0297 };
const TZ = 'Europe/Kyiv';
const UA = 'TVHome/1.0 (private home screen; +https://neptun.in.ua attribution shown)';

const log = (...a) => console.log(new Date().toISOString(), ...a);
const state = {
  weather: null,
  threats: [],
  alerts: null, // { oblasts: {name: level}, city: {...} }
  fallback: null, // ubilling states
  updated: {},
  errors: {},
};

async function getJson(url, timeout = 12_000) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function every(name, ms, fn) {
  const tick = async () => {
    try {
      await fn();
      state.updated[name] = new Date().toISOString();
      delete state.errors[name];
    } catch (error) {
      state.errors[name] = error.message;
      log(`[${name}]`, error.message);
    }
  };
  tick();
  setInterval(tick, ms);
}

// ---- today's target counter (unique track ids since local midnight) ----
const todayFile = path.join(DATA, 'today.json');
const localDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
let today = { date: localDate(), ids: {} };
try {
  const saved = JSON.parse(fs.readFileSync(todayFile, 'utf8'));
  if (saved.date === today.date) today = saved;
} catch {}
let todayDirty = false;
// Rolling 24 h: hour bucket (epoch hour) → targets first seen in it; plus every id ever counted in the window.
const histFile = path.join(DATA, 'hist.json');
let hist = { buckets: {}, seen: {} };
try { hist = JSON.parse(fs.readFileSync(histFile, 'utf8')); } catch {}
// Lviv alerts today: how many started, total minutes.
const cityFile = path.join(DATA, 'city-alerts.json');
let cityDay = { date: localDate(), count: 0, minutes: 0, since: null };
try { const c = JSON.parse(fs.readFileSync(cityFile, 'utf8')); if (c.date === cityDay.date) cityDay = c; } catch {}
function trackCityAlert(active, sinceIso) {
  const d = localDate();
  if (cityDay.date !== d) cityDay = { date: d, count: 0, minutes: 0, since: cityDay.since };
  if (active && !cityDay.since) { cityDay.since = sinceIso || new Date().toISOString(); cityDay.count++; todayDirty = true; }
  if (!active && cityDay.since) { cityDay.minutes += Math.max(1, Math.round((Date.now() - Date.parse(cityDay.since)) / 60000)); cityDay.since = null; todayDirty = true; }
}
function countToday(threats) {
  const d = localDate();
  if (today.date !== d) today = { date: d, ids: {} };
  const hour = Math.floor(Date.now() / 3600e3);
  for (const t of threats) {
    const n = Math.max(1, Number(t.count) || 1);
    if ((today.ids[t.id] ?? 0) < n) {
      today.ids[t.id] = n;
      todayDirty = true;
    }
    const was = hist.seen[t.id] ?? 0;
    if (n > was) {
      hist.buckets[hour] = (hist.buckets[hour] ?? 0) + (n - was);
      hist.seen[t.id] = n;
      todayDirty = true;
    }
  }
  for (const h of Object.keys(hist.buckets)) if (Number(h) <= hour - 24) delete hist.buckets[h];
  if (Object.keys(hist.seen).length > 5000) hist.seen = Object.fromEntries(Object.entries(hist.seen).slice(-2000));
}
function histogram() {
  const hour = Math.floor(Date.now() / 3600e3);
  const out = [];
  for (let h = hour - 23; h <= hour; h++) out.push(hist.buckets[h] ?? 0);
  return out;
}
setInterval(() => {
  if (!todayDirty) return;
  todayDirty = false;
  try {
    for (const [f, v] of [[todayFile, today], [histFile, hist], [cityFile, cityDay]]) {
      fs.writeFileSync(f + '.tmp', JSON.stringify(v));
      fs.renameSync(f + '.tmp', f);
    }
  } catch (error) {
    log('[today]', error.message);
  }
}, 30_000);

// ---- sources ----
const KIND = (t) => {
  if (t.type === 'missile' || t.type === 'ballistic' || t.type === 'mig31k') return 'missile';
  if (t.type === 'kab') return 'kab';
  if (/реактив/i.test(t.title ?? '')) return 'jet';
  if (t.type === 'uav' || t.type === 'recon' || t.type === 'fpv') return 'uav';
  return 'other';
};

every('threats', 10_000, async () => {
  const d = await getJson('https://neptun.in.ua/api/v1/threats');
  const list = (d.threats ?? []).filter((t) => t.status !== 'resolved' && Number.isFinite(t.lat) && Number.isFinite(t.lon));
  state.threats = list.map((t) => ({
    id: t.id,
    kind: KIND(t),
    title: t.title,
    region: t.region,
    locality: t.locality,
    lat: t.lat,
    lon: t.lon,
    heading: t.velocity?.bearingDeg ?? t.heading ?? null,
    count: Math.max(1, Number(t.count) || 1),
    stale: t.status === 'stale',
    ageMin: t.updatedAt ? Math.max(0, Math.round((Date.now() - Date.parse(t.updatedAt)) / 60000)) : null,
    // last few observed points (oldest first) for the fading trail behind the icon
    trail: (t.trail ?? []).slice(-4, -1).map((p) => [Math.round(p.lat * 1e4) / 1e4, Math.round(p.lon * 1e4) / 1e4]),
  }));
  countToday(list.filter((t) => t.status === 'active'));
});

// Official air-raid alerts, the same feed map.ukrainealarm.com draws (public, no key), keyed by
// ukrainealarm regionId. Regions: State (oblast), District (raion), Community (hromada).
// Level: 'alert' = yellow, 'red' = red level / artillery / street fighting, 'long' = over a day.
const GEO_DIR = process.env.GEO_DIR ?? new URL('./geo', import.meta.url).pathname;
let communityShapes = {};
try { communityShapes = JSON.parse(fs.readFileSync(path.join(GEO_DIR, 'communities.json'), 'utf8')); } catch (e) { log('[geo]', e.message); }
let oblastIdByName = {};
try { for (const o of JSON.parse(fs.readFileSync(path.join(WEB, 'ukraine.json'), 'utf8')).oblasts) oblastIdByName[o.name] = o.id; } catch {}
const CITY_IDS = { state: '27', district: '90', community: '845' }; // Львівська область / Львівський район / м. Львів
const rank = { alert: 1, red: 2, long: 3 };

function levelFrom(region) {
  let lv = null, since = null;
  for (const a of region.activeAlerts ?? []) {
    for (const l of a.activeAlertLevels?.length ? a.activeAlertLevels : [{ alertLevel: 'Yellow', createdAt: a.lastUpdate }]) {
      let v = l.alertLevel === 'Red' || a.type === 'ARTILLERY' || a.type === 'URBAN_FIGHTS' ? 'red' : 'alert';
      if (l.createdAt && Date.now() - Date.parse(l.createdAt) > 24 * 3600_000) v = 'long';
      if (!lv || rank[v] > rank[lv]) lv = v;
      if (!since || (l.createdAt && l.createdAt < since)) since = l.createdAt;
    }
  }
  return lv ? { level: lv, since, types: [...new Set((region.activeAlerts ?? []).map((a) => a.type))] } : null;
}

every('alerts', 15_000, async () => {
  const d = await getJson('https://map.ukrainealarm.com/api/v2/data/mapUpdate');
  const states = {}, districts = {}, communities = {}, since = {};
  let hit = null;
  for (const r of d.alerts ?? []) {
    const lv = levelFrom(r);
    if (!lv) continue;
    if (lv.since) since[r.regionId] = lv.since;
    if (r.regionType === 'State') states[r.regionId] = lv.level;
    else if (r.regionType === 'District') districts[r.regionId] = lv.level;
    else if (r.regionType === 'Community' && communityShapes[r.regionId]) communities[r.regionId] = { level: lv.level, d: communityShapes[r.regionId].d };
    const isCity = (r.regionType === 'State' && r.regionId === CITY_IDS.state) || (r.regionType === 'District' && r.regionId === CITY_IDS.district) || (r.regionType === 'Community' && r.regionId === CITY_IDS.community);
    if (isCity && (r.activeAlerts ?? []).some((a) => a.type === 'AIR')) hit = { since: lv.since, level: lv.level, reasons: lv.types };
  }
  trackCityAlert(Boolean(hit), hit?.since);
  state.alerts = {
    source: 'ukrainealarm',
    states,
    districts,
    communities,
    since,
    city: hit ? { active: true, since: hit.since, level: hit.level, reasons: [] } : { active: false },
  };
});

// ---- exchange rates (NBU, official) with change vs the previous day ----
every('rates', 60 * 60_000, async () => {
  const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d).replaceAll('-', '');
  const pick = (list) => Object.fromEntries((list ?? []).filter((x) => ['USD', 'EUR', 'PLN'].includes(x.cc)).map((x) => [x.cc, x.rate]));
  const list = await getJson('https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json');
  const today = pick(list);
  // compare with the day before the rate's own date (NBU publishes tomorrow's rate in the evening)
  const [dd, mm, yyyy] = String(list?.[0]?.exchangedate ?? '').split('.');
  const base = dd ? new Date(Date.UTC(+yyyy, +mm - 1, +dd, 12)) : new Date();
  const prev = pick(await getJson(`https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?date=${ymd(new Date(base - 86400e3))}&json`));
  state.rates = Object.fromEntries(Object.entries(today).map(([k, v]) => [k, { rate: v, delta: prev[k] != null ? Math.round((v - prev[k]) * 1000) / 1000 : null }]));
});

// ---- headlines (RSS; Ukrainska Pravda, Ukrinform as backup) ----
const FEEDS = [
  { name: 'Українська правда', url: 'https://www.pravda.com.ua/rss/view_news/' },
  { name: 'Укрінформ', url: 'https://www.ukrinform.ua/rss/block-lastnews' },
];
const unxml = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&quot;/g, '"').replace(/&#039;|&apos;/g, "'").replace(/&laquo;/g, '«').replace(/&raquo;/g, '»').replace(/&amp;/g, '&').replace(/<[^>]+>/g, '').trim();
every('news', 10 * 60_000, async () => {
  let lastError;
  for (const f of FEEDS) {
    try {
      const res = await fetch(f.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 9).map((m) => ({
        title: unxml((/<title>([\s\S]*?)<\/title>/.exec(m[1]) ?? [])[1] ?? ''),
        at: (/<pubDate>([\s\S]*?)<\/pubDate>/.exec(m[1]) ?? [])[1] ?? null,
      })).filter((x) => x.title);
      if (!items.length) throw new Error('empty feed');
      state.news = { source: f.name, items: items.map((x) => ({ title: x.title, at: x.at ? new Date(x.at).toISOString() : null })) };
      return;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
});

every('fallback', 30_000, async () => {
  const d = await getJson('https://ubilling.net.ua/aerialalerts/');
  state.fallback = d.states ?? null;
});

const WMO = {
  0: 'ясно', 1: 'переважно ясно', 2: 'мінлива хмарність', 3: 'хмарно', 45: 'туман', 48: 'паморозь',
  51: 'мряка', 53: 'мряка', 55: 'сильна мряка', 56: 'крижана мряка', 57: 'крижана мряка',
  61: 'невеликий дощ', 63: 'дощ', 65: 'злива', 66: 'крижаний дощ', 67: 'крижаний дощ',
  71: 'невеликий сніг', 73: 'сніг', 75: 'снігопад', 77: 'снігова крупа',
  80: 'короткочасний дощ', 81: 'зливи', 82: 'сильні зливи', 85: 'сніг', 86: 'сильний сніг',
  95: 'гроза', 96: 'гроза з градом', 99: 'гроза з градом',
};
every('weather', 10 * 60_000, async () => {
  const q = new URLSearchParams({
    latitude: CITY.lat, longitude: CITY.lon, timezone: TZ, forecast_days: '2',
    current: 'temperature_2m,weather_code,is_day',
    hourly: 'precipitation_probability,precipitation,weather_code',
    daily: 'sunrise,sunset,temperature_2m_max,temperature_2m_min,weather_code',
  });
  const d = await getJson(`https://api.open-meteo.com/v1/forecast?${q}`);
  state.weather = {
    temp: Math.round(d.current.temperature_2m),
    code: d.current.weather_code,
    text: WMO[d.current.weather_code] ?? '—',
    isDay: Boolean(d.current.is_day),
    max: Math.round(d.daily.temperature_2m_max[0]),
    min: Math.round(d.daily.temperature_2m_min[0]),
    sunrise: d.daily.sunrise, // local ISO without offset, [today, tomorrow]
    sunset: d.daily.sunset,
  };
  state.raw = d;
});

// "> погода" forecast line: morning → today, afternoon → until evening, evening/night → tomorrow.
const SNOW = new Set([71, 73, 75, 77, 85, 86]);
function forecast() {
  const d = state.raw;
  if (!d) return null;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour);
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const tomorrow = d.daily.time[1];
  let label, day, from, to;
  if (hour >= 5 && hour < 11) [label, day, from, to] = ['сьогодні', today, hour, 23];
  else if (hour >= 11 && hour < 17) [label, day, from, to] = ['до вечора', today, hour, 22];
  else [label, day, from, to] = ['завтра', hour < 5 ? today : tomorrow, 6, 23];
  const di = d.daily.time.indexOf(day);
  const wet = [];
  d.hourly.time.forEach((t, i) => {
    const [date, hh] = t.split('T');
    const h = Number(hh.slice(0, 2));
    if (date !== day || h < from || h > to) return;
    if ((d.hourly.precipitation_probability[i] ?? 0) >= 50 || (d.hourly.precipitation[i] ?? 0) >= 0.3) wet.push({ h, snow: SNOW.has(d.hourly.weather_code[i]) });
  });
  const out = { label, max: Math.round(d.daily.temperature_2m_max[di]), min: Math.round(d.daily.temperature_2m_min[di]), text: WMO[d.daily.weather_code[di]] ?? '' };
  if (wet.length) {
    const snow = wet.filter((w) => w.snow).length > wet.length / 2;
    out.precip = { kind: snow ? 'сніг' : 'дощ', from: wet[0].h, to: wet[wet.length - 1].h + 1 };
    out.advice = snow ? 'одягнись тепліше' : 'візьми парасолю';
  } else {
    const code = d.daily.weather_code[di];
    // light precipitation the hourly odds don't call likely: mention it, keep the umbrella optional
    out.advice = out.max <= 0 ? 'одягнись тепліше' : code >= 51 ? 'парасолю про запас' : 'без опадів';
  }
  return out;
}

// Pi health: the host's sensors are visible through the container's read-only /sys and /proc.
function readNum(file) {
  try { return Number(fs.readFileSync(file, 'utf8').trim()); } catch { return null; }
}
function hwmonTemp(name) {
  try {
    for (const h of fs.readdirSync('/sys/class/hwmon')) {
      const base = `/sys/class/hwmon/${h}`;
      if (fs.readFileSync(`${base}/name`, 'utf8').trim() === name) return readNum(`${base}/temp1_input`) / 1000;
    }
  } catch {}
  return null;
}
function piStatus() {
  const mem = {};
  try {
    for (const line of fs.readFileSync('/proc/meminfo', 'utf8').split('\n')) {
      const m = /^(\w+):\s+(\d+)/.exec(line);
      if (m) mem[m[1]] = Number(m[2]);
    }
  } catch {}
  const up = (() => { try { return Number(fs.readFileSync('/proc/uptime', 'utf8').split(' ')[0]); } catch { return null; } })();
  return {
    cpu: hwmonTemp('cpu_thermal'),
    disk: hwmonTemp('nvme'),
    ram: mem.MemTotal ? Math.round((1 - mem.MemAvailable / mem.MemTotal) * 100) : null,
    uptimeSec: up,
  };
}

// Newest mtime under web/: the page reloads itself when it changes, so edits reach the TV.
let webVer = { at: 0, v: '' };
function webVersion() {
  if (Date.now() - webVer.at < 10_000) return webVer.v;
  let max = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else max = Math.max(max, fs.statSync(f).mtimeMs);
    }
  };
  try { walk(WEB); } catch {}
  webVer = { at: Date.now(), v: String(Math.round(max)) };
  return webVer.v;
}

function snapshot() {
  let { alerts } = state;
  // ukrainealarm down → oblast-level fallback (ubilling) so the screen never lies by omission.
  if ((!alerts || state.errors.alerts) && state.fallback) {
    const states = {};
    for (const [name, st] of Object.entries(state.fallback)) if (st.alertnow && oblastIdByName[name]) states[oblastIdByName[name]] = 'alert';
    const c = state.fallback[CITY.oblast];
    alerts = { source: 'ubilling', states, districts: {}, communities: {}, city: c?.alertnow ? { active: true, since: c.changed, level: 'alert', reasons: [] } : { active: false }, fallback: true };
  }
  const counts = {};
  for (const t of state.threats) if (!t.stale) counts[t.kind] = (counts[t.kind] ?? 0) + t.count;
  return {
    now: new Date().toISOString(),
    city: CITY.name,
    weather: state.weather,
    forecast: forecast(),
    rates: state.rates ?? null,
    news: state.news ?? null,
    pi: piStatus(),
    alerts,
    threats: state.threats,
    counts,
    inSky: Object.values(counts).reduce((a, b) => a + b, 0),
    today: Object.values(today.ids).reduce((a, b) => a + b, 0),
    hist: histogram(),
    cityToday: { count: cityDay.count, minutes: cityDay.minutes + (cityDay.since ? Math.round((Date.now() - Date.parse(cityDay.since)) / 60000) : 0), active: Boolean(cityDay.since) },
    webVersion: webVersion(),
    updated: state.updated,
    errors: state.errors,
  };
}

let testAlert = null;

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/api/state') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(snapshot()));
    }
    if (url.pathname === '/api/alert') {
      // Small poll target for the launcher's background alert watch.
      const snap = snapshot();
      let city = snap.alerts?.city ?? { active: false };
      if (testAlert && testAlert.until > Date.now()) city = testAlert.city;
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ city: CITY.name, ...city, known: Boolean(snap.alerts) }));
    }
    if (url.pathname === '/api/test-alert' && req.method === 'POST') {
      // Only from the Pi itself: lets us check the overlay on the box without a real alert.
      const ip = req.socket.remoteAddress ?? '';
      if (!/^(::ffff:)?(127\.|172\.|192\.168\.1\.16$)/.test(ip)) { res.writeHead(403); return res.end('forbidden'); }
      const st = url.searchParams.get('state');
      testAlert = st === 'on' ? { until: Date.now() + 120_000, city: { active: true, since: new Date().toISOString(), level: 'red', reasons: ['Тест сповіщення'] } }
        : st === 'off' ? { until: Date.now() + 120_000, city: { active: false } } : null;
      return res.end('ok ' + (st ?? 'auto'));
    }
    if (url.pathname === '/api/public/alerts') {
      // Public (through the Cloudflare tunnel): official ukrainealarm alerts by oblast/district/community,
      // for TVHome APKs outside this LAN. Nothing about the Pi or the household is exposed here.
      let al = state.alerts ?? null;
      if (al && testAlert && testAlert.until > Date.now() && testAlert.city.active) {
        // test switch (POST /api/test-alert from the Pi) also reaches the APKs: Lviv oblast under alert
        al = { ...al, states: { ...al.states, '27': 'red' }, since: { ...(al.since ?? {}), '27': testAlert.city.since } };
      }
      res.writeHead(al ? 200 : 503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=10', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify(al ? { source: al.source, updated: state.updated.alerts ?? null, states: al.states, districts: al.districts, communities: al.communities, since: al.since ?? {} } : { error: 'no data yet' }));
    }
    if (url.pathname === '/api/diag') {
      log('[diag]', url.search.slice(0, 300));
      return res.end('ok');
    }
    if (url.pathname === '/api/public/download/tvhome.apk') {
      // the current launcher build, for sharing (dist/ is mounted read-only)
      const apk = path.join(process.env.DIST_DIR ?? '/dist', 'tvhome.apk');
      if (!fs.existsSync(apk)) { res.writeHead(404); return res.end('no build'); }
      res.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Disposition': 'attachment; filename="tvhome.apk"', 'Content-Length': fs.statSync(apk).size });
      return fs.createReadStream(apk).pipe(res);
    }
    if (url.pathname === '/healthz') return res.end('ok');
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(WEB, rel);
    if (!file.startsWith(WEB + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, HOST, () => log(`tvhome on http://${HOST}:${PORT}`));

for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
