#!/usr/bin/env bash
#
# clip.sh — pull short clips out of a YouTube video by timestamp.
#
#   ./scripts/clip.sh <url> <timestamp> [timestamp ...]
#   ./scripts/clip.sh -n fatthor -p 3 -l 4 <url> 1:03 3:36
#
# Each timestamp becomes one clip centred on that moment, so you can read
# numbers straight off the YouTube scrubber while watching and paste them in
# without doing arithmetic. A YouTube Short is downloaded whole and the
# timestamps ignored, because a Short is already the clip.
#
# The source is downloaded ONCE and every clip is cut from that local copy.
# The obvious implementation — one yt-dlp --download-sections per clip — asks
# YouTube for a fresh signed URL each time, and a handful of those in quick
# succession earns an HTTP 403. It fails late, after the wait, and it fails
# more often the more clips you ask for, which is exactly backwards. Cutting
# locally is also faster: one download beats five, and an ffmpeg seek on a
# file already on disk is instant.
set -euo pipefail

NAME="clip"; PRE=3; LEN=6; OUT="clips"; KEEP=0

usage() { sed -n '3,19p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while getopts "n:p:l:o:kh" opt; do
  case "$opt" in
    n) NAME="$OPTARG" ;; p) PRE="$OPTARG" ;; l) LEN="$OPTARG" ;;
    o) OUT="$OPTARG" ;; k) KEEP=1 ;; h) usage 0 ;; *) usage 1 ;;
  esac
done
shift $((OPTIND - 1))

[ $# -ge 1 ] || usage 1
URL="$1"; shift

for tool in yt-dlp ffmpeg; do
  command -v "$tool" >/dev/null || { echo "$tool not found. brew install yt-dlp ffmpeg" >&2; exit 1; }
done

mkdir -p "$OUT"

# mm:ss / hh:mm:ss / plain seconds -> seconds. Leading zeros are forced to base
# 10: 08 is an invalid octal literal to $(( )) and would abort the run on a
# timestamp like 1:08.
to_seconds() {
  local total=0 part
  IFS=: read -ra part <<< "$1"
  for p in "${part[@]}"; do total=$((total * 60 + 10#$p)); done
  echo "$total"
}
fmt() { printf '%02d:%02d:%02d' $(($1 / 3600)) $(($1 % 3600 / 60)) $(($1 % 60)); }

if [[ "$URL" == *"/shorts/"* ]]; then
  echo "Short detected — taking it whole."
  yt-dlp -f "bv*[height<=1080]+ba/b[height<=1080]" --recode mp4 -o "$OUT/$NAME.mp4" "$URL"
  echo "-> $OUT/$NAME.mp4"; exit 0
fi

[ $# -ge 1 ] || { echo "Give at least one timestamp, e.g. 1:03" >&2; exit 1; }

# Cached by video id, so a second run against the same video costs no download
# at all — which is the common case when you missed a moment the first time.
VID=$(yt-dlp --get-id "$URL" 2>/dev/null | head -1 || echo "src")
SRC="$OUT/.src-$VID.mp4"

if [ -f "$SRC" ]; then
  echo "Using cached source ($VID)."
else
  echo "Downloading source once ($VID)..."
  yt-dlp -f "bv*[height<=1080]+ba/b[height<=1080]" --recode mp4 -o "$SRC" "$URL"
fi

i=0; failed=0
for stamp in "$@"; do
  i=$((i + 1))
  centre=$(to_seconds "$stamp")
  start=$((centre - PRE)); [ "$start" -lt 0 ] && start=0
  file=$(printf '%s/%s-%02d.mp4' "$OUT" "$NAME" "$i")
  echo "[$i/$#] $stamp -> $(fmt $start) +${LEN}s"
  # Re-encoded rather than stream-copied: a copy can only cut on a keyframe,
  # which is up to a second off the frame asked for.
  if ffmpeg -nostdin -y -ss "$(fmt $start)" -i "$SRC" -t "$LEN" \
       -c:v libx264 -preset veryfast -crf 20 -c:a aac "$file" >/dev/null 2>&1; then
    echo "     -> $file"
  else
    echo "     !! failed at $stamp" >&2; failed=$((failed + 1))
  fi
done

[ "$KEEP" -eq 1 ] || rm -f "$SRC"
echo "Done. $OUT/  ($((i - failed))/$i clips)"
[ "$KEEP" -eq 1 ] && echo "Source kept at $SRC"
exit 0
