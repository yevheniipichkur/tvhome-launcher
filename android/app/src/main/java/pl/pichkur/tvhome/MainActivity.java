package pl.pichkur.tvhome;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
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
    private boolean offline;
    private long loadedAt;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
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
            public void onPageFinished(WebView view, String url) {
                if (url.startsWith("http")) {
                    offline = false;
                    loadedAt = SystemClock.elapsedRealtime();
                }
            }
        });
        setContentView(web);
        web.loadUrl(HOME_URL);
        web.requestFocus();
        hideSystemUi();
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
    protected void onResume() {
        super.onResume();
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

        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME + " (" + BuildConfig.VERSION_CODE + ")";
        }
    }
}
