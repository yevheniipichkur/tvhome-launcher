package pl.pichkur.tvhome;
import org.json.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

public class CinemaCatalogTest {
    static int checks;
    static void check(boolean value,String name){checks++;if(!value)throw new AssertionError(name);}
    static void rejects(Runnable action){try{action.run();throw new AssertionError("must reject");}catch(IllegalArgumentException expected){checks++;}}
    static JSONArray fallback()throws Exception{return new JSONArray().put(new JSONObject().put("id","1").put("title","Offline film"));}
    static JSONObject movie(int id)throws Exception{return new JSONObject().put("id",id).put("title","Тест "+id).put("original_title","Test "+id).put("release_date","2024-02-01").put("overview","Опис тестового фільму").put("genre_ids",new JSONArray().put(28)).put("poster_path","/poster.jpg").put("vote_average",8.2).put("vote_count",500);}
    static JSONObject page(int page,int...ids)throws Exception{JSONArray r=new JSONArray();for(int id:ids)r.put(movie(id));return new JSONObject().put("page",page).put("total_pages",5).put("results",r);}
    public static void main(String[] args)throws Exception{
        Path dir=Files.createTempDirectory("tvhome-catalog-test-");CinemaQuery q=CinemaQuery.defaults();
        try{
            rejects(()->new CinemaQuery(999,1900,q.toYear,0,"popularity.desc"));
            rejects(()->new CinemaQuery(0,2020,2010,0,"popularity.desc"));
            rejects(()->new CinemaQuery(0,1900,q.toYear,10,"popularity.desc"));
            rejects(()->new CinemaQuery(0,1900,q.toYear,0,"https://bad"));
            AtomicInteger calls=new AtomicInteger();List<String> addresses=new ArrayList<>();CountDownLatch gate=new CountDownLatch(1);
            CinemaCatalog.Fetcher fetch=url->{addresses.add(url);int call=calls.incrementAndGet();if(call==1){gate.await(2,TimeUnit.SECONDS);JSONObject response=page(1,100,100,101);response.getJSONArray("results").put(movie(999).put("adult",true)).put(movie(0));return response;}return page(url.contains("&page=3")?3:2,101,102);};
            try(CinemaCatalog c=new CinemaCatalog(dir.toFile(),"secret-test-key",fallback(),fetch,q)){
                check(c.status().batch.source.equals("offline"),"honest offline source");
                check(c.refresh(q,false),"start update");check(c.status().loading,"background loading state");
                check(!c.refresh(q,true),"coalesce concurrent refresh");gate.countDown();c.awaitIdle();
                CinemaCatalog.Batch first=c.status().batch;
                check(first.items.length()==2,"dedupe + reject adult/invalid ids");check(first.source.equals("tmdb")&&!first.cached,"online provenance");
                check(first.items.getJSONObject(0).getString("id").equals("100"),"stable TMDB id");
                check(first.items.getJSONObject(0).isNull("minutes"),"unknown runtime stays unknown");
                check(first.items.getJSONObject(0).getDouble("rating")==8.2,"real rating");
                check(first.items.getJSONObject(0).getString("genre").equals("Бойовик"),"genre names");
                check(addresses.get(0).contains("language=uk-UA")&&addresses.get(0).contains("include_adult=false")&&addresses.get(0).contains("primary_release_date.lte="),"upstream query");
                check(!c.refresh(q,false)&&calls.get()==1,"TTL prevents polling requests");
                CinemaRoom room=new CinemaRoom(Arrays.asList("100","101"));String a="aaaaaaaaaaaaaaaaaaaa",b="bbbbbbbbbbbbbbbbbbbb";
                String round=room.join(a,"A",0).round;room.join(b,"B",0);room.vote(a,round,"100",true,1);room.vote(b,round,"100",true,1);
                check(c.more(),"load next page");c.awaitIdle();CinemaCatalog.Batch second=c.status().batch;
                check(second.items.length()==3 && second.page==2,"page merge dedupes");
                room.appendDeck(Arrays.asList("100","101","102"));check(room.state(a,2).matches.equals(Arrays.asList("100")),"append preserves match");
                check(room.state(a,2).mine.size()==1,"append preserves private votes");rejects(()->room.replaceDeck(Arrays.asList("other"),3));
                room.reset();room.replaceDeck(Arrays.asList("200"),4);check(room.join(a,"A",4).mine.isEmpty(),"new deck after reset");
                check(c.more(),"next duplicate page");c.awaitIdle();check(!c.status().batch.hasMore(),"duplicate page stops pagination");
            }
            try(CinemaCatalog cached=new CinemaCatalog(dir.toFile(),"secret-test-key",fallback(),url->{throw new CinemaCatalog.UpstreamException(401);},q)){
                check(cached.status().batch.cached&&cached.status().batch.source.equals("tmdb"),"disk cache restored");
                check(cached.status().batch.items.length()==3,"all paginated cached entries restored");
                check(cached.refresh(q,true),"forced retry");cached.awaitIdle();
                check(cached.status().batch.items.length()==3,"401 retains saved items");
                check(!cached.status().error.contains("secret-test-key")&&cached.status().error.contains("ключ"),"safe authentication error");
                check(!cached.refresh(q,false),"backoff after failure");
                CinemaQuery changed=new CinemaQuery(35,2010,2019,7,"vote_average.desc");
                cached.refresh(changed,true);cached.awaitIdle();
                check(cached.status().batch.query.equals(changed)&&cached.status().batch.items.length()==0,"different filters never show previous list as matching");
            }
            try(CinemaCatalog malformed=new CinemaCatalog(dir.toFile(),"secret-test-key",fallback(),url->new JSONObject().put("wrong",true),q)){
                malformed.refresh(q,true);malformed.awaitIdle();check(malformed.status().batch.items.length()==3&&!malformed.status().error.isEmpty(),"schema failure preserves cache");
            }
            AtomicInteger translations=new AtomicInteger();
            try(CinemaCatalog c=new CinemaCatalog(new File(dir.toFile(),"translations"),"secret-test-key",fallback(),url->{JSONObject data=page(1,700);JSONObject f=data.getJSONArray("results").getJSONObject(0);if(url.contains("language=uk-UA")){f.put("overview","").put("poster_path",JSONObject.NULL);}else{translations.incrementAndGet();f.put("overview","An English description").put("poster_path","/english.jpg");data.getJSONArray("results").put(movie(701).put("overview","Wrong film"));}return data;},q)){
                c.refresh(q,true);c.awaitIdle();JSONObject film=c.status().batch.items.getJSONObject(0);
                check(translations.get()==1,"one bounded English request for missing metadata");
                check(film.getString("description").equals("An English description"),"description fallback matches same TMDB id");
                check(film.getString("poster").equals("/english.jpg"),"poster fallback matches same TMDB id");
                check(c.status().batch.items.length()==1,"English fallback never injects unrelated films");
            }
            CinemaQuery filtered=new CinemaQuery(28,2000,2010,8,"vote_average.desc");
            try(CinemaCatalog c=new CinemaCatalog(new File(dir.toFile(),"filtered"),"secret-test-key",fallback(),url->page(1,400),filtered)){
                String url=c.url(filtered,2);check(url.contains("with_genres=28")&&url.contains("vote_average.gte=8")&&url.contains("primary_release_date.gte=2000-01-01")&&url.contains("primary_release_date.lte=2010-12-31")&&url.contains("page=2"),"filters encoded correctly");
            }
            try(CinemaCatalog c=new CinemaCatalog(new File(dir.toFile(),"bounds"),"secret-test-key",fallback(),url->{JSONObject p=page(1);JSONArray many=p.getJSONArray("results");for(int i=1;i<=250;i++)many.put(movie(i));return p;},q)){
                c.refresh(q,true);c.awaitIdle();check(c.status().batch.items.length()==200&&!c.status().batch.hasMore(),"bounded memory and pagination");
            }
            for(File f:dir.toFile().listFiles())if(f.isFile())check(!new String(Files.readAllBytes(f.toPath()),"UTF-8").contains("secret-test-key"),"cache does not contain API key");
            if(args.length>0){JSONObject live=new JSONObject(new String(Files.readAllBytes(Paths.get(args[0])),"UTF-8"));try(CinemaCatalog c=new CinemaCatalog(new File(dir.toFile(),"live"),"secret-test-key",fallback(),url->live,q)){c.refresh(q,true);c.awaitIdle();check(c.status().batch.source.equals("tmdb")&&c.status().batch.items.length()>0,"parse actual successful TMDB response");}}
            System.out.println("CinemaCatalog: "+checks+" checks passed");
        }finally{try(java.util.stream.Stream<Path> files=Files.walk(dir)){files.sorted(Comparator.reverseOrder()).forEach(p->{try{Files.delete(p);}catch(IOException ignored){}});}}
    }
}
