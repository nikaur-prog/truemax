#!/usr/bin/env bash
#
# Sort TrueMax exports out of ~/Downloads into a folder per kind.
#
# A browser cannot pick a download folder, so everything lands in one pile.
# This is the other half: run it whenever the pile gets deep, or leave it on a
# schedule. It is deliberately conservative — it MOVES files it recognises and
# touches nothing else, it never overwrites, and --dry-run shows the whole plan
# without changing anything.
#
#   ./sort-truemax-downloads.sh --dry-run     # see what would happen
#   ./sort-truemax-downloads.sh               # do it
#   ./sort-truemax-downloads.sh --from ~/Desktop --to ~/Movies/TrueMax
#
# Handles both naming schemes: the current
# truemax-<kind>-[label-]YYYY-MM-DD-HHMM.<ext> and the older
# truemax-<something>-<epoch>.<ext> files already sitting in Downloads.

set -euo pipefail

FROM="$HOME/Downloads"
TO="$HOME/TrueMax"
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1; shift ;;
    --from) FROM="$2"; shift 2 ;;
    --to) TO="$2"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

[ -d "$FROM" ] || { echo "no such folder: $FROM" >&2; exit 1; }

# One folder per kind, plus a holding pen. The names are chosen to read as
# what they hold rather than as what produced them.
REELS="$TO/Reels"          # finished vertical videos: breakdowns, produced cuts
RUNDOWNS="$TO/Rundowns"    # the narrated walk down one face
CARDS="$TO/Verdict cards"  # score cards and before/after stills
SCANS="$TO/Scans"          # scanned photographs with landmarks
OTHER="$TO/Unsorted"       # recognised as TrueMax, kind unclear — never guessed

say() { [ "$DRY" = 1 ] && echo "would: $*" || echo "$*"; }

ensure() {
  [ "$DRY" = 1 ] && return 0
  mkdir -p "$1"
}

# Move without ever clobbering: if the destination exists, add -2, -3, ...
# Two exports inside the same minute is rare but not impossible, and losing one
# silently would be a bad trade for a tidier folder.
move() {
  local src="$1" dir="$2"
  local base ext stem target n
  base="$(basename "$src")"
  ext="${base##*.}"
  stem="${base%.*}"
  target="$dir/$base"
  n=2
  while [ -e "$target" ]; do
    target="$dir/${stem}-${n}.${ext}"
    n=$((n + 1))
  done
  say "$base  ->  ${dir#$TO/}/$(basename "$target")"
  [ "$DRY" = 1 ] && return 0
  mv -n "$src" "$target"
}

moved=0
shopt -s nullglob nocaseglob
for file in "$FROM"/truemax-*; do
  [ -f "$file" ] || continue
  name="$(basename "$file")"
  lower="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')"

  case "$lower" in
    truemax-rundown-*)                        dir="$RUNDOWNS" ;;
    truemax-reel-*|truemax-breakdown-*|truemax-tiktok-*|truemax-analysis-*)
                                              dir="$REELS" ;;
    truemax-card-*|truemax-before-*|truemax-after-*|truemax-score-*)
                                              dir="$CARDS" ;;
    truemax-scan-*)                           dir="$SCANS" ;;
    # Legacy: truemax-<epoch>.png with no kind at all. It is a share card by
    # construction — that was the only export ever named this way — but the
    # name does not say so, so it goes to Unsorted rather than being assumed.
    *)                                        dir="$OTHER" ;;
  esac

  ensure "$dir"
  move "$file" "$dir"
  moved=$((moved + 1))
done

if [ "$moved" = 0 ]; then
  echo "nothing to sort in $FROM"
else
  echo
  echo "$moved file(s)$([ "$DRY" = 1 ] && echo " would be" || echo "") sorted into $TO"
  [ "$DRY" = 1 ] && echo "(dry run — nothing was moved)"
fi
