package pl.pichkur.tvhome;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;

/** Android TV firmware can route hardware volume straight to AudioService, bypassing key filters. */
final class VolumeFallback {
    private static final String LEVEL = "android.media.VOLUME_CHANGED_ACTION";
    private static final String MUTE = "android.media.STREAM_MUTE_CHANGED_ACTION";
    private final Context context;
    private final Runnable show;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private VolumeChangeTracker tracker;
    volatile boolean registered;
    volatile int mirroredChanges, dismissRequests;
    private final Runnable dismiss = this::dismissStock;
    private void dismissStock() {
        if (!registered || !MediaVolume.custom(context)) return;
        try {
            // Android 9 SystemUI's volume controller explicitly listens for this broadcast.
            // Restrict it to registered SystemUI receivers; never send Back or change volume twice.
            context.sendBroadcast(new Intent(Intent.ACTION_CLOSE_SYSTEM_DIALOGS).setPackage("com.android.systemui").addFlags(Intent.FLAG_RECEIVER_REGISTERED_ONLY));
            dismissRequests++;
        } catch (Exception ignored) { }
    }
    VolumeFallback(Context context, Runnable show) { this.context = context; this.show = show; }
    void start() {
        // Newer Android restricts closing system dialogs. This compatibility path is for the owner's
        // Android 9 Mi Box, not a claim of replacing SystemUI on every Android version.
        if (registered || Build.VERSION.SDK_INT > 30) return;
        AudioManager a = (AudioManager)context.getSystemService(Context.AUDIO_SERVICE);
        if (a == null) return;
        tracker = new VolumeChangeTracker(a.getStreamVolume(AudioManager.STREAM_MUSIC), a.isStreamMute(AudioManager.STREAM_MUSIC));
        IntentFilter filter = new IntentFilter(LEVEL); filter.addAction(MUTE);
        try { context.registerReceiver(receiver, filter); registered = true; } catch (Exception ignored) { }
    }
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent intent) {
            String action = intent.getAction();
            if (!registered || (!LEVEL.equals(action) && !MUTE.equals(action)) || intent.getIntExtra("android.media.EXTRA_VOLUME_STREAM_TYPE", -1) != AudioManager.STREAM_MUSIC) return;
            AudioManager a = (AudioManager)context.getSystemService(Context.AUDIO_SERVICE);
            if (a == null) return;
            int current = a.getStreamVolume(AudioManager.STREAM_MUSIC); boolean muted = a.isStreamMute(AudioManager.STREAM_MUSIC);
            boolean changed = tracker.changed(current, muted, MediaVolume.wasOwnChange(current, muted));
            PowerManager power = (PowerManager)context.getSystemService(Context.POWER_SERVICE);
            if (!changed || !MediaVolume.custom(context) || a.isVolumeFixed() || (power != null && !power.isInteractive())) return;
            mirroredChanges++; show.run();
            ui.removeCallbacks(dismiss);
            // Let the firmware's already-queued show callback run, then dismiss its stock panel.
            ui.postDelayed(dismiss, 40);
        }
    };
    void close() {
        ui.removeCallbacksAndMessages(null);
        if (registered) { registered = false; try { context.unregisterReceiver(receiver); } catch (Exception ignored) { } }
    }
}
