package pl.pichkur.tvhome;

import android.content.Context;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.inputmethodservice.InputMethodService;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.ExtractedText;
import android.view.inputmethod.ExtractedTextRequest;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.InputMethodManager;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * «Вітальня: клавіатура з телефону». Selected as the keyboard, it puts whatever is typed on the phone
 * remote (RemoteServer) straight into the focused text field of any app — YouTube search, Lampa,
 * a Wi-Fi password — Cyrillic included. On the TV it shows only a slim strip with the address; OK on
 * the remote switches to the previous (on-screen) keyboard for typing with the remote.
 */
public class RemoteIme extends InputMethodService {
    static volatile RemoteIme active;
    static volatile boolean editing;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private TextView hint;

    @Override
    public void onCreate() {
        super.onCreate();
        active = this;
        RemoteServer.start(getApplicationContext());
    }

    @Override
    public void onDestroy() {
        if (active == this) active = null;
        editing = false;
        super.onDestroy();
    }

    @Override
    public boolean onEvaluateFullscreenMode() { return false; }

    @Override
    public View onCreateInputView() {
        float d = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 1, getResources().getDisplayMetrics());
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER);
        bar.setPadding((int) (24 * d), (int) (12 * d), (int) (24 * d), (int) (14 * d));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xF0080C12);
        bg.setCornerRadii(new float[]{18 * d, 18 * d, 18 * d, 18 * d, 0, 0, 0, 0});
        bar.setBackground(bg);
        hint = new TextView(this);
        hint.setTextColor(Color.WHITE);
        hint.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 15);
        hint.setTypeface(Typeface.create("sans-serif-medium", Typeface.NORMAL));
        bar.addView(hint);
        TextView sw = new TextView(this);
        sw.setText("   ·   ОК — звичайна клавіатура");
        sw.setTextColor(0xFFA7ADB8);
        sw.setTextSize(TypedValue.COMPLEX_UNIT_DIP, 14);
        bar.addView(sw);
        paintHint();
        return bar;
    }

    private void paintHint() {
        if (hint == null) return;
        String url = RemoteServer.url(this);
        hint.setText("📱  Пишіть з телефону: " + (url == null ? "немає мережі" : url.replace("http://", "")));
    }

    @Override
    public void onStartInput(EditorInfo attribute, boolean restarting) {
        super.onStartInput(attribute, restarting);
        editing = attribute != null && attribute.inputType != 0;
    }

    @Override
    public void onStartInputView(EditorInfo info, boolean restarting) {
        super.onStartInputView(info, restarting);
        paintHint();
    }

    @Override
    public void onFinishInput() {
        editing = false;
        super.onFinishInput();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // OK on the remote while the strip is shown: hand over to the normal on-screen keyboard
        if (isInputViewShown() && (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER)) {
            switchBack();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    void switchBack() {
        try {
            if (Build.VERSION.SDK_INT >= 28) switchToPreviousInputMethod();
            else ((InputMethodManager) getSystemService(Context.INPUT_METHOD_SERVICE)).switchToLastInputMethod(getWindow().getWindow().getAttributes().token);
        } catch (Exception ignored) {
        }
    }

    // ---------- called by RemoteServer (from its threads; the InputConnection is used on the UI thread) ----------

    /** The field's current text and hint, so the phone can edit what is already there. */
    String[] field() {
        final String[] out = {null, null};
        final Object lock = new Object();
        ui.post(() -> {
            try {
                InputConnection ic = getCurrentInputConnection();
                EditorInfo ei = getCurrentInputEditorInfo();
                if (ic != null) {
                    ExtractedText et = ic.getExtractedText(new ExtractedTextRequest(), 0);
                    out[0] = et != null && et.text != null ? et.text.toString() : "";
                }
                if (ei != null && ei.hintText != null) out[1] = ei.hintText.toString();
            } catch (Exception ignored) {
            }
            synchronized (lock) { lock.notifyAll(); }
        });
        synchronized (lock) { try { lock.wait(600); } catch (InterruptedException ignored) { } }
        return out;
    }

    /** Replace the whole field with {@code text} (the phone sends the full text as you type). */
    boolean setText(final String text) {
        if (!editing) return false;
        ui.post(() -> {
            InputConnection ic = getCurrentInputConnection();
            if (ic == null) return;
            ic.beginBatchEdit();
            ExtractedText et = ic.getExtractedText(new ExtractedTextRequest(), 0);
            int len = et != null && et.text != null ? et.text.length() : 0;
            if (et != null) {
                ic.setSelection(0, len);
                ic.commitText(text, 1);
            } else {
                // some fields don't report their text: clear what's around the cursor, then type
                ic.deleteSurroundingText(10000, 10000);
                ic.commitText(text, 1);
            }
            ic.endBatchEdit();
        });
        return true;
    }

    /** «Enter» from the phone: the field's own action (search, go, done) or a plain Enter. */
    boolean enter() {
        if (!editing) return false;
        ui.post(() -> {
            InputConnection ic = getCurrentInputConnection();
            EditorInfo ei = getCurrentInputEditorInfo();
            if (ic == null) return;
            int action = ei == null ? EditorInfo.IME_ACTION_NONE : ei.imeOptions & EditorInfo.IME_MASK_ACTION;
            if (action != EditorInfo.IME_ACTION_NONE && action != EditorInfo.IME_ACTION_UNSPECIFIED && (ei.imeOptions & EditorInfo.IME_FLAG_NO_ENTER_ACTION) == 0)
                ic.performEditorAction(action);
            else {
                ic.sendKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_ENTER));
                ic.sendKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_ENTER));
            }
        });
        return true;
    }
}
