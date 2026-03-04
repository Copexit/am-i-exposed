"use client";

import Link from "next/link";
import { ArrowLeft, AlertTriangle, Terminal, Shield, Globe, Copy } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "@/lib/clipboard";

function CopyButton({ text }: { text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        const ok = await copyToClipboard(text);
        if (ok) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
      }}
      className="absolute top-2 right-2 text-muted hover:text-foreground transition-colors cursor-pointer p-1 rounded bg-surface-elevated/50"
      aria-label={t("common.copy", { defaultValue: "Copy" })}
    >
      <Copy size={12} />
      {copied && (
        <span className="absolute -top-6 right-0 text-[10px] text-severity-good whitespace-nowrap">
          {t("common.copied", { defaultValue: "Copied" })}
        </span>
      )}
    </button>
  );
}

const CORS_SNIPPET = `# Add these lines inside your existing location /api/ { } block
add_header 'Access-Control-Allow-Origin' '*' always;
add_header 'Access-Control-Allow-Methods' 'GET, OPTIONS' always;
if ($request_method = 'OPTIONS') {
  return 204;
}`;

const CADDY_SNIPPET = `:8090 {
  reverse_proxy localhost:3006
  header Access-Control-Allow-Origin *
  header Access-Control-Allow-Methods "GET, OPTIONS"
  @options method OPTIONS
  respond @options 204
}`;

export default function SetupGuidePage() {
  const { t } = useTranslation();

  return (
    <div className="flex-1 flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-4xl space-y-10">
        {/* Back nav */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors py-2 -my-2"
        >
          <ArrowLeft size={16} />
          {t("setup.back", { defaultValue: "Back to scanner" })}
        </Link>

        {/* Title */}
        <div className="space-y-3">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            {t("setup.title", { defaultValue: "Connect Your Node" })}
          </h1>
          <p className="text-muted text-lg leading-relaxed max-w-2xl">
            {t("setup.subtitle", { defaultValue: "Point am-i.exposed at your own mempool instance for maximum privacy. This guide covers Umbrel, Start9, Docker, and bare-metal setups." })}
          </p>
        </div>

        {/* Table of contents */}
        <nav className="flex flex-wrap gap-2 text-xs" aria-label={t("setup.tocLabel", { defaultValue: "Page sections" })}>
          {[
            { label: t("setup.toc_why", { defaultValue: "Why Self-Host" }), id: "why" },
            { label: t("setup.toc_umbrel", { defaultValue: "Umbrel App" }), id: "umbrel" },
            { label: t("setup.toc_manual", { defaultValue: "Manual Setup" }), id: "manual" },
            { label: t("setup.toc_start9", { defaultValue: "Start9" }), id: "start9" },
            { label: t("setup.toc_docker", { defaultValue: "Docker" }), id: "docker" },
            { label: t("setup.toc_cors", { defaultValue: "CORS Proxy" }), id: "cors-proxy" },
            { label: t("setup.toc_tor", { defaultValue: "Tor + .onion" }), id: "tor" },
            { label: t("setup.toc_troubleshooting", { defaultValue: "Troubleshooting" }), id: "troubleshooting" },
          ].map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="px-2.5 py-2.5 rounded-lg bg-surface-elevated/50 border border-card-border/50 text-muted hover:text-foreground hover:border-bitcoin/30 transition-all"
            >
              {s.label}
            </a>
          ))}
        </nav>

        {/* Why self-host */}
        <section id="why" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("setup.why_title", { defaultValue: "Why Self-Host?" })}
          </h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-4">
            <p className="text-muted leading-relaxed">
              {t("setup.why_p1", { defaultValue: "When you use the public mempool.space API, their servers see your IP address and every address and transaction you query. This creates a log linking your network identity to your Bitcoin activity." })}
            </p>
            <p className="text-muted leading-relaxed">
              {t("setup.why_p2", { defaultValue: "By pointing am-i.exposed at your own node, API requests never leave your local network." })}
            </p>
          </div>
        </section>

        {/* Umbrel - recommended */}
        <section id="umbrel" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Terminal size={22} />
            {t("setup.umbrel_title", { defaultValue: "Umbrel" })}
          </h2>

          <div className="bg-card-bg border border-bitcoin/30 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-bitcoin bg-bitcoin/10 px-2 py-0.5 rounded">
                {t("setup.recommended", { defaultValue: "Recommended" })}
              </span>
            </div>
            <h3 className="text-lg font-semibold text-foreground">
              {t("setup.umbrel_app_title", { defaultValue: "Install the Umbrel App" })}
            </h3>
            <p className="text-muted leading-relaxed">
              {t("setup.umbrel_app_desc", { defaultValue: "The easiest way. Install am-i.exposed directly on your Umbrel and it automatically connects to your local mempool instance. No CORS headers, no SSH tunnel, no configuration needed." })}
            </p>
            <ol className="space-y-2 text-muted leading-relaxed">
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0 font-bold">1.</span>
                <span>
                  {t("setup.umbrel_step1", { defaultValue: "Open your Umbrel dashboard and go to the App Store" })}
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0 font-bold">2.</span>
                <span>
                  {t("setup.umbrel_step2", { defaultValue: "Click the three-dot menu (top right) and select Community App Stores" })}
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0 font-bold">3.</span>
                <span>
                  {t("setup.umbrel_step3", { defaultValue: "Paste the store URL and click Add:" })}
                </span>
              </li>
            </ol>
            <div className="relative">
              <pre className="bg-surface-inset rounded-lg p-3 text-sm font-mono overflow-x-auto text-bitcoin">
                https://github.com/Copexit/copexit-umbrel-app-store
              </pre>
              <CopyButton text="https://github.com/Copexit/copexit-umbrel-app-store" />
            </div>
            <ol start={4} className="space-y-2 text-muted leading-relaxed">
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0 font-bold">4.</span>
                <span>
                  {t("setup.umbrel_step4", { defaultValue: "Find am-i.exposed in the store and click Install" })}
                </span>
              </li>
            </ol>
            <p className="text-muted leading-relaxed">
              {t("setup.umbrel_app_footer", { defaultValue: "The app detects your local mempool automatically. All API requests stay on your local network and Chainalysis lookups are routed through a built-in Tor proxy." })}
            </p>
          </div>
        </section>

        {/* Manual setup for other platforms */}
        <section id="manual" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("setup.manual_title", { defaultValue: "Manual Setup" })}
          </h2>
          <p className="text-muted leading-relaxed">
            {t("setup.manual_desc", { defaultValue: "For Start9, Docker, bare-metal, or if you prefer using the am-i.exposed website with your own node instead of the Umbrel app." })}
          </p>

          {/* Important callout */}
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
        </section>

        {/* CORS headers */}
        <section id="cors" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("setup.cors_title", { defaultValue: "Step 1: Add CORS Headers" })}
          </h2>
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
          <h2 className="text-2xl font-semibold text-foreground">
            {t("setup.ssh_title", { defaultValue: "Step 2: SSH Tunnel" })}
          </h2>
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

        {/* Umbrel manual */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Terminal size={22} />
            {t("setup.umbrel_manual_title", { defaultValue: "Umbrel (Manual)" })}
          </h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-5">
            <p className="text-muted leading-relaxed">
              {t("setup.umbrel_manual_desc", { defaultValue: "If you prefer using the am-i.exposed website instead of the Umbrel app, you can point it at your Umbrel's mempool instance. The mempool app listens on port 3006 via Umbrel's app_proxy container." })}
            </p>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">
                {t("setup.umbrel_manual_cors_title", { defaultValue: "1. Add CORS headers" })}
              </h3>
              <p className="text-muted leading-relaxed">
                {t("setup.umbrel_manual_cors_desc", { defaultValue: "SSH into your Umbrel and exec into the mempool web container:" })}
              </p>
              <div className="relative">
                <pre className="bg-surface-inset rounded-lg p-3 text-xs font-mono overflow-x-auto whitespace-pre leading-relaxed">{`ssh umbrel@umbrel.local
docker exec -it mempool_web_1 sh
vi /etc/nginx/conf.d/nginx-mempool.conf`}</pre>
                <CopyButton text="ssh umbrel@umbrel.local\ndocker exec -it mempool_web_1 sh\nvi /etc/nginx/conf.d/nginx-mempool.conf" />
              </div>
              <p className="text-muted leading-relaxed">
                {t("setup.umbrel_manual_cors_add", { defaultValue: "Find the location /api/ { block and add the CORS headers shown above. Then reload nginx inside the container:" })}
              </p>
              <pre className="bg-surface-inset rounded-lg p-3 text-xs font-mono overflow-x-auto">
                nginx -s reload
              </pre>
              <div className="bg-warning/10 rounded-lg p-3 text-xs text-warning leading-relaxed">
                <strong>{t("setup.note", { defaultValue: "Note:" })}</strong> {t("setup.umbrel_manual_docker_warning", { defaultValue: "Changes inside the Docker container are lost when the container restarts (e.g., after an Umbrel update). You will need to re-apply them after updates. For a persistent solution, mount a custom nginx config." })}
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">
                {t("setup.umbrel_manual_ssh_title", { defaultValue: "2. SSH tunnel" })}
              </h3>
              <p className="text-muted leading-relaxed">
                {t("setup.umbrel_manual_ssh_desc", { defaultValue: "From your desktop, open a terminal:" })}
              </p>
              <div className="relative">
                <pre className="bg-surface-inset rounded-lg p-3 text-xs font-mono overflow-x-auto">
                  ssh -N -L 3006:localhost:3006 umbrel@umbrel.local
                </pre>
                <CopyButton text="ssh -N -L 3006:localhost:3006 umbrel@umbrel.local" />
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">
                {t("setup.umbrel_manual_config_title", { defaultValue: "3. Configure am-i.exposed" })}
              </h3>
              <p className="text-muted leading-relaxed">
                {t("setup.umbrel_manual_config_desc", { defaultValue: "Click the gear icon in the header and enter:" })}
              </p>
              <pre className="bg-surface-inset rounded-lg p-3 text-sm font-mono overflow-x-auto text-bitcoin">
                http://localhost:3006/api
              </pre>
              <p className="text-muted leading-relaxed">
                {t("setup.umbrel_manual_config_apply", { defaultValue: "Click Apply. You should see a green checkmark if everything is configured correctly." })}
              </p>
            </div>
          </div>
        </section>

        {/* Start9 */}
        <section id="start9" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Shield size={22} />
            {t("setup.start9_title", { defaultValue: "Start9 / StartOS" })}
          </h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-4">
            <p className="text-muted leading-relaxed">
              {t("setup.start9_desc", { defaultValue: "Start9 serves mempool over HTTPS on a .local hostname with a self-signed certificate. There is no bare port to SSH tunnel to, so the approach is different from Umbrel." })}
            </p>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">
                {t("setup.start9_ca_title", { defaultValue: "1. Install the StartOS root CA" })}
              </h3>
              <p className="text-muted leading-relaxed">
                {t("setup.start9_ca_desc", { defaultValue: "Your browser needs to trust the StartOS certificate authority. Download the CA from your StartOS dashboard and install it in your system/browser trust store. Without this, HTTPS requests to your .local address will fail." })}
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">
                {t("setup.start9_cors_title", { defaultValue: "2. Add CORS headers" })}
              </h3>
              <p className="text-muted leading-relaxed">
                {t("setup.start9_cors_desc", { defaultValue: "SSH into your Start9 and edit the mempool nginx config to add the CORS headers shown above. The process is similar to Umbrel - find the running mempool container and edit its nginx config." })}
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">
                {t("setup.start9_config_title", { defaultValue: "3. Configure am-i.exposed" })}
              </h3>
              <p className="text-muted leading-relaxed">
                {t("setup.start9_config_desc", { defaultValue: "Use your mempool's LAN address in the settings:" })}
              </p>
              <pre className="bg-surface-inset rounded-lg p-3 text-sm font-mono overflow-x-auto text-bitcoin">
                {"https://<your-mempool-hostname>.local/api"}
              </pre>
              <p className="text-muted leading-relaxed">
                {t("setup.start9_config_replace", { defaultValue: "Replace <your-mempool-hostname> with the hostname shown in your StartOS dashboard for the mempool service." })}
              </p>
            </div>
          </div>
        </section>

        {/* Docker */}
        <section id="docker" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Terminal size={22} />
            {t("setup.docker_title", { defaultValue: "Docker / Bare Metal" })}
          </h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-4">
            <p className="text-muted leading-relaxed">
              {t("setup.docker_desc", { defaultValue: "If you run the official mempool/mempool Docker image or a bare-metal installation:" })}
            </p>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">Docker</h3>
              <p className="text-muted leading-relaxed">
                {t("setup.docker_setup_desc", { defaultValue: "The default Docker setup maps the frontend nginx to port 80 (or whichever port you configured). To persist CORS headers, mount a custom nginx config:" })}
              </p>
              <div className="relative">
                <pre className="bg-surface-inset rounded-lg p-3 text-xs font-mono overflow-x-auto whitespace-pre leading-relaxed">{`# Copy the default config out of the container
docker cp mempool_frontend_1:/etc/nginx/conf.d/nginx-mempool.conf ./nginx-mempool.conf

# Edit it to add CORS headers (see Step 1 above)

# Restart with the custom config mounted
docker run -v $(pwd)/nginx-mempool.conf:/etc/nginx/conf.d/nginx-mempool.conf ...`}</pre>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">
                {t("setup.bare_metal_title", { defaultValue: "Bare metal" })}
              </h3>
              <p className="text-muted leading-relaxed">
                {t("setup.bare_metal_desc", { defaultValue: "Edit your mempool nginx config directly. The default location is typically /etc/nginx/conf.d/nginx-mempool.conf or wherever you placed it during installation." })}
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">
                {t("setup.remote_access_title", { defaultValue: "Remote access" })}
              </h3>
              <p className="text-muted leading-relaxed">
                {t("setup.remote_access_desc", { defaultValue: "If your node is on the same machine, use http://localhost:<port>/api directly. If it is on another machine on your network, use an SSH tunnel as described above." })}
              </p>
            </div>
          </div>
        </section>

        {/* Local CORS proxy alternative */}
        <section id="cors-proxy" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("setup.cors_proxy_title", { defaultValue: "Alternative: Local CORS Proxy" })}
          </h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-4">
            <p className="text-muted leading-relaxed">
              {t("setup.cors_proxy_desc", { defaultValue: "If you cannot or do not want to modify your node's nginx config, you can run a small reverse proxy on your desktop that adds CORS headers. This sits between your browser and the SSH tunnel." })}
            </p>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">
                {t("setup.caddy_title", { defaultValue: "Using Caddy" })}
              </h3>
              <p className="text-muted leading-relaxed">
                {t("setup.caddy_desc", { defaultValue: "Caddy is a single-binary web server. Create a file called Caddyfile:" })}
              </p>
              <div className="relative">
                <pre className="bg-surface-inset rounded-lg p-3 text-xs font-mono overflow-x-auto whitespace-pre leading-relaxed">
                  {CADDY_SNIPPET}
                </pre>
                <CopyButton text={CADDY_SNIPPET} />
              </div>
              <p className="text-muted leading-relaxed">
                {t("setup.caddy_run", { defaultValue: "Then run caddy run in the same directory. In am-i.exposed settings, enter:" })}
              </p>
              <pre className="bg-surface-inset rounded-lg p-3 text-sm font-mono overflow-x-auto text-bitcoin">
                http://localhost:8090/api
              </pre>
              <p className="text-muted text-sm leading-relaxed">
                {t("setup.caddy_flow", { defaultValue: "The flow: browser -> Caddy (:8090, adds CORS) -> SSH tunnel (:3006) -> your node's mempool." })}
              </p>
            </div>
          </div>
        </section>

        {/* Tor */}
        <section id="tor" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Globe size={22} />
            {t("setup.tor_title", { defaultValue: "Alternative: Tor Browser + .onion" })}
          </h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-4">
            <p className="text-muted leading-relaxed">
              {t("setup.tor_p1", { defaultValue: "If both am-i.exposed and your mempool instance are accessed via .onion addresses in Tor Browser, there is no mixed-content blocking (both are HTTP) and Tor Browser relaxes CORS restrictions for .onion-to-.onion requests." })}
            </p>
            <p className="text-muted leading-relaxed">
              {t("setup.tor_p2", { defaultValue: "This requires a .onion mirror of am-i.exposed. If one is available, use Tor Browser to visit the .onion URL, then enter your mempool's .onion address in the settings." })}
            </p>
            <p className="text-muted leading-relaxed">
              {t("setup.tor_p3", { defaultValue: "You still need CORS headers on your mempool nginx if the .onion addresses differ (which they will, since they are separate hidden services)." })}
            </p>
          </div>
        </section>

        {/* Troubleshooting */}
        <section id="troubleshooting" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("setup.troubleshooting_title", { defaultValue: "Troubleshooting" })}
          </h2>
          <div className="space-y-3">
            {[
              {
                error: t("setup.ts_cors_error", { defaultValue: "\"Connection failed\" after setting up SSH tunnel" }),
                cause: t("setup.ts_cors_cause", { defaultValue: "Missing CORS headers" }),
                fix: t("setup.ts_cors_fix", { defaultValue: "This is the #1 issue. Your SSH tunnel works at the network level, but your browser blocks the response because mempool's nginx does not include CORS headers. Add the CORS headers from Step 1 and reload nginx." }),
              },
              {
                error: t("setup.ts_mixed_error", { defaultValue: "\"Blocked: HTTP from HTTPS page\"" }),
                cause: t("setup.ts_mixed_cause", { defaultValue: "Mixed content" }),
                fix: t("setup.ts_mixed_fix", { defaultValue: "You are entering an HTTP URL that is not localhost (e.g., http://umbrel.local:3006). Use an SSH tunnel to forward the port to localhost, then use http://localhost:3006/api." }),
              },
              {
                error: t("setup.ts_api_error", { defaultValue: "Health check passes but analysis returns no results" }),
                cause: t("setup.ts_api_cause", { defaultValue: "Missing /api suffix" }),
                fix: t("setup.ts_api_fix", { defaultValue: "Make sure your URL ends with /api. For example, http://localhost:3006/api - not http://localhost:3006. The app will warn you about this if it detects a missing suffix." }),
              },
              {
                error: t("setup.ts_timeout_error", { defaultValue: "\"Timeout (10s)\"" }),
                cause: t("setup.ts_timeout_cause", { defaultValue: "No connection" }),
                fix: t("setup.ts_timeout_fix", { defaultValue: "Check that your SSH tunnel is still running (the terminal session must stay open). Verify the port number matches your mempool instance. Check firewall rules on your node." }),
              },
              {
                error: t("setup.ts_502_error", { defaultValue: "\"HTTP 502\" or \"HTTP 503\"" }),
                cause: t("setup.ts_502_cause", { defaultValue: "Backend not ready" }),
                fix: t("setup.ts_502_fix", { defaultValue: "Your mempool frontend (nginx) is reachable, but the backend is not responding. This usually means the mempool backend is still syncing the blockchain. Wait for it to finish and try again." }),
              },
              {
                error: t("setup.ts_restart_error", { defaultValue: "CORS changes lost after Umbrel restart" }),
                cause: t("setup.ts_restart_cause", { defaultValue: "Docker container recreated" }),
                fix: t("setup.ts_restart_fix", { defaultValue: "Umbrel recreates containers on updates. You need to re-apply CORS headers after each restart, or mount a persistent custom nginx config via Docker volume." }),
              },
            ].map((item) => (
              <div
                key={item.error}
                className="bg-card-bg border border-card-border rounded-xl p-5 space-y-2 hover:border-bitcoin/20 transition-colors"
              >
                <h3 className="text-sm font-semibold text-foreground">{item.error}</h3>
                <p className="text-xs text-muted">
                  <span className="text-warning font-medium">{t("setup.cause", { defaultValue: "Cause:" })}</span> {item.cause}
                </p>
                <p className="text-sm text-muted leading-relaxed">{item.fix}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Verifying */}
        <section id="verify" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            {t("setup.verify_title", { defaultValue: "Verifying It Works" })}
          </h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-3">
            <ol className="space-y-2 text-muted leading-relaxed">
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0 font-bold">1.</span>
                <span>{t("setup.verify_step1", { defaultValue: "Click the gear icon in the header and enter your URL (e.g., http://localhost:3006/api)" })}</span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0 font-bold">2.</span>
                <span>{t("setup.verify_step2", { defaultValue: "Click Apply - you should see a green checkmark and \"Connected. Using custom endpoint.\"" })}</span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0 font-bold">3.</span>
                <span>{t("setup.verify_step3", { defaultValue: "Run an analysis on any transaction or address - results should load normally" })}</span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0 font-bold">4.</span>
                <span>{t("setup.verify_step4", { defaultValue: "The gear icon shows an orange dot when a custom endpoint is active" })}</span>
              </li>
            </ol>
          </div>
        </section>

        {/* Back to scanner */}
        <div className="flex items-center justify-center py-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-bitcoin/10 border border-bitcoin/20 hover:border-bitcoin/40 text-bitcoin hover:text-bitcoin-hover transition-all text-sm"
          >
            <ArrowLeft size={14} />
            {t("setup.back", { defaultValue: "Back to scanner" })}
          </Link>
        </div>
      </div>
    </div>
  );
}
