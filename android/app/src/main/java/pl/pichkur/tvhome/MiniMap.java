package pl.pichkur.tvhome;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * A small map around the home city for the alert notch: district fills by alert level, oblast
 * borders, targets with their heading, the city marker. Geometry comes from the page's own
 * assets/web/ukraine.json (same projection: x = (lon-22)*60*cos48.5°, y = (52.45-lat)*60).
 */
final class MiniMap {
    private static final double COS = Math.cos(Math.toRadians(48.5));
    private static List<Object[]> districts; // {id, oblastId, Path}
    private static List<Path> oblasts;

    static double[] proj(double lon, double lat) { return new double[]{(lon - 22.0) * 60 * COS, (52.45 - lat) * 60}; }

    private static Path parse(String d) {
        Path p = new Path();
        int i = 0, n = d.length();
        boolean move = true;
        while (i < n) {
            char c = d.charAt(i);
            if (c == 'M') { move = true; i++; continue; }
            if (c == 'L') { move = false; i++; continue; }
            if (c == 'Z') { p.close(); i++; continue; }
            int j = i;
            while (j < n && "MLZ".indexOf(d.charAt(j)) < 0) j++;
            String[] xy = d.substring(i, j).split(",");
            float x = Float.parseFloat(xy[0]), y = Float.parseFloat(xy[1]);
            if (move) p.moveTo(x, y); else p.lineTo(x, y);
            move = false;
            i = j;
        }
        return p;
    }

    static synchronized void load(Context ctx) {
        if (districts != null) return;
        districts = new ArrayList<>();
        oblasts = new ArrayList<>();
        try (InputStream in = ctx.getAssets().open("web/ukraine.json")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            for (int k; (k = in.read(buf)) > 0; ) out.write(buf, 0, k);
            JSONObject g = new JSONObject(out.toString("UTF-8"));
            JSONArray ds = g.getJSONArray("districts");
            for (int i = 0; i < ds.length(); i++) {
                JSONObject d = ds.getJSONObject(i);
                districts.add(new Object[]{d.optString("id"), d.optString("oblast"), parse(d.getString("d"))});
            }
            JSONArray os = g.getJSONArray("oblasts");
            for (int i = 0; i < os.length(); i++) {
                JSONObject o = os.getJSONObject(i);
                oblasts.add(parse(o.optString("base", o.getString("d"))));
                districts.add(0, new Object[]{"oblast:" + o.optString("id"), o.optString("id"), parse(o.optString("base", o.getString("d")))});
            }
        } catch (Exception ignored) {
        }
    }

    private final Paint land = new Paint(Paint.ANTI_ALIAS_FLAG), fill = new Paint(Paint.ANTI_ALIAS_FLAG),
            border = new Paint(Paint.ANTI_ALIAS_FLAG), plane = new Paint(Paint.ANTI_ALIAS_FLAG), home = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final JSONObject alerts;
    private final JSONArray threats;
    private final double cityLon, cityLat;

    MiniMap(Context ctx, JSONObject alerts, JSONArray threats, double cityLon, double cityLat) {
        load(ctx);
        this.alerts = alerts; this.threats = threats; this.cityLon = cityLon; this.cityLat = cityLat;
        land.setColor(0xFF1A2232);
        border.setStyle(Paint.Style.STROKE);
        border.setColor(0x66FFFFFF);
        plane.setColor(0xFFFFFFFF);
        home.setColor(0xFFFF453A);
    }

    private static int levelColor(String lv) {
        if ("red".equals(lv)) return 0xFFEF6A57;
        if ("long".equals(lv)) return 0xFF8B2F28;
        if ("alert".equals(lv)) return 0xFFE3B341;
        return 0;
    }

    /** Draw into rect r; the view spans about ±3.2° lon around the city. */
    void draw(Canvas c, RectF r, int alpha) {
        if (districts == null) return;
        double[] cc = proj(cityLon, cityLat);
        float spanX = (float) (6.4 * 60 * COS);
        float k = r.width() / spanX;
        float spanY = r.height() / k;
        Matrix m = new Matrix();
        m.setTranslate((float) -(cc[0] - spanX * 0.5), (float) -(cc[1] - spanY * 0.55));
        m.postScale(k, k);
        m.postTranslate(r.left, r.top);
        c.save();
        c.clipRect(r);
        JSONObject states = alerts != null ? alerts.optJSONObject("states") : null;
        JSONObject dist = alerts != null ? alerts.optJSONObject("districts") : null;
        land.setAlpha(alpha);
        Path t = new Path();
        for (Object[] d : districts) {
            String id = (String) d[0];
            String lv = id.startsWith("oblast:") ? null : dist != null ? dist.optString(id, null) : null;
            if (lv == null && states != null) lv = states.optString((String) d[1], null);
            int col = levelColor(lv);
            ((Path) d[2]).transform(m, t);
            if (id.startsWith("oblast:") && col == 0) { c.drawPath(t, land); continue; }
            if (col == 0) continue;
            fill.setColor(col);
            fill.setAlpha(alpha);
            c.drawPath(t, fill);
        }
        border.setStrokeWidth(Math.max(1f, k * 1.2f));
        border.setAlpha(alpha * 100 / 255);
        for (Path o : oblasts) { o.transform(m, t); c.drawPath(t, border); }
        // targets: small arrowheads along their heading
        plane.setAlpha(alpha);
        float s = Math.max(5f, k * 7f);
        for (int i = 0; threats != null && i < threats.length(); i++) {
            JSONObject th = threats.optJSONObject(i);
            if (th == null || th.optBoolean("stale")) continue;
            double[] p = proj(th.optDouble("lon"), th.optDouble("lat"));
            float[] pt = {(float) p[0], (float) p[1]};
            m.mapPoints(pt);
            if (!r.contains(pt[0], pt[1])) continue;
            double hd = Math.toRadians(th.optDouble("heading", 0));
            Path a = new Path();
            a.moveTo(pt[0] + (float) (Math.sin(hd) * s), pt[1] - (float) (Math.cos(hd) * s));
            a.lineTo(pt[0] + (float) (Math.sin(hd + 2.5) * s * 0.75), pt[1] - (float) (Math.cos(hd + 2.5) * s * 0.75));
            a.lineTo(pt[0] + (float) (Math.sin(hd - 2.5) * s * 0.75), pt[1] - (float) (Math.cos(hd - 2.5) * s * 0.75));
            a.close();
            plane.setColor("missile".equals(th.optString("kind")) ? 0xFFFF6B5E : 0xFFFFFFFF);
            plane.setAlpha(alpha);
            c.drawPath(a, plane);
        }
        // home
        float[] hp = {(float) cc[0], (float) cc[1]};
        m.mapPoints(hp);
        home.setAlpha(alpha);
        home.setStyle(Paint.Style.FILL);
        c.drawCircle(hp[0], hp[1], Math.max(3f, k * 3f), home);
        home.setStyle(Paint.Style.STROKE);
        home.setStrokeWidth(2f);
        c.drawCircle(hp[0], hp[1], Math.max(7f, k * 7f), home);
        c.restore();
    }
}
