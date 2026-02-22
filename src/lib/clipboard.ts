/**
 * Copy text to clipboard with fallback for HTTP environments.
 * navigator.clipboard.writeText() requires a secure context (HTTPS).
 * Falls back to legacy document.execCommand("copy") for HTTP (Umbrel/Start9).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Secure context may still throw - fall through to legacy
    }
  }

  // Fallback for HTTP environments
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
    return true;
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}
