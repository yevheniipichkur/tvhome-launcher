#!/usr/bin/env bash
# Build the APK on Codemagic, publish it for sharing/self-update (dist/), install on the Mi Box.
set -eu
T=$(cat ~/.config/workopus/codemagic-token); APP=6ada4ecfb42a6cfaaa2d5735
ID=${BUILD_ID:-}
[ -n "$ID" ] || ID=$(curl -s -X POST -H "x-auth-token: $T" -H "Content-Type: application/json" -d "{\"appId\":\"$APP\",\"workflowId\":\"tvhome-apk\",\"branch\":\"main\"}" https://api.codemagic.io/builds | python3 -c "import json,sys;print(json.load(sys.stdin)['buildId'])")
for i in $(seq 1 360); do  # the free Codemagic queue can take a while S=$(curl -s -H "x-auth-token: $T" https://api.codemagic.io/builds/$ID | python3 -c "import json,sys;print(json.load(sys.stdin).get('build',{}).get('status','?'))"); case $S in finished|failed|canceled|timeout) break;; esac; sleep 10; done
echo "build $S"; [ "$S" = finished ] || exit 1
read -r U N < <(curl -s -H "x-auth-token: $T" https://api.codemagic.io/builds/$ID | python3 -c "import json,sys;b=json.load(sys.stdin)['build'];print(b['artefacts'][0]['url'], b['index'])")
D=~/tvhome/dist
curl -sL -H "x-auth-token: $T" -o $D/tvhome.apk.new "$U"
mv $D/tvhome.apk.new $D/tvhome.apk
printf '{"versionCode":%s,"versionName":"1.%s"}\n' "$N" "$N" > $D/version.json
echo "published 1.$N"
[ "${1:-}" = "--no-install" ] || ~/tvhome/tools/install-on-box.sh $D/tvhome.apk
