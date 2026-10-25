package android.view;
public class KeyEvent {
 public static final int ACTION_DOWN=0,ACTION_UP=1,KEYCODE_VOLUME_UP=24,KEYCODE_VOLUME_DOWN=25,KEYCODE_VOLUME_MUTE=164;
 private final int action,code;public KeyEvent(int action,int code){this.action=action;this.code=code;}
 public int getAction(){return action;}public int getKeyCode(){return code;}
}
