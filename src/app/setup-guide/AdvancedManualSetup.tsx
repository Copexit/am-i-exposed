"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, ChevronDown } from "lucide-react";
import { CopyButton } from "@/components/ui/CopyButton";
import { useTranslation } from "react-i18next";
import { CORS_SNIPPET } from "./setup-guide-data";
import {
  UmbrelManualSection,
  Start9ManualSection,
  DockerSection,
  CorsProxySection,
} from "./PlatformSections";
import { TroubleshootingSection } from "./TroubleshootingSection";

/**
 * Collapsed disclosure holding every manual/advanced path (CORS headers, SSH
 * tunnel, website-instead-of-app, Docker, bare metal, CORS proxy,
 * troubleshooting). The official Umbrel/StartOS one-click apps handle all of
 * this automatically, so it stays out of the way for the ~99% who do not need it.
 */
export function AdvancedManualSetup() {
  const { t } = useTranslation();
  const detailsRef = useRef<HTMLDetailsElement>(null);

  // A native <details> does not auto-open when an in-page anchor targets a
  // descendant. The TOC "Advanced Setup" link (#advanced) plus the buried
  // section anchors (#cors, #ssh-tunnel, #start9-manual, #docker, etc.) all
  // live in here, so open the disclosure and scroll to the target whenever the
  // hash points at it or anything inside it - on load and on later hash changes.
  useEffect(() => {
    const el = detailsRef.current;
    if (!el) return;
    const reveal = () => {
      const hash = window.location.hash;
      if (hash.length < 2) return;
      let target: Element | null = null;
      try {
        target = document.querySelector(hash);
      } catch {
        return; // malformed selector
      }
      if (target && el.contains(target)) {
        el.open = true;
        target.scrollIntoView({ block: "start" });
      }
    };
    reveal();
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, []);

  return (
    <details
      id="advanced"
      ref={detailsRef}
      className="group border border-card-border rounded-xl overflow-hidden"
    >
      <summary className="flex items-start justify-between gap-3 cursor-pointer select-none px-6 py-5 hover:bg-foreground/5 transition-colors list-none [&::-webkit-details-marker]:hidden">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("setup.advanced_title", { defaultValue: "Advanced: manual setup" })}
          </h2>
          <p className="text-sm text-muted leading-relaxed">
            {t("setup.advanced_intro", { defaultValue: "Running the official Umbrel or StartOS app handles all of this automatically. These steps are only for Docker, bare-metal, or custom mempool setups - or if you prefer the am-i.exposed website over the native app." })}
          </p>
        </div>
        <ChevronDown
          size={22}
          className="shrink-0 mt-1 text-muted transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>

      <div className="px-4 sm:px-6 pb-6 pt-4 space-y-8 border-t border-card-border">
        {/* Two things must be true */}
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-5 flex gap-3">
          <AlertTriangle size={20} className="text-warning shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-foreground font-medium text-sm">
              {t("setup.manual_warning_title", { defaultValue: "Two things must be true for manual setup" })}
            </p>
            <ol className="text-muted text-sm leading-relaxed space-y-1 list-decimal list-inside">
              <li>{t("setup.manual_warning_1", { defaultValue: "Your mempool instance must have CORS headers enabled (mempool does not include them by default)" })}</li>
              <li>{t("setup.manual_warning_2", { defaultValue: "Your URL must end with /api (e.g., http://localhost:3006/api)" })}</li>
            </ol>
          </div>
        </div>

        {/* CORS headers */}
        <section id="cors" className="space-y-4">
          <h3 className="text-xl font-semibold text-foreground">
            {t("setup.cors_title", { defaultValue: "Step 1: Add CORS Headers" })}
          </h3>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-4">
            <p className="text-muted leading-relaxed">
              {t("setup.cors_p1", { defaultValue: "This is the #1 reason connections fail. Mempool's nginx config does not include CORS headers by default. Without them, your browser silently blocks every API response - even if the network connection is working perfectly." })}
            </p>
            <p className="text-muted leading-relaxed">
              {t("setup.cors_p2", { defaultValue: "Add these lines to your mempool nginx config, inside the existing location /api/ { } block:" })}
            </p>
            <div className="relative">
              <pre className="bg-surface-inset rounded-lg p-3 text-xs font-mono overflow-x-auto whitespace-pre leading-relaxed">
                {CORS_SNIPPET}
              </pre>
              <CopyButton text={CORS_SNIPPET} />
            </div>
            <p className="text-muted leading-relaxed">
              {t("setup.cors_reload", { defaultValue: "After editing, reload nginx:" })}
            </p>
            <pre className="bg-surface-inset rounded-lg p-3 text-xs font-mono overflow-x-auto">
              nginx -s reload
            </pre>
            <p className="text-muted text-sm leading-relaxed">
              {t("setup.cors_platform_note", { defaultValue: "Where to find the nginx config depends on your platform - see the platform-specific sections below." })}
            </p>
          </div>
        </section>

        {/* SSH tunnel */}
        <section id="ssh-tunnel" className="space-y-4">
          <h3 className="text-xl font-semibold text-foreground">
            {t("setup.ssh_title", { defaultValue: "Step 2: SSH Tunnel" })}
          </h3>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-4">
            <p className="text-muted leading-relaxed">
              {t("setup.ssh_p1", { defaultValue: "This site is served over HTTPS. Browsers block HTTP requests from HTTPS pages (called mixed content) unless the target is localhost. An SSH tunnel forwards your node's mempool port to localhost on your machine, bypassing this restriction." })}
            </p>
            <div className="space-y-3">
              <p className="text-muted leading-relaxed">
                {t("setup.ssh_run", { defaultValue: "Open a terminal and run:" })}
              </p>
              <div className="relative">
                <pre className="bg-surface-inset rounded-lg p-3 text-xs font-mono overflow-x-auto">
                  ssh -L 3006:localhost:3006 user@your-node-ip
                </pre>
                <CopyButton text="ssh -L 3006:localhost:3006 user@your-node-ip" />
              </div>
              <p className="text-muted leading-relaxed">
                {t("setup.ssh_replace", { defaultValue: "Replace user@your-node-ip with your node's SSH credentials. This maps port 3006 on your desktop to port 3006 on your node." })}
              </p>
              <p className="text-muted leading-relaxed">
                {t("setup.ssh_settings", { defaultValue: "Then in the am-i.exposed settings (the gear icon), enter:" })}
              </p>
              <pre className="bg-surface-inset rounded-lg p-3 text-sm font-mono overflow-x-auto text-bitcoin">
                http://localhost:3006/api
              </pre>
              <div className="bg-surface-inset rounded-lg p-3 text-xs text-muted leading-relaxed">
                {t("setup.ssh_keep_open", { defaultValue: "Keep the terminal open while using the site. The tunnel stays active as long as the SSH session is running. You can add -N to the SSH command to skip opening a shell (e.g., ssh -N -L 3006:localhost:3006 ...)." })}
              </div>
            </div>
          </div>
        </section>

        <UmbrelManualSection />
        <Start9ManualSection />
        <DockerSection />
        <CorsProxySection />
        <TroubleshootingSection />
      </div>
    </details>
  );
}
