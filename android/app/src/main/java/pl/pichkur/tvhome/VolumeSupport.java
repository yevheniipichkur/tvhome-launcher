package pl.pichkur.tvhome;

import android.accessibilityservice.AccessibilityServiceInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;
import android.view.accessibility.AccessibilityManager;
import org.json.JSONArray;
import org.json.JSONObject;

/** Read-only evidence about physical-key routing, separate from the phone's media-volume commands. */
final class VolumeSupport {
    static JSONObject state(Context c) {
        JSONObject o = new JSONObject();
        try {
            ComponentName own = new ComponentName(c, HomeGuardService.class);
            String enabled = Settings.Secure.getString(c.getContentResolver(), Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            boolean listed = false;
            if (enabled != null) for (String item : enabled.split(":")) if (own.equals(ComponentName.unflattenFromString(item))) listed = true;
            HomeGuardService g = HomeGuardService.instance;
            AccessibilityServiceInfo info = g == null ? null : g.getServiceInfo();
            o.put("androidSdk", android.os.Build.VERSION.SDK_INT);
            o.put("edition", BuildConfig.LITE ? "lite" : "full").put("version", BuildConfig.VERSION_NAME).put("uiEnabled", MediaVolume.custom(c));
            o.put("enabled", listed).put("connected", g != null);
            o.put("filterRequested", info != null && (info.flags & AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS) != 0);
            o.put("filterCapable", info != null && (info.getCapabilities() & AccessibilityServiceInfo.CAPABILITY_CAN_REQUEST_FILTER_KEY_EVENTS) != 0);
            o.put("receivedKeys", g == null ? 0 : g.volumeKeysReceived).put("handledKeys", g == null ? 0 : g.volumeKeysHandled);
            VolumeFallback fallback = g == null ? null : g.volumeFallback;
            o.put("firmwareObserver", fallback != null && fallback.registered);
            o.put("mirroredChanges", fallback == null ? 0 : fallback.mirroredChanges);
            o.put("stockDismissRequests", fallback == null ? 0 : fallback.dismissRequests);
            JSONArray others = new JSONArray();
            AccessibilityManager a = (AccessibilityManager)c.getSystemService(Context.ACCESSIBILITY_SERVICE);
            if (a != null) for (AccessibilityServiceInfo service : a.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK)) {
                if ((service.flags & AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS) == 0) continue;
                ComponentName component = ComponentName.unflattenFromString(service.getId());
                if (component != null && !own.equals(component)) others.put(component.flattenToShortString());
            }
            o.put("otherKeyFilters", others);
        } catch (Exception ignored) { }
        return o;
    }
    static void openSettings(Context c) {
        c.startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
}
