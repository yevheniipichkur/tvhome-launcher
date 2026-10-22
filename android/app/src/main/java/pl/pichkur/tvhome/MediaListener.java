package pl.pichkur.tvhome;

import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Handler;
import android.os.Looper;
import android.service.notification.NotificationListenerService;
import android.util.Base64;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Always-on watcher of media sessions (MediaSessionManager needs an enabled notification
 * listener; enabled once over ADB). It remembers the last thing played even after an app such as
 * YouTube drops its session on exit, so the launcher's mini player can offer to go back to it.
 */
public class MediaListener extends NotificationListenerService {
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final Map<MediaController, MediaController.Callback> watched = new HashMap<>();
    private MediaSessionManager msm;
    private final MediaSessionManager.OnActiveSessionsChangedListener onChange = this::watch;

    @Override
    public void onListenerConnected() {
        super.onListenerConnected();
        try {
            msm = (MediaSessionManager) getSystemService(MEDIA_SESSION_SERVICE);
            ComponentName me = new ComponentName(this, MediaListener.class);
            msm.addOnActiveSessionsChangedListener(onChange, me, ui);
            watch(msm.getActiveSessions(me));
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onListenerDisconnected() {
        try { if (msm != null) msm.removeOnActiveSessionsChangedListener(onChange); } catch (Exception ignored) { }
        for (Map.Entry<MediaController, MediaController.Callback> e : watched.entrySet()) e.getKey().unregisterCallback(e.getValue());
        watched.clear();
        super.onListenerDisconnected();
    }

    private void watch(List<MediaController> list) {
        for (Map.Entry<MediaController, MediaController.Callback> e : watched.entrySet()) e.getKey().unregisterCallback(e.getValue());
        watched.clear();
        if (list == null) return;
        for (final MediaController c : list) {
            if (c.getPackageName().equals(getPackageName())) continue;
            MediaController.Callback cb = new MediaController.Callback() {
                @Override public void onMetadataChanged(MediaMetadata metadata) { remember(MediaListener.this, c); }
                @Override public void onPlaybackStateChanged(PlaybackState state) { remember(MediaListener.this, c); }
            };
            c.registerCallback(cb, ui);
            watched.put(c, cb);
            remember(this, c);
        }
    }

    /** Stores what a session is playing as the launcher's "last media". */
    static void remember(Context ctx, MediaController c) {
        try {
            MediaMetadata md = c.getMetadata();
            if (md == null) return;
            String title = first(md.getString(MediaMetadata.METADATA_KEY_DISPLAY_TITLE), md.getString(MediaMetadata.METADATA_KEY_TITLE));
            if (title == null) return;
            PlaybackState ps = c.getPlaybackState();
            String pkg = c.getPackageName();
            SharedPreferences prefs = ctx.getSharedPreferences("tvhome", MODE_PRIVATE);
            JSONObject old = new JSONObject(prefs.getString("last_media", "{}"));
            JSONObject o = new JSONObject();
            o.put("live", false);
            o.put("playing", false);
            o.put("pkg", pkg);
            try {
                PackageManager pm = ctx.getPackageManager();
                o.put("app", String.valueOf(pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0))));
            } catch (Exception e) {
                o.put("app", pkg);
            }
            o.put("title", title);
            o.put("sub", first(md.getString(MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE), md.getString(MediaMetadata.METADATA_KEY_ARTIST), md.getString(MediaMetadata.METADATA_KEY_ALBUM)));
            o.put("duration", md.getLong(MediaMetadata.METADATA_KEY_DURATION));
            o.put("position", ps == null ? 0 : Math.max(0, ps.getPosition()));
            o.put("at", System.currentTimeMillis());
            boolean same = pkg.equals(old.optString("pkg")) && title.equals(old.optString("title"));
            if (same && old.has("art")) {
                o.put("art", old.getString("art"));
            } else {
                Bitmap b = md.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON);
                if (b == null) b = md.getBitmap(MediaMetadata.METADATA_KEY_ART);
                if (b == null) b = md.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
                if (b != null) {
                    int w = 240, h = Math.max(1, Math.round(240f * b.getHeight() / b.getWidth()));
                    ByteArrayOutputStream out = new ByteArrayOutputStream();
                    Bitmap.createScaledBitmap(b, w, h, true).compress(Bitmap.CompressFormat.JPEG, 85, out);
                    o.put("art", "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
                }
            }
            prefs.edit().putString("last_media", o.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    private static String first(String... xs) {
        for (String x : xs) if (x != null && !x.isEmpty()) return x;
        return null;
    }
}
