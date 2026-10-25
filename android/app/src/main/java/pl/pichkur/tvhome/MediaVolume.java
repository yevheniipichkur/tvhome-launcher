package pl.pichkur.tvhome;

import android.content.Context;
import android.media.AudioManager;
import android.view.KeyEvent;
import org.json.JSONObject;

/** All controls operate only on the box's media stream, never an HDMI/CEC TV command. */
final class MediaVolume {
    private static AudioManager audio(Context c) { return (AudioManager) c.getSystemService(Context.AUDIO_SERVICE); }
    static boolean custom(Context c) { return c.getSharedPreferences("tvhome", Context.MODE_PRIVATE).getBoolean("vol_ui", true); }
    static boolean canShowCustom(Context c) {
        return custom(c) && (HomeGuardService.instance != null || (MainActivity.instance != null && HomeGuardService.homeInFront));
    }
    static JSONObject snapshot(Context c) {
        JSONObject o = new JSONObject();
        try {
            AudioManager a = audio(c);
            if (a == null) return o.put("ok", false).put("error", "audio");
            int max = a.getStreamMaxVolume(AudioManager.STREAM_MUSIC), cur = VolumeScale.clamp(a.getStreamVolume(AudioManager.STREAM_MUSIC), max);
            boolean muted = a.isStreamMute(AudioManager.STREAM_MUSIC);
            o.put("ok", true).put("vol", cur).put("volMax", max).put("muted", muted).put("volFixed", a.isVolumeFixed());
            o.put("volPercent", VolumeScale.percent(cur, max, muted));
            // Keep the settings bridge's existing field names compatible.
            o.put("cur", cur).put("max", max).put("fixed", a.isVolumeFixed());
        } catch (Exception ignored) { }
        return o;
    }
    static synchronized JSONObject change(Context c, Integer exact, int direction) {
        try {
            AudioManager a = audio(c);
            if (a == null) return new JSONObject().put("ok", false).put("error", "audio");
            if (a.isVolumeFixed()) return snapshot(c).put("ok", false).put("error", "volume-fixed");
            int flags = canShowCustom(c) ? 0 : AudioManager.FLAG_SHOW_UI;
            if (exact != null) {
                int v = VolumeScale.clamp(exact, a.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
                // A positive slider position means audible output, even after explicit mute.
                if (v > 0 && a.isStreamMute(AudioManager.STREAM_MUSIC)) a.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, 0);
                a.setStreamVolume(AudioManager.STREAM_MUSIC, v, flags);
            } else a.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, flags);
            if (canShowCustom(c)) {
                HomeGuardService g = HomeGuardService.instance;
                if (g != null) g.showVolumeNow(); else MainActivity.instance.showVolumeNow();
            }
            return snapshot(c);
        } catch (Exception ignored) {
            try { return new JSONObject().put("ok", false).put("error", "volume"); } catch (Exception impossible) { return new JSONObject(); }
        }
    }
    /** Tracks consumed DOWN/UP pairs; holding mute never toggles it repeatedly. */
    static final class Keys {
        private final java.util.Set<Integer> held = new java.util.HashSet<>();
        boolean handle(Context c, KeyEvent event) {
            int code = event.getKeyCode();
            if (code != KeyEvent.KEYCODE_VOLUME_UP && code != KeyEvent.KEYCODE_VOLUME_DOWN && code != KeyEvent.KEYCODE_VOLUME_MUTE) return false;
            if (event.getAction() == KeyEvent.ACTION_UP) return held.remove(code);
            if (event.getAction() != KeyEvent.ACTION_DOWN) return held.contains(code);
            if (held.contains(code) && code == KeyEvent.KEYCODE_VOLUME_MUTE) return true;
            if (!custom(c) || audio(c) == null || audio(c).isVolumeFixed()) return held.contains(code);
            int dir = code == KeyEvent.KEYCODE_VOLUME_UP ? AudioManager.ADJUST_RAISE : code == KeyEvent.KEYCODE_VOLUME_DOWN ? AudioManager.ADJUST_LOWER : AudioManager.ADJUST_TOGGLE_MUTE;
            if (!change(c, null, dir).optBoolean("ok")) return held.contains(code);
            held.add(code); return true;
        }
        void clear() { held.clear(); }
    }
}
