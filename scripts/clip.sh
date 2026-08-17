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
# Written because the alternative is a 200-character yt-dlp invocation per
# clip, and the two things that go wrong in that invocation both go wrong
# silently: an unquoted -f selector gets glob-expanded by zsh before yt-dlp
# ever sees it, and without --force-keyframes-at-cuts the cut lands on the
# nearest keyframe instead of the frame asked for, which is up to a second of
# slop on each end of a six-second clip.
set -euo pipefail

NAME="clip"; PRE=3; LEN=6; OUT="clips"

usage() {
  sed -n '3,12p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while getopts "n:p:l:o:h" opt; do
  case "$opt" in
    n) NAME="$OPTARG" ;;
    p) PRE="$OPTARG" ;;
    l) LEN="$OPTARG" ;;
    o) OUT="$OPTARG" ;;
    h) usage 0 ;;
    *) usage 1 ;;
  esac
done
shift $((OPTIND - 1))

[ $# -ge 1 ] || usage 1
URL="$1"; shift

command -v yt-dlp >/dev/null || { echo "yt-dlp not found. brew install yt-dlp ffmpeg" >&2; exit 1; }

mkdir -p "$OUT"

# mm:ss / hh:mm:ss / plain seconds -> seconds. Leading zeros are stripped
# explicitly: 08 is an invalid octal literal to $(( )) and would abort the run
# on a timestamp like 1:08.
to_seconds() {
  local t="$1" total=0 part
  IFS=: read -ra part <<< "$t"
  for p in "${part[@]}"; do total=$((total * 60 + 10#$p)); done
  echo "$total"
}

fmt() { printf '%02d:%02d:%02d' $(($1 / 3600)) $(($1 % 3600 / 60)) $(($1 % 60)); }

if [[ "$URL" == *"/shorts/"* ]]; then
  echo "Short detected — taking it whole."
  yt-dlp -f "bv*[height<=1080]+ba/b[height<=1080]" --recode mp4 \
         -o "$OUT/$NAME.mp4" "$URL"
  echo "-> $OUT/$NAME.mp4"
  exit 0
fi

[ $# -ge 1 ] || { echo "Give at least one timestamp, e.g. 1:03" >&2; exit 1; }

i=0
for stamp in "$@"; do
  i=$((i + 1))
  centre=$(to_seconds "$stamp")
  start=$((centre - PRE)); [ "$start" -lt 0 ] && start=0
  end=$((start + LEN))
  file=$(printf '%s/%s-%02d.mp4' "$OUT" "$NAME" "$i")
  echo "[$i/$#] $stamp  ->  $(fmt $start)-$(fmt $end)"
  # Quoted -f so zsh cannot glob the brackets; --force-keyframes-at-cuts so the
  # cut lands where it was asked to.
  yt-dlp -f "bv*[height<=1080]" --recode mp4 --force-keyframes-at-cuts \
         --download-sections "*$(fmt $start)-$(fmt $end)" \
         -o "$file" "$URL" >/dev/null 2>&1 \
    && echo "     -> $file" \
    || echo "     !! failed at $stamp" >&2
done
echo "Done. $OUT/"
