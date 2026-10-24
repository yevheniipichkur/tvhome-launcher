package pl.pichkur.tvhome;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;

/**
 * Volume level as a notch at the top edge (same shape as the alert NotchBanner): a speaker, a bar
 * and the number. Shown by HomeGuardService instead of the system volume panel; it stays while the
 * remote's volume keys are pressed and folds away ~1.6 s after the last one.
 */
final class VolumePill extends View {
    private final float d;
    private final Paint bg = new Paint(Paint.ANTI_ALIAS_FLAG), track = new Paint(Paint.ANTI_ALIAS_FLAG),
            fill = new Paint(Paint.ANTI_ALIAS_FLAG), icon = new Paint(Paint.ANTI_ALIAS_FLAG), text = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();
    private final RectF r = new RectF();
    private float drop;          // 0 hidden above the edge … 1 attached
    private float shown;         // animated level 0..1
    private int level, max = 15;
    private boolean muted;
    private ValueAnimator dropAnim, levelAnim;

    VolumePill(Context ctx) {
        super(ctx);
        d = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 1, ctx.getResources().getDisplayMetrics());
        bg.setColor(0xFF000000);
        track.setColor(0x33FFFFFF);
        fill.setColor(0xFFF4A640);
        icon.setColor(0xFFFFFFFF);
        icon.setStyle(Paint.Style.STROKE);
        icon.setStrokeWidth(2.2f * d);
        icon.setStrokeCap(Paint.Cap.ROUND);
        icon.setStrokeJoin(Paint.Join.ROUND);
        text.setColor(0xFFFFFFFF);
        text.setTextSize(17 * d);
        text.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        text.setTextAlign(Paint.Align.RIGHT);
    }

    static WindowManager.LayoutParams windowParams(Context ctx) {
        float d = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 1, ctx.getResources().getDisplayMetrics());
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams((int) (420 * d), (int) (70 * d),
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
        return lp;
    }

    void setLevel(int level, int max, boolean muted) {
        this.max = Math.max(1, max);
        this.muted = muted;
        float from = shown, to = muted ? 0 : (float) level / this.max;
        this.level = level;
        if (levelAnim != null) levelAnim.cancel();
        levelAnim = ValueAnimator.ofFloat(from, to);
        levelAnim.setDuration(160);
        levelAnim.addUpdateListener(a -> { shown = (float) a.getAnimatedValue(); invalidate(); });
        levelAnim.start();
    }

    void slide(boolean in, Runnable end) {
        if (dropAnim != null) dropAnim.cancel();
        dropAnim = ValueAnimator.ofFloat(drop, in ? 1 : 0);
        dropAnim.setDuration(in ? 220 : 260);
        dropAnim.setInterpolator(new DecelerateInterpolator(2f));
        dropAnim.addUpdateListener(a -> { drop = (float) a.getAnimatedValue(); invalidate(); });
        if (end != null) dropAnim.addListener(new android.animation.AnimatorListenerAdapter() {
            @Override public void onAnimationEnd(android.animation.Animator a) { end.run(); }
        });
        dropAnim.start();
    }

    @Override
    protected void onDraw(Canvas c) {
        float w = 360 * d, h = 46 * d, cx = getWidth() / 2f;
        float top = -h * (1 - drop) - 2 * d, rad = 22 * d, sh = 10 * d;
        path.reset();
        path.moveTo(cx - w / 2 - sh, top);
        path.quadTo(cx - w / 2, top, cx - w / 2, top + sh);
        path.lineTo(cx - w / 2, top + h - rad);
        r.set(cx - w / 2, top + h - 2 * rad, cx - w / 2 + 2 * rad, top + h);
        path.arcTo(r, 180, -90);
        path.lineTo(cx + w / 2 - rad, top + h);
        r.set(cx + w / 2 - 2 * rad, top + h - 2 * rad, cx + w / 2, top + h);
        path.arcTo(r, 90, -90);
        path.lineTo(cx + w / 2, top + sh);
        path.quadTo(cx + w / 2, top, cx + w / 2 + sh, top);
        path.close();
        c.drawPath(path, bg);
        float mid = top + h / 2f + 2 * d, x0 = cx - w / 2 + 26 * d;
        // speaker
        Path sp = new Path();
        sp.moveTo(x0, mid - 4 * d); sp.lineTo(x0 + 5 * d, mid - 4 * d); sp.lineTo(x0 + 11 * d, mid - 9 * d);
        sp.lineTo(x0 + 11 * d, mid + 9 * d); sp.lineTo(x0 + 5 * d, mid + 4 * d); sp.lineTo(x0, mid + 4 * d); sp.close();
        c.drawPath(sp, icon);
        if (muted || level == 0) {
            c.drawLine(x0 + 16 * d, mid - 5 * d, x0 + 26 * d, mid + 5 * d, icon);
            c.drawLine(x0 + 26 * d, mid - 5 * d, x0 + 16 * d, mid + 5 * d, icon);
        } else {
            r.set(x0 + 9 * d, mid - 6 * d, x0 + 21 * d, mid + 6 * d);
            c.drawArc(r, -50, 100, false, icon);
            if (shown > 0.5f) { r.set(x0 + 9 * d, mid - 11 * d, x0 + 29 * d, mid + 11 * d); c.drawArc(r, -50, 100, false, icon); }
        }
        // bar + number
        float bx = x0 + 40 * d, bw = w - 40 * d - 26 * d - 40 * d;
        r.set(bx, mid - 3 * d, bx + bw, mid + 3 * d);
        c.drawRoundRect(r, 3 * d, 3 * d, track);
        r.set(bx, mid - 3 * d, bx + bw * shown, mid + 3 * d);
        c.drawRoundRect(r, 3 * d, 3 * d, fill);
        c.drawText(muted ? "—" : String.valueOf(level), cx + w / 2 - 22 * d, mid + 6 * d, text);
    }
}
