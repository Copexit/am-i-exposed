"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { ConnectionBadge } from "@/components/ConnectionBadge";
import { ApiSettings } from "@/components/ApiSettings";
import { useDevMode } from "@/hooks/useDevMode";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { V2PrivacyNotice } from "./V2PrivacyNotice";
import { V2_NAV, isNavActive, classicHref, graphHref } from "./nav";
import { useLocationHash } from "./useLocationHash";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bitcoin";

export function V2Header() {
  const { t } = useTranslation();
  const pathname = usePathname() ?? "/v2/";
  const router = useRouter();
  const hash = useLocationHash();
  const { devMode, toggleDevMode } = useDevMode();
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const clicks = useRef(0);
  const clickTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Keeps Tab inside bar + sheet while open, and returns focus to the toggle on close.
  useFocusTrap(headerRef, open);

  // Publish the header's live height (bar + privacy notice) for sticky elements below it.
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const root = document.documentElement;
    const ro = new ResizeObserver(() => root.style.setProperty("--v2-header-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => { ro.disconnect(); root.style.removeProperty("--v2-header-h"); };
  }, []);

  useEffect(() => () => clearTimeout(clickTimer.current), []);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const mq = window.matchMedia("(min-width: 768px)");
    const onWide = () => { if (mq.matches) setOpen(false); };
    document.addEventListener("keydown", onKey);
    mq.addEventListener("change", onWide);
    return () => {
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onWide);
    };
  }, [open]);

  const onLogo = () => {
    // 5 rapid clicks (within 2s) toggle dev mode; otherwise go home and reset any scan.
    clicks.current++;
    if (clicks.current >= 5) {
      toggleDevMode();
      clicks.current = 0;
    } else if (window.location.pathname.replace(/\/$/, "") !== "/v2") {
      router.push("/v2/");
    } else {
      window.location.hash = "";
    }
    setOpen(false);
    clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => { clicks.current = 0; }, 2000);
  };

  const navLabel = (key: string, label: string) => t(key, { defaultValue: label });
  const hrefFor = (href: string) => (href === "/v2/graph/" ? graphHref(pathname, hash) : href);
  const classic = classicHref(pathname, hash);

  return (
    <header
      ref={headerRef}
      className="sticky top-0 z-40 border-b border-hairline bg-background/75 backdrop-blur-md"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="mx-auto max-w-[1360px] h-14 lg:h-16 flex items-center gap-4 lg:gap-8 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onLogo}
            aria-label={t("common.homeLink", { defaultValue: "am-i.exposed home" })}
            className={`rounded-md text-[17px] font-semibold tracking-tight text-foreground select-none whitespace-nowrap cursor-pointer hover:opacity-80 transition-opacity ${FOCUS}`}
          >
            am-i.<span className="text-bitcoin">exposed</span>
          </button>
          <span className="rounded-full border border-hairline-strong px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.08em] text-muted select-none">
            {t("v2.chrome.beta", { defaultValue: "Beta" })}
          </span>
          {devMode && (
            <span className="rounded px-1.5 py-px font-mono text-[10px] font-semibold text-severity-medium bg-severity-medium/15">DEV</span>
          )}
        </div>

        <nav aria-label={t("common.mainNavigation", { defaultValue: "Main navigation" })} className="hidden md:flex items-center gap-0.5 min-w-0">
          {V2_NAV.map((item) => {
            const active = isNavActive(item.href, pathname);
            return (
              <Link
                key={item.href}
                href={hrefFor(item.href)}
                aria-current={active ? "page" : undefined}
                className={`relative whitespace-nowrap rounded-lg px-2 lg:px-3 py-2 text-[14px] transition-colors ${FOCUS} ${
                  active ? "text-foreground" : "text-muted hover:text-foreground"
                }`}
              >
                {navLabel(item.key, item.label)}
                {active && (
                  <motion.span
                    layoutId="v2-nav-active"
                    aria-hidden="true"
                    className="absolute left-2 right-2 lg:left-3 lg:right-3 -bottom-[11px] lg:-bottom-[15px] h-px bg-bitcoin"
                    transition={{ type: "spring", stiffness: 420, damping: 36 }}
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <ConnectionBadge />
          <ApiSettings v2 />
          <Link
            href={classic}
            title={t("v2.chrome.classicTitle", { defaultValue: "Switch to the classic interface" })}
            className={`hidden md:inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-[13px] text-muted hover:text-foreground transition-colors whitespace-nowrap ${FOCUS}`}
          >
            {t("v2.chrome.classic", { defaultValue: "Classic" })}
            <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? t("common.closeMenu", { defaultValue: "Close menu" }) : t("common.openMenu", { defaultValue: "Open menu" })}
            aria-expanded={open}
            aria-controls="v2-mobile-nav"
            className={`md:hidden -mr-2 inline-flex size-11 items-center justify-center rounded-lg text-muted hover:text-foreground transition-colors cursor-pointer ${FOCUS}`}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* md+ keeps the one-line notice in the sticky bar; phones render it in flow (V2Layout) so it never covers content. */}
      <div className="hidden md:block"><V2PrivacyNotice /></div>

      <AnimatePresence>
        {open && (
          <motion.nav
            key="v2-mobile-nav"
            id="v2-mobile-nav"
            aria-label={t("common.mobileNavigation", { defaultValue: "Mobile navigation" })}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="md:hidden absolute inset-x-0 top-full h-[calc(100dvh-100%)] overflow-y-auto overscroll-contain border-t border-hairline bg-background px-4 pt-2"
            style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
          >
            <ul className="divide-y divide-hairline">
              {V2_NAV.map((item) => {
                const active = isNavActive(item.href, pathname);
                return (
                  <li key={item.href}>
                    <Link
                      href={hrefFor(item.href)}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={`flex min-h-14 items-center justify-between rounded-md text-[20px] tracking-tight ${FOCUS} ${
                        active ? "text-foreground" : "text-muted"
                      }`}
                    >
                      {navLabel(item.key, item.label)}
                      {active && <span className="size-1.5 rounded-full bg-bitcoin" aria-hidden="true" />}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-6 border-t border-hairline pt-6">
              {/* Settings stay reachable via the gear in the bar above (it remains visible while open). */}
              <Link
                href={classic}
                onClick={() => setOpen(false)}
                className={`flex min-h-12 items-center justify-between rounded-lg border border-hairline bg-surface-1 px-4 text-[15px] text-foreground ${FOCUS}`}
              >
                {t("v2.chrome.backToClassic", { defaultValue: "Back to classic" })}
                <ArrowUpRight size={16} className="text-muted" aria-hidden="true" />
              </Link>
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
