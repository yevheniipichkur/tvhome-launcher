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
    private View banner;
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
        for (String s : STOCK) {
            if (s.equals(pkg)) {
                goHome(this);
                return;
            }
        }
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
        new Thread(() -> {
            JSONObject a = null;
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(BuildConfig.HOME_URL + "api/alert").openConnection();
                c.setConnectTimeout(5000);
                c.setReadTimeout(5000);
                if (c.getResponseCode() == 200) {
                    InputStream in = c.getInputStream();
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    byte[] buf = new byte[4096];
                    for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                    a = new JSONObject(out.toString("UTF-8"));
                }
                c.disconnect();
            } catch (Exception ignored) {
            }
            final JSONObject alert = a;
            ui.post(() -> {
                if (alert != null) onAlertState(alert);
                ui.postDelayed(this::poll, POLL_MS);
            });
        }).start();
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
        StringBuilder sub = new StringBuilder();
        if (since > 0) sub.append("з ").append(hhmm(since));
        JSONArray reasons = a.optJSONArray("reasons");
        if (reasons != null && reasons.length() > 0) {
            if (sub.length() > 0) sub.append(" · ");
            sub.append(reasons.optString(0).replaceAll("\\s*\\(.*\\)", ""));
        }
        if (sub.length() > 0) sub.append(" · ");
        sub.append("пройдіть в укриття");
        present("Повітряна тривога · " + city, sub.toString(), 0xFFE5584F, 0xF2321715, R.raw.alert_chime, 15_000);
    }

    private void showClear(JSONObject a) {
        present("Відбій тривоги · " + a.optString("city", "Львів"), hhmm(System.currentTimeMillis()), 0xFF7FBF6A, 0xF2162418, R.raw.clear_chime, 9_000);
    }

    // ---------- banner ----------

    private float dp(float v) {
        return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private void present(String title, String subtitle, int accent, int fill, int sound, long showMs) {
        playChime(sound);
        if (homeInFront) return;
        hideBanner(false);

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.HORIZONTAL);
        box.setGravity(Gravity.CENTER_VERTICAL);
        int padH = (int) dp(22), padV = (int) dp(14);
        box.setPadding(padH, padV, (int) dp(28), padV);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(fill);
        bg.setCornerRadius(dp(18));
        bg.setStroke((int) dp(2), accent);
        box.setBackground(bg);
        box.setElevation(dp(12));

        View dot = new View(this);
        GradientDrawable dotBg = new GradientDrawable();
        dotBg.setShape(GradientDrawable.OVAL);
        dotBg.setColor(accent);
        dot.setBackground(dotBg);
        LinearLayout.LayoutParams dlp = new LinearLayout.LayoutParams((int) dp(12), (int) dp(12));
        dlp.rightMargin = (int) dp(16);
        box.addView(dot, dlp);

        LinearLayout texts = new LinearLayout(this);
        texts.setOrientation(LinearLayout.VERTICAL);
        TextView t = new TextView(this);
        t.setText("✻ " + title);
        t.setTextColor(Color.WHITE);
        t.setTypeface(Typeface.MONOSPACE, Typeface.BOLD);
        t.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 17);
        TextView s = new TextView(this);
        s.setText(subtitle);
        s.setTextColor(0xFFD9D6CF);
        s.setTypeface(Typeface.MONOSPACE);
        s.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 12);
        s.setPadding(0, (int) dp(3), 0, 0);
        t.setSingleLine(true);
        s.setSingleLine(true);
        texts.addView(t);
        texts.addView(s);
        box.addView(texts);

        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        // overlay windows get a narrow default width; size it to the text explicitly
        box.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED);
        lp.width = Math.min(box.getMeasuredWidth(), getResources().getDisplayMetrics().widthPixels - (int) dp(80));
        lp.y = (int) dp(24);
        try {
            ((WindowManager) getSystemService(WINDOW_SERVICE)).addView(box, lp);
        } catch (Exception e) {
            return;
        }
        banner = box;

        // slide in from above, pulse the dot, slide out after a while
        box.setAlpha(0f);
        box.setTranslationY(-dp(90));
        box.animate().alpha(1f).translationY(0f).setDuration(650).setInterpolator(new DecelerateInterpolator(2.2f)).start();
        pulse(dot, 6);
        final View shown = box;
        ui.postDelayed(() -> {
            if (banner == shown) hideBanner(true);
        }, showMs);
    }

    private void pulse(View dot, int times) {
        if (times <= 0) return;
        dot.animate().scaleX(1.6f).scaleY(1.6f).alpha(.45f).setDuration(520).withEndAction(() ->
                dot.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(520).withEndAction(() -> pulse(dot, times - 1)).start()).start();
    }

    private void hideBanner(boolean animated) {
        final View b = banner;
        banner = null;
        if (b == null) return;
        final WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        if (!animated) {
            try { wm.removeView(b); } catch (Exception ignored) { }
            return;
        }
        b.animate().alpha(0f).translationY(-dp(60)).setDuration(450).setListener(new AnimatorListenerAdapter() {
            @Override
            public void onAnimationEnd(Animator animation) {
                try { wm.removeView(b); } catch (Exception ignored) { }
            }
        }).start();
    }

    private void playChime(int res) {
        try {
            MediaPlayer mp = MediaPlayer.create(this, res, new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
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
