package pl.pichkur.tvhome;

import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import org.json.*;
import java.io.InputStream;
import java.util.*;

/** Shared by the TV bridge and PIN-authenticated phone HTTP routes. */
final class CinemaService {
    private static CinemaRoom room;
    private static JSONArray catalog;
    private static synchronized void init(Context ctx) throws Exception {
        if (room != null) return;
        String text;
        try (InputStream in = ctx.getAssets().open("web/cinema-catalog.json")) {
            java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            for (int n; (n = in.read(buf)) != -1;) out.write(buf, 0, n);
            text = out.toString("UTF-8");
        }
        JSONArray parsed = new JSONArray(text);
        List<String> ids = new ArrayList<>();
        for (int i = 0; i < parsed.length(); i++) ids.add(parsed.getJSONObject(i).getString("id"));
        catalog = parsed; room = new CinemaRoom(ids);
    }
    static JSONObject request(Context ctx, String action, JSONObject body) {
        try {
            init(ctx);
            String client = body.optString("client", "");
            CinemaRoom.Snapshot s;
            switch (action) {
                case "join": s = room.join(client, body.optString("name"), SystemClock.elapsedRealtime()); break;
                case "vote":
                    if (!(body.opt("yes") instanceof Boolean)) throw new IllegalArgumentException("Невірний голос.");
                    s = room.vote(client, body.optString("round"), body.optString("id"), body.getBoolean("yes"), SystemClock.elapsedRealtime()); break;
                case "reset": room.reset(); s = room.state(client, SystemClock.elapsedRealtime()); break;
                case "play":
                    s = room.state(client, SystemClock.elapsedRealtime());
                    String id = body.optString("id");
                    if (!s.matches.contains(id)) throw new IllegalArgumentException("Оберіть спільний фільм зі збігів.");
                    if (!Objects.equals(s.round, body.optString("round"))) throw new IllegalArgumentException("Вечір змінився.");
                    play(ctx, id); break;
                case "state": s = room.state(client, SystemClock.elapsedRealtime()); break;
                default: throw new IllegalArgumentException("Невідома дія.");
            }
            JSONObject out = new JSONObject(); out.put("ok", true);
            out.put("round", s.round == null ? JSONObject.NULL : s.round);
            out.put("names", new JSONArray(s.names)); out.put("progress", new JSONArray(s.progress));
            out.put("matches", new JSONArray(s.matches)); out.put("mine", new JSONObject(s.mine));
            out.put("joined", s.joined); out.put("catalog", catalog);
            return out;
        } catch (Exception e) {
            JSONObject out = new JSONObject();
            try { out.put("ok", false); out.put("error", e.getMessage() == null ? "Не вдалося відкрити кіновечір." : e.getMessage()); } catch (Exception ignored) { }
            return out;
        }
    }
    private static void play(Context ctx, String id) throws Exception {
        // Lampa's public Android intent contract: media + id + source opens a full TMDB card.
        // No playback or source selection is forced; those remain in the user's Lampa setup.
        for (String pkg : new String[]{"top.rootu.lamps", "top.rootu.lampa"}) {
            Intent i = ctx.getPackageManager().getLeanbackLaunchIntentForPackage(pkg);
            if (i == null) i = ctx.getPackageManager().getLaunchIntentForPackage(pkg);
            if (i == null) continue;
            i.setAction(Intent.ACTION_VIEW);
            i.putExtra("id", id); i.putExtra("media", "movie"); i.putExtra("source", "tmdb");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            ctx.startActivity(i); return;
        }
        throw new IllegalArgumentException("Lampa не встановлена. Встановіть її, щоб відкрити фільм.");
    }
}
