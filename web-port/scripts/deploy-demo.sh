#!/bin/sh
# Rebuild the site for GitHub Pages and push it to the public demo repo.
#   sh scripts/deploy-demo.sh            (run from web-port/, needs ../../geometry-web-dash-demo cloned)
set -e
DEMO="${DEMO_DIR:-$(cd .. && cd .. && pwd)/geometry-web-dash-demo}"
[ -d "$DEMO/.git" ] || { echo "no demo repo at $DEMO (set DEMO_DIR)"; exit 1; }
GD_BASE=/geometry-web-dash-demo/ npm run build
# replace everything but the repo's own files
find "$DEMO" -mindepth 1 -maxdepth 1 ! -name .git ! -name README.md ! -name .nojekyll -exec rm -rf {} +
cp -R dist/. "$DEMO"/
cd "$DEMO"
for i in 1 2 3 4 5; do
  if git add -A 2>/dev/null; then
    break
  fi
  sleep 0.2
done
git add -A
if git diff --cached --quiet; then
  echo "Demo build is already up to date."
else
  git commit -m "Update demo build" && git push
fi
