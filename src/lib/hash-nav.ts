/**
 * Set the URL hash and fire `hashchange`, like `location.hash = x` does, but
 * through the History API. Next's app router stamps its state onto entries
 * created by `history.pushState`; entries created by a plain hash assignment
 * carry no state, so browser Back from another page to them left the old page
 * rendered. `replace` rewrites the current entry instead of adding one.
 */
export function setHash(hash: string, { replace = false }: { replace?: boolean } = {}): void {
  const next = hash.replace(/^#/, "");
  // Same as a hash assignment: setting the current hash is a no-op.
  if (window.location.hash.slice(1) === next) return;
  const oldURL = window.location.href;
  const { pathname, search } = window.location;
  const url = next ? `#${next}` : pathname + search;
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
  window.dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL: window.location.href }));
}
