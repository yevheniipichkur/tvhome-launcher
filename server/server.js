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
function countToday(threats) {
  const d = localDate();
  if (today.date !== d) today = { date: d, ids: {} };
  for (const t of threats) {
    const n = Math.max(1, Number(t.count) || 1);
    if ((today.ids[t.id] ?? 0) < n) {
      today.ids[t.id] = n;
      todayDirty = true;
    }
  }
}
setInterval(() => {
  if (!todayDirty) return;
  todayDirty = false;
  try {
    fs.writeFileSync(todayFile + '.tmp', JSON.stringify(today));
    fs.renameSync(todayFile + '.tmp', todayFile);
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
    // last few observed points (oldest first) for the fading trail behind the icon
    trail: (t.trail ?? []).slice(-4, -1).map((p) => [Math.round(p.lat * 1e4) / 1e4, Math.round(p.lon * 1e4) / 1e4]),
  }));
  countToday(list.filter((t) => t.status === 'active'));
});

// Alert levels per raion (and whole oblasts), keyed like web/ukraine.json: "<oblast>|<raion name>".
// 'long' = has lasted over a day (occupied/front-line areas), drawn darker like ukrainealarm.
const apos = (s) => String(s ?? '').replace(/[’ʼ]/g, "'");
const levelOf = (x) => {
  if (x.since && Date.now() - Date.parse(x.since) > 24 * 3600_000) return 'long';
  return x.level === 'red' ? 'red' : 'alert';
};
every('alerts', 15_000, async () => {
  const d = await getJson('https://neptun.in.ua/api/v1/alerts');
  const oblasts = {};
  for (const o of d.oblasts ?? []) {
    const name = o.name === 'Севастополь' ? 'Севастополь' : o.oblast ?? o.name;
    oblasts[name] = levelOf(o);
  }
  const raions = {};
  for (const r of d.raions ?? []) raions[`${r.oblast}|${apos(r.name)}`] = levelOf(r);
  const whole = (d.oblasts ?? []).find((o) => (o.oblast ?? o.name) === CITY.oblast);
  const raion = (d.raions ?? []).find((r) => r.name === CITY.raion);
  const hit = whole ?? raion ?? null;
  state.alerts = {
    oblasts,
    raions,
    city: hit ? { active: true, since: hit.since, level: hit.level, reasons: hit.reasons ?? [] } : { active: false },
  };
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
  // NEPTUN alerts down → oblast-level fallback so the screen never lies by omission.
  if ((!alerts || state.errors.alerts) && state.fallback) {
    const oblasts = {};
    for (const [name, s] of Object.entries(state.fallback)) if (s.alertnow) oblasts[name] = 'alert';
    const c = state.fallback[CITY.oblast];
    alerts = { oblasts, raions: {}, city: c?.alertnow ? { active: true, since: c.changed, level: 'alert', reasons: [] } : { active: false }, fallback: true };
  }
  const counts = {};
  for (const t of state.threats) if (!t.stale) counts[t.kind] = (counts[t.kind] ?? 0) + t.count;
  return {
    now: new Date().toISOString(),
    city: CITY.name,
    weather: state.weather,
    forecast: forecast(),
    pi: piStatus(),
    alerts,
    threats: state.threats,
    counts,
    inSky: Object.values(counts).reduce((a, b) => a + b, 0),
    today: Object.values(today.ids).reduce((a, b) => a + b, 0),
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
    if (url.pathname === '/api/diag') {
      log('[diag]', url.search.slice(0, 300));
      return res.end('ok');
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
