package pl.pichkur.tvhome;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.Handler;
import android.os.Looper;
import android.text.TextPaint;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.OvershootInterpolator;

/**
 * Alert notification as a "notch" at the top edge (MacBook notch / Dynamic Island style):
 * a small black notch drops in, springs open into a wide capsule, the content fades in,
 * holds, then folds back into the notch and slides away. One custom View, drawn on its own
 * accessibility-overlay window — cheap for the box GPU (no blur, one path per frame).
 */
final class NotchBanner extends View {
    interface Done { void run(); }

    private final float d; // px per dp
    private final Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint accent = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint title = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint sub = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint chip = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();
    private final RectF r = new RectF();

    private final String titleText, subText, chipText;
    private final int color;

    // animated state
    private float open;      // 0 = notch, 1 = full capsule
    private float drop;      // 0 = hidden above the edge, 1 = attached
    private float content;   // 0..1 text/icon alpha
    private float pulse;     // 0..1 ring phase

    private final float notchW, notchH, fullW, fullH;

    NotchBanner(Context ctx, String title, String subtitle, String chip, int color) {
        super(ctx);
        d = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 1, ctx.getResources().getDisplayMetrics());
        titleText = title; subText = subtitle; chipText = chip; this.color = color;
        bg.setColor(Color.BLACK);
        accent.setColor(color);
        ring.setColor(color);
        ring.setStyle(Paint.Style.STROKE);
        ring.setStrokeWidth(2 * d);
        this.title.setColor(Color.WHITE);
        this.title.setTextSize(19 * d);
        this.title.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        sub.setColor(0xFFA7ADB8);
        sub.setTextSize(13.5f * d);
        sub.setTypeface(Typeface.create("sans-serif", Typeface.NORMAL));
        this.chip.setColor(color);
        this.chip.setTextSize(12 * d);
        this.chip.setTypeface(Typeface.create("sans-serif-medium", Typeface.BOLD));
        this.chip.setLetterSpacing(0.12f);
        notchW = 150 * d; notchH = 30 * d;
        fullW = 560 * d; fullH = 78 * d;
    }

    static WindowManager.LayoutParams windowParams(Context ctx) {
        float d = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 1, ctx.getResources().getDisplayMetrics());
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                (int) (600 * d), (int) (110 * d),
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        lp.y = 0;
        return lp;
    }

    /** drop in → spring open → content → hold → content out → fold → lift away */
    void play(long holdMs, Done done) {
        Handler h = new Handler(Looper.getMainLooper());
        animate(0, 1, 260, new DecelerateInterpolator(2f), v -> drop = v, () ->
                animate(0, 1, 620, new OvershootInterpolator(1.15f), v -> open = v, null));
        h.postDelayed(() -> animate(0, 1, 320, new DecelerateInterpolator(), v -> content = v, null), 420);
        ValueAnimator p = ValueAnimator.ofFloat(0, 1);
        p.setDuration(1400);
        p.setRepeatCount(ValueAnimator.INFINITE);
        p.addUpdateListener(a -> { pulse = (float) a.getAnimatedValue(); invalidate(); });
        p.start();
        h.postDelayed(() -> animate(1, 0, 200, new DecelerateInterpolator(), v -> content = v, () ->
                animate(1, 0, 420, new DecelerateInterpolator(1.6f), v -> open = v, () ->
                        animate(1, 0, 240, new DecelerateInterpolator(), v -> drop = v, () -> { p.cancel(); done.run(); }))), 420 + holdMs);
    }

    private interface Set { void set(float v); }

    private void animate(float from, float to, long ms, android.animation.TimeInterpolator in, Set set, Runnable end) {
        ValueAnimator a = ValueAnimator.ofFloat(from, to);
        a.setDuration(ms);
        a.setInterpolator(in);
        a.addUpdateListener(x -> { set.set((float) x.getAnimatedValue()); invalidate(); });
        if (end != null) a.addListener(new AnimatorListenerAdapter() { @Override public void onAnimationEnd(Animator x) { end.run(); } });
        a.start();
    }

    @Override
    protected void onDraw(Canvas c) {
        float w = notchW + (fullW - notchW) * open;
        float h = notchH + (fullH - notchH) * Math.min(1f, open);
        float cx = getWidth() / 2f;
        float top = -h * (1 - drop) - 2 * d;            // slides down from above the edge
        float rad = Math.min(h / 2f, 30 * d);
        float shoulder = 10 * d;                          // concave "ears" where the notch meets the edge
        // notch body: square top attached to the edge, round bottom corners, concave shoulders
        path.reset();
        path.moveTo(cx - w / 2 - shoulder, top);
        path.quadTo(cx - w / 2, top, cx - w / 2, top + shoulder);
        path.lineTo(cx - w / 2, top + h - rad);
        r.set(cx - w / 2, top + h - 2 * rad, cx - w / 2 + 2 * rad, top + h);
        path.arcTo(r, 180, -90);
        path.lineTo(cx + w / 2 - rad, top + h);
        r.set(cx + w / 2 - 2 * rad, top + h - 2 * rad, cx + w / 2, top + h);
        path.arcTo(r, 90, -90);
        path.lineTo(cx + w / 2, top + shoulder);
        path.quadTo(cx + w / 2, top, cx + w / 2 + shoulder, top);
        path.close();
        c.drawPath(path, bg);

        if (content <= 0.01f) return;
        int alpha = (int) (255 * content);
        float left = cx - w / 2 + 28 * d, midY = top + h / 2f;
        // icon: solid dot with an expanding ring
        float dotR = 8 * d;
        accent.setAlpha(alpha);
        c.drawCircle(left + dotR, midY, dotR, accent);
        ring.setAlpha((int) (alpha * (1 - pulse)));
        c.drawCircle(left + dotR, midY, dotR + 12 * d * pulse, ring);
        // chip on the right
        float chipW = chip.measureText(chipText);
        float right = cx + w / 2 - 28 * d;
        chip.setAlpha(alpha);
        c.drawText(chipText, right - chipW, midY + 4 * d, chip);
        // texts
        float tx = left + 2 * dotR + 18 * d, maxW = right - chipW - 20 * d - tx;
        title.setAlpha(alpha);
        sub.setAlpha(alpha);
        c.drawText(TextUtils.ellipsize(titleText, title, maxW, TextUtils.TruncateAt.END).toString(), tx, midY - 3 * d, title);
        c.drawText(TextUtils.ellipsize(subText, sub, maxW, TextUtils.TruncateAt.END).toString(), tx, midY + 17 * d, sub);
    }
}
