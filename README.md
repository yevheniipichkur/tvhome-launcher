# TVHome — «Вітальня»

Home screen for the Mi Box S in the Claude Code style: clock, Lviv weather and sunrise,
air-raid alerts by raion, live Shahed/missile targets on a map of Ukraine, Wi-Fi name, app dock.

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

Projectivy stays installed as the fallback launcher (offline page → OK).
