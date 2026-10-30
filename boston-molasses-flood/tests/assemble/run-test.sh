#!/usr/bin/env bash
# Synthetic test: tiny low-res clips only. Usage: tests/assemble/run-test.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ASM="$HERE/../../src/render/assemble.sh"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
F=(ffmpeg -hide_banner -loglevel error -y)
fail() { echo "FAIL: $*"; exit 1; }

# 3 scenes of 96x54 frames at 30fps (2s, 2s, 1.5s)
mk() { mkdir -p "$T/$1"; "${F[@]}" -f lavfi -i "$2=s=96x54:r=30:d=$3" "$T/$1/%05d.png"; }
mk a testsrc 2; mk b smptebars 2; mk c testsrc2 1.5
"${F[@]}" -f lavfi -i "sine=f=440:d=4" "$T/vo.wav"
"${F[@]}" -f lavfi -i "sine=f=220:d=2" "$T/music.wav"   # shorter than video: must loop
cat > "$T/scenes.json" <<J
{ "width": 96, "height": 54, "fps": 30,
  "default_transition": {"type":"crossfade","duration":0.5},
  "audio": {"voiceover":"vo.wav","music":"music.wav","music_volume":0.3},
  "scenes": [
    {"frames":"a","duration":2,"transition":{"type":"crossfade","duration":0.5}},
    {"frames":"b","duration":2,"transition":{"type":"dip","duration":0.4}},
    {"frames":"c","duration":2.5} ] }
J
# expected: 2 + 2 + 2.5 - 0.5 - 0.4 = 5.6s
check() { # file w h expected_dur
  local o; o="$(ffprobe -v error -show_entries stream=codec_name,pix_fmt,width,height,r_frame_rate -show_entries format=duration -of default=nw=1 "$1")"
  echo "$o" | grep -q "pix_fmt=yuv420p" || fail "pix_fmt: $o"
  echo "$o" | grep -q "codec_name=h264" || fail "codec: $o"
  echo "$o" | grep -q "width=$2" && echo "$o" | grep -q "height=$3" || fail "size: $o"
  echo "$o" | grep -q "r_frame_rate=30/1" || fail "fps: $o"
  echo "$o" | grep -q "codec_name=aac" || fail "no aac audio: $o"
  local d; d="$(echo "$o" | sed -n 's/^duration=//p')"
  awk -v d="$d" -v e="$4" 'BEGIN{exit !(d>e-0.15 && d<e+0.15)}' || fail "duration $d != $4"
}
"$ASM" --config "$T/scenes.json" --out "$T/full.mp4"; check "$T/full.mp4" 96 54 5.6
echo "ok: full"
"$ASM" --config "$T/scenes.json" --out "$T/draft.mp4" --draft; check "$T/draft.mp4" 854 480 5.6
echo "ok: draft (480p)"
# cut transition + voiceover only
sed 's/"music":"music.wav",//; s/"dip"/"cut"/' "$T/scenes.json" > "$T/s2.json"
"$ASM" --config "$T/s2.json" --out "$T/cut.mp4"; check "$T/cut.mp4" 96 54 6.0
echo "ok: cut + voiceover only"
# error handling
"$ASM" --config "$T/nope.json" --out "$T/x.mp4" 2>/dev/null && fail "missing config accepted"
echo "ALL PASS"
