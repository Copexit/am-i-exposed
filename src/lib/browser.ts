/**
 * Whether the browser is Brave (any mode).
 * Brave exposes navigator.brave with an isBrave() method.
 */
export function isBraveBrowser(): boolean {
  // Typed structurally: the CLI compiles src/lib without the DOM lib.
  const nav = (globalThis as { navigator?: object }).navigator;
  return !!nav && "brave" in nav;
}
