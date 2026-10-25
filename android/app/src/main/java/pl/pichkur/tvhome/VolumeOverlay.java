package pl.pichkur.tvhome;

import android.content.Context;
import android.media.AudioManager;
import android.os.Handler;
import android.os.Looper;
import android.os.IBinder;
import android.view.WindowManager;

/** Same native view in the launcher and in the accessibility overlay over other apps. */
final class VolumeOverlay {
    private final Context context;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final boolean global;
    private final java.util.function.Supplier<IBinder> token;
    private VolumePill view;
    private final Runnable hide = () -> { if (view != null) view.slide(false, this::remove); };
    VolumeOverlay(Context context, boolean global, java.util.function.Supplier<IBinder> token) {
        this.context = context; this.global = global; this.token = token;
    }
    void show() { ui.post(() -> {
        if (!MediaVolume.custom(context)) { remove(); return; }
        AudioManager a = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        if (a == null || a.isVolumeFixed()) return;
        if (view == null) {
            view = new VolumePill(context);
            try { ((WindowManager) context.getSystemService(Context.WINDOW_SERVICE)).addView(view, VolumePill.windowParams(context, global, token == null ? null : token.get())); }
            catch (Exception e) { view = null; a.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_SAME, AudioManager.FLAG_SHOW_UI); return; }
        }
        view.setLevel(a.getStreamVolume(AudioManager.STREAM_MUSIC), a.getStreamMaxVolume(AudioManager.STREAM_MUSIC), a.isStreamMute(AudioManager.STREAM_MUSIC));
        view.slide(true, null); ui.removeCallbacks(hide); ui.postDelayed(hide, 2000);
    }); }
    void close() { ui.post(() -> { ui.removeCallbacks(hide); remove(); }); }
    private void remove() {
        if (view == null) return;
        VolumePill old = view; view = null; old.cancelAnimations();
        try { ((WindowManager) context.getSystemService(Context.WINDOW_SERVICE)).removeView(old); } catch (Exception ignored) { }
    }
}
