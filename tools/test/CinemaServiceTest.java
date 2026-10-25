package pl.pichkur.tvhome;
import org.json.*;
import java.io.*;
import java.lang.reflect.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** Real service + provider with deterministic fetch/clock interleaving, no Android UI needed. */
public class CinemaServiceTest {
    static int checks;
    static void check(boolean b,String message){checks++;if(!b)throw new AssertionError(message);}
    static void field(String name,Object value)throws Exception{Field f=CinemaService.class.getDeclaredField(name);f.setAccessible(true);f.set(null,value);}
    public static void main(String[] args)throws Exception {
        Path dir=Files.createTempDirectory("tvhome-service-test-");CountDownLatch release=new CountDownLatch(1);AtomicInteger calls=new AtomicInteger();
        JSONArray offline=new JSONArray().put(new JSONObject().put("id","1").put("title","Offline"));
        try(CinemaCatalog c=new CinemaCatalog(dir.toFile(),"test",offline,url->{int call=calls.incrementAndGet();if(call==1)release.await(2,TimeUnit.SECONDS);int page=url.contains("&page=2")?2:1;return new JSONObject().put("page",page).put("total_pages",2).put("results",new JSONArray().put(new JSONObject().put("id",page==1?100:101).put("title","Live").put("vote_average",8).put("vote_count",100).put("genre_ids",new JSONArray().put(28))));},CinemaQuery.defaults())){
            field("provider",c);field("current",c.status().batch);field("room",new CinemaRoom(Arrays.asList("1")));c.refresh(CinemaQuery.defaults(),true);
            // Finish the fetch after initial adopt(), immediately before the first join's loading check.
            android.os.SystemClock.beforeRead=()->{release.countDown();try{c.awaitIdle();}catch(Exception e){throw new RuntimeException(e);}};
            String a="aaaaaaaaaaaaaaaaaaaa",b="bbbbbbbbbbbbbbbbbbbb";
            JSONObject s=CinemaService.request(null,"join",new JSONObject().put("client",a).put("name","A"));
            check(s.getBoolean("ok")&&s.getBoolean("joined"),"first viewer joined");
            check(s.getJSONArray("catalog").getJSONObject(0).getString("id").equals("100"),"completed online batch bound before first ballot");
            check(s.getJSONObject("catalogMeta").getString("source").equals("tmdb"),"no offline catalogue frozen by race");
            String round=s.getString("round");CinemaService.request(null,"join",new JSONObject().put("client",b).put("name","B"));
            for(String client:Arrays.asList(a,b))s=CinemaService.request(null,"vote",new JSONObject().put("client",client).put("round",round).put("id","100").put("yes",true));
            check(s.getJSONArray("matches").getString(0).equals("100"),"live film matched");
            JSONObject forbidden=CinemaService.request(null,"configure",new JSONObject().put("filters",new JSONObject().put("genre",35)));
            check(!forbidden.getBoolean("ok"),"active filters rejected");
            CinemaService.request(null,"more",new JSONObject().put("round",round));c.awaitIdle();s=CinemaService.request(null,"state",new JSONObject().put("client",a));
            check(s.getJSONArray("catalog").length()==2,"new page adopted by active service");
            check(s.getJSONArray("matches").getString(0).equals("100")&&s.getJSONObject("mine").getBoolean("100"),"append preserves match and private ballot");
            JSONObject publicState=CinemaService.request(null,"state",new JSONObject());
            check(publicState.getJSONObject("mine").length()==0,"public snapshot excludes votes");
            check(!publicState.toString().contains("api_key"),"snapshot excludes credentials");
            System.out.println("CinemaService: "+checks+" checks passed");
        }finally{field("room",null);field("provider",null);field("current",null);try(java.util.stream.Stream<Path> files=Files.walk(dir)){files.sorted(Comparator.reverseOrder()).forEach(p->{try{Files.delete(p);}catch(IOException ignored){}});}}
    }
}
