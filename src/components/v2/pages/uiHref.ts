import { usePathname } from "next/navigation";
import { isV2Path, V2_PREFIX } from "@/lib/v2/paths";

/**
 * A site-internal href ("/", "/guide/", "/#tx=...") kept inside the UI the
 * current pathname belongs to. Classic pathnames get the href unchanged.
 */
export function uiHref(href: string, pathname: string | null | undefined): string {
  if (!isV2Path(pathname) || !href.startsWith("/") || href.startsWith("//") || isV2Path(href.split("#")[0])) return href;
  return `${V2_PREFIX}${href}`;
}

/** Hook form of uiHref bound to the current pathname. */
export function useUiHref(): (href: string) => string {
  const pathname = usePathname();
  return (href) => uiHref(href, pathname);
}
