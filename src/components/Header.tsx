"use client";

import { NetworkSelector } from "./NetworkSelector";
import { ConnectionBadge } from "./ConnectionBadge";
import { ApiSettings } from "./ApiSettings";

export function Header() {
  const handleLogoClick = () => {
    window.location.hash = "";
  };

  return (
    <header className="sticky top-0 z-50 border-b border-card-border bg-background/80 backdrop-blur-md">
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 max-w-6xl mx-auto w-full">
        <button
          onClick={handleLogoClick}
          aria-label="am-i.exposed home"
          className="flex items-center gap-2 group hover:opacity-80 transition-opacity cursor-pointer"
        >
          <span className="text-xl sm:text-2xl font-bold tracking-tight text-foreground select-none">
            am-i.<span className="text-danger">exposed</span>
          </span>
        </button>
        <div className="flex items-center gap-3">
          <ConnectionBadge />
          <ApiSettings />
          <NetworkSelector />
        </div>
      </div>
    </header>
  );
}
