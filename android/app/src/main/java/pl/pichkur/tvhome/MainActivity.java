package pl.pichkur.tvhome;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.graphics.BitmapFactory;
import android.media.AudioAttributes;
import android.media.SoundPool;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.SharedPreferences;
import android.media.tv.TvContract;
import android.webkit.RenderProcessGoneDetail;
import android.view.ViewGroup;
import android.net.Uri;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.BitmapDrawable;
import android.graphics.drawable.Drawable;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Base64;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Full-screen WebView home screen. The page itself lives on the Pi, so it can change without reinstalling. */
public class MainActivity extends Activity {
    // The page ships inside the APK (assets/web) and is served under this https origin by
    // shouldInterceptRequest; "api/state" is answered by DataService. No home server needed.
    private static final String ORIGIN = "https://appassets.androidplatform.net";
    private static final String HOME_URL = ORIGIN + "/web/index.html";
    private static final String FALLBACK_LAUNCHER = "com.spocky.projengmenu";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Map<String, String> imageCache = new HashMap<>();
    private WebView web;
    static volatile MainActivity instance;

    /** A notch toast on the home screen (setup.js TVS.toast). */
    void webToast(String icon, String title, String sub) {
        org.json.JSONArray args = new org.json.JSONArray().put(icon).put(title).put(sub);
        ui.post(() -> { if (web != null) web.evaluateJavascript("window.TVS && TVS.toast.apply(null, " + args + ")", null); });
    }

    /** Phone remote → slideshow of the photos/videos it sent: bring the home screen up, then start it. */
    static void showMedia(Context c, org.json.JSONArray items, int start) {
        MainActivity m = instance;
        boolean front = HomeGuardService.homeInFront && m != null;
        if (!front) {
            Intent i = new Intent(c, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            c.startActivity(i);
        }
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            MainActivity a = instance;
            if (a != null && a.web != null) a.web.evaluateJavascript("window.TVS && TVS.slideshow(" + items + "," + start + ")", null);
        }, front ? 0 : 900);
    }

    static void slideCtl(String a) {
        MainActivity m = instance;
        if (m == null) return;
        m.ui.post(() -> { if (m.web != null) m.web.evaluateJavascript("window.TVS && TVS.slide('" + a.replaceAll("[^a-z]", "") + "')", null); });
    }

    /** A key from the phone remote while the home screen is in front: same path as the TV remote. */
    void webKey(String k) {
        ui.post(() -> { if (web != null) web.evaluateJavascript("window.tvKey && tvKey('" + k.replaceAll("[^a-z]", "") + "')", null); });
    }
    private SoundPool sounds;
    private final Map<String, Integer> soundIds = new HashMap<>();
    private long loadedAt;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        instance = this;
        RemoteServer.start(this);
        // UI sounds via SoundPool: low latency and independent of the WebView
        sounds = new SoundPool.Builder().setMaxStreams(4).setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME) // media volume: the system stream is near-silent over HDMI on this box
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()).build();
        soundIds.put("move", sounds.load(this, R.raw.ui_move, 1));
        soundIds.put("edge", sounds.load(this, R.raw.ui_edge, 1));
        soundIds.put("open", sounds.load(this, R.raw.ui_open, 1));
        soundIds.put("back", sounds.load(this, R.raw.ui_back, 1));
        WebView.setWebContentsDebuggingEnabled(true); // chrome://inspect over ADB on the LAN
        DataService.get(this); // start fetching right away
        checkUpdate();
        ui.postDelayed(new Runnable() { @Override public void run() { checkUpdate(); ui.postDelayed(this, 6 * 3600_000L); } }, 6 * 3600_000L);
        android.content.IntentFilter pf = new android.content.IntentFilter();
        pf.addAction(Intent.ACTION_PACKAGE_ADDED);
        pf.addAction(Intent.ACTION_PACKAGE_REMOVED);
        pf.addAction(Intent.ACTION_PACKAGE_CHANGED);
        pf.addAction(Intent.ACTION_PACKAGE_REPLACED);
        pf.addDataScheme("package");
        registerReceiver(pkgReceiver, pf);
        // Owner's choice: the home screen works as a wall display and never sleeps while it is in front.
        // Other apps keep the normal 15-min timeout; the remote's power button still turns everything off.
        getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        createWebView();
        hideSystemUi();
    }

    private void createWebView() {
        web = new WebView(this);
        web.setBackgroundColor(Color.rgb(0x26, 0x27, 0x2b));
        web.setFocusable(true);
        web.setFocusableInTouchMode(true);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setTextZoom(100);
        web.addJavascriptInterface(new Bridge(), "TV");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!"appassets.androidplatform.net".equals(u.getHost())) return null; // real network (images etc.)
                String path = u.getPath() == null ? "" : u.getPath();
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-store");
                if (path.equals("/web/api/state")) {
                    byte[] body = DataService.get(MainActivity.this).snapshot().getBytes(java.nio.charset.StandardCharsets.UTF_8);
                    return new WebResourceResponse("application/json", "utf-8", 200, "OK", headers, new java.io.ByteArrayInputStream(body));
                }
                if (path.startsWith("/media/")) {
                    // photos/videos sent from the phone (MediaShare), with Range support so videos can seek
                    java.io.File f = MediaShare.file(MainActivity.this, path.substring(7));
                    if (f == null) return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, new java.io.ByteArrayInputStream(new byte[0]));
                    try {
                        long len = f.length(), from = 0, to = len - 1;
                        String range = req.getRequestHeaders().get("Range");
                        java.io.RandomAccessFile raf = new java.io.RandomAccessFile(f, "r");
                        Map<String, String> h = new HashMap<>();
                        h.put("Accept-Ranges", "bytes");
                        if (range != null && range.startsWith("bytes=")) {
                            String[] p = range.substring(6).split("-");
                            from = Long.parseLong(p[0]);
                            if (p.length > 1 && !p[1].isEmpty()) to = Math.min(len - 1, Long.parseLong(p[1]));
                            raf.seek(from);
                            h.put("Content-Range", "bytes " + from + "-" + to + "/" + len);
                            h.put("Content-Length", String.valueOf(to - from + 1));
                            final long remain = to - from + 1;
                            java.io.InputStream body = new java.io.InputStream() {
                                long left = remain;
                                @Override public int read() throws java.io.IOException { if (left <= 0) return -1; left--; return raf.read(); }
                                @Override public int read(byte[] b, int off, int n) throws java.io.IOException { if (left <= 0) return -1; int r = raf.read(b, off, (int) Math.min(n, left)); if (r > 0) left -= r; return r; }
                                @Override public void close() throws java.io.IOException { raf.close(); }
                            };
                            return new WebResourceResponse(MediaShare.mime(f.getName()), null, 206, "Partial Content", h, body);
                        }
                        raf.close();
                        h.put("Content-Length", String.valueOf(len));
                        return new WebResourceResponse(MediaShare.mime(f.getName()), null, 200, "OK", h, new java.io.FileInputStream(f));
                    } catch (Exception e) {
                        return null;
                    }
                }
                if (path.startsWith("/web/") && !path.contains("..")) {
                    try {
                        java.io.InputStream in = getAssets().open(path.substring(1));
                        return new WebResourceResponse(mime(path), "utf-8", 200, "OK", headers, in);
                    } catch (java.io.IOException e) {
                        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, new java.io.ByteArrayInputStream(new byte[0]));
                    }
                }
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, new java.io.ByteArrayInputStream(new byte[0]));
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) ui.postDelayed(() -> web.loadUrl(HOME_URL), 3000);
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // Low memory killed the page renderer: rebuild the WebView instead of showing white.
                if (view != web) return true;
                ((ViewGroup) view.getParent()).removeView(view);
                view.destroy();
                ui.post(MainActivity.this::createWebView);
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                loadedAt = SystemClock.elapsedRealtime();
            }
        });
        setContentView(web);
        web.loadUrl(HOME_URL);
        web.requestFocus();
    }

    private static String mime(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json")) return "application/json";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    @Override
    protected void onPause() {
        HomeGuardService.homeInFront = false;
        // Another app is in front: stop the page entirely (JS timers, animations, rendering) so video
        // gets the whole box. DataService keeps running in Java for the alert notch.
        if (web != null) { web.evaluateJavascript("document.body.classList.add('bg-paused')", null); web.onPause(); web.pauseTimers(); }
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        HomeGuardService.homeInFront = true;
        if (web != null) { web.resumeTimers(); web.onResume(); web.evaluateJavascript("document.body.classList.remove('bg-paused')", null); }
        hideSystemUi();
        // The page is bundled in the APK and its data comes from DataService, so there is nothing to
        // reload after a long movie — a full reload is what made the return to Home feel laggy.
        web.evaluateJavascript("window.tvResume && window.tvResume()", null);
        web.requestFocus();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); // onResume follows and calls tvResume once
    }

    @Override
    public void onBackPressed() {
        // A launcher never closes; Back only closes the app drawer inside the page.
        web.evaluateJavascript("window.tvBack && window.tvBack()", null);
    }

    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    private static Bitmap toBitmap(Drawable d, int w, int h) {
        if (d instanceof BitmapDrawable && ((BitmapDrawable) d).getBitmap() != null) {
            Bitmap b = ((BitmapDrawable) d).getBitmap();
            if (b.getWidth() <= w * 1.5 && b.getHeight() <= h * 1.5) return b;
            return Bitmap.createScaledBitmap(b, w, h, true);
        }
        Bitmap b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        d.setBounds(0, 0, w, h);
        d.draw(c);
        return b;
    }

    // Video apps that keep decoding in the background after Home (YouTube, Lampa…) make the next app stutter
    // on this box: before launching one, pause other playing sessions and drop their background processes.
    private static final String[] PLAYERS = {"com.google.android.youtube.tv", "top.rootu.lamps", "top.rootu.lampa", "com.netflix.ninja",
            "com.megogo.application", "dkc.video.hdbox", "studio.scillarium.ottnavigator", "org.videolan.vlc", "com.brouken.player",
            "com.google.android.youtube.tvmusic", "ru.yourok.torrserve"};

    private void stopOtherPlayers(String keep) {
        try {
            MediaSessionManager msm = (MediaSessionManager) getSystemService(MEDIA_SESSION_SERVICE);
            for (MediaController c : msm.getActiveSessions(new ComponentName(this, MediaListener.class))) {
                PlaybackState ps = c.getPlaybackState();
                if (!c.getPackageName().equals(keep) && ps != null && ps.getState() == PlaybackState.STATE_PLAYING) c.getTransportControls().pause();
            }
        } catch (Exception ignored) {
        }
        android.app.ActivityManager am = (android.app.ActivityManager) getSystemService(ACTIVITY_SERVICE);
        for (String p : PLAYERS) {
            if (p.equals(keep) || p.equals("ru.yourok.torrserve") && keep.startsWith("top.rootu")) continue; // Lampa streams through TorrServe
            try { am.killBackgroundProcesses(p); } catch (Exception ignored) { }
        }
    }

    // ---------- self-update ----------
    private volatile int latestCode;

    private void checkUpdate() {
        new Thread(() -> {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(BuildConfig.UPDATE_URL + "version" + BuildConfig.UPDATE_FILE).openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                if (c.getResponseCode() == 200) {
                    java.io.InputStream in = c.getInputStream();
                    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
                    byte[] buf = new byte[4096];
                    for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                    latestCode = new JSONObject(out.toString("UTF-8")).optInt("versionCode", 0);
                }
                c.disconnect();
            } catch (Exception ignored) {
            }
        }).start();
    }

    /** Download the APK and hand it to the system installer (it asks the user to confirm). */
    private void installUpdate() {
        if (!getPackageManager().canRequestPackageInstalls()) {
            new Bridge().openSettings("unknown-sources");
            return;
        }
        new Thread(() -> {
            try {
                android.content.pm.PackageInstaller pi = getPackageManager().getPackageInstaller();
                android.content.pm.PackageInstaller.SessionParams sp = new android.content.pm.PackageInstaller.SessionParams(
                        android.content.pm.PackageInstaller.SessionParams.MODE_FULL_INSTALL);
                int id = pi.createSession(sp);
                android.content.pm.PackageInstaller.Session session = pi.openSession(id);
                HttpURLConnection c = (HttpURLConnection) new URL(BuildConfig.UPDATE_URL + "download/tvhome" + BuildConfig.UPDATE_FILE + ".apk").openConnection();
                c.setConnectTimeout(10000);
                c.setReadTimeout(60000);
                try (java.io.InputStream in = c.getInputStream(); java.io.OutputStream out = session.openWrite("tvhome.apk", 0, -1)) {
                    byte[] buf = new byte[65536];
                    for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                    session.fsync(out);
                }
                c.disconnect();
                Intent done = new Intent(this, UpdateReceiver.class);
                PendingIntent pend = PendingIntent.getBroadcast(this, id, done, PendingIntent.FLAG_UPDATE_CURRENT);
                session.commit(pend.getIntentSender());
                session.close();
            } catch (Exception e) {
                ui.post(() -> web.evaluateJavascript("window.tvUpdateFailed && window.tvUpdateFailed()", null));
            }
        }).start();
    }

    private volatile MediaController lastController;
    private volatile String appsCache;
    private volatile int appsVersion = 1;
    private final android.content.BroadcastReceiver pkgReceiver = new android.content.BroadcastReceiver() {
        @Override
        public void onReceive(android.content.Context c, Intent i) { appsCache = null; appsVersion++; }
    };

    private SharedPreferences prefs() {
        return getSharedPreferences("tvhome", MODE_PRIVATE);
    }

    private MediaController pickController() {
        MediaSessionManager msm = (MediaSessionManager) getSystemService(MEDIA_SESSION_SERVICE);
        List<MediaController> list = msm.getActiveSessions(new ComponentName(this, MediaListener.class));
        MediaController best = null;
        for (MediaController c : list) {
            if (c.getPackageName().equals(getPackageName())) continue;
            PlaybackState ps = c.getPlaybackState();
            if (ps != null && ps.getState() == PlaybackState.STATE_PLAYING) return c;
            if (best == null && c.getMetadata() != null) best = c;
        }
        return best;
    }

    private String appLabel(String pkg) {
        try {
            PackageManager pm = getPackageManager();
            return String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)));
        } catch (Exception e) {
            return pkg;
        }
    }

    private static String first(String... xs) {
        for (String x : xs) if (x != null && !x.isEmpty()) return x;
        return null;
    }

    private static String str(Cursor c, String col) {
        int i = c.getColumnIndex(col);
        return i < 0 || c.isNull(i) ? null : c.getString(i);
    }

    private static long num(Cursor c, String col) {
        int i = c.getColumnIndex(col);
        return i < 0 || c.isNull(i) ? 0 : c.getLong(i);
    }

    /** http(s) art loads directly; content:// and android.resource:// are inlined so the page can show them. */
    private String webImage(String uri) {
        if (uri.startsWith("http")) return uri;
        String cached = imageCache.get("w:" + uri);
        if (cached != null) return cached;
        try (java.io.InputStream in = getContentResolver().openInputStream(Uri.parse(uri))) {
            Bitmap b = BitmapFactory.decodeStream(in);
            if (b == null) return null;
            int w = 400, h = Math.max(1, Math.round(400f * b.getHeight() / b.getWidth()));
            String d = dataUri(Bitmap.createScaledBitmap(b, w, h, true));
            imageCache.put("w:" + uri, d);
            return d;
        } catch (Exception e) {
            return null;
        }
    }

    private static String dataUri(Bitmap b) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        b.compress(Bitmap.CompressFormat.PNG, 100, out);
        return "data:image/png;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
    }

    /** Exposed to the page as window.TV. Methods run on a binder thread. */
    private class Bridge {
        /** Bumped when apps are installed/removed/updated; the page rebuilds the dock only then. */
        @JavascriptInterface
        public int appsVersion() { return appsVersion; }

        @JavascriptInterface
        public String apps() {
            String cached = appsCache;
            if (cached != null) return cached;
            String fresh = buildApps();
            appsCache = fresh;
            return fresh;
        }

        private String buildApps() {
            PackageManager pm = getPackageManager();
            Map<String, ResolveInfo> found = new LinkedHashMap<>();
            Map<String, Boolean> leanback = new HashMap<>();
            Intent tv = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER);
            for (ResolveInfo ri : pm.queryIntentActivities(tv, 0)) {
                found.put(ri.activityInfo.packageName, ri);
                leanback.put(ri.activityInfo.packageName, true);
            }
            Intent phone = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            for (ResolveInfo ri : pm.queryIntentActivities(phone, 0)) {
                if (!found.containsKey(ri.activityInfo.packageName)) found.put(ri.activityInfo.packageName, ri);
            }
            JSONArray arr = new JSONArray();
            for (Map.Entry<String, ResolveInfo> e : found.entrySet()) {
                String pkg = e.getKey();
                if (pkg.equals(getPackageName())) continue;
                ActivityInfo ai = e.getValue().activityInfo;
                try {
                    JSONObject o = new JSONObject();
                    o.put("pkg", pkg);
                    o.put("label", String.valueOf(e.getValue().loadLabel(pm)));
                    o.put("tv", leanback.containsKey(pkg));
                    // preinstalled apps can't be removed, only disabled — the page hides «Видалити» for them
                    o.put("sys", (ai.applicationInfo.flags & (ApplicationInfo.FLAG_SYSTEM | ApplicationInfo.FLAG_UPDATED_SYSTEM_APP)) != 0);
                    String banner = imageCache.get("b:" + pkg);
                    String icon = imageCache.get("i:" + pkg);
                    if (banner == null && icon == null) {
                        Drawable bd = ai.loadBanner(pm);
                        if (bd == null) bd = ai.applicationInfo.loadBanner(pm);
                        if (bd != null) {
                            banner = dataUri(toBitmap(bd, 320, 180));
                            imageCache.put("b:" + pkg, banner);
                        } else {
                            icon = dataUri(toBitmap(ai.loadIcon(pm), 128, 128));
                            imageCache.put("i:" + pkg, icon);
                        }
                    }
                    if (banner != null) o.put("banner", banner);
                    if (icon != null) o.put("icon", icon);
                    arr.put(o);
                } catch (Exception ignored) {
                }
            }
            return arr.toString();
        }

        @JavascriptInterface
        public void launch(String pkg) {
            stopOtherPlayers(pkg);
            ui.post(() -> {
                PackageManager pm = getPackageManager();
                Intent i = pm.getLeanbackLaunchIntentForPackage(pkg);
                if (i == null) i = pm.getLaunchIntentForPackage(pkg);
                if (i == null) return;
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    startActivity(i);
                } catch (ActivityNotFoundException ignored) {
                }
            });
        }

        @JavascriptInterface
        public void openSettings(String what) {
            ui.post(() -> {
                Intent i;
                if ("wifi".equals(what)) i = new Intent(Settings.ACTION_WIFI_SETTINGS);
                else if ("accessibility".equals(what)) i = new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS);
                else if ("unknown-sources".equals(what)) i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
                else if ("fallback".equals(what)) i = getPackageManager().getLaunchIntentForPackage(FALLBACK_LAUNCHER);
                else if ("keyboard".equals(what)) i = new Intent(Settings.ACTION_INPUT_METHOD_SETTINGS);
                else if ("notifications".equals(what)) i = new Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS");
                else if (what != null && what.startsWith("app:")) i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + what.substring(4)));
                else i = new Intent(Settings.ACTION_SETTINGS);
                if (i == null) i = new Intent(Settings.ACTION_SETTINGS);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    startActivity(i);
                } catch (ActivityNotFoundException ignored) {
                }
            });
        }

        @JavascriptInterface
        public String cinema(String action, String body) {
            try { return CinemaService.request(MainActivity.this, action, new JSONObject(body)).toString(); }
            catch (Exception e) { return "{\"ok\":false,\"error\":\"Невірний запит\"}"; }
        }

        /** Settings → Система → Пульт з телефону: address, code, keyboard and debugging state. */
        @JavascriptInterface
        public String remoteInfo() { return RemoteServer.info(MainActivity.this).toString(); }

        /** Make our keyboard current (when allowed); otherwise the caller opens the picker/settings. */
        @JavascriptInterface
        public boolean useOurKeyboard() { return RemoteServer.useOurKeyboard(); }

        @JavascriptInterface
        public void adbProbe() { RemoteServer.adbProbe(); }

        /** The system keyboard picker, to switch to «Вітальня: клавіатура з телефону». */
        @JavascriptInterface
        public void pickKeyboard() {
            ui.post(() -> {
                try { ((android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE)).showInputMethodPicker(); } catch (Exception ignored) { }
            });
        }

        /** Settings → Система → Про приставку. */
        @JavascriptInterface
        public String deviceInfo() {
            JSONObject o = new JSONObject();
            try {
                o.put("model", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL);
                o.put("android", android.os.Build.VERSION.RELEASE);
                android.app.ActivityManager am = (android.app.ActivityManager) getSystemService(ACTIVITY_SERVICE);
                android.app.ActivityManager.MemoryInfo mi = new android.app.ActivityManager.MemoryInfo();
                am.getMemoryInfo(mi);
                o.put("ramTotal", mi.totalMem);
                o.put("ramFree", mi.availMem);
                android.os.StatFs fs = new android.os.StatFs(android.os.Environment.getDataDirectory().getPath());
                o.put("diskTotal", fs.getTotalBytes());
                o.put("diskFree", fs.getAvailableBytes());
                o.put("uptime", android.os.SystemClock.elapsedRealtime());
                o.put("temp", cpuTemp());
                o.put("ip", localIp());
                o.put("version", BuildConfig.VERSION_NAME);
                android.media.AudioManager au = (android.media.AudioManager) getSystemService(AUDIO_SERVICE);
                o.put("volFixed", au != null && au.isVolumeFixed());
            } catch (Exception ignored) {
            }
            return o.toString();
        }

        private double cpuTemp() {
            for (int z = 0; z < 6; z++) {
                try (java.io.BufferedReader r = new java.io.BufferedReader(new java.io.FileReader("/sys/class/thermal/thermal_zone" + z + "/temp"))) {
                    double t = Double.parseDouble(r.readLine().trim());
                    if (t > 1000) t /= 1000;
                    if (t > 10 && t < 130) return t;
                } catch (Exception ignored) {
                }
            }
            return -1;
        }

        private String localIp() {
            try {
                for (java.net.NetworkInterface ni : java.util.Collections.list(java.net.NetworkInterface.getNetworkInterfaces())) {
                    if (!ni.isUp() || ni.isLoopback()) continue;
                    for (java.net.InetAddress a : java.util.Collections.list(ni.getInetAddresses()))
                        if (a instanceof java.net.Inet4Address) return a.getHostAddress();
                }
            } catch (Exception ignored) {
            }
            return "";
        }

        /** «Звільнити пам'ять»: ask Android to drop the background processes of every launchable
         *  app (never the one playing in front, never us), then report how much memory came back. */
        @JavascriptInterface
        public String freeMemory() {
            android.app.ActivityManager am = (android.app.ActivityManager) getSystemService(ACTIVITY_SERVICE);
            android.app.ActivityManager.MemoryInfo mi = new android.app.ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            long before = mi.availMem;
            int n = 0;
            Intent tv = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER);
            Intent ph = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
            java.util.Set<String> pkgs = new java.util.HashSet<>();
            for (ResolveInfo ri : getPackageManager().queryIntentActivities(tv, 0)) pkgs.add(ri.activityInfo.packageName);
            for (ResolveInfo ri : getPackageManager().queryIntentActivities(ph, 0)) pkgs.add(ri.activityInfo.packageName);
            pkgs.add("com.google.android.youtube.tv");
            pkgs.remove(getPackageName());
            for (String p : pkgs) {
                try { am.killBackgroundProcesses(p); n++; } catch (Exception ignored) { }
            }
            try { Thread.sleep(900); } catch (InterruptedException ignored) { }
            am.getMemoryInfo(mi);
            JSONObject o = new JSONObject();
            try {
                o.put("before", before);
                o.put("after", mi.availMem);
                o.put("total", mi.totalMem);
                o.put("apps", n);
            } catch (Exception ignored) {
            }
            return o.toString();
        }

        /** Notification access (the mini player reads what is playing from it). */
        @JavascriptInterface
        public boolean notifAccess() {
            String s = Settings.Secure.getString(getContentResolver(), "enabled_notification_listeners");
            return s != null && s.contains(getPackageName());
        }

        @JavascriptInterface
        public String volume() {
            android.media.AudioManager am = (android.media.AudioManager) getSystemService(AUDIO_SERVICE);
            if (am == null) return "{}";
            return "{\"cur\":" + am.getStreamVolume(android.media.AudioManager.STREAM_MUSIC) + ",\"max\":" + am.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC)
                    + ",\"fixed\":" + am.isVolumeFixed() + "}";
        }

        @JavascriptInterface
        public void setVolume(int v) {
            android.media.AudioManager am = (android.media.AudioManager) getSystemService(AUDIO_SERVICE);
            if (am != null) am.setStreamVolume(android.media.AudioManager.STREAM_MUSIC, Math.max(0, Math.min(v, am.getStreamMaxVolume(android.media.AudioManager.STREAM_MUSIC))), 0);
        }

        @JavascriptInterface
        public void setPref(String key, boolean on) { if ("vol_ui".equals(key)) prefs().edit().putBoolean(key, on).apply(); }

        @JavascriptInterface
        public boolean pref(String key) { return prefs().getBoolean(key, true); }

        /** First-run wizard: is Вітальня what the system opens on Home? */
        @JavascriptInterface
        public boolean isDefaultHome() {
            Intent h = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME);
            ResolveInfo ri = getPackageManager().resolveActivity(h, PackageManager.MATCH_DEFAULT_ONLY);
            return ri != null && ri.activityInfo != null && getPackageName().equals(ri.activityInfo.packageName);
        }

        /** Ask the system to pick the home screen: the Home settings page where the device has one,
         *  otherwise the Home intent, which shows the "always" chooser when no default is set yet. */
        @JavascriptInterface
        public void chooseHome() {
            ui.post(() -> {
                Intent set = new Intent(Settings.ACTION_HOME_SETTINGS);
                ResolveInfo ri = getPackageManager().resolveActivity(set, 0);
                boolean stub = ri == null || ri.activityInfo == null || ri.activityInfo.name.contains("EmptyStub");
                Intent i = stub ? new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME) : set;
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    startActivity(i);
                } catch (ActivityNotFoundException ignored) {
                }
            });
        }

        /** Long-press menu → «Видалити»: the system uninstall dialog asks the user to confirm. */
        @JavascriptInterface
        public void uninstall(String pkg) {
            if (pkg == null || pkg.equals(getPackageName())) return;
            ui.post(() -> {
                Intent i = new Intent(Intent.ACTION_DELETE, Uri.parse("package:" + pkg));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    startActivity(i);
                } catch (ActivityNotFoundException ignored) {
                }
            });
        }

        /** First-run wizard: is the Home/alert service enabled in Accessibility? */
        @JavascriptInterface
        public boolean isLite() { return BuildConfig.LITE; }

        @JavascriptInterface
        public boolean a11yEnabled() {
            String on = Settings.Secure.getString(getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            return on != null && on.contains(getPackageName() + "/");
        }

        /** {current, latest, name, ready} — latest build published on the owner's server. */
        @JavascriptInterface
        public String updateInfo() {
            JSONObject o = new JSONObject();
            try {
                o.put("current", BuildConfig.VERSION_CODE);
                o.put("name", BuildConfig.VERSION_NAME);
                o.put("latest", latestCode);
                o.put("canInstall", getPackageManager().canRequestPackageInstalls());
            } catch (Exception ignored) {
            }
            return o.toString();
        }

        @JavascriptInterface
        public void checkUpdate() { MainActivity.this.checkUpdate(); }

        @JavascriptInterface
        public void installUpdate() { MainActivity.this.installUpdate(); }

        /** {type: wifi|ethernet|none, ssid, level 0..3}. SSID needs location permission on Android 9. */
        @JavascriptInterface
        public String wifi() {
            JSONObject o = new JSONObject();
            try {
                ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
                NetworkInfo ni = cm == null ? null : cm.getActiveNetworkInfo();
                if (ni == null || !ni.isConnected()) {
                    o.put("type", "none");
                } else if (ni.getType() == ConnectivityManager.TYPE_ETHERNET) {
                    o.put("type", "ethernet");
                } else {
                    o.put("type", "wifi");
                    WifiManager wm = (WifiManager) getApplicationContext().getSystemService(WIFI_SERVICE);
                    WifiInfo wi = wm == null ? null : wm.getConnectionInfo();
                    if (wi != null) {
                        String ssid = wi.getSSID();
                        if (ssid != null && ssid.startsWith("\"") && ssid.endsWith("\"")) ssid = ssid.substring(1, ssid.length() - 1);
                        if (ssid != null && !"<unknown ssid>".equals(ssid)) o.put("ssid", ssid);
                        o.put("level", WifiManager.calculateSignalLevel(wi.getRssi(), 4));
                    }
                }
            } catch (Exception ignored) {
            }
            return o.toString();
        }

        /** Android TV "Play Next" row (what apps like Lampa offer to continue), newest first. */
        @JavascriptInterface
        public String watchNext() {
            JSONArray arr = new JSONArray();
            Cursor c = null;
            try {
                c = getContentResolver().query(TvContract.WatchNextPrograms.CONTENT_URI, null, null, null, null);
                if (c == null) return arr.toString();
                java.util.List<JSONObject> rows = new java.util.ArrayList<>();
                while (c.moveToNext()) {
                    JSONObject o = new JSONObject();
                    o.put("pkg", str(c, TvContract.WatchNextPrograms.COLUMN_PACKAGE_NAME));
                    o.put("title", str(c, TvContract.WatchNextPrograms.COLUMN_TITLE));
                    o.put("episode", str(c, TvContract.WatchNextPrograms.COLUMN_EPISODE_TITLE));
                    o.put("season", str(c, TvContract.WatchNextPrograms.COLUMN_SEASON_DISPLAY_NUMBER));
                    o.put("number", str(c, TvContract.WatchNextPrograms.COLUMN_EPISODE_DISPLAY_NUMBER));
                    o.put("intent", str(c, TvContract.WatchNextPrograms.COLUMN_INTENT_URI));
                    o.put("position", num(c, TvContract.WatchNextPrograms.COLUMN_LAST_PLAYBACK_POSITION_MILLIS));
                    o.put("duration", num(c, TvContract.WatchNextPrograms.COLUMN_DURATION_MILLIS));
                    o.put("engaged", num(c, TvContract.WatchNextPrograms.COLUMN_LAST_ENGAGEMENT_TIME_UTC_MILLIS));
                    String art = str(c, TvContract.WatchNextPrograms.COLUMN_POSTER_ART_URI);
                    if (art == null) art = str(c, TvContract.WatchNextPrograms.COLUMN_THUMBNAIL_URI);
                    o.put("art", art == null ? null : webImage(art));
                    if (o.optString("intent", null) != null && o.optString("title", null) != null) rows.add(o);
                }
                java.util.Collections.sort(rows, (x, y) -> Long.compare(y.optLong("engaged"), x.optLong("engaged")));
                for (int i = 0; i < Math.min(rows.size(), 6); i++) arr.put(rows.get(i));
            } catch (Exception ignored) {
                // no TV provider or no permission: the page simply shows no "continue" tile
            } finally {
                if (c != null) c.close();
            }
            return arr.toString();
        }

        @JavascriptInterface
        public void openIntent(String uri) {
            ui.post(() -> {
                try {
                    Intent i = Intent.parseUri(uri, Intent.URI_INTENT_SCHEME);
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(i);
                } catch (Exception ignored) {
                }
            });
        }

        /** What is playing now (or what played last), for the mini player. */
        @JavascriptInterface
        public String media() {
            JSONObject o = new JSONObject();
            try {
                MediaController c = pickController();
                if (c != null) {
                    MediaMetadata md = c.getMetadata();
                    PlaybackState ps = c.getPlaybackState();
                    String pkg = c.getPackageName();
                    String title = md == null ? null : first(md.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE), md.getString(MediaMetadata.METADATA_KEY_TITLE));
                    if (title != null) {
                        o.put("live", true);
                        o.put("pkg", pkg);
                        o.put("app", appLabel(pkg));
                        o.put("title", title);
                        o.put("sub", first(md.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE), md.getString(MediaMetadata.METADATA_KEY_ARTIST), md.getString(MediaMetadata.METADATA_KEY_ALBUM)));
                        long dur = md.getLong(MediaMetadata.METADATA_KEY_DURATION);
                        o.put("duration", dur);
                        int st = ps == null ? PlaybackState.STATE_NONE : ps.getState();
                        o.put("playing", st == PlaybackState.STATE_PLAYING || st == PlaybackState.STATE_BUFFERING);
                        long pos = ps == null ? 0 : ps.getPosition();
                        if (ps != null && st == PlaybackState.STATE_PLAYING) pos += (long) ((SystemClock.elapsedRealtime() - ps.getLastPositionUpdateTime()) * ps.getPlaybackSpeed());
                        o.put("position", Math.max(0, pos));
                        String artKey = pkg + "|" + title;
                        String art = imageCache.get("m:" + artKey);
                        if (art == null) {
                            Bitmap b = md.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON);
                            if (b == null) b = md.getBitmap(MediaMetadata.METADATA_KEY_ART);
                            if (b == null) b = md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
                            if (b != null) {
                                int w = 240, h = Math.max(1, Math.round(240f * b.getHeight() / b.getWidth()));
                                art = dataUri(Bitmap.createScaledBitmap(b, w, h, true));
                                imageCache.put("m:" + artKey, art);
                            }
                        }
                        if (art != null) o.put("art", art);
                        lastController = c;
                        return o.toString();
                    }
                }
            } catch (Exception ignored) {
                // listener not enabled yet, or the app has no session
            }
            lastController = null;
            String last = prefs().getString("last_media", null); // kept by MediaListener in the background
            // An app opened after that media (e.g. Lampa, which has no media session) wins.
            String app = prefs().getString("last_app", null);
            long appAt = prefs().getLong("last_app_at", 0);
            try {
                JSONObject lm = last != null ? new JSONObject(last) : new JSONObject();
                if (app != null && !app.equals(lm.optString("pkg")) && appAt > lm.optLong("at", 0)) {
                    JSONObject ao = new JSONObject();
                    ao.put("live", false);
                    ao.put("playing", false);
                    ao.put("pkg", app);
                    ao.put("app", appLabel(app));
                    ao.put("title", appLabel(app));
                    ao.put("sub", "відкрито о " + new java.text.SimpleDateFormat("HH:mm", java.util.Locale.US).format(new java.util.Date(appAt)));
                    ao.put("appOnly", true);
                    return ao.toString();
                }
            } catch (Exception ignored) {
            }
            return last != null ? last : "{}";
        }

        @JavascriptInterface
        public void mediaAction(String action) {
            ui.post(() -> {
                try {
                    MediaController c = lastController;
                    if ("open".equals(action) || c == null) {
                        if (c != null && c.getSessionActivity() != null) {
                            c.getSessionActivity().send();
                            return;
                        }
                        JSONObject last = new JSONObject(prefs().getString("last_media", "{}"));
                        String pkg = last.optString("pkg", null);
                        if (pkg != null) new Bridge().launch(pkg);
                        return;
                    }
                    MediaController.TransportControls t = c.getTransportControls();
                    PlaybackState ps = c.getPlaybackState();
                    boolean playing = ps != null && ps.getState() == PlaybackState.STATE_PLAYING;
                    if ("toggle".equals(action)) { if (playing) t.pause(); else t.play(); }
                    else if ("next".equals(action)) t.skipToNext();
                    else if ("prev".equals(action)) t.skipToPrevious();
                } catch (Exception ignored) {
                }
            });
        }

        @JavascriptInterface
        public void setNotchMap(boolean on) { prefs().edit().putBoolean("notch_map", on).apply(); }

        @JavascriptInterface
        public boolean notchMap() { return prefs().getBoolean("notch_map", false); }

        @JavascriptInterface
        public void setCity(String json) { DataService.get(MainActivity.this).setCity(json); }

        @JavascriptInterface
        public String getCity() { return DataService.get(MainActivity.this).getCity(); }

        @JavascriptInterface
        public void sound(String name) {
            Integer id = soundIds.get(name);
            if (id != null && sounds != null) sounds.play(id, 0.5f, 0.5f, 1, 0, 1f);
        }

        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME + " (" + BuildConfig.VERSION_CODE + ")";
        }
    }
}
