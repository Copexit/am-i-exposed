#!/usr/bin/env bash
# Builds the flag-on static export into out-videos/ (for `pnpm test:e2e:videos`),
# then rebuilds the normal flag-off out/. Restores public/sitemap.xml.
set -euo pipefail
cd "$(dirname "$0")/.."
# On failure: restore the sitemap and remove out/ so a missing out/ fails loudly
# (never leave a flag-on or half-built out/ for the default suite).
trap 'rc=$?; git checkout -- public/sitemap.xml || true; if [ $rc -ne 0 ]; then rm -rf out; fi; exit $rc' EXIT
NEXT_PUBLIC_VIDEOS=1 pnpm build
rm -rf out-videos && mv out out-videos
pnpm build
git checkout -- public/sitemap.xml
