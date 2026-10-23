#!/usr/bin/env bash
# The free Codemagic queue can take a while: up to 60 min of waiting. BUILD_ID=<id> waits for an existing build.
# Build the APK on Codemagic, publish it for sharing/self-update (dist/), install on the Mi Box.
set -eu
T=$(cat ~/.config/workopus/codemagic-token); APP=6ada4ecfb42a6cfaaa2d5735
ID=${BUILD_ID:-}
[ -n "$ID" ] || ID=$(curl -s -X POST -H "x-auth-token: $T" -H "Content-Type: application/json" -d "{\"appId\":\"$APP\",\"workflowId\":\"tvhome-apk\",\"branch\":\"main\"}" https://api.codemagic.io/builds | python3 -c "import json,sys;print(json.load(sys.stdin)['buildId'])")
for i in $(seq 1 360); do S=$(curl -s -H "x-auth-token: $T" https://api.codemagic.io/builds/$ID | python3 -c "import json,sys;print(json.load(sys.stdin).get('build',{}).get('status','?'))"); case $S in finished|failed|canceled|timeout) break;; esac; sleep 10; done
echo "build $S"; [ "$S" = finished ] || exit 1
D=~/tvhome/dist
curl -s -H "x-auth-token: $T" https://api.codemagic.io/builds/$ID > /tmp/tvhome-build.json
N=$(python3 -c "import json;print(json.load(open('/tmp/tvhome-build.json'))['build']['index'])")
for ed in full lite; do
  U=$(python3 -c "import json,sys;print([a['url'] for a in json.load(open('/tmp/tvhome-build.json'))['build']['artefacts'] if a['name'].endswith('-$ed-release.apk')][0])")
  OUT=$D/tvhome$([ $ed = lite ] && echo -lite).apk
  curl -sL -H "x-auth-token: $T" -o "$OUT.new" "$U" && mv "$OUT.new" "$OUT"
  printf '{"versionCode":%s,"versionName":"1.%s"}\n' "$N" "$N" > $D/version$([ $ed = lite ] && echo -lite).json
done
echo "published 1.$N"
[ "${1:-}" = "--no-install" ] || ~/tvhome/tools/install-on-box.sh $D/tvhome.apk
