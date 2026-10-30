#!/usr/bin/env bash
# assemble.sh - encode per-scene PNG sequences, join with transitions, mux audio.
# Usage: assemble.sh --config scenes.json --out out.mp4 [--draft] [--workdir DIR] [--keep]
# See README-assemble.md for the scenes.json schema.
set -euo pipefail

CONFIG="" OUT="" DRAFT=0 WORKDIR="" KEEP=0
die() { echo "[assemble] error: $*" >&2; exit 1; }
log() { echo "[assemble] $*" >&2; }

while [ $# -gt 0 ]; do
  case "$1" in
    --config)  CONFIG="${2:-}"; shift 2 ;;
    --out)     OUT="${2:-}"; shift 2 ;;
    --draft)   DRAFT=1; shift ;;
    --workdir) WORKDIR="${2:-}"; shift 2 ;;
    --keep)    KEEP=1; shift ;;
    -h|--help) sed -n '2,3p' "$0"; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done
[ -n "$CONFIG" ] && [ -f "$CONFIG" ] || die "--config scenes.json required"
[ -n "$OUT" ] || die "--out required"
for t in ffmpeg jq; do command -v "$t" >/dev/null || die "$t not found"; done

CFGDIR="$(cd "$(dirname "$CONFIG")" && pwd)"
jq -e '.scenes | type == "array" and length > 0' "$CONFIG" >/dev/null || die "config needs non-empty .scenes"

# resolve path relative to config dir unless absolute
rp() { case "$1" in /*) printf '%s' "$1" ;; *) printf '%s/%s' "$CFGDIR" "$1" ;; esac; }
cfg() { jq -r "$1" "$CONFIG"; }

FPS="$(cfg '.fps // 30')"
W="$(cfg '.width // 1920')"; H="$(cfg '.height // 1080')"
PATTERN="$(cfg '.pattern // "%05d.png"')"
DEF_T="$(cfg '.default_transition.type // "crossfade"')"
DEF_D="$(cfg '.default_transition.duration // 0.5')"
if [ "$DRAFT" = 1 ]; then OW=854 OH=480 PRESET=ultrafast CRF=30; else OW=$W OH=$H PRESET=medium CRF=18; fi

if [ -z "$WORKDIR" ]; then WORKDIR="$(mktemp -d)"; CLEAN=1; else mkdir -p "$WORKDIR"; CLEAN=0; fi
[ "$KEEP" = 1 ] && CLEAN=0
cleanup() { [ "$CLEAN" = 1 ] && rm -rf "$WORKDIR"; return 0; }
trap cleanup EXIT

N="$(cfg '.scenes | length')"
declare -a LEN TYPE DUR
FF=(ffmpeg -hide_banner -loglevel error -y)

# ---- 1. encode each scene -------------------------------------------------
for ((i=0; i<N; i++)); do
  dir="$(rp "$(cfg ".scenes[$i].frames")")"
  [ -d "$dir" ] || die "scene $i: frames dir not found: $dir"
  nframes="$(find "$dir" -maxdepth 1 -name '*.png' | wc -l)"
  [ "$nframes" -gt 0 ] || die "scene $i: no PNG frames in $dir"
  d="$(cfg ".scenes[$i].duration // empty")"
  [ -n "$d" ] || d="$(awk -v n="$nframes" -v f="$FPS" 'BEGIN{printf "%.6f", n/f}')"
  LEN[i]="$d"
  # transition leaving this scene (ignored for the last scene)
  TYPE[i]="$(cfg ".scenes[$i].transition.type // \"$DEF_T\"")"
  DUR[i]="$(cfg ".scenes[$i].transition.duration // $DEF_D")"
  start="$(cfg ".scenes[$i].start_number // 1")"
  log "scene $i: $nframes frames, ${d}s -> $WORKDIR/scene_$i.mp4"
  # tpad holds the last frame if duration exceeds the frame count; -t trims if shorter
  "${FF[@]}" -framerate "$FPS" -start_number "$start" -i "$dir/$PATTERN" \
    -vf "scale=${OW}:${OH}:force_original_aspect_ratio=decrease,pad=${OW}:${OH}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=$FPS,tpad=stop_mode=clone:stop_duration=$d,format=yuv420p" \
    -t "$d" -c:v libx264 -preset "$PRESET" -crf "$CRF" -pix_fmt yuv420p -r "$FPS" -an \
    "$WORKDIR/scene_$i.mp4"
done

# ---- 2. build join graph --------------------------------------------------
INPUTS=(); for ((i=0; i<N; i++)); do INPUTS+=(-i "$WORKDIR/scene_$i.mp4"); done
GRAPH="" ; cur="[0:v]"; acc="${LEN[0]}"
for ((i=1; i<N; i++)); do
  t="${TYPE[i-1]}"; td="${DUR[i-1]}"; out="[v$i]"
  case "$t" in
    cut|none) GRAPH+="${cur}[$i:v]concat=n=2:v=1:a=0${out};"
              acc="$(awk -v a="$acc" -v l="${LEN[i]}" 'BEGIN{printf "%.6f", a+l}')" ;;
    crossfade|fade|dip|dip-to-black|fadeblack|*)
      case "$t" in
        crossfade|fade) xt=fade ;;
        dip|dip-to-black|fadeblack) xt=fadeblack ;;
        *) xt="$t" ;;   # pass any other ffmpeg xfade name through
      esac
      # transition can't exceed either neighbouring clip
      td="$(awk -v d="$td" -v a="${LEN[i-1]}" -v b="${LEN[i]}" 'BEGIN{m=(a<b?a:b)-0.04; if(d>m)d=m; printf "%.6f", d}')"
      off="$(awk -v a="$acc" -v d="$td" 'BEGIN{printf "%.6f", a-d}')"
      GRAPH+="${cur}[$i:v]xfade=transition=${xt}:duration=${td}:offset=${off}${out};"
      acc="$(awk -v a="$acc" -v l="${LEN[i]}" -v d="$td" 'BEGIN{printf "%.6f", a+l-d}')" ;;
  esac
  cur="$out"
done
GRAPH+="${cur}format=yuv420p,fps=$FPS[vout]"
TOTAL="$acc"
log "total duration ${TOTAL}s"

# ---- 3. audio -------------------------------------------------------------
VO="$(cfg '.audio.voiceover // empty')"; MUS="$(cfg '.audio.music // empty')"
MUSVOL="$(cfg '.audio.music_volume // 0.3')"
DUCK_THR="$(cfg '.audio.duck_threshold // 0.03')"; DUCK_RATIO="$(cfg '.audio.duck_ratio // 8')"
AIDX=$N; AMAP=()
[ -n "$VO" ] && { VO="$(rp "$VO")"; [ -f "$VO" ] || die "voiceover not found: $VO"; }
[ -n "$MUS" ] && { MUS="$(rp "$MUS")"; [ -f "$MUS" ] || die "music not found: $MUS"; }
AF="" ; FADE_START="$(awk -v t="$TOTAL" 'BEGIN{s=t-1.5; if(s<0)s=0; printf "%.3f", s}')"
if [ -n "$VO" ] && [ -n "$MUS" ]; then
  INPUTS+=(-i "$VO" -i "$MUS"); v=$AIDX; m=$((AIDX+1))
  AF="[$v:a]aresample=48000,apad,atrim=0:$TOTAL,asplit=2[vo1][vo2];"
  AF+="[$m:a]aresample=48000,aloop=loop=-1:size=2147483647,atrim=0:$TOTAL,volume=$MUSVOL[mus];"
  AF+="[mus][vo1]sidechaincompress=threshold=$DUCK_THR:ratio=$DUCK_RATIO:attack=20:release=400[duck];"
  AF+="[vo2][duck]amix=inputs=2:duration=first:dropout_transition=0,volume=2,afade=t=out:st=$FADE_START:d=1.5[aout]"
elif [ -n "$VO" ]; then
  INPUTS+=(-i "$VO")
  AF="[$AIDX:a]aresample=48000,apad,atrim=0:$TOTAL,afade=t=out:st=$FADE_START:d=1.5[aout]"
elif [ -n "$MUS" ]; then
  INPUTS+=(-i "$MUS")
  AF="[$AIDX:a]aresample=48000,aloop=loop=-1:size=2147483647,atrim=0:$TOTAL,volume=$MUSVOL,afade=t=out:st=$FADE_START:d=1.5[aout]"
fi
if [ -n "$AF" ]; then GRAPH+=";$AF"; AMAP=(-map "[aout]" -c:a aac -b:a 192k -ar 48000); fi

# ---- 4. final encode ------------------------------------------------------
mkdir -p "$(dirname "$OUT")"
"${FF[@]}" "${INPUTS[@]}" -filter_complex "$GRAPH" -map "[vout]" "${AMAP[@]}" \
  -c:v libx264 -preset "$PRESET" -crf "$CRF" -pix_fmt yuv420p -r "$FPS" \
  -t "$TOTAL" -movflags +faststart "$OUT"
log "wrote $OUT"
