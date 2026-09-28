/**
 * Validate and normalize a user-entered custom mempool API URL.
 *
 * Trims whitespace and trailing slashes (requests are built as
 * `${url}/blocks/tip/height`), then requires an absolute http(s) URL with a
 * host. Returns the normalized string, or null when the input is not usable.
 * Relative paths, bare hostnames and other schemes (data:, javascript:) are
 * rejected so they can never be fetched against the page origin.
 */
export function normalizeApiUrl(input: string): string | null {
  const trimmed = input.trim().replace(/\/+$/, "");
  // Require an explicit scheme: new URL("http:host") would otherwise parse
  if (!/^https?:\/\/[^/]/i.test(trimmed)) return null;
  try {
    const { hostname } = new URL(trimmed);
    return hostname ? trimmed : null;
  } catch {
    return null;
  }
}
