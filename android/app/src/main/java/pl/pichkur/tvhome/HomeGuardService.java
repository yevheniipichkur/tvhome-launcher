package pl.pichkur.tvhome;

import android.accessibilityservice.AccessibilityService;
import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.animation.DecelerateInterpolator;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * Always-running helper:
 *  - the Mi Box firmware re-enables and prefers the stock launcher on every boot, so the Home
 *    button and any appearance of the stock launcher are sent back to «Вітальня»;
 *  - while another app is in front, a Lviv air-raid alert (and the all-clear) slides in over it.
 */
public class HomeGuardService extends AccessibilityService {
    private static final String[] STOCK = {"com.google.android.tvlauncher", "com.google.android.leanbacklauncher", "com.mitv.tvhome"};
    private static final long POLL_MS = 10_000;
    private static final long FRESH_MS = 10 * 60_000L; // an alert already running at start is shown if this recent

    /** Set by MainActivity: the home screen shows alerts itself. */
    static volatile boolean homeInFront;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private Boolean lastActive; // null until the first successful poll
    private boolean polling;

    static void goHome(Context ctx) {
        Intent i = new Intent(ctx, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        ctx.startActivity(i);
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        if (!polling) {
            polling = true;
            ui.post(this::poll);
        }
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED || event.getPackageName() == null) return;
        String pkg = event.getPackageName().toString();
        rememberApp(pkg);
        for (String s : STOCK) {
            if (s.equals(pkg)) {
                goHome(this);
                return;
            }
        }
    }

    // Apps without a media session (Lampa, TorrServe players…) never tell the system what plays:
    // remember the last opened app so the home screen's player can offer to go back to it.
    private final java.util.Map<String, Boolean> launchable = new java.util.HashMap<>();
    private String lastApp;

    private void rememberApp(String pkg) {
        if (pkg.equals(getPackageName()) || pkg.equals(lastApp) || pkg.startsWith("com.android.") || pkg.contains("inputmethod")) return;
        Boolean ok = launchable.get(pkg);
        if (ok == null) {
            android.content.pm.PackageManager pm = getPackageManager();
            ok = pm.getLeanbackLaunchIntentForPackage(pkg) != null || pm.getLaunchIntentForPackage(pkg) != null;
            launchable.put(pkg, ok);
        }
        if (!ok) return;
        lastApp = pkg;
        getSharedPreferences("tvhome", MODE_PRIVATE).edit().putString("last_app", pkg).putLong("last_app_at", System.currentTimeMillis()).apply();
    }

    @Override
    protected boolean onKeyEvent(KeyEvent event) {
        if (event.getKeyCode() != KeyEvent.KEYCODE_HOME) return false;
        if (event.getAction() == KeyEvent.ACTION_UP) goHome(this);
        return true;
    }

    @Override
    public void onInterrupt() {
    }

    @Override
    public void onDestroy() {
        polling = false;
        ui.removeCallbacksAndMessages(null);
        hideBanner(false);
        super.onDestroy();
    }

    // ---------- alert watch ----------

    private void poll() {
        if (!polling) return;
        // Same in-process data the home screen uses (DataService), no home server involved.
        JSONObject alert = DataService.get(this).cityAlert();
        if (alert.optBoolean("known")) onAlertState(alert);
        ui.postDelayed(this::poll, POLL_MS);
    }

    private void onAlertState(JSONObject a) {
        boolean active = a.optBoolean("active");
        long since = parseIso(a.optString("since", null));
        if (lastActive == null) {
            lastActive = active;
            if (active && since > 0 && System.currentTimeMillis() - since < FRESH_MS) showAlert(a, since);
            return;
        }
        if (active == lastActive) return;
        lastActive = active;
        if (active) showAlert(a, since);
        else showClear(a);
    }

    private void showAlert(JSONObject a, long since) {
        String city = a.optString("city", "Львів");
        String sub = city + (since > 0 ? " · з " + hhmm(since) : "") + " · пройдіть в укриття";
        DataService ds = DataService.get(this);
        mapForNext = new MiniMap(this, ds.alertsNow(), ds.threatsNow(), ds.cityLon(), ds.cityLat());
        present("Повітряна тривога", sub, "ТРИВОГА", 0xFFFF453A, R.raw.alert_chime, 14_000);
    }

    private void showClear(JSONObject a) {
        present("Відбій тривоги", a.optString("city", "Львів") + " · " + hhmm(System.currentTimeMillis()), "ВІДБІЙ", 0xFF32D74B, R.raw.clear_chime, 7_000);
    }

    // ---------- notch ----------
    private MiniMap mapForNext;
    private View banner;

    private void present(String title, String subtitle, String chip, int color, int sound, long holdMs) {
        playChime(sound);
        if (homeInFront) { mapForNext = null; return; }
        hideBanner(false);
        NotchBanner notch = new NotchBanner(this, title, subtitle, chip, color);
        if (mapForNext != null) { notch.withMap(mapForNext); mapForNext = null; }
        WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        try {
            wm.addView(notch, NotchBanner.windowParams(this));
        } catch (Exception e) {
            return;
        }
        banner = notch;
        notch.play(holdMs, () -> { if (banner == notch) hideBanner(false); });
    }

    private void hideBanner(boolean animated) {
        final View b = banner;
        banner = null;
        if (b == null) return;
        try { ((WindowManager) getSystemService(WINDOW_SERVICE)).removeView(b); } catch (Exception ignored) { }
    }

    private void playChime(int res) {
        try {
            MediaPlayer mp = MediaPlayer.create(this, res, new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_GAME) // media volume, audible over HDMI
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build(), 0);
            if (mp == null) return;
            mp.setVolume(0.6f, 0.6f);
            mp.setOnCompletionListener(MediaPlayer::release);
            mp.start();
        } catch (Exception ignored) {
        }
    }

    private static long parseIso(String s) {
        if (s == null || s.isEmpty() || "null".equals(s)) return 0;
        try {
            String clean = s.replaceAll("\\.\\d+", "").replace("Z", "+0000");
            if (!clean.matches(".*[+-]\\d{4}$")) clean = clean.replaceAll("([+-]\\d{2}):(\\d{2})$", "$1$2");
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssZ", Locale.US);
            return f.parse(clean).getTime();
        } catch (Exception e) {
            return 0;
        }
    }

    private static String hhmm(long ms) {
        SimpleDateFormat f = new SimpleDateFormat("HH:mm", Locale.US);
        f.setTimeZone(TimeZone.getDefault());
        return f.format(new Date(ms));
    }
}
