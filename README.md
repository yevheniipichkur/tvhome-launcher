# TVHome — «Вітальня»

Home screen for the Mi Box S in the Claude Code style: clock, Lviv weather and sunrise,
air-raid alerts by raion, live Shahed/missile targets on a map of Ukraine, Wi-Fi name, app dock.

**Since 2026-10-23 the APK is standalone.** The page (`web/`) is bundled into the APK and served from
`https://appassets.androidplatform.net/web/`; `DataService.java` fetches everything on the box:
NEPTUN (targets), Open-Meteo, NBU, Ukrainska Pravda / Ukrinform RSS, ubilling (oblast fallback) and
**our public API** `https://tvhome.pichkur.com/api/public/alerts` for official ukrainealarm alerts by
district/community (ukrainealarm has no open API). The tunnel exposes only `/api/public/` of the Pi
server (everything else 404). Latest build for sharing: `https://tvhome.pichkur.com/api/public/download/tvhome.apk`.
Page changes now need a new APK build (Codemagic), not just an edit on the Pi.

- `server/` — no-dependency Node server. Caches NEPTUN (threats + alerts; terms: visible link
  to NEPTUN), ubilling (fallback alerts), Open-Meteo (weather). Runs as container `tvhome`
  (`docker compose up -d --build`), LAN only at `http://192.168.1.16:8098/`.
- `web/` — the page. Mounted read-only into the container, so edits go live on the next reload
  (the launcher reloads after 30 min in the background, or press Home twice).
  `web/config.js` holds the dock order and hidden apps.
- `android/` — the launcher APK: full-screen WebView + `window.TV` bridge (apps, launch,
  settings, wifi), HOME activity, accessibility service that sends the Home button and the
  stock launcher back here. Built on Codemagic (`codemagic.yaml`), never on the Pi.
- `tools/make-map.py` — rebuilds `web/ukraine.json` from ua-radar's OSM-derived raions/oblasts.

Install on the box (after a Codemagic build):

```bash
adb -s 192.168.1.18:5555 install -r tvhome.apk
adb -s 192.168.1.18:5555 shell pm grant pl.pichkur.tvhome android.permission.ACCESS_COARSE_LOCATION
adb -s 192.168.1.18:5555 shell cmd package set-home-activity pl.pichkur.tvhome/.MainActivity
adb -s 192.168.1.18:5555 shell settings put secure enabled_accessibility_services pl.pichkur.tvhome/.HomeGuardService
```

Projectivy is disabled (2026-10-22); the offline page falls back to Settings.
