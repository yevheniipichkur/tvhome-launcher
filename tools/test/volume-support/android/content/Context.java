package android.content;
public class Context {
 public static final String AUDIO_SERVICE="audio"; public static final int MODE_PRIVATE=0;
 public final android.media.AudioManager audio=new android.media.AudioManager(); public boolean custom=true;
 public Object getSystemService(String key){return audio;}
 public SharedPreferences getSharedPreferences(String name,int mode){return new SharedPreferences(this);}
}
