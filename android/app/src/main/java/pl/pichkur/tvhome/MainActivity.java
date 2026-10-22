package pl.pichkur.tvhome;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ActivityInfo;
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
    private static final String HOME_URL = BuildConfig.HOME_URL;
    private static final String OFFLINE_URL = "file:///android_asset/offline.html";
    private static final String FALLBACK_LAUNCHER = "com.spocky.projengmenu";
    private static final long RELOAD_AFTER_MS = 30 * 60_000L;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Map<String, String> imageCache = new HashMap<>();
    private WebView web;
    private SoundPool sounds;
    private final Map<String, Integer> soundIds = new HashMap<>();
    private boolean offline;
    private long loadedAt;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // UI sounds via SoundPool: low latency and independent of the WebView
        sounds = new SoundPool.Builder().setMaxStreams(4).setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_GAME) // media volume: the system stream is near-silent over HDMI on this box
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()).build();
        soundIds.put("move", sounds.load(this, R.raw.ui_move, 1));
        soundIds.put("edge", sounds.load(this, R.raw.ui_edge, 1));
        soundIds.put("open", sounds.load(this, R.raw.ui_open, 1));
        soundIds.put("back", sounds.load(this, R.raw.ui_back, 1));
        WebView.setWebContentsDebuggingEnabled(true); // chrome://inspect over ADB on the LAN
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
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) goOffline();
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
                if (url.startsWith("http") && offline) {
                    offline = false; // the offline page navigated back home by itself
                }
                if (url.startsWith("http")) {
                    offline = false;
                    loadedAt = SystemClock.elapsedRealtime();
                }
            }
        });
        setContentView(web);
        offline = false;
        web.loadUrl(HOME_URL);
        web.requestFocus();
    }

    private void goOffline() {
        if (offline) return;
        offline = true;
        web.loadUrl(OFFLINE_URL);
        ui.postDelayed(this::retry, 10_000);
    }

    private void retry() {
        if (!offline) return;
        new Thread(() -> {
            boolean up = false;
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(HOME_URL + "healthz").openConnection();
                c.setConnectTimeout(4000);
                c.setReadTimeout(4000);
                up = c.getResponseCode() == 200;
                c.disconnect();
            } catch (Exception ignored) {
            }
            final boolean ok = up;
            ui.post(() -> {
                if (ok) {
                    offline = false;
                    web.loadUrl(HOME_URL);
                } else {
                    ui.postDelayed(this::retry, 10_000);
                }
            });
        }).start();
    }

    @Override
    protected void onPause() {
        HomeGuardService.homeInFront = false;
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        HomeGuardService.homeInFront = true;
        hideSystemUi();
        if (!offline && loadedAt > 0 && SystemClock.elapsedRealtime() - loadedAt > RELOAD_AFTER_MS) {
            web.loadUrl(HOME_URL);
        } else {
            web.evaluateJavascript("window.tvResume && window.tvResume()", null);
        }
        web.requestFocus();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        web.evaluateJavascript("window.tvResume && window.tvResume()", null);
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

    private volatile MediaController lastController;

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
        @JavascriptInterface
        public String apps() {
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
                else if ("fallback".equals(what)) i = getPackageManager().getLaunchIntentForPackage(FALLBACK_LAUNCHER);
                else i = new Intent(Settings.ACTION_SETTINGS);
                if (i == null) i = new Intent(Settings.ACTION_SETTINGS);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    startActivity(i);
                } catch (ActivityNotFoundException ignored) {
                }
            });
        }

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
