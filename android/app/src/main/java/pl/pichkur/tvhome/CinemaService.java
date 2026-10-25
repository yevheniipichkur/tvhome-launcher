package pl.pichkur.tvhome;

import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;
import org.json.*;
import java.io.*;
import java.util.*;

/** Short synchronized operations; all upstream I/O runs in CinemaCatalog's background worker. */
final class CinemaService {
    private static CinemaRoom room;
    private static CinemaCatalog provider;
    private static CinemaCatalog.Batch current;
    private static synchronized void init(Context ctx) throws Exception {
        if (room != null) return;
        JSONArray fallback;
        try (InputStream in=ctx.getAssets().open("web/cinema-catalog.json")) { fallback=new JSONArray(CinemaCatalog.read(in,500_000)); }
        CinemaQuery q=CinemaQuery.defaults();
        try { q=parseQuery(new JSONObject(ctx.getSharedPreferences("tvhome",Context.MODE_PRIVATE).getString("cinema_filters","{}"))); } catch(Exception ignored){}
        provider=new CinemaCatalog(new File(ctx.getFilesDir(),"cinema-cache"),BuildConfig.TMDB_KEY,fallback,CinemaCatalog::http,q);
        current=provider.status().batch;
        room=new CinemaRoom(ids(current.items));
        provider.refresh(q,false);
    }
    private static List<String> ids(JSONArray items)throws Exception {
        List<String> result=new ArrayList<>();for(int i=0;i<items.length();i++)result.add(items.getJSONObject(i).getString("id"));return result;
    }
    private static void adopt()throws Exception {
        CinemaCatalog.Batch fresh=provider.status().batch;
        if(fresh.revision==current.revision)return;
        List<String> oldIds=ids(current.items), next=ids(fresh.items);
        if(room.state("",SystemClock.elapsedRealtime()).round==null) {
            room.replaceDeck(next,SystemClock.elapsedRealtime());current=fresh;
        }else if(fresh.query.equals(current.query) && next.size()>=oldIds.size() && next.subList(0,oldIds.size()).equals(oldIds)) {
            room.appendDeck(next);current=fresh;
        } // A changing catalogue can never replace already-voted film identities in an active room.
    }
    static CinemaQuery parseQuery(JSONObject v) {
        CinemaQuery d=CinemaQuery.defaults();return new CinemaQuery(v.optInt("genre",d.genre),v.optInt("fromYear",d.fromYear),v.optInt("toYear",d.toYear),v.optInt("rating",d.rating),v.optString("sort",d.sort));
    }
    private static JSONObject queryJson(CinemaQuery q)throws Exception {
        return new JSONObject().put("genre",q.genre).put("fromYear",q.fromYear).put("toYear",q.toYear).put("rating",q.rating).put("sort",q.sort);
    }
    static synchronized JSONObject request(Context ctx,String action,JSONObject body) {
        try {
            init(ctx);adopt();
            String client=body.optString("client","");long now=SystemClock.elapsedRealtime();
            CinemaRoom.Snapshot s=room.state(client,now);
            switch(action) {
                case "join":
                    if(s.round==null) {
                        if(provider.status().loading)throw new IllegalArgumentException("Завантажуємо спільну добірку. Зачекайте трохи.");
                        // A worker can finish between the initial adoption and this join check.
                        // Bind its ready batch before the first participant freezes the deck.
                        adopt();
                    }
                    if(current.items.length()==0)throw new IllegalArgumentException("Немає фільмів. Змініть фільтри або повторіть завантаження.");
                    room.join(client,body.optString("name"),now);break;
                case "vote":
                    if(!(body.opt("yes") instanceof Boolean))throw new IllegalArgumentException("Невірний голос.");
                    room.vote(client,body.optString("round"),body.optString("id"),body.getBoolean("yes"),now);break;
                case "reset":room.reset();provider.refresh(current.query,true);break;
                case "configure":
                    if(s.round!=null)throw new IllegalArgumentException("Щоб змінити фільтри, почніть новий вечір на телевізорі.");
                    CinemaQuery q=parseQuery(body.getJSONObject("filters"));
                    if(!provider.refresh(q,true))throw new IllegalArgumentException("Попередня добірка ще завантажується.");
                    ctx.getSharedPreferences("tvhome",Context.MODE_PRIVATE).edit().putString("cinema_filters",queryJson(q).toString()).apply();break;
                case "refresh":
                    if(s.round!=null)throw new IllegalArgumentException("Оновлення добірки доступне в новому вечорі.");
                    provider.refresh(current.query,true);break;
                case "more":
                    if(!body.optString("round").equals(s.round==null?"":s.round))throw new IllegalArgumentException("Вечір змінився. Оновіть сторінку.");
                    provider.more();break;
                case "play":
                    String id=body.optString("id");
                    if(!s.matches.contains(id))throw new IllegalArgumentException("Оберіть спільний фільм зі збігів.");
                    if(!Objects.equals(s.round,body.optString("round")))throw new IllegalArgumentException("Вечір змінився.");
                    play(ctx,id);break;
                case "state":
                    if(s.round==null)provider.refresh(current.query,false);break;
                default:throw new IllegalArgumentException("Невідома дія.");
            }
            adopt();s=room.state(client,SystemClock.elapsedRealtime());CinemaCatalog.Status status=provider.status();
            JSONArray genres=new JSONArray();for(int i=0;i<CinemaQuery.GENRES.length;i++)genres.put(new JSONObject().put("id",CinemaQuery.GENRES[i]).put("name",CinemaQuery.NAMES[i]));
            JSONObject meta=new JSONObject().put("source",current.source).put("cached",current.cached).put("updatedAt",current.fetchedAt)
              .put("loading",status.loading).put("error",status.error).put("hasMore",current.hasMore()).put("page",current.page).put("totalPages",current.totalPages)
              .put("updateAvailable",status.batch.revision!=current.revision);
            return new JSONObject().put("ok",true).put("round",s.round==null?JSONObject.NULL:s.round).put("names",new JSONArray(s.names))
              .put("progress",new JSONArray(s.progress)).put("matches",new JSONArray(s.matches)).put("mine",new JSONObject(s.mine))
              .put("joined",s.joined).put("catalog",current.items).put("catalogMeta",meta).put("filters",queryJson(current.query)).put("genres",genres);
        }catch(Exception e) {
            JSONObject out=new JSONObject();try{out.put("ok",false);out.put("error",e.getMessage()==null?"Не вдалося відкрити кіновечір.":e.getMessage());}catch(Exception ignored){}return out;
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
