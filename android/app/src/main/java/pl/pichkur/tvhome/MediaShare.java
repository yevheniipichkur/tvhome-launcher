package pl.pichkur.tvhome;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Photos, videos and music sent from the phone remote. Files are kept in the app's cache
 * ("share/"), shown by the launcher page (slideshow) or played here (music: a small queue on
 * MediaPlayer that keeps going while other apps are in front).
 */
final class MediaShare {
    private static final long MAX_TOTAL = 1500L * 1024 * 1024;
    private static final List<JSONObject> items = new ArrayList<>(); // photos & videos of the current show
    private static final List<File> tracks = new ArrayList<>();
    private static MediaPlayer player;
    private static int track = -1;
    private static boolean paused;

    static File dir(Context c) {
        File base = c.getExternalCacheDir() != null ? c.getExternalCacheDir() : c.getCacheDir();
        File d = new File(base, "share");
        if (!d.exists()) d.mkdirs();
        return d;
    }

    static String kind(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        if (n.matches(".*\\.(jpe?g|png|webp|gif|heic|heif|bmp)$")) return "image";
        if (n.matches(".*\\.(mp4|m4v|mov|webm|mkv|3gp|avi)$")) return "video";
        if (n.matches(".*\\.(mp3|m4a|aac|flac|ogg|opus|wav|wma)$")) return "audio";
        return null;
    }

    static String mime(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        if (n.endsWith(".png")) return "image/png";
        if (n.endsWith(".webp")) return "image/webp";
        if (n.endsWith(".gif")) return "image/gif";
        if (n.matches(".*\\.(heic|heif)$")) return "image/heif";
        if (n.matches(".*\\.jpe?g$")) return "image/jpeg";
        if (n.endsWith(".webm")) return "video/webm";
        if (n.endsWith(".mov")) return "video/quicktime";
        if (n.endsWith(".mkv")) return "video/x-matroska";
        if (n.matches(".*\\.(mp4|m4v|3gp)$")) return "video/mp4";
        return "application/octet-stream";
    }

    /** Stores one upload. {@code reset}: the first file of a new batch clears the previous one of that kind. */
    static synchronized JSONObject save(Context c, InputStream in, long total, String name, boolean reset) throws Exception {
        String k = kind(name == null ? "" : name);
        if (k == null) throw new Exception("цей тип файлу не підтримується");
        if (total <= 0 || total > MAX_TOTAL) throw new Exception("завеликий файл");
        File d = dir(c);
        if (reset) {
            if (k.equals("audio")) { stopMusic(); for (File f : tracks) f.delete(); tracks.clear(); }
            else { for (JSONObject o : items) new File(d, o.optString("file")).delete(); items.clear(); }
        }
        long used = 0;
        File[] all = d.listFiles();
        if (all != null) for (File f : all) used += f.length();
        if (used + total > MAX_TOTAL) throw new Exception("на приставці замало місця");
        String safe = System.currentTimeMillis() + "-" + name.replaceAll("[^A-Za-z0-9._-]", "_");
        File f = new File(d, safe);
        try (FileOutputStream o = new FileOutputStream(f)) {
            byte[] buf = new byte[65536];
            long left = total;
            while (left > 0) {
                int r = in.read(buf, 0, (int) Math.min(buf.length, left));
                if (r < 0) break;
                o.write(buf, 0, r);
                left -= r;
            }
            if (left > 0) { f.delete(); throw new Exception("файл не дійшов повністю"); }
        }
        if (k.equals("image")) { File small = downscale(f); if (small != null) { f = small; safe = small.getName(); } }
        JSONObject o = new JSONObject();
        o.put("file", safe);
        o.put("name", name);
        o.put("kind", k);
        if (k.equals("audio")) tracks.add(f); else items.add(o);
        return o;
    }

    /** Phone photos (12+ MP, often HEIC) are too heavy for the box: a 2560 px JPEG, upright by EXIF. */
    private static File downscale(File f) {
        try {
            android.graphics.BitmapFactory.Options b = new android.graphics.BitmapFactory.Options();
            b.inJustDecodeBounds = true;
            android.graphics.BitmapFactory.decodeFile(f.getAbsolutePath(), b);
            if (b.outWidth <= 0) return null;
            int sample = 1;
            while (Math.max(b.outWidth, b.outHeight) / (sample * 2) >= 2560) sample *= 2;
            if (sample == 1 && f.getName().toLowerCase(Locale.ROOT).matches(".*\\.(jpe?g|png|webp|gif)$")) return null; // already small enough
            android.graphics.BitmapFactory.Options o = new android.graphics.BitmapFactory.Options();
            o.inSampleSize = sample;
            android.graphics.Bitmap bm = android.graphics.BitmapFactory.decodeFile(f.getAbsolutePath(), o);
            if (bm == null) return null;
            int rot = 0;
            try {
                int or = new android.media.ExifInterface(f.getAbsolutePath()).getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, 1);
                rot = or == 6 ? 90 : or == 3 ? 180 : or == 8 ? 270 : 0;
            } catch (Exception ignored) { }
            if (rot != 0) {
                android.graphics.Matrix m = new android.graphics.Matrix();
                m.postRotate(rot);
                android.graphics.Bitmap r = android.graphics.Bitmap.createBitmap(bm, 0, 0, bm.getWidth(), bm.getHeight(), m, true);
                if (r != bm) bm.recycle();
                bm = r;
            }
            File out = new File(f.getParentFile(), f.getName().replaceFirst("\\.[A-Za-z0-9]+$", "") + "-tv.jpg");
            try (FileOutputStream os = new FileOutputStream(out)) { bm.compress(android.graphics.Bitmap.CompressFormat.JPEG, 88, os); }
            bm.recycle();
            f.delete();
            return out;
        } catch (Throwable t) {
            return null;
        }
    }

    static synchronized JSONArray showList() { return new JSONArray(items); }

    static File file(Context c, String safe) {
        if (safe == null || safe.contains("/") || safe.contains("..")) return null;
        File f = new File(dir(c), safe);
        return f.exists() ? f : null;
    }

    // ---------- music ----------
    static synchronized void playMusic(Context c, int from) {
        if (tracks.isEmpty()) return;
        track = Math.max(0, Math.min(from, tracks.size() - 1));
        startTrack(c);
    }

    private static void startTrack(Context c) {
        releasePlayer();
        try {
            AudioManager am = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
            AudioAttributes aa = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build();
            // ask other players (YouTube…) to pause while the phone's music plays
            if (am != null && Build.VERSION.SDK_INT >= 26) am.requestAudioFocus(new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(aa).build());
            player = new MediaPlayer();
            player.setAudioAttributes(aa);
            player.setDataSource(tracks.get(track).getAbsolutePath());
            player.setOnCompletionListener(mp -> { synchronized (MediaShare.class) { if (track + 1 < tracks.size()) { track++; startTrack(c); } else { releasePlayer(); track = -1; } } });
            player.prepare();
            player.start();
            paused = false;
            RemoteServer.announceNow("Грає з телефону", title(tracks.get(track)));
        } catch (Exception e) {
            releasePlayer();
        }
    }

    static synchronized void musicCtl(Context c, String a) {
        if (player == null && !a.equals("play")) return;
        switch (a) {
            case "play": if (player == null) playMusic(c, 0); else { player.start(); paused = false; } break;
            case "pause": if (player.isPlaying()) { player.pause(); paused = true; } else { player.start(); paused = false; } break;
            case "next": if (track + 1 < tracks.size()) { track++; startTrack(c); } break;
            case "prev": if (player.getCurrentPosition() > 4000 || track == 0) player.seekTo(0); else { track--; startTrack(c); } break;
            case "stop": stopMusic(); break;
        }
    }

    static synchronized void stopMusic() { releasePlayer(); track = -1; }

    private static void releasePlayer() {
        if (player != null) { try { player.release(); } catch (Exception ignored) { } player = null; }
    }

    private static String title(File f) { return f.getName().replaceFirst("^\\d+-", "").replaceFirst("\\.[A-Za-z0-9]+$", "").replace('_', ' '); }

    static synchronized JSONObject musicState() throws Exception {
        JSONObject o = new JSONObject();
        o.put("tracks", tracks.size());
        if (player == null || track < 0) { o.put("on", false); return o; }
        o.put("on", true);
        o.put("title", title(tracks.get(track)));
        o.put("index", track + 1);
        o.put("playing", !paused && player.isPlaying());
        try { o.put("pos", player.getCurrentPosition()); o.put("dur", player.getDuration()); } catch (Exception ignored) { }
        return o;
    }
}
