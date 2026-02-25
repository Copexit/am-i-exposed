#!/bin/bash
# Submit URLs to IndexNow after deployment
# Supported engines: Bing, Yandex, Naver
API_KEY="29dadd2b-9bd0-4e5e-afb9-8e0c12f88ba9"
HOST="am-i.exposed"
URLS=(
  "https://$HOST/"
  "https://$HOST/methodology/"
  "https://$HOST/setup-guide/"
)

echo "Submitting ${#URLS[@]} URLs to IndexNow..."
for url in "${URLS[@]}"; do
  response=$(curl -s -o /dev/null -w "%{http_code}" "https://api.indexnow.org/indexnow?url=${url}&key=${API_KEY}")
  echo "  $url -> HTTP $response"
done
echo "Done."
