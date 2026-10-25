package pl.pichkur.tvhome;
import android.content.Context;
import android.media.AudioManager;
import android.view.KeyEvent;
public class MediaVolumeTest {
 private static int checks;
 private static void check(boolean b,String message){checks++;if(!b)throw new AssertionError(message);}
 public static void main(String[]args)throws Exception{
  Context c=new Context();MediaVolume.Keys keys=new MediaVolume.Keys();
  MainActivity.instance=new MainActivity();HomeGuardService.homeInFront=true;
  check(!keys.handle(c,new KeyEvent(1,24)),"unhandled key-up passes through");
  check(keys.handle(c,new KeyEvent(0,24)),"consume down");check(c.audio.current==9&&c.audio.flags==0,"one media step, no system UI");
  check(keys.handle(c,new KeyEvent(1,24)),"consume matching up");check(c.audio.changes==1,"up never applies another change");
  keys.handle(c,new KeyEvent(0,164));keys.handle(c,new KeyEvent(0,164));keys.handle(c,new KeyEvent(0,164));
  check(c.audio.muted,"hold mute toggles only once");check(keys.handle(c,new KeyEvent(1,164)),"mute up consumed");
  keys.handle(c,new KeyEvent(0,164));keys.handle(c,new KeyEvent(1,164));check(!c.audio.muted,"next mute press toggles again");
  keys.handle(c,new KeyEvent(0,25));keys.handle(c,new KeyEvent(0,25));keys.handle(c,new KeyEvent(1,25));check(c.audio.current==7,"volume hold still repeats");
  c.audio.muted=true;check(MediaVolume.change(c,12,0).optBoolean("ok"),"slider success");check(!c.audio.muted&&c.audio.current==12,"slider restores audible media");
  check(MediaVolume.snapshot(c).getInt("volPercent")==80,"native percentage");
  c.audio.fixed=true;int count=c.audio.changes;check(!MediaVolume.change(c,2,0).optBoolean("ok"),"fixed output rejected");check(!keys.handle(c,new KeyEvent(0,24)),"fixed keys go to firmware");check(count==c.audio.changes,"no changes to fixed output");c.audio.fixed=false;
  c.custom=false;check(!keys.handle(c,new KeyEvent(0,24)),"disabled custom UI leaves physical keys alone");MediaVolume.change(c,5,0);check(c.audio.flags==AudioManager.FLAG_SHOW_UI,"disabled uses system fallback");
  c.custom=true;keys.handle(c,new KeyEvent(0,24));c.custom=false;check(keys.handle(c,new KeyEvent(1,24)),"paired up remains consumed after preference change");
  c.custom=true;c.audio.fail=true;check(!keys.handle(c,new KeyEvent(0,24)),"permission failure passes key through");check(!keys.handle(c,new KeyEvent(1,24)),"failed down leaves up alone");c.audio.fail=false;
  HomeGuardService.homeInFront=false;MediaVolume.change(c,5,0);check(c.audio.flags==AudioManager.FLAG_SHOW_UI,"no overlay host falls back");
  HomeGuardService.instance=new HomeGuardService();MediaVolume.change(c,6,0);check(c.audio.flags==0&&HomeGuardService.instance.shown==1,"global host used once");
  check(MediaVolume.change(c,100,0).getInt("vol")==15,"clamp exact level");
  System.out.println("Media volume controller passed: "+checks+" checks with Android test doubles (keys, pairs, mute hold, stream routing, fixed output, errors, fallback).");
 }
}
