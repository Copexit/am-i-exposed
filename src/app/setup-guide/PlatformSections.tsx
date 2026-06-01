"use client";

import { Terminal, Shield, ExternalLink } from "lucide-react";
import { CopyButton } from "@/components/ui/CopyButton";
import { useTranslation } from "react-i18next";
import { CADDY_SNIPPET } from "./setup-guide-data";
import { UMBREL_APP_URL } from "@/lib/external-links";

export function UmbrelSection() {
  const { t } = useTranslation();

  return (
    <section id="umbrel" className="space-y-4">
      <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
        <Terminal size={22} />
        {t("setup.umbrel_title", { defaultValue: "Umbrel" })}
      </h2>

      <div className="bg-card-bg border border-bitcoin/30 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-bitcoin bg-bitcoin/10 px-2 py-0.5 rounded">
            {t("setup.one_click", { defaultValue: "One-click install" })}
          </span>
        </div>
        <h3 className="text-lg font-semibold text-foreground">
          {t("setup.umbrel_app_title", { defaultValue: "Install the Umbrel App" })}
        </h3>
        <p className="text-muted leading-relaxed">
          {t("setup.umbrel_app_desc", { defaultValue: "The easiest way. Install am-i.exposed directly from the official Umbrel App Store and it automatically connects to your local mempool instance. No CORS headers, no SSH tunnel, no configuration needed." })}
        </p>
        <ol className="space-y-2 text-muted leading-relaxed">
          <li className="flex gap-2">
            <span className="text-bitcoin shrink-0 font-bold">1.</span>
            <span>
              {t("setup.umbrel_step1", { defaultValue: "Open the App Store on your Umbrel dashboard" })}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-bitcoin shrink-0 font-bold">2.</span>
            <span>
              {t("setup.umbrel_step2", { defaultValue: "Search for am-i.exposed" })}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-bitcoin shrink-0 font-bold">3.</span>
            <span>
              {t("setup.umbrel_step3", { defaultValue: "Click Install" })}
            </span>
          </li>
        </ol>
        <a
          href={UMBREL_APP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-bitcoin hover:text-bitcoin/80 transition-colors"
        >
          <ExternalLink size={14} aria-hidden="true" />
          {t("setup.umbrel_store_link", { defaultValue: "View on the Umbrel App Store" })}
        </a>
        <p className="text-muted leading-relaxed">
          {t("setup.umbrel_app_footer", { defaultValue: "The app detects your local mempool automatically. All API requests stay on your local network and Chainalysis lookups are routed through a built-in Tor proxy." })}
        </p>
      </div>
    </section>
  );
}

export function Start9Section() {
  const { t } = useTranslation();

  return (
    <section id="start9" className="space-y-4">
      <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
        <Shield size={22} />
        {t("setup.start9_title", { defaultValue: "Start9 / StartOS" })}
      </h2>

      <div className="bg-card-bg border border-bitcoin/30 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-bitcoin bg-bitcoin/10 px-2 py-0.5 rounded">
            {t("setup.one_click", { defaultValue: "One-click install" })}
          </span>
        </div>
        <h3 className="text-lg font-semibold text-foreground">
          {t("setup.start9_app_title", { defaultValue: "Install from the StartOS Marketplace" })}
        </h3>
        <p className="text-muted leading-relaxed">
          {t("setup.start9_app_desc", { defaultValue: "am-i.exposed is in the official Start9 marketplace, maintained by the Start9 team. Install it directly on your StartOS server and it connects to your local mempool automatically. No CORS headers, no SSH tunnel, no configuration needed." })}
        </p>
        <ol className="space-y-2 text-muted leading-relaxed">
          <li className="flex gap-2">
            <span className="text-bitcoin shrink-0 font-bold">1.</span>
            <span>
              {t("setup.start9_app_step1", { defaultValue: "Open the Marketplace on your StartOS dashboard" })}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-bitcoin shrink-0 font-bold">2.</span>
            <span>
              {t("setup.start9_app_step2", { defaultValue: "Search for am-i.exposed" })}
            </span>
          </li>
          <li className="flex gap-2">
            <span className="text-bitcoin shrink-0 font-bold">3.</span>
            <span>
              {t("setup.start9_app_step3", { defaultValue: "Click Install" })}
            </span>
          </li>
        </ol>
        <p className="text-muted leading-relaxed">
          {t("setup.start9_app_footer", { defaultValue: "The app detects your local mempool automatically. Prefer to use the am-i.exposed website with your StartOS node instead? See the manual setup below." })}
        </p>
      </div>
    </section>
  );
}

export function UmbrelManualSection() {
  const { t } = useTranslation();

  return (
    <section id="umbrel-manual" className="space-y-4">
      <h3 className="text-xl font-semibold text-foreground flex items-center gap-2">
        <Terminal size={20} />
        {t("setup.umbrel_manual_title", { defaultValue: "Umbrel (Manual)" })}
      </h3>
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
  );
}

export function Start9ManualSection() {
  const { t } = useTranslation();

  return (
    <section id="start9-manual" className="space-y-4">
      <h3 className="text-xl font-semibold text-foreground flex items-center gap-2">
        <Shield size={20} />
        {t("setup.start9_manual_title", { defaultValue: "StartOS (use the website instead)" })}
      </h3>
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
  );
}

export function DockerSection() {
  const { t } = useTranslation();

  return (
    <section id="docker" className="space-y-4">
      <h3 className="text-xl font-semibold text-foreground flex items-center gap-2">
        <Terminal size={20} />
        {t("setup.docker_title", { defaultValue: "Docker / Bare Metal" })}
      </h3>
      <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-4">
        <p className="text-muted leading-relaxed">
          {t("setup.docker_desc", { defaultValue: "If you run the official mempool/mempool Docker image or a bare-metal installation:" })}
        </p>

        <div className="space-y-2">
          <h3 className="text-lg font-semibold text-foreground">{t("setup.docker_section_title", { defaultValue: "Docker" })}</h3>
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
  );
}

export function CorsProxySection() {
  const { t } = useTranslation();

  return (
    <section id="cors-proxy" className="space-y-4">
      <h3 className="text-xl font-semibold text-foreground">
        {t("setup.cors_proxy_title", { defaultValue: "Alternative: Local CORS Proxy" })}
      </h3>
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
  );
}
