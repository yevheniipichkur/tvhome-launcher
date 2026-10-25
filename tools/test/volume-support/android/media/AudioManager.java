package android.media;
/** Test double: deterministic media stream, not a claim about Android/HDMI firmware. */
public class AudioManager {
 public static final int STREAM_MUSIC=3,FLAG_SHOW_UI=1,ADJUST_RAISE=1,ADJUST_LOWER=-1,ADJUST_TOGGLE_MUTE=101,ADJUST_UNMUTE=100;
 public int current=8,max=15,changes,flags; public boolean muted,fixed,fail;
 public int getStreamMaxVolume(int stream){return max;}public int getStreamVolume(int stream){return current;}
 public boolean isStreamMute(int stream){return muted;}public boolean isVolumeFixed(){return fixed;}
 public void setStreamVolume(int stream,int value,int flags){change(stream,flags);current=value;}
 public void adjustStreamVolume(int stream,int direction,int flags){change(stream,flags);if(direction==ADJUST_TOGGLE_MUTE)muted=!muted;else if(direction==ADJUST_UNMUTE)muted=false;else current=Math.max(0,Math.min(max,current+direction));}
 private void change(int stream,int flags){if(stream!=STREAM_MUSIC)throw new AssertionError("wrong stream");if(fail)throw new SecurityException();changes++;this.flags=flags;}
}
