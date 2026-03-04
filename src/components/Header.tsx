"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { Menu, X, BookOpen, HelpCircle, FileText, Info } from "lucide-react";
import { ConnectionBadge } from "./ConnectionBadge";
import { ApiSettings } from "./ApiSettings";
import { useDevMode } from "@/hooks/useDevMode";

const NAV_ITEMS = [
  { href: "/methodology/", labelKey: "common.methodology", labelDefault: "Methodology", icon: FileText },
  { href: "/faq/", labelKey: "common.faq", labelDefault: "FAQ", icon: HelpCircle },
  { href: "/glossary/", labelKey: "common.glossary", labelDefault: "Glossary", icon: BookOpen },
  { href: "/about/", labelKey: "common.about", labelDefault: "About", icon: Info },
];

export function Header() {
  const { t } = useTranslation();
  const currentPath = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { devMode, toggleDevMode } = useDevMode();
  const clickCount = useRef(0);
  const clickTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  // Clear dev-mode click timer on unmount
  useEffect(() => () => clearTimeout(clickTimer.current), []);

  // Close mobile menu on Escape key
  useEffect(() => {
    if (!mobileOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen]);

  const isActive = (href: string) => {
    const normalized = currentPath.replace(/\/$/, "") || "/";
    const target = href.replace(/\/$/, "") || "/";
    return normalized === target;
  };

  return (
    <>
      <header
        className="fixed top-0 w-full sm:top-3 sm:left-1/2 sm:-translate-x-1/2 sm:max-w-5xl sm:w-[calc(100%-2rem)] sm:rounded-2xl z-50 border-b sm:border-b-0 border-glass-border glass"
        style={{
          backdropFilter: "blur(16px) saturate(180%)",
          WebkitBackdropFilter: "blur(16px) saturate(180%)",
          borderTop: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        <div className="flex items-center justify-between px-4 sm:px-6 py-4">
          <div className="flex items-center">
            <button
              onClick={() => {
                // Track rapid clicks for dev mode toggle (5 clicks within 2s)
                clickCount.current++;
                if (clickCount.current >= 5) {
                  toggleDevMode();
                  clickCount.current = 0;
                } else {
                  // Normal navigation on non-5th clicks
                  if (window.location.pathname !== "/") {
                    window.location.href = "/";
                  } else {
                    window.location.hash = "";
                  }
                }
                clearTimeout(clickTimer.current);
                clickTimer.current = setTimeout(() => { clickCount.current = 0; }, 2000);
              }}
              aria-label={t("common.homeLink", { defaultValue: "am-i.exposed home" })}
              className="flex items-center gap-2 group hover:opacity-80 transition-opacity cursor-pointer"
            >
              <span className="text-xl sm:text-2xl font-bold tracking-tight text-foreground select-none whitespace-nowrap">
                am-i.<span className="gradient-text">exposed</span>
              </span>
              {devMode && (
                <span className="text-[10px] font-bold text-severity-medium bg-severity-medium/15 px-1.5 py-0.5 rounded">
                  DEV
                </span>
              )}
            </button>

            {/* Desktop nav */}
            <nav className="hidden sm:flex items-center gap-0.5 ml-4 relative" aria-label="Main navigation">
              {NAV_ITEMS.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`relative text-sm px-3 py-2 rounded-lg transition-colors ${
                      active
                        ? "text-foreground"
                        : "text-muted hover:text-foreground hover:bg-foreground/5"
                    }`}
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-active"
                        className="absolute inset-0 bg-bitcoin/15 border border-bitcoin/30 rounded-lg"
                        transition={{ type: "spring", stiffness: 380, damping: 30 }}
                      />
                    )}
                    <span className="relative z-10">
                      {t(item.labelKey, { defaultValue: item.labelDefault })}
                    </span>
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <ConnectionBadge />
            <ApiSettings />
            {/* Mobile hamburger */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label={mobileOpen ? t("common.closeMenu", { defaultValue: "Close menu" }) : t("common.openMenu", { defaultValue: "Open menu" })}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
              className="sm:hidden flex items-center justify-center w-11 h-11 rounded-lg text-muted hover:text-foreground transition-colors cursor-pointer"
            >
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </header>

      {/* Mobile menu overlay */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 sm:hidden"
          >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setMobileOpen(false)}
              aria-hidden="true"
            />
            {/* Menu panel */}
            <motion.nav
              id="mobile-nav"
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -10, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute top-[72px] left-0 right-0 mx-4 rounded-xl border border-glass-border glass p-2 space-y-1"
              style={{
                backdropFilter: "blur(16px) saturate(180%)",
                WebkitBackdropFilter: "blur(16px) saturate(180%)",
                background: "var(--card-bg)",
              }}
              aria-label="Mobile navigation"
            >
              {NAV_ITEMS.map((item) => {
                const active = isActive(item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-colors ${
                      active
                        ? "text-bitcoin bg-bitcoin/10"
                        : "text-muted hover:text-foreground hover:bg-surface-elevated/50"
                    }`}
                  >
                    <Icon size={16} />
                    {t(item.labelKey, { defaultValue: item.labelDefault })}
                  </Link>
                );
              })}
            </motion.nav>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
