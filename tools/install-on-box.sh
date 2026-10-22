#!/usr/bin/env bash
# Installs/updates the TVHome launcher on the Mi Box and makes it the home screen.
# Usage: install-on-box.sh path/to/tvhome.apk [--wait]   (--wait: poll until the box is online, up to 2 h)
set -u
DEV=192.168.1.18:5555
APK=${1:?apk}
A() { adb -s "$DEV" shell "$@" 2>/dev/null | tr -d '\r'; }
online() { adb connect "$DEV" >/dev/null 2>&1; [ "$(A echo ok)" = "ok" ]; }
if [ "${2:-}" = "--wait" ]; then
  for _ in $(seq 1 720); do online && break; sleep 10; done
fi
online || { echo "Mi Box offline"; exit 1; }
sleep 5 # let a just-woken box settle
adb -s "$DEV" install -r "$APK" || exit 1
A pm grant pl.pichkur.tvhome android.permission.ACCESS_COARSE_LOCATION
A pm grant pl.pichkur.tvhome com.android.providers.tv.permission.READ_EPG_DATA
A cmd package set-home-activity pl.pichkur.tvhome/.MainActivity
A settings put secure enabled_accessibility_services pl.pichkur.tvhome/pl.pichkur.tvhome.HomeGuardService
A settings put secure accessibility_enabled 1
A am start -a android.intent.action.MAIN -c android.intent.category.HOME >/dev/null
echo "installed $(A dumpsys package pl.pichkur.tvhome | grep -m1 versionName)"
