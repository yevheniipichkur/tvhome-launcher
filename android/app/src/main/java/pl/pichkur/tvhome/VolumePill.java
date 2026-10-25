package pl.pichkur.tvhome;

import android.animation.Animator;
import android.animation.AnimatorListenerAdapter;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.os.IBinder;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.animation.DecelerateInterpolator;

/** Media volume: ink surface, ivory speaker, amber track and the same 0–100% scale as the phone. */
final class VolumePill extends View {
    private final float d;
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path speaker = new Path();
    private final RectF rect = new RectF();
    private final Typeface regular = Typeface.create("sans-serif", Typeface.NORMAL), medium = Typeface.create("sans-serif-medium", Typeface.NORMAL);
    private float shown, reveal;
    private int percent;
    private boolean quiet, visibleTarget;
    private ValueAnimator entrance, level;
    VolumePill(Context c) { super(c); d = getResources().getDisplayMetrics().scaledDensity; setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_YES); }
    static WindowManager.LayoutParams windowParams(Context c, boolean global, IBinder token) {
        float d = c.getResources().getDisplayMetrics().scaledDensity;
        float physical = c.getResources().getDisplayMetrics().density;
        int width = Math.min((int)(288*d), c.getResources().getDisplayMetrics().widthPixels-(int)(48*physical));
        WindowManager.LayoutParams p = new WindowManager.LayoutParams(width, (int)(56*d), global ? WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY : WindowManager.LayoutParams.TYPE_APPLICATION_PANEL,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN, PixelFormat.TRANSLUCENT);
        p.gravity = Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL; p.y = (int)(20*physical); p.token = token; p.setTitle("Вітальня · Гучність"); return p;
    }
    private boolean motion() { return Settings.Global.getFloat(getContext().getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 1f) != 0; }
    void setLevel(int current, int max, boolean muted) {
        percent = VolumeScale.percent(current, max, muted); quiet = muted || current == 0;
        setContentDescription(quiet ? "Гучність: без звуку" : "Гучність: " + percent + " відсотків");
        if (level != null) level.cancel();
        float to = percent / 100f;
        if (!motion() || !visibleTarget) { shown = to; invalidate(); return; }
        level = ValueAnimator.ofFloat(shown, to); level.setDuration(120); level.setInterpolator(new DecelerateInterpolator());
        level.addUpdateListener(a -> { shown = (float)a.getAnimatedValue(); invalidate(); }); level.start();
    }
    void slide(boolean show, Runnable end) {
        if (show && visibleTarget) return;
        visibleTarget = show;
        if (entrance != null) entrance.cancel();
        if (!motion()) { reveal = show ? 1 : 0; invalidate(); if (end != null) end.run(); return; }
        entrance = ValueAnimator.ofFloat(reveal, show ? 1 : 0); entrance.setDuration(show ? 180 : 150); entrance.setInterpolator(new DecelerateInterpolator());
        entrance.addUpdateListener(a -> { reveal = (float)a.getAnimatedValue(); invalidate(); });
        entrance.addListener(new AnimatorListenerAdapter() { boolean cancelled; @Override public void onAnimationCancel(Animator a) { cancelled = true; } @Override public void onAnimationEnd(Animator a) { if (!cancelled && end != null) end.run(); } }); entrance.start();
    }
    void cancelAnimations() { if (entrance != null) entrance.cancel(); if (level != null) level.cancel(); }
    private void color(int color) { paint.setColor(color); paint.setStyle(Paint.Style.FILL); }
    private void text(Canvas c, String value, float x, float y, int size, boolean bold, Paint.Align align, int color) {
        color(color); paint.setTypeface(bold ? medium : regular); paint.setTextSize(size*d); paint.setTextAlign(align); c.drawText(value,x*d,y*d,paint);
    }
    @Override protected void onDraw(Canvas c) {
        if (reveal <= 0) return;
        float w = getWidth()/d;
        c.save(); c.translate(0,(1-reveal)*6*d); c.saveLayerAlpha(0,0,getWidth(),getHeight(),Math.round(reveal*255));
        color(0xF517202C); rect.set(0,0,getWidth(),48*d); c.drawRoundRect(rect,12*d,12*d,paint);
        color(0xFFF3EEE4); paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(1.8f); paint.setStrokeCap(Paint.Cap.ROUND); paint.setStrokeJoin(Paint.Join.ROUND);
        c.save(); c.translate(16*d,14*d); c.scale(.8f*d,.8f*d);
        speaker.reset(); speaker.moveTo(2,8); speaker.lineTo(6,8); speaker.lineTo(12,3); speaker.lineTo(12,21); speaker.lineTo(6,16); speaker.lineTo(2,16); speaker.close(); c.drawPath(speaker,paint);
        // Canvas was scaled to density; keep the icon stroke at 1.8 logical pixels.
        paint.setStrokeWidth(1.8f);
        if (quiet) { c.drawLine(17,8,23,16,paint); c.drawLine(23,8,17,16,paint); }
        else { rect.set(12,6,22,18); c.drawArc(rect,-55,110,false,paint); if (percent>50) { rect.set(11,2,29,22); c.drawArc(rect,-50,100,false,paint); } }
        c.restore();
        text(c,percent+"%",w-16,31,18,true,Paint.Align.RIGHT,0xFFF3EEE4);
        float x=52*d,y=23*d,bw=getWidth()-120*d;
        color(0xFF34404E);rect.set(x,y,x+bw,y+4*d);c.drawRoundRect(rect,2*d,2*d,paint);
        if (shown>0) { color(quiet ? 0xFFB1BAC8 : 0xFFF4A640);rect.set(x,y,x+bw*shown,y+4*d);c.drawRoundRect(rect,2*d,2*d,paint); }
        c.restore();c.restore();
    }
}
