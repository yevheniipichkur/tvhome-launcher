package pl.pichkur.tvhome;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.net.wifi.WifiManager;
import android.os.SystemClock;
import android.provider.Settings;
import android.view.KeyEvent;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Phone remote over the home network: http://<box>:8765/ serves a page (assets/web/remote.html) and a
 * small JSON API protected by a 6-digit code shown on the TV (Settings → Система → Пульт з телефону).
 * Text goes into the focused field through RemoteIme; arrows/OK reach the launcher directly and other
 * apps through the box's own network debugging (AdbLocal); media keys, volume, Back/Home work without it.
 */
final class RemoteServer {
    static final int PORT = 8765;
    private static volatile boolean running;
    private static Context app;
    private static final ExecutorService pool = Executors.newFixedThreadPool(4);
    private static final ExecutorService adbQ = Executors.newSingleThreadExecutor();
    private static final Map<String, long[]> fails = new HashMap<>(); // ip → {count, blockedUntil}
    private static volatile String adbState = "unknown"; // ok | asking | off | unknown
    private static AdbLocal adb;
    private static final Map<String, byte[]> iconCache = new HashMap<>();
    // who uses the remote: address → {name, last seen}; a new phone gets a «Підключено: …» notch on the TV
    private static final Map<String, Object[]> clients = new HashMap<>();

    private static void seen(String ip, String name) {
        if (name == null || name.trim().isEmpty()) name = "Телефон";
        name = name.trim().replaceAll("[\\p{Cntrl}<>]", "");
        if (name.length() > 32) name = name.substring(0, 32);
        long now = SystemClock.elapsedRealtime();
        boolean fresh;
        synchronized (clients) {
            Object[] c = clients.get(ip);
            fresh = c == null || now - (long) c[1] > 10 * 60_000 || !name.equals(c[0]);
            clients.put(ip, new Object[]{name, now});
        }
        if (fresh) announce("Підключено: " + name, "пульт з телефону");
    }

    private static void announce(String title, String sub) {
        MainActivity main = MainActivity.instance;
        if (HomeGuardService.homeInFront && main != null) { main.webToast("phone", title, sub); return; }
        HomeGuardService g = HomeGuardService.instance;
        if (g != null) g.showInfo(title, sub);
    }

    private static JSONArray clientList(String me) throws Exception {
        JSONArray a = new JSONArray();
        long now = SystemClock.elapsedRealtime();
        synchronized (clients) {
            for (Map.Entry<String, Object[]> e : clients.entrySet()) {
                if (now - (long) e.getValue()[1] > 30_000) continue;
                JSONObject c = new JSONObject();
                c.put("name", e.getValue()[0]);
                c.put("you", e.getKey().equals(me));
                a.put(c);
            }
        }
        return a;
    }

    static synchronized void start(Context ctx) {
        if (running) return;
        app = ctx.getApplicationContext();
        running = true;
        Thread t = new Thread(() -> {
            try (ServerSocket ss = new ServerSocket(PORT)) {
                while (true) {
                    Socket s = ss.accept();
                    pool.execute(() -> handle(s));
                }
            } catch (Exception e) {
                running = false;
            }
        }, "remote-http");
        t.setDaemon(true);
        t.start();
    }

    static String pin(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences("tvhome", Context.MODE_PRIVATE);
        String pin = p.getString("remote_pin", null);
        if (pin == null) {
            pin = String.valueOf(100000 + new SecureRandom().nextInt(900000));
            p.edit().putString("remote_pin", pin).apply();
        }
        return pin;
    }

    static String ip() {
        try {
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InetAddress a : Collections.list(ni.getInetAddresses()))
                    if (a instanceof Inet4Address && !a.isLoopbackAddress()) return a.getHostAddress();
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    static String url(Context ctx) {
        String ip = ip();
        return ip == null ? null : "http://" + ip + ":" + PORT + "/?pin=" + pin(ctx);
    }

    static JSONObject info(Context ctx) {
        JSONObject o = new JSONObject();
        try {
            o.put("url", url(ctx));
            o.put("ip", ip());
            o.put("pin", pin(ctx));
            o.put("port", PORT);
            o.put("running", running);
            o.put("adb", adbState);
            String cur = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.DEFAULT_INPUT_METHOD);
            String enabled = Settings.Secure.getString(ctx.getContentResolver(), Settings.Secure.ENABLED_INPUT_METHODS);
            o.put("imeCurrent", cur != null && cur.startsWith(ctx.getPackageName() + "/"));
            o.put("imeEnabled", enabled != null && enabled.contains(ctx.getPackageName() + "/"));
        } catch (Exception ignored) {
        }
        return o;
    }

    // ---------- HTTP ----------
    private static void handle(Socket s) {
        try (Socket sock = s) {
            sock.setSoTimeout(8000);
            InputStream in = new BufferedInputStream(sock.getInputStream());
            String reqLine = line(in);
            if (reqLine == null) return;
            Map<String, String> headers = new HashMap<>();
            for (String h; (h = line(in)) != null && !h.isEmpty(); ) {
                int c = h.indexOf(':');
                if (c > 0) headers.put(h.substring(0, c).trim().toLowerCase(), h.substring(c + 1).trim());
            }
            String[] parts = reqLine.split(" ");
            String method = parts[0], target = parts.length > 1 ? parts[1] : "/";
            String ipAddr0 = sock.getInetAddress().getHostAddress();
            if (target.startsWith("/api/install")) {
                int qi = target.indexOf('?');
                Map<String, String> a0 = parseQuery(qi >= 0 ? target.substring(qi + 1) : "");
                OutputStream o0 = sock.getOutputStream();
                if (!pinOk(ipAddr0, a0, o0)) return;
                long total = 0;
                try { total = Long.parseLong(headers.getOrDefault("content-length", "0")); } catch (Exception ignored) { }
                sock.setSoTimeout(60_000);
                json(o0, 200, install(in, total));
                return;
            }
            int len = 0;
            try { len = Math.min(65536, Integer.parseInt(headers.getOrDefault("content-length", "0"))); } catch (Exception ignored) { }
            byte[] body = new byte[len];
            for (int off = 0; off < len; ) { int k = in.read(body, off, len - off); if (k < 0) break; off += k; }
            String path = target, query = "";
            int q = target.indexOf('?');
            if (q >= 0) { path = target.substring(0, q); query = target.substring(q + 1); }
            Map<String, String> args = parseQuery(query);
            OutputStream out = sock.getOutputStream();
            String ipAddr = sock.getInetAddress().getHostAddress();

            if (path.equals("/") || path.equals("/index.html")) { sendAsset(out, "web/remote.html", "text/html; charset=utf-8"); return; }
            if (path.matches("/fonts/[A-Za-z0-9-]+\\.woff2")) { sendAsset(out, "web" + path, "font/woff2"); return; }
            if (path.equals("/manifest.json")) { sendAsset(out, "web/remote-manifest.json", "application/manifest+json"); return; }
            if (!path.startsWith("/api/")) { send(out, 404, "text/plain", "not found".getBytes()); return; }
            if (!pinOk(ipAddr, args, out)) return;
            String b = new String(body, StandardCharsets.UTF_8);
            switch (path) {
                case "/api/state": { seen(ipAddr, args.get("name")); JSONObject st = state(); st.put("clients", clientList(ipAddr)); json(out, 200, st); return; }
                case "/api/text": json(out, 200, text(new JSONObject(b.isEmpty() ? "{}" : b).optString("text", ""))); return;
                case "/api/enter": json(out, 200, enter()); return;
                case "/api/key": json(out, 200, key(args.getOrDefault("k", ""))); return;
                case "/api/vol": {
                    // the phone's volume slider: an exact level
                    AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
                    int v = Integer.parseInt(args.getOrDefault("v", "-1"));
                    if (am != null && v >= 0) { am.setStreamVolume(AudioManager.STREAM_MUSIC, Math.min(v, am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)), 0); HomeGuardService g = HomeGuardService.instance; if (g != null) g.showVolumeNow(); }
                    json(out, 200, ok());
                    return;
                }
                case "/api/launch": json(out, 200, launch(args.get("pkg"))); return;
                case "/api/apps": json(out, 200, apps()); return;
                case "/api/icon": icon(out, args.get("pkg")); return;
                default: json(out, 404, err("unknown"));
            }
        } catch (Exception ignored) {
        }
    }

    /** The code: 10 wrong tries from one address → a minute's pause. */
    private static boolean pinOk(String ipAddr, Map<String, String> args, OutputStream out) throws Exception {
        synchronized (fails) {
            long[] f = fails.get(ipAddr);
            if (f != null && f[1] > SystemClock.elapsedRealtime()) { json(out, 429, err("wait")); return false; }
            if (!pin(app).equals(args.get("pin"))) {
                if (f == null) fails.put(ipAddr, f = new long[2]);
                if (++f[0] >= 10) { f[0] = 0; f[1] = SystemClock.elapsedRealtime() + 60_000; }
                json(out, 403, err("pin"));
                return false;
            }
            fails.remove(ipAddr);
        }
        return true;
    }

    // ---------- install an APK sent from the phone ----------
    private static final Object installLock = new Object();

    /** Saves the upload, then installs it: silently over the box's own debugging when allowed,
     *  otherwise through Android's installer, which asks «Встановити?» on the TV. */
    private static JSONObject install(InputStream in, long total) throws Exception {
        if (total <= 0 || total > 700L * 1024 * 1024) return err("розмір файлу");
        synchronized (installLock) {
            java.io.File dir = app.getExternalCacheDir() != null ? app.getExternalCacheDir() : app.getCacheDir();
            java.io.File f = new java.io.File(dir, "remote-install.apk");
            try (java.io.FileOutputStream o = new java.io.FileOutputStream(f)) {
                byte[] buf = new byte[65536];
                long left = total;
                while (left > 0) {
                    int k = in.read(buf, 0, (int) Math.min(buf.length, left));
                    if (k < 0) break;
                    o.write(buf, 0, k);
                    left -= k;
                }
                if (left > 0) return err("файл не дійшов повністю");
            }
            byte[] head = new byte[2];
            try (java.io.FileInputStream fi = new java.io.FileInputStream(f)) { if (fi.read(head) != 2 || head[0] != 'P' || head[1] != 'K') { f.delete(); return err("це не APK"); } }
            f.setReadable(true, false);
            // 1) silent, if network debugging is allowed (the TV may ask «Allow?» once)
            if (!adbState.equals("off")) {
                try {
                    String r = adb().shell("127.0.0.1", 5555, "pm install -r -g '" + f.getAbsolutePath() + "'", 120_000);
                    adbState = "ok";
                    if (r.contains("Success")) { f.delete(); JSONObject o = ok(); o.put("how", "silent"); return o; }
                    if (r.contains("INSTALL_FAILED")) { f.delete(); return err(r.replaceAll("(?s).*(INSTALL_FAILED_[A-Z_]+).*", "$1")); }
                } catch (java.net.ConnectException e) {
                    adbState = "off";
                } catch (Exception ignored) {
                }
            }
            // 2) Android's installer: the confirmation dialog shows on the TV
            android.content.pm.PackageInstaller pi = app.getPackageManager().getPackageInstaller();
            android.content.pm.PackageInstaller.SessionParams sp = new android.content.pm.PackageInstaller.SessionParams(android.content.pm.PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            int id = pi.createSession(sp);
            try (android.content.pm.PackageInstaller.Session session = pi.openSession(id)) {
                try (java.io.FileInputStream fi = new java.io.FileInputStream(f); OutputStream so = session.openWrite("remote.apk", 0, f.length())) {
                    byte[] buf = new byte[65536];
                    for (int k; (k = fi.read(buf)) > 0; ) so.write(buf, 0, k);
                    session.fsync(so);
                }
                Intent done = new Intent(app, UpdateReceiver.class);
                android.app.PendingIntent pend = android.app.PendingIntent.getBroadcast(app, id, done, android.app.PendingIntent.FLAG_UPDATE_CURRENT);
                session.commit(pend.getIntentSender());
            }
            f.delete();
            JSONObject o = ok();
            o.put("how", "confirm");
            return o;
        }
    }

    private static synchronized AdbLocal adb() throws Exception {
        if (adb == null) adb = new AdbLocal(AdbLocal.loadOrCreate(app.getFilesDir()), "Vitalnia@" + android.os.Build.MODEL.replace(' ', '_'));
        return adb;
    }

    private static String line(InputStream in) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') b.write(c);
            if (b.size() > 8192) return null;
        }
        if (c == -1 && b.size() == 0) return null;
        return b.toString("UTF-8");
    }

    private static Map<String, String> parseQuery(String q) {
        Map<String, String> m = new HashMap<>();
        for (String kv : q.split("&")) {
            int e = kv.indexOf('=');
            if (e <= 0) continue;
            try { m.put(kv.substring(0, e), URLDecoder.decode(kv.substring(e + 1), "UTF-8")); } catch (Exception ignored) { }
        }
        return m;
    }

    private static void send(OutputStream out, int code, String type, byte[] body) throws Exception {
        String head = "HTTP/1.1 " + code + (code == 200 ? " OK" : " Error") + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.length
                + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(body);
        out.flush();
    }

    private static void json(OutputStream out, int code, JSONObject o) throws Exception { send(out, code, "application/json; charset=utf-8", o.toString().getBytes(StandardCharsets.UTF_8)); }

    private static JSONObject err(String why) { JSONObject o = new JSONObject(); try { o.put("ok", false); o.put("error", why); } catch (Exception ignored) { } return o; }

    private static JSONObject ok() { JSONObject o = new JSONObject(); try { o.put("ok", true); } catch (Exception ignored) { } return o; }

    private static void sendAsset(OutputStream out, String name, String type) throws Exception {
        try (InputStream a = app.getAssets().open(name)) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int k; (k = a.read(buf)) > 0; ) b.write(buf, 0, k);
            send(out, 200, type, b.toByteArray());
        }
    }

    // ---------- state ----------
    private static JSONObject state() throws Exception {
        JSONObject o = new JSONObject();
        o.put("ok", true);
        o.put("model", android.os.Build.MODEL);
        RemoteIme ime = RemoteIme.active;
        boolean editing = ime != null && RemoteIme.editing;
        o.put("editing", editing);
        if (editing) {
            String[] f = ime.field();
            o.put("fieldText", f[0] == null ? JSONObject.NULL : f[0]);
            o.put("fieldHint", f[1] == null ? JSONObject.NULL : f[1]);
        }
        JSONObject inf = info(app);
        o.put("imeCurrent", inf.optBoolean("imeCurrent"));
        o.put("adb", adbState);
        o.put("home", HomeGuardService.homeInFront);
        AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        if (am != null) { o.put("vol", am.getStreamVolume(AudioManager.STREAM_MUSIC)); o.put("volMax", am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)); o.put("muted", am.isStreamMute(AudioManager.STREAM_MUSIC)); }
        try {
            MediaSessionManager msm = (MediaSessionManager) app.getSystemService(Context.MEDIA_SESSION_SERVICE);
            List<MediaController> list = msm.getActiveSessions(new ComponentName(app, MediaListener.class));
            for (MediaController c : list) {
                MediaMetadata md = c.getMetadata();
                PlaybackState ps = c.getPlaybackState();
                if (md == null) continue;
                JSONObject m = new JSONObject();
                m.put("title", md.getString(MediaMetadata.METADATA_KEY_TITLE));
                m.put("artist", md.getString(MediaMetadata.METADATA_KEY_ARTIST));
                m.put("app", label(c.getPackageName()));
                m.put("playing", ps != null && ps.getState() == PlaybackState.STATE_PLAYING);
                o.put("media", m);
                break;
            }
        } catch (Exception ignored) { // lite edition / no notification access
        }
        return o;
    }

    private static String label(String pkg) {
        try { PackageManager pm = app.getPackageManager(); return String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0))); } catch (Exception e) { return pkg; }
    }

    // ---------- text ----------
    private static JSONObject text(String t) throws Exception {
        RemoteIme ime = RemoteIme.active;
        if (ime != null && ime.setText(t)) return ok();
        // our keyboard isn't the current one (OK on the TV switched to the on-screen keyboard): bring it back
        if (ime == null && useOurKeyboard()) {
            for (int i = 0; i < 12 && (RemoteIme.active == null || !RemoteIme.editing); i++) Thread.sleep(100);
            ime = RemoteIme.active;
            if (ime != null && ime.setText(t)) return ok();
        }
        // no focused field with our keyboard: plain ASCII can still go through debugging
        if (t.matches("[\\x20-\\x7e]*") && adbKnownOk()) {
            String esc = t.replace("\\", "\\\\").replace("'", "'\\''").replace(" ", "%s");
            adbAsync("input text '" + esc + "'");
            return ok();
        }
        JSONObject e = err(ime == null ? "ime" : "no-field");
        return e;
    }

    private static JSONObject enter() throws Exception {
        RemoteIme ime = RemoteIme.active;
        if (ime != null && ime.enter()) return ok();
        return key("ok");
    }

    // ---------- keys ----------
    private static final Map<String, Integer> CODES = new HashMap<>();
    static {
        CODES.put("up", KeyEvent.KEYCODE_DPAD_UP); CODES.put("down", KeyEvent.KEYCODE_DPAD_DOWN);
        CODES.put("left", KeyEvent.KEYCODE_DPAD_LEFT); CODES.put("right", KeyEvent.KEYCODE_DPAD_RIGHT);
        CODES.put("ok", KeyEvent.KEYCODE_DPAD_CENTER); CODES.put("back", KeyEvent.KEYCODE_BACK);
        CODES.put("home", KeyEvent.KEYCODE_HOME); CODES.put("menu", KeyEvent.KEYCODE_MENU);
        CODES.put("del", KeyEvent.KEYCODE_DEL); CODES.put("sleep", KeyEvent.KEYCODE_SLEEP); CODES.put("wakeup", KeyEvent.KEYCODE_WAKEUP);
        CODES.put("playpause", KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE); CODES.put("next", KeyEvent.KEYCODE_MEDIA_NEXT);
        CODES.put("prev", KeyEvent.KEYCODE_MEDIA_PREVIOUS); CODES.put("ff", KeyEvent.KEYCODE_MEDIA_FAST_FORWARD); CODES.put("rew", KeyEvent.KEYCODE_MEDIA_REWIND);
    }

    private static JSONObject key(String k) throws Exception {
        AudioManager am = (AudioManager) app.getSystemService(Context.AUDIO_SERVICE);
        switch (k) {
            case "volup": case "voldown": case "mute": {
                int dir = k.equals("volup") ? AudioManager.ADJUST_RAISE : k.equals("voldown") ? AudioManager.ADJUST_LOWER : AudioManager.ADJUST_TOGGLE_MUTE;
                am.adjustStreamVolume(AudioManager.STREAM_MUSIC, dir, 0);
                HomeGuardService g = HomeGuardService.instance;
                if (g != null) g.showVolumeNow();
                return ok();
            }
            case "playpause": case "next": case "prev": case "ff": case "rew": {
                // media keys reach the playing app without any permission
                int code = CODES.get(k);
                am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, code));
                am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, code));
                return ok();
            }
        }
        Integer code = CODES.get(k);
        if (code == null) return err("key");
        // our own home screen: straight into the page
        MainActivity main = MainActivity.instance;
        if (HomeGuardService.homeInFront && main != null && !k.equals("home") && !k.equals("sleep") && !k.equals("wakeup")) { main.webKey(k); return ok(); }
        // everything else: network debugging, if allowed
        if (!adbState.equals("off")) { adbAsync("input keyevent " + code); JSONObject o = ok(); o.put("adb", adbState); return o; }
        // fallbacks without debugging
        HomeGuardService g = HomeGuardService.instance;
        if (g != null && k.equals("back")) { g.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_BACK); return ok(); }
        if (k.equals("home")) { Intent h = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); app.startActivity(h); return ok(); }
        if (g != null && k.equals("sleep") && android.os.Build.VERSION.SDK_INT >= 28) { g.performGlobalAction(8 /* GLOBAL_ACTION_LOCK_SCREEN */); return ok(); }
        return err("adb");
    }

    /** Make «Вітальня: клавіатура з телефону» the current keyboard (needs WRITE_SECURE_SETTINGS, granted once over debugging). */
    static boolean useOurKeyboard() {
        String me = app.getPackageName() + "/.RemoteIme";
        if (app.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") == PackageManager.PERMISSION_GRANTED) {
            try {
                String en = Settings.Secure.getString(app.getContentResolver(), Settings.Secure.ENABLED_INPUT_METHODS);
                if (en == null || !en.contains(me)) Settings.Secure.putString(app.getContentResolver(), Settings.Secure.ENABLED_INPUT_METHODS, (en == null || en.isEmpty() ? "" : en + ":") + me);
                Settings.Secure.putString(app.getContentResolver(), Settings.Secure.DEFAULT_INPUT_METHOD, me);
                return true;
            } catch (Exception ignored) {
            }
        }
        if (adbState.equals("ok")) { adbAsync("ime enable " + me + "; ime set " + me); return true; }
        return false;
    }

    private static boolean adbKnownOk() { return adbState.equals("ok") || adbState.equals("unknown"); }

    /** Commands go one after another; the first one may wait for the "Allow debugging?" dialog. */
    private static void adbAsync(String cmd) {
        adbQ.execute(() -> {
            try {
                adb();
                boolean first = !adbState.equals("ok");
                if (first) adbState = "asking";
                adb.shell("127.0.0.1", 5555, cmd, first ? 45_000 : 4000);
                adbState = "ok";
                // once debugging is allowed: let the app switch keyboards itself from now on
                if (app.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") != PackageManager.PERMISSION_GRANTED)
                    adb.shell("127.0.0.1", 5555, "pm grant " + app.getPackageName() + " android.permission.WRITE_SECURE_SETTINGS", 4000);
            } catch (java.net.ConnectException e) {
                adbState = "off"; // network debugging is switched off on this box
            } catch (Exception e) {
                adbState = adbState.equals("asking") ? "off" : "unknown";
            }
        });
    }

    /** Settings → «Пульт з телефону» → test the debugging channel (shows the TV's «Allow?» dialog once). */
    static void adbProbe() { adbAsync("echo ok"); }

    // ---------- apps ----------
    private static JSONObject apps() throws Exception {
        PackageManager pm = app.getPackageManager();
        Map<String, String> found = new java.util.LinkedHashMap<>();
        for (ResolveInfo ri : pm.queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER), 0))
            found.put(ri.activityInfo.packageName, String.valueOf(ri.loadLabel(pm)));
        found.remove(app.getPackageName());
        JSONArray a = new JSONArray();
        for (Map.Entry<String, String> e : found.entrySet()) { JSONObject x = new JSONObject(); x.put("pkg", e.getKey()); x.put("label", e.getValue()); a.put(x); }
        JSONObject o = ok();
        o.put("apps", a);
        String dock = app.getSharedPreferences("tvhome", Context.MODE_PRIVATE).getString("dock", null);
        if (dock != null) o.put("dock", new JSONArray(dock));
        return o;
    }

    private static JSONObject launch(String pkg) throws Exception {
        if (pkg == null) return err("pkg");
        PackageManager pm = app.getPackageManager();
        Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
        if (i == null) i = pm.getLaunchIntentForPackage(pkg);
        if (i == null) return err("pkg");
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        app.startActivity(i);
        return ok();
    }

    private static void icon(OutputStream out, String pkg) throws Exception {
        byte[] png;
        synchronized (iconCache) { png = iconCache.get(pkg); }
        if (png == null) {
            PackageManager pm = app.getPackageManager();
            Drawable d;
            try {
                d = pm.getApplicationBanner(pkg);
                if (d == null) d = pm.getApplicationIcon(pkg);
            } catch (Exception e) { send(out, 404, "text/plain", new byte[0]); return; }
            int w = d.getIntrinsicWidth() > d.getIntrinsicHeight() * 1.3 ? 192 : 96, h = w == 192 ? 108 : 96;
            Bitmap bm = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
            Canvas c = new Canvas(bm);
            d.setBounds(0, 0, w, h);
            d.draw(c);
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            bm.compress(Bitmap.CompressFormat.PNG, 100, b);
            png = b.toByteArray();
            synchronized (iconCache) { iconCache.put(pkg, png); }
        }
        String head = "HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: " + png.length + "\r\nCache-Control: max-age=86400\r\nConnection: close\r\n\r\n";
        out.write(head.getBytes(StandardCharsets.UTF_8));
        out.write(png);
        out.flush();
    }
}
