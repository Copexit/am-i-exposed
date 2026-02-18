# TODO: Custom mempool.space API URL

## What
Let advanced users point the tool at their own mempool.space instance (local or remote) instead of the public one. Privacy-conscious users run their own node + mempool and don't want to leak queries to mempool.space.

## UX
- **NOT in your face** — this is for power users only
- Small gear/settings icon in the footer or header, or a collapsible "Advanced" section below the input
- Clicking opens a minimal panel with a single text field: "Custom API endpoint"
- Placeholder: `https://mempool.space/api` (the default)
- Persist in localStorage so it survives page reloads
- Show a small badge/indicator when a custom endpoint is active (so the user knows they're not hitting the default)
- A "Reset to default" link to clear

## Implementation
- Store in localStorage key: `ami-custom-api-url`
- Validate: must be a URL, should respond to `/api/blocks/tip/height` (quick health check)
- Pass through to the existing API client (`src/lib/api/client.ts` or `src/lib/api/mempool.ts`)
- Fallback behavior: if custom endpoint fails, ask user — don't silently fall back to public (that would defeat the privacy purpose)
- Update CSP in layout.tsx to allow `connect-src` to any https origin when custom URL is set (or use a meta tag override)

## Examples of custom endpoints
- `http://localhost:8999/api` — local mempool instance
- `http://umbrel.local:3006/api` — Umbrel node
- `https://mempool.mydomain.com/api` — self-hosted remote
- `http://mempoolhqx4isw62xs7abwphsq7ldvnlk5.onion/api` — Tor

## CSP consideration
The current CSP only allows `connect-src` to mempool.space and blockstream.info. A custom URL needs to either:
1. Relax CSP when custom URL is set (via JS, not meta tag — meta tags are static)
2. Or remove the connect-src restriction entirely and rely on the user's judgment

Option 2 is simpler and fine for a privacy tool aimed at technical users.
