#!/usr/bin/env bash
# Builds the flag-on static export into out-videos/ (for `pnpm test:e2e:videos`),
# then rebuilds the normal flag-off out/. Restores public/sitemap.xml.
set -euo pipefail
cd "$(dirname "$0")/.."
# On failure: restore the sitemap and leave a flag-off out/ (not the flag-on one).
trap 'git checkout -- public/sitemap.xml; [ -d out-videos ] && [ ! -d out ] && cp -r out-videos out' EXIT
NEXT_PUBLIC_VIDEOS=1 pnpm build
rm -rf out-videos && mv out out-videos
pnpm build
git checkout -- public/sitemap.xml
