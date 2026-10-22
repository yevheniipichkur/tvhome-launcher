package pl.pichkur.tvhome;

import android.accessibilityservice.AccessibilityService;
import android.content.Intent;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityEvent;

/**
 * The Mi Box firmware re-enables and prefers the stock Google TV launcher on every boot.
 * This service sends the Home button and any appearance of the stock launcher back here.
 */
public class HomeGuardService extends AccessibilityService {
    private static final String[] STOCK = {"com.google.android.tvlauncher", "com.google.android.leanbacklauncher", "com.mitv.tvhome"};

    static void goHome(android.content.Context ctx) {
        Intent i = new Intent(ctx, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        ctx.startActivity(i);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED || event.getPackageName() == null) return;
        String pkg = event.getPackageName().toString();
        for (String s : STOCK) {
            if (s.equals(pkg)) {
                goHome(this);
                return;
            }
        }
    }

    @Override
    protected boolean onKeyEvent(KeyEvent event) {
        if (event.getKeyCode() != KeyEvent.KEYCODE_HOME) return false;
        if (event.getAction() == KeyEvent.ACTION_UP) goHome(this);
        return true;
    }

    @Override
    public void onInterrupt() {
    }
}
