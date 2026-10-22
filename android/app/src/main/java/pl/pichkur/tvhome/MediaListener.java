package pl.pichkur.tvhome;

import android.service.notification.NotificationListenerService;

/**
 * Exists only so the launcher may read active media sessions (MediaSessionManager requires an
 * enabled notification listener). Enabled once over ADB: cmd notification allow_listener …
 */
public class MediaListener extends NotificationListenerService {
}
