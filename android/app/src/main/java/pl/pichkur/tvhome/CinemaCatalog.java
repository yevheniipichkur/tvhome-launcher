package pl.pichkur.tvhome;

import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.*;

/** Background TMDB discover with a bounded disk cache. Entirely independent of Android UI threads. */
final class CinemaCatalog implements AutoCloseable {
    static final long TTL=6*60*60*1000L, RETRY=60_000;
    static final int MAX_ITEMS=200;
    interface Fetcher { JSONObject get(String url) throws Exception; }
    static final class Batch {
        final CinemaQuery query; final JSONArray items;
        final int page,totalPages; final long fetchedAt,revision;
        final boolean cached; final String source;
        Batch(CinemaQuery q,JSONArray items,int page,int pages,long at,long rev,boolean cached,String source) {
            this.query=q; this.items=items; this.page=page; totalPages=pages; fetchedAt=at; revision=rev; this.cached=cached; this.source=source;
        }
        boolean hasMore() { return "tmdb".equals(source) && page<totalPages && items.length()<MAX_ITEMS; }
    }
    static final class Status {
        final Batch batch; final boolean loading; final String error;
        Status(Batch b, boolean l, String e) { batch=b;loading=l;error=e; }
    }
    private final File dir; private final String apiKey; private final Fetcher fetcher; private final JSONArray fallback;
    private final ExecutorService worker=Executors.newSingleThreadExecutor(r->{Thread t=new Thread(r,"cinema-catalog");t.setDaemon(true);return t;});
    private Batch batch; private boolean loading; private String error=""; private long attempt,revision;
    CinemaCatalog(File dir,String apiKey,JSONArray fallback,Fetcher fetcher,CinemaQuery query) {
        this.dir=dir;this.apiKey=apiKey;this.fallback=fallback;this.fetcher=fetcher;
        batch=seed(query); // Initial data is immediately available; fetches never block the JS bridge.
    }
    synchronized Status status() { return new Status(batch,loading,error); }
    synchronized boolean refresh(CinemaQuery q,boolean force) {
        long now=System.currentTimeMillis();
        if (loading) return false;
        if (!force && q.equals(batch.query) && (now-batch.fetchedAt<TTL || now-attempt<RETRY)) return false;
        if (!q.equals(batch.query)) batch=seed(q);
        return begin(q,1,false);
    }
    synchronized boolean more() {
        if(loading || !batch.hasMore())return false;
        return begin(batch.query,batch.page+1,true);
    }
    private boolean begin(CinemaQuery q,int page,boolean append) {
        loading=true;error="";attempt=System.currentTimeMillis();Batch before=batch;
        worker.execute(()->{
            try {
                if(apiKey.isEmpty())throw new IOException("Немає налаштованого ключа TMDB.");
                JSONObject response=fetcher.get(url(q,page));
                JSONArray raw=response.optJSONArray("results");
                if(raw==null)throw new IOException("TMDB повернув нерозпізнану відповідь.");
                if(response.optInt("page",-1)!=page)throw new IOException("TMDB повернув іншу сторінку.");
                JSONArray items=new JSONArray();Set<String> ids=new HashSet<>();
                if(append)for(int i=0;i<before.items.length();i++){JSONObject f=before.items.getJSONObject(i);items.put(f);ids.add(f.getString("id"));}
                for(int i=0;i<raw.length() && items.length()<MAX_ITEMS;i++) {
                    JSONObject f=normalize(raw.optJSONObject(i));
                    if(f!=null && ids.add(f.getString("id")))items.put(f);
                }
                int pages=Math.max(page,Math.min(500,response.optInt("total_pages",page)));
                // Empty/duplicate pages end traversal instead of offering a stuck load-more button.
                if(append && items.length()==before.items.length())pages=page;
                Batch fresh;
                synchronized(this){fresh=new Batch(q,items,page,pages,System.currentTimeMillis(),++revision,false,"tmdb");batch=fresh;}
                save(fresh);
            } catch(Exception e) {
                synchronized(this){error=safeError(e);}
            } finally { synchronized(this){loading=false;} }
        });
        return true;
    }
    String url(CinemaQuery q,int page) throws Exception {
        SimpleDateFormat format=new SimpleDateFormat("yyyy-MM-dd",Locale.US);format.setTimeZone(TimeZone.getTimeZone("UTC"));
        String today=format.format(new Date());
        return "https://api.themoviedb.org/3/discover/movie?api_key="+URLEncoder.encode(apiKey,"UTF-8")+
          "&language=uk-UA&include_adult=false&include_video=false&vote_count.gte=100&page="+page+
          "&sort_by="+q.sort+"&vote_average.gte="+q.rating+"&primary_release_date.gte="+q.fromYear+"-01-01"+
          "&primary_release_date.lte="+(q.toYear==CinemaQuery.defaults().toYear?today:q.toYear+"-12-31")+
          (q.genre==0?"":"&with_genres="+q.genre);
    }
    private JSONObject normalize(JSONObject raw) throws Exception {
        if(raw==null || raw.optLong("id",0)<=0 || raw.optBoolean("adult",false) || raw.optBoolean("video",false))return null;
        String title=text(raw,"title",text(raw,"original_title","",240),240);if(title.isEmpty())return null;
        String date=text(raw,"release_date","",10);int year=0;try{year=Integer.parseInt(date.substring(0,4));}catch(Exception ignored){}
        JSONArray genres=raw.optJSONArray("genre_ids");List<String> names=new ArrayList<>();
        if(genres!=null)for(int i=0;i<Math.min(2,genres.length());i++)names.add(CinemaQuery.genreName(genres.optInt(i)));
        String poster=raw.isNull("poster_path")?"":raw.optString("poster_path","");
        if(!poster.matches("/[A-Za-z0-9_-]+\\.(jpg|png|webp)"))poster="";
        double rating=raw.optDouble("vote_average",0);if(!Double.isFinite(rating))rating=0;
        return new JSONObject().put("id",String.valueOf(raw.getLong("id"))).put("title",title)
          .put("original",text(raw,"original_title",title,240)).put("year",year).put("minutes",JSONObject.NULL)
          .put("genre",names.isEmpty()?"Кіно":join(names)).put("genreIds",genres==null?new JSONArray():genres)
          .put("description",text(raw,"overview","",1200)).put("poster",poster)
          .put("rating",Math.max(0,Math.min(10,rating))).put("votes",Math.max(0,raw.optInt("vote_count",0)));
    }
    private static String text(JSONObject v,String key,String fallback,int max) { String s=v.isNull(key)?fallback:v.optString(key,fallback).trim();return s.substring(0,Math.min(max,s.length())); }
    private static String join(List<String> values) { StringBuilder b=new StringBuilder(); for(String v:values){if(b.length()>0)b.append(" · ");b.append(v);}return b.toString(); }
    private Batch seed(CinemaQuery q) {
        try {
            File file=file(q);if(!file.exists() || file.length()>2*1024*1024)throw new IOException();
            JSONObject data=new JSONObject(read(new FileInputStream(file),2*1024*1024));
            JSONArray items=data.getJSONArray("items");if(items.length()>MAX_ITEMS)throw new IOException();
            Set<String> ids=new HashSet<>();for(int i=0;i<items.length();i++){String id=items.getJSONObject(i).getString("id");if(!id.matches("[1-9][0-9]*")||!ids.add(id))throw new IOException();}
            return new Batch(q,items,data.getInt("page"),data.getInt("totalPages"),data.getLong("fetchedAt"),++revision,true,"tmdb");
        }catch(Exception ignored){}
        // Never relabel the bundled 24-film fallback as a fresh or filtered online catalogue.
        return new Batch(q,q.equals(CinemaQuery.defaults())?fallback:new JSONArray(),0,0,0,++revision,true,"offline");
    }
    private File file(CinemaQuery q){return new File(dir,"catalog-"+q.key()+".json");}
    private void save(Batch b) {
        try {
            dir.mkdirs();File tmp=new File(dir,"catalog.tmp");
            JSONObject data=new JSONObject().put("items",b.items).put("page",b.page).put("totalPages",b.totalPages).put("fetchedAt",b.fetchedAt);
            try(OutputStream out=new FileOutputStream(tmp)){out.write(data.toString().getBytes(StandardCharsets.UTF_8));}
            if(!tmp.renameTo(file(b.query)))tmp.delete();
            File[] files=dir.listFiles((d,n)->n.startsWith("catalog-") && n.endsWith(".json"));
            if(files!=null && files.length>20){Arrays.sort(files,Comparator.comparingLong(File::lastModified));for(int i=0;i<files.length-20;i++)files[i].delete();}
        }catch(Exception ignored){} // Disk-full must not discard a successful in-memory fetch.
    }
    private String safeError(Exception e) {
        if(e instanceof UpstreamException){int code=((UpstreamException)e).code;return code==401||code==403?"TMDB відхилив ключ доступу.":code==429?"TMDB просить зачекати. Спробуйте пізніше.":"TMDB тимчасово недоступний. Спробуйте ще раз.";}
        return "Не вдалося оновити TMDB. Перевірте інтернет і повторіть спробу.";
    }
    static final class UpstreamException extends IOException {final int code;UpstreamException(int c){super("TMDB HTTP "+c);code=c;}}
    static JSONObject http(String address)throws Exception {
        HttpURLConnection c=(HttpURLConnection)new URL(address).openConnection();
        c.setConnectTimeout(8000);c.setReadTimeout(8000);c.setInstanceFollowRedirects(false);
        c.setRequestProperty("Accept","application/json");c.setRequestProperty("User-Agent","Vitalnia/1.0");
        try {int status=c.getResponseCode();if(status!=200)throw new UpstreamException(status);return new JSONObject(read(c.getInputStream(),2*1024*1024));}
        finally{c.disconnect();}
    }
    static String read(InputStream input,int max)throws Exception {
        try(InputStream in=input;ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] buf=new byte[8192];int size=0;for(int n;(n=in.read(buf))!=-1;){size+=n;if(size>max)throw new IOException("response too large");out.write(buf,0,n);}return out.toString("UTF-8");
        }
    }
    void awaitIdle()throws Exception{worker.submit(()->{}).get(25,TimeUnit.SECONDS);}
    @Override public void close(){worker.shutdownNow();}
}
