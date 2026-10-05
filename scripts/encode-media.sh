#!/usr/bin/env bash
# Web encodes of the am-i.exposed videos for the GitHub Pages site (public/media).
# Usage: scripts/encode-media.sh ~/Videos/am-i-exposed
set -euo pipefail
SRC="${1:?masters directory}"; OUT="$(dirname "$0")/../public/media"; mkdir -p "$OUT"
enc() { # in out scale crf audio
  ffmpeg -nostdin -y -loglevel error -i "$1" -vf "scale=$3:flags=lanczos,fps=30" \
    -c:v libx264 -profile:v high -preset slow -crf "$4" -pix_fmt yuv420p \
    $5 -movflags +faststart "$OUT/$2.mp4"
}
poster() { ffmpeg -nostdin -y -loglevel error -ss "$3" -i "$OUT/$1.mp4" -frames:v 1 -c:v libwebp -quality 80 "$OUT/$2.webp"; }
for L in en es; do
  enc "$SRC/am-i-exposed-$L-16x9.mp4" "promo-$L-16x9" 1280:720 "${PROMO_CRF:-22}" "-c:a aac -b:a 128k"
  enc "$SRC/am-i-exposed-$L-9x16.mp4" "promo-$L-9x16" 720:1280 "${PROMO_CRF:-22}" "-c:a aac -b:a 128k"
  enc "$SRC/tutorial/tutorial-$L-16x9.mp4" "tutorial-$L-16x9" 1280:720 "${TUT_CRF:-23}" "-c:a aac -b:a 96k -ac 1"
  poster "promo-$L-16x9" "promo-$L-16x9" "${PROMO_POSTER_T:-44}"
  poster "promo-$L-9x16" "promo-$L-9x16" "${PROMO_POSTER_T:-44}"
  poster "tutorial-$L-16x9" "tutorial-$L-16x9" "${TUT_POSTER_T:-110}"
  # SRT -> WebVTT (comma -> dot in timestamps)
  { echo "WEBVTT"; echo; sed -E 's/([0-9]{2}:[0-9]{2}:[0-9]{2}),([0-9]{3})/\1.\2/g' "$SRC/tutorial/tutorial-$L.srt" | tr -d '\r'; } > "$OUT/tutorial-$L.vtt"
done
ls -la "$OUT"
