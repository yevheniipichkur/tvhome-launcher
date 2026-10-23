package pl.pichkur.tvhome;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.TimeZone;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Everything the home screen shows, fetched by the box itself (no home server needed):
 *  - targets: NEPTUN open API (terms: visible NEPTUN credit, shown under the map)
 *  - alerts by oblast/district/community: our public API (tvhome.pichkur.com/api/public/alerts,
 *    official ukrainealarm data — ukrainealarm has no open API for it); oblast-level fallback: ubilling
 *  - weather: Open-Meteo; rates: NBU; headlines: Ukrainska Pravda RSS (Ukrinform as backup)
 * The page reads one JSON snapshot (same shape the Pi server used to serve) through snapshot().
 */
final class DataService {
    private static final String UA = "TVHome/1.0 (Android TV home screen)";
    private static final String TZ = "Europe/Kyiv";
    private static final String ALERTS_URL = "https://tvhome.pichkur.com/api/public/alerts";

    // The home city, chosen in the launcher's settings (web/cities.json); Lviv until then.
    // ukrainealarm ids: state (oblast) / district / community.
    private static final String DEFAULT_CITY = "{\"id\":\"Львів\",\"name\":\"Львів\",\"loc\":\"у Львові\",\"lat\":49.8397,\"lon\":24.0297,"
            + "\"oblast\":\"Львівська область\",\"state\":\"27\",\"district\":\"90\",\"community\":\"845\"}";
    private volatile JSONObject city;
    private String cityName() { return city.optString("name", "Львів"); }

    private static DataService instance;

    static synchronized DataService get(Context ctx) {
        if (instance == null) instance = new DataService(ctx.getApplicationContext());
        return instance;
    }

    private final Context ctx;
    private final SharedPreferences prefs;
    private final ScheduledExecutorService pool = Executors.newScheduledThreadPool(3);

    private volatile JSONObject weather, raw, alerts, rates, news;
    private volatile JSONArray threats = new JSONArray();
    private volatile JSONObject fallback; // ubilling states
    private final JSONObject updated = new JSONObject();
    private final JSONObject errors = new JSONObject();
    private final Map<String, String> oblastIdByName = new HashMap<>();

    // today's unique targets (since local midnight, Kyiv)
    private String todayDate;
    private JSONObject todayIds = new JSONObject();
    private boolean todayDirty;

    private DataService(Context ctx) {
        this.ctx = ctx;
        prefs = ctx.getSharedPreferences("tvhome-data", Context.MODE_PRIVATE);
        try { city = new JSONObject(prefs.getString("city", DEFAULT_CITY)); } catch (Exception e) { try { city = new JSONObject(DEFAULT_CITY); } catch (Exception ignored) { } }
        todayDate = prefs.getString("today_date", localDate());
        try { todayIds = new JSONObject(prefs.getString("today_ids", "{}")); } catch (Exception ignored) { }
        loadOblastIds();
        every("threats", 0, 10, this::pollThreats);
        every("alerts", 1, 15, this::pollAlerts);
        every("fallback", 2, 30, this::pollFallback);
        every("weather", 1, 600, this::pollWeather);
        every("rates", 3, 3600, this::pollRates);
        every("news", 4, 600, this::pollNews);
        pool.scheduleWithFixedDelay(this::saveToday, 30, 30, TimeUnit.SECONDS);
    }

    /** Settings: switch the home city (JSON from web/cities.json). Weather and alerts refresh at once. */
    void setCity(String json) {
        try {
            JSONObject c = new JSONObject(json);
            if (!c.has("lat") || !c.has("lon") || !c.has("state")) return;
            city = c;
            prefs.edit().putString("city", c.toString()).apply();
            pool.execute(() -> { try { pollWeather(); } catch (Exception ignored) { } });
            pool.execute(() -> { try { pollAlerts(); } catch (Exception ignored) { } });
        } catch (Exception ignored) {
        }
    }

    String getCity() { return city.toString(); }

    private interface Job { void run() throws Exception; }

    private void every(String name, long delay, long period, Job job) {
        pool.scheduleWithFixedDelay(() -> {
            try {
                job.run();
                synchronized (updated) { updated.put(name, iso(new Date())); }
                synchronized (errors) { errors.remove(name); }
            } catch (Throwable e) {
                try { synchronized (errors) { errors.put(name, String.valueOf(e.getMessage())); } } catch (Exception ignored) { }
            }
        }, delay, period, TimeUnit.SECONDS);
    }

    // ---------- http ----------
    private static String http(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10_000);
        c.setReadTimeout(12_000);
        c.setRequestProperty("User-Agent", UA);
        try {
            int code = c.getResponseCode();
            if (code != 200) throw new Exception("HTTP " + code);
            InputStream in = c.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } finally {
            c.disconnect();
        }
    }

    private static String iso(Date d) {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(d);
    }

    private static long parseIso(String s) {
        if (s == null || s.isEmpty() || "null".equals(s)) return 0;
        try {
            String clean = s.replaceAll("\\.\\d+", "").replace("Z", "+0000").replaceAll("([+-]\\d{2}):(\\d{2})$", "$1$2");
            return new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZ", Locale.US).parse(clean).getTime();
        } catch (Exception e) {
            return 0;
        }
    }

    private static String localDate() {
        SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone(TZ));
        return f.format(new Date());
    }

    // ---------- targets (NEPTUN) ----------
    private static String kind(JSONObject t) {
        String type = t.optString("type"), title = t.optString("title");
        if (type.equals("missile") || type.equals("ballistic") || type.equals("mig31k")) return "missile";
        if (type.equals("kab")) return "kab";
        if (title.toLowerCase(Locale.ROOT).contains("реактив")) return "jet";
        if (type.equals("uav") || type.equals("recon") || type.equals("fpv")) return "uav";
        return "other";
    }

    private long lastThreats;

    /** 01:00–07:00 local: refresh targets once a minute instead of every 10 s. */
    static boolean night() {
        int h = Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
        return h >= 1 && h < 7;
    }

    private void pollThreats() throws Exception {
        if (night() && System.currentTimeMillis() - lastThreats < 55_000) return;
        lastThreats = System.currentTimeMillis();
        JSONObject d = new JSONObject(http("https://neptun.in.ua/api/v1/threats"));
        JSONArray in = d.optJSONArray("threats");
        JSONArray out = new JSONArray();
        List<JSONObject> active = new ArrayList<>();
        long now = System.currentTimeMillis();
        for (int i = 0; in != null && i < in.length(); i++) {
            JSONObject t = in.getJSONObject(i);
            String status = t.optString("status");
            if ("resolved".equals(status) || !t.has("lat") || !t.has("lon") || t.isNull("lat") || t.isNull("lon")) continue;
            JSONObject o = new JSONObject();
            o.put("id", t.optString("id"));
            o.put("kind", kind(t));
            o.put("title", t.optString("title"));
            o.put("region", t.optString("region"));
            o.put("lat", t.getDouble("lat"));
            o.put("lon", t.getDouble("lon"));
            JSONObject vel = t.optJSONObject("velocity");
            if (vel != null && vel.has("bearingDeg") && !vel.isNull("bearingDeg")) o.put("heading", vel.getDouble("bearingDeg"));
            else if (t.has("heading") && !t.isNull("heading")) o.put("heading", t.getDouble("heading"));
            else o.put("heading", JSONObject.NULL);
            o.put("count", Math.max(1, t.optInt("count", 1)));
            o.put("stale", "stale".equals(status));
            long upd = parseIso(t.optString("updatedAt", null));
            o.put("ageMin", upd > 0 ? Math.max(0, Math.round((now - upd) / 60000.0)) : JSONObject.NULL);
            JSONArray trail = t.optJSONArray("trail"), tr = new JSONArray();
            if (trail != null && trail.length() > 1) {
                int from = Math.max(0, trail.length() - 4), to = trail.length() - 1;
                for (int k = from; k < to; k++) {
                    JSONObject p = trail.getJSONObject(k);
                    tr.put(new JSONArray().put(Math.round(p.optDouble("lat") * 1e4) / 1e4).put(Math.round(p.optDouble("lon") * 1e4) / 1e4));
                }
            }
            o.put("trail", tr);
            out.put(o);
            if ("active".equals(status)) active.add(o);
        }
        threats = out;
        countToday(active);
    }

    private synchronized void countToday(List<JSONObject> list) throws Exception {
        String d = localDate();
        if (!d.equals(todayDate)) { todayDate = d; todayIds = new JSONObject(); todayDirty = true; }
        for (JSONObject t : list) {
            String id = t.optString("id");
            int n = t.optInt("count", 1);
            if (todayIds.optInt(id, 0) < n) { todayIds.put(id, n); todayDirty = true; }
        }
    }

    private synchronized int todayTotal() {
        if (!localDate().equals(todayDate)) return 0;
        int sum = 0;
        for (Iterator<String> it = todayIds.keys(); it.hasNext(); ) sum += todayIds.optInt(it.next(), 0);
        return sum;
    }

    private synchronized void saveToday() {
        if (!todayDirty) return;
        todayDirty = false;
        prefs.edit().putString("today_date", todayDate).putString("today_ids", todayIds.toString()).apply();
    }

    // ---------- alerts (our public API + ubilling fallback) ----------
    private void loadOblastIds() {
        try (InputStream in = ctx.getAssets().open("web/ukraine.json")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
            JSONArray ob = new JSONObject(out.toString("UTF-8")).getJSONArray("oblasts");
            for (int i = 0; i < ob.length(); i++) oblastIdByName.put(ob.getJSONObject(i).getString("name"), ob.getJSONObject(i).getString("id"));
        } catch (Exception ignored) {
        }
    }

    private void pollAlerts() throws Exception {
        JSONObject d = new JSONObject(http(ALERTS_URL));
        JSONObject states = d.optJSONObject("states"), districts = d.optJSONObject("districts"), comms = d.optJSONObject("communities"), since = d.optJSONObject("since");
        if (states == null) throw new Exception("bad alerts payload");
        JSONObject cityState = new JSONObject();
        String cs = city.optString("state", ""), cd = city.optString("district", ""), cc = city.optString("community", "");
        String hit = states.has(cs) ? cs : districts != null && !cd.isEmpty() && districts.has(cd) ? cd : comms != null && !cc.isEmpty() && comms.has(cc) ? cc : null;
        if (hit != null) {
            cityState.put("active", true);
            cityState.put("since", since != null ? since.optString(hit, null) : JSONObject.NULL);
            cityState.put("level", hit.equals(cc) && comms != null && comms.has(cc) ? comms.getJSONObject(hit).optString("level") : (hit.equals(cs) ? states : districts).optString(hit));
            cityState.put("reasons", new JSONArray());
        } else {
            cityState.put("active", false);
        }
        JSONObject a = new JSONObject();
        a.put("source", d.optString("source", "ukrainealarm"));
        a.put("states", states);
        a.put("districts", districts != null ? districts : new JSONObject());
        a.put("communities", comms != null ? comms : new JSONObject());
        a.put("city", cityState);
        alerts = a;
    }

    private void pollFallback() throws Exception {
        fallback = new JSONObject(http("https://ubilling.net.ua/aerialalerts/")).optJSONObject("states");
    }

    private JSONObject currentAlerts() throws Exception {
        boolean down;
        synchronized (errors) { down = errors.has("alerts"); }
        if ((alerts == null || down) && fallback != null) {
            JSONObject states = new JSONObject();
            for (Iterator<String> it = fallback.keys(); it.hasNext(); ) {
                String name = it.next();
                JSONObject st = fallback.optJSONObject(name);
                if (st != null && st.optBoolean("alertnow") && oblastIdByName.containsKey(name)) states.put(oblastIdByName.get(name), "alert");
            }
            JSONObject c = fallback.optJSONObject(city.optString("oblast")), cityState = new JSONObject();
            boolean on = c != null && c.optBoolean("alertnow");
            cityState.put("active", on);
            if (on) { cityState.put("since", c.optString("changed", null)); cityState.put("level", "alert"); cityState.put("reasons", new JSONArray()); }
            JSONObject a = new JSONObject();
            a.put("source", "ubilling");
            a.put("states", states);
            a.put("districts", new JSONObject());
            a.put("communities", new JSONObject());
            a.put("city", cityState);
            a.put("fallback", true);
            return a;
        }
        return alerts;
    }

    /** For the alert overlay: {city, active, since, level, reasons, known}. */
    JSONObject cityAlert() {
        JSONObject o = new JSONObject();
        try {
            JSONObject a = currentAlerts();
            JSONObject c = a != null ? a.optJSONObject("city") : null;
            o.put("city", cityName());
            o.put("known", a != null);
            o.put("active", c != null && c.optBoolean("active"));
            if (c != null) { o.put("since", c.opt("since")); o.put("level", c.opt("level")); o.put("reasons", c.optJSONArray("reasons")); }
        } catch (Exception ignored) {
        }
        return o;
    }

    // ---------- weather (Open-Meteo) ----------
    private static final Map<Integer, String> WMO = new HashMap<>();
    static {
        Object[][] m = {{0, "ясно"}, {1, "переважно ясно"}, {2, "мінлива хмарність"}, {3, "хмарно"}, {45, "туман"}, {48, "паморозь"},
                {51, "мряка"}, {53, "мряка"}, {55, "сильна мряка"}, {56, "крижана мряка"}, {57, "крижана мряка"},
                {61, "невеликий дощ"}, {63, "дощ"}, {65, "злива"}, {66, "крижаний дощ"}, {67, "крижаний дощ"},
                {71, "невеликий сніг"}, {73, "сніг"}, {75, "снігопад"}, {77, "снігова крупа"},
                {80, "короткочасний дощ"}, {81, "зливи"}, {82, "сильні зливи"}, {85, "сніг"}, {86, "сильний сніг"},
                {95, "гроза"}, {96, "гроза з градом"}, {99, "гроза з градом"}};
        for (Object[] e : m) WMO.put((Integer) e[0], (String) e[1]);
    }

    private void pollWeather() throws Exception {
        String q = "latitude=" + city.optDouble("lat") + "&longitude=" + city.optDouble("lon") + "&timezone=Europe%2FKyiv&forecast_days=2"
                + "&current=temperature_2m,weather_code,is_day&hourly=precipitation_probability,precipitation,weather_code"
                + "&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min,weather_code";
        JSONObject d = new JSONObject(http("https://api.open-meteo.com/v1/forecast?" + q));
        JSONObject cur = d.getJSONObject("current"), day = d.getJSONObject("daily");
        JSONObject w = new JSONObject();
        int code = cur.getInt("weather_code");
        w.put("temp", Math.round(cur.getDouble("temperature_2m")));
        w.put("code", code);
        w.put("text", WMO.containsKey(code) ? WMO.get(code) : "—");
        w.put("isDay", cur.optInt("is_day") == 1);
        w.put("max", Math.round(day.getJSONArray("temperature_2m_max").getDouble(0)));
        w.put("min", Math.round(day.getJSONArray("temperature_2m_min").getDouble(0)));
        w.put("sunrise", day.getJSONArray("sunrise"));
        w.put("sunset", day.getJSONArray("sunset"));
        weather = w;
        raw = d;
    }

    private static final Set<Integer> SNOW = new HashSet<>(java.util.Arrays.asList(71, 73, 75, 77, 85, 86));

    private JSONObject forecast() throws Exception {
        JSONObject d = raw;
        if (d == null) return null;
        Calendar k = Calendar.getInstance(TimeZone.getTimeZone(TZ));
        int hour = k.get(Calendar.HOUR_OF_DAY);
        String today = localDate();
        JSONArray days = d.getJSONObject("daily").getJSONArray("time");
        String tomorrow = days.length() > 1 ? days.getString(1) : today;
        String label, day;
        int from, to;
        if (hour >= 5 && hour < 11) { label = "сьогодні"; day = today; from = hour; to = 23; }
        else if (hour >= 11 && hour < 17) { label = "до вечора"; day = today; from = hour; to = 22; }
        else { label = "завтра"; day = hour < 5 ? today : tomorrow; from = 6; to = 23; }
        int di = 0;
        for (int i = 0; i < days.length(); i++) if (days.getString(i).equals(day)) di = i;
        JSONObject hourly = d.getJSONObject("hourly");
        JSONArray ht = hourly.getJSONArray("time"), pp = hourly.getJSONArray("precipitation_probability"), pr = hourly.getJSONArray("precipitation"), wc = hourly.getJSONArray("weather_code");
        int first = -1, last = -1, snow = 0, wet = 0;
        for (int i = 0; i < ht.length(); i++) {
            String[] p = ht.getString(i).split("T");
            int h = Integer.parseInt(p[1].substring(0, 2));
            if (!p[0].equals(day) || h < from || h > to) continue;
            if (pp.optInt(i, 0) >= 50 || pr.optDouble(i, 0) >= 0.3) {
                if (first < 0) first = h;
                last = h;
                wet++;
                if (SNOW.contains(wc.optInt(i))) snow++;
            }
        }
        JSONObject daily = d.getJSONObject("daily");
        JSONObject out = new JSONObject();
        int code = daily.getJSONArray("weather_code").getInt(di);
        long max = Math.round(daily.getJSONArray("temperature_2m_max").getDouble(di));
        out.put("label", label);
        out.put("max", max);
        out.put("min", Math.round(daily.getJSONArray("temperature_2m_min").getDouble(di)));
        out.put("text", WMO.containsKey(code) ? WMO.get(code) : "");
        if (wet > 0) {
            boolean isSnow = snow > wet / 2.0;
            out.put("precip", new JSONObject().put("kind", isSnow ? "сніг" : "дощ").put("from", first).put("to", last + 1));
            out.put("advice", isSnow ? "одягнись тепліше" : "візьми парасолю");
        } else {
            out.put("advice", max <= 0 ? "одягнись тепліше" : code >= 51 ? "парасолю про запас" : "без опадів");
        }
        return out;
    }

    // ---------- rates (NBU) ----------
    private void pollRates() throws Exception {
        JSONArray list = new JSONArray(http("https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json"));
        Map<String, Double> today = pick(list);
        String exd = list.length() > 0 ? list.getJSONObject(0).optString("exchangedate") : "";
        Calendar c = Calendar.getInstance(TimeZone.getTimeZone(TZ));
        try { c.setTime(new SimpleDateFormat("dd.MM.yyyy", Locale.US).parse(exd)); } catch (Exception ignored) { }
        c.add(Calendar.DAY_OF_MONTH, -1);
        String prevDay = new SimpleDateFormat("yyyyMMdd", Locale.US).format(c.getTime());
        Map<String, Double> prev = pick(new JSONArray(http("https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?date=" + prevDay + "&json")));
        JSONObject r = new JSONObject();
        for (Map.Entry<String, Double> e : today.entrySet()) {
            JSONObject o = new JSONObject().put("rate", e.getValue());
            Double p = prev.get(e.getKey());
            o.put("delta", p != null ? Math.round((e.getValue() - p) * 1000) / 1000.0 : JSONObject.NULL);
            r.put(e.getKey(), o);
        }
        rates = r;
    }

    private static Map<String, Double> pick(JSONArray list) throws Exception {
        Map<String, Double> m = new HashMap<>();
        for (int i = 0; i < list.length(); i++) {
            JSONObject x = list.getJSONObject(i);
            String cc = x.optString("cc");
            if (cc.equals("USD") || cc.equals("EUR") || cc.equals("PLN")) m.put(cc, x.getDouble("rate"));
        }
        return m;
    }

    // ---------- headlines (RSS) ----------
    private static final String[][] FEEDS = {{"Українська правда", "https://www.pravda.com.ua/rss/view_news/"}, {"Укрінформ", "https://www.ukrinform.ua/rss/block-lastnews"}};
    private static final Pattern ITEM = Pattern.compile("<item>([\\s\\S]*?)</item>"), TITLE = Pattern.compile("<title>([\\s\\S]*?)</title>"), DATE = Pattern.compile("<pubDate>([\\s\\S]*?)</pubDate>");

    private static String unxml(String s) {
        return s.replaceAll("<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>", "$1").replace("&quot;", "\"").replace("&#039;", "'").replace("&apos;", "'")
                .replace("&laquo;", "«").replace("&raquo;", "»").replace("&amp;", "&").replaceAll("<[^>]+>", "").trim();
    }

    private void pollNews() throws Exception {
        Exception last = null;
        for (String[] f : FEEDS) {
            try {
                String xml = http(f[1]);
                JSONArray items = new JSONArray();
                Matcher m = ITEM.matcher(xml);
                SimpleDateFormat rfc = new SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss Z", Locale.US);
                while (m.find() && items.length() < 9) {
                    Matcher t = TITLE.matcher(m.group(1)), d = DATE.matcher(m.group(1));
                    if (!t.find()) continue;
                    String title = unxml(t.group(1));
                    if (title.isEmpty()) continue;
                    JSONObject o = new JSONObject().put("title", title);
                    try { o.put("at", d.find() ? iso(rfc.parse(d.group(1).trim())) : JSONObject.NULL); } catch (Exception e) { o.put("at", JSONObject.NULL); }
                    items.put(o);
                }
                if (items.length() == 0) throw new Exception("empty feed");
                news = new JSONObject().put("source", f[0]).put("items", items);
                return;
            } catch (Exception e) {
                last = e;
            }
        }
        if (last != null) throw last;
    }

    // ---------- snapshot for the page ----------
    String snapshot() {
        try {
            JSONObject s = new JSONObject();
            s.put("now", iso(new Date()));
            s.put("city", cityName());
            s.put("cityInfo", city);
            s.put("weather", weather != null ? weather : JSONObject.NULL);
            JSONObject fc = null;
            try { fc = forecast(); } catch (Exception ignored) { }
            s.put("forecast", fc != null ? fc : JSONObject.NULL);
            s.put("rates", rates != null ? rates : JSONObject.NULL);
            s.put("news", news != null ? news : JSONObject.NULL);
            s.put("pi", JSONObject.NULL);
            JSONObject a = currentAlerts();
            s.put("alerts", a != null ? a : JSONObject.NULL);
            JSONArray th = threats;
            s.put("threats", th);
            JSONObject counts = new JSONObject();
            int inSky = 0;
            for (int i = 0; i < th.length(); i++) {
                JSONObject t = th.getJSONObject(i);
                if (t.optBoolean("stale")) continue;
                counts.put(t.getString("kind"), counts.optInt(t.getString("kind"), 0) + t.optInt("count", 1));
                inSky += t.optInt("count", 1);
            }
            s.put("counts", counts);
            s.put("inSky", inSky);
            s.put("today", todayTotal());
            synchronized (updated) { s.put("updated", new JSONObject(updated.toString())); }
            synchronized (errors) { s.put("errors", new JSONObject(errors.toString())); }
            return s.toString();
        } catch (Exception e) {
            return "{}";
        }
    }
}
