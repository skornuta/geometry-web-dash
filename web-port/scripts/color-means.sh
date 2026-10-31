#!/bin/zsh
# Native batch frame vs port frame, mean RGB per pair, for every row of the
# capture index (or one level: color-means.sh 14). Writes /tmp/color-means/means.csv
# as `level,pct,nativeR,G,B,portR,G,B` — a large distance flags a colour-state
# mismatch (trigger/channel), independent of camera framing.
cd "$(dirname "$0")/.."
B=../docs/fidelity/captures-2026-10-03/batch
D=/tmp/color-means; mkdir -p $D; out=$D/means.csv; : > $out
mean() { node scripts/png-mean.mjs "$1" | cut -d' ' -f2 | python3 -I -c "import sys,json;print(*json.loads(sys.stdin.read())['meanRGB'],sep=',')"; }
while read -r lvl pct x rest; do
  [ -n "$1" ] && [ "$1" != "$lvl" ] && continue
  [ -f $B/l$lvl-$pct.png ] || continue
  node scripts/port-at.mjs $lvl $x $D/p-$lvl-$pct.png >/dev/null 2>&1 || { echo "$lvl,$pct,FAIL" >> $out; continue; }
  echo "$lvl,$pct,$(mean $B/l$lvl-$pct.png),$(mean $D/p-$lvl-$pct.png)" >> $out
done < $B/index.txt
