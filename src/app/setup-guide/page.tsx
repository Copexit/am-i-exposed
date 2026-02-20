"use client";

import Link from "next/link";
import { ArrowLeft, AlertTriangle, Terminal, Shield, Globe, Copy } from "lucide-react";
import { useState } from "react";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {}
      }}
      className="absolute top-2 right-2 text-muted hover:text-foreground transition-colors cursor-pointer p-1 rounded bg-surface-elevated/50"
      aria-label="Copy to clipboard"
    >
      <Copy size={12} />
      {copied && (
        <span className="absolute -top-6 right-0 text-[10px] text-severity-good whitespace-nowrap">
          Copied
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
  return (
    <div className="flex-1 flex flex-col items-center px-4 py-8">
      <div className="w-full max-w-4xl space-y-10">
        {/* Back nav */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors py-2 -my-2"
        >
          <ArrowLeft size={16} />
          Back to scanner
        </Link>

        {/* Title */}
        <div className="space-y-3">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
            Connect Your Node
          </h1>
          <p className="text-muted text-lg leading-relaxed max-w-2xl">
            Point am-i.exposed at your own mempool instance for maximum privacy.
            This guide covers Umbrel, Start9, Docker, and bare-metal setups.
          </p>
        </div>

        {/* Table of contents */}
        <nav className="flex flex-wrap gap-2 text-xs" aria-label="Page sections">
          {[
            { label: "Why Self-Host", id: "why" },
            { label: "CORS Headers", id: "cors" },
            { label: "SSH Tunnel", id: "ssh-tunnel" },
            { label: "Umbrel App", id: "umbrel" },
            { label: "Start9", id: "start9" },
            { label: "Docker", id: "docker" },
            { label: "CORS Proxy", id: "cors-proxy" },
            { label: "Tor + .onion", id: "tor" },
            { label: "Troubleshooting", id: "troubleshooting" },
          ].map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="px-2.5 py-1.5 rounded-lg bg-surface-elevated/50 border border-card-border/50 text-muted hover:text-foreground hover:border-bitcoin/30 transition-all"
            >
              {s.label}
            </a>
          ))}
        </nav>

        {/* Why self-host */}
        <section id="why" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Why Self-Host?</h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-4">
            <p className="text-muted leading-relaxed">
              When you use the public <span className="text-foreground font-medium">mempool.space</span> API,
              their servers see your <span className="text-foreground font-medium">IP address</span> and
              every <span className="text-foreground font-medium">address and transaction</span> you query.
              This creates a log linking your network identity to your Bitcoin activity.
            </p>
            <p className="text-muted leading-relaxed">
              By pointing am-i.exposed at your own node, API requests never leave your local network.
              Combined with the SSH tunnel approach below, not even your ISP can see what you are querying.
            </p>
          </div>
        </section>

        {/* Important callout */}
        <div className="bg-warning/10 border border-warning/30 rounded-xl p-5 flex gap-3">
          <AlertTriangle size={20} className="text-warning shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-foreground font-medium text-sm">Two things must be true for this to work</p>
            <ol className="text-muted text-sm leading-relaxed space-y-1 list-decimal list-inside">
              <li>Your mempool instance must have <strong className="text-foreground">CORS headers</strong> enabled (mempool does not include them by default)</li>
              <li>Your URL must end with <code className="text-bitcoin">/api</code> (e.g., <code className="text-bitcoin">http://localhost:3006/api</code>)</li>
            </ol>
          </div>
        </div>

        {/* CORS headers */}
        <section id="cors" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            Step 1: Add CORS Headers
          </h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-4">
            <p className="text-muted leading-relaxed">
              This is the <span className="text-foreground font-medium">#1 reason connections fail</span>.
              Mempool&apos;s nginx config does not include CORS headers by default.
              Without them, your browser silently blocks every API response - even if the network connection is working perfectly.
            </p>
            <p className="text-muted leading-relaxed">
              Add these lines to your mempool nginx config, inside the existing{" "}
              <code className="text-bitcoin bg-bitcoin/10 px-1.5 py-0.5 rounded text-xs">location /api/ {"{"} {"}"}</code> block:
            </p>
            <div className="relative">
              <pre className="bg-surface-inset rounded-lg p-3 text-xs font-mono overflow-x-auto whitespace-pre leading-relaxed">
                {CORS_SNIPPET}
              </pre>
              <CopyButton text={CORS_SNIPPET} />
            </div>
            <p className="text-muted leading-relaxed">
              After editing, reload nginx:
            </p>
            <pre className="bg-surface-inset rounded-lg p-3 text-xs font-mono overflow-x-auto">
              nginx -s reload
            </pre>
            <p className="text-muted text-sm leading-relaxed">
              Where to find the nginx config depends on your platform - see the platform-specific sections below.
            </p>
          </div>
        </section>

        {/* SSH tunnel */}
        <section id="ssh-tunnel" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            Step 2: SSH Tunnel
          </h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-4">
            <p className="text-muted leading-relaxed">
              This site is served over HTTPS. Browsers block HTTP requests from HTTPS pages
              (called <span className="text-foreground font-medium">mixed content</span>)
              unless the target is <code className="text-bitcoin bg-bitcoin/10 px-1.5 py-0.5 rounded text-xs">localhost</code>.
              An SSH tunnel forwards your node&apos;s mempool port to localhost on your machine, bypassing this restriction.
            </p>
            <div className="space-y-3">
              <p className="text-muted leading-relaxed">
                Open a terminal and run:
              </p>
              <div className="relative">
                <pre className="bg-surface-inset rounded-lg p-3 text-xs font-mono overflow-x-auto">
                  ssh -L 3006:localhost:3006 user@your-node-ip
                </pre>
                <CopyButton text="ssh -L 3006:localhost:3006 user@your-node-ip" />
              </div>
              <p className="text-muted leading-relaxed">
                Replace <code className="text-foreground">user@your-node-ip</code> with your node&apos;s SSH credentials.
                This maps port 3006 on your desktop to port 3006 on your node.
              </p>
              <p className="text-muted leading-relaxed">
                Then in the am-i.exposed settings (the gear icon), enter:
              </p>
              <pre className="bg-surface-inset rounded-lg p-3 text-sm font-mono overflow-x-auto text-bitcoin">
                http://localhost:3006/api
              </pre>
              <div className="bg-surface-inset rounded-lg p-3 text-xs text-muted leading-relaxed">
                <strong className="text-foreground">Keep the terminal open</strong> while using the site.
                The tunnel stays active as long as the SSH session is running.
                You can add <code className="text-foreground">-N</code> to the SSH command to skip opening a shell
                (e.g., <code className="text-foreground">ssh -N -L 3006:localhost:3006 ...</code>).
              </div>
            </div>
          </div>
        </section>

        {/* Umbrel */}
        <section id="umbrel" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Terminal size={22} />
            Umbrel
          </h2>

          {/* Recommended: Umbrel app */}
          <div className="bg-card-bg border border-bitcoin/30 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-bitcoin bg-bitcoin/10 px-2 py-0.5 rounded">
                Recommended
              </span>
            </div>
            <h3 className="text-lg font-semibold text-foreground">Install the Umbrel App</h3>
            <p className="text-muted leading-relaxed">
              The easiest way. Install <span className="text-foreground font-medium">am-i.exposed</span> directly
              on your Umbrel and it automatically connects to your local mempool instance.
              No CORS headers, no SSH tunnel, no configuration needed.
            </p>
            <ol className="space-y-2 text-muted leading-relaxed">
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0 font-bold">1.</span>
                <span>
                  Open your Umbrel dashboard and go to the <strong className="text-foreground">App Store</strong>
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0 font-bold">2.</span>
                <span>
                  Click the <strong className="text-foreground">three-dot menu</strong> (top right)
                  and select <strong className="text-foreground">Community App Stores</strong>
                </span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0 font-bold">3.</span>
                <span>
                  Paste the store URL and click <strong className="text-foreground">Add</strong>:
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
                  Find <strong className="text-foreground">am-i.exposed</strong> in the store and click <strong className="text-foreground">Install</strong>
                </span>
              </li>
            </ol>
            <p className="text-muted leading-relaxed">
              The app detects your local mempool automatically. All API requests stay on your local network
              and Chainalysis lookups are routed through a built-in Tor proxy.
            </p>
          </div>

          {/* Alternative: manual setup */}
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-5">
            <h3 className="text-lg font-semibold text-foreground">
              Alternative: Use the Website with Your Umbrel Node
            </h3>
            <p className="text-muted leading-relaxed">
              If you prefer using <span className="text-foreground font-medium">am-i.exposed</span> from the public
              website instead of the Umbrel app, you can point it at your Umbrel&apos;s mempool instance.
              This requires CORS headers and an SSH tunnel.
            </p>
            <p className="text-muted leading-relaxed">
              On Umbrel, the mempool app listens on <span className="text-foreground font-medium">port 3006</span> via
              Umbrel&apos;s <code className="text-foreground text-xs">app_proxy</code> container.
              Authentication is disabled for the mempool app, so no session token is needed.
            </p>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">1. Add CORS headers</h3>
              <p className="text-muted leading-relaxed">
                SSH into your Umbrel and exec into the mempool web container:
              </p>
              <div className="relative">
                <pre className="bg-surface-inset rounded-lg p-3 text-xs font-mono overflow-x-auto whitespace-pre leading-relaxed">{`ssh umbrel@umbrel.local
docker exec -it mempool_web_1 sh
vi /etc/nginx/conf.d/nginx-mempool.conf`}</pre>
                <CopyButton text="ssh umbrel@umbrel.local\ndocker exec -it mempool_web_1 sh\nvi /etc/nginx/conf.d/nginx-mempool.conf" />
              </div>
              <p className="text-muted leading-relaxed">
                Find the <code className="text-foreground text-xs">location /api/ {"{"}</code> block and add the CORS headers shown above.
                Then reload nginx inside the container:
              </p>
              <pre className="bg-surface-inset rounded-lg p-3 text-xs font-mono overflow-x-auto">
                nginx -s reload
              </pre>
              <div className="bg-warning/10 rounded-lg p-3 text-xs text-warning leading-relaxed">
                <strong>Note:</strong> Changes inside the Docker container are lost when the container restarts
                (e.g., after an Umbrel update). You will need to re-apply them after updates.
                For a persistent solution, mount a custom nginx config - see the{" "}
                <a
                  href="https://github.com/getumbrel/umbrel-apps"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-warning/80"
                >
                  Umbrel app customization docs
                </a>.
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">2. SSH tunnel</h3>
              <p className="text-muted leading-relaxed">
                From your desktop, open a terminal:
              </p>
              <div className="relative">
                <pre className="bg-surface-inset rounded-lg p-3 text-xs font-mono overflow-x-auto">
                  ssh -N -L 3006:localhost:3006 umbrel@umbrel.local
                </pre>
                <CopyButton text="ssh -N -L 3006:localhost:3006 umbrel@umbrel.local" />
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">3. Configure am-i.exposed</h3>
              <p className="text-muted leading-relaxed">
                Click the gear icon in the header and enter:
              </p>
              <pre className="bg-surface-inset rounded-lg p-3 text-sm font-mono overflow-x-auto text-bitcoin">
                http://localhost:3006/api
              </pre>
              <p className="text-muted leading-relaxed">
                Click <strong className="text-foreground">Apply</strong>. You should see a green checkmark if everything is configured correctly.
              </p>
            </div>
          </div>
        </section>

        {/* Start9 */}
        <section id="start9" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Shield size={22} />
            Start9 / StartOS
          </h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-4">
            <p className="text-muted leading-relaxed">
              Start9 serves mempool over <span className="text-foreground font-medium">HTTPS</span> on
              a <code className="text-foreground text-xs">.local</code> hostname with a self-signed certificate.
              There is no bare port to SSH tunnel to, so the approach is different from Umbrel.
            </p>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">1. Install the StartOS root CA</h3>
              <p className="text-muted leading-relaxed">
                Your browser needs to trust the StartOS certificate authority. Download the CA from
                your StartOS dashboard and install it in your system/browser trust store. Without this,
                HTTPS requests to your <code className="text-foreground text-xs">.local</code> address will fail.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">2. Add CORS headers</h3>
              <p className="text-muted leading-relaxed">
                SSH into your Start9 and edit the mempool nginx config to add the CORS headers shown above.
                The process is similar to Umbrel - find the running mempool container and edit its nginx config.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">3. Configure am-i.exposed</h3>
              <p className="text-muted leading-relaxed">
                Use your mempool&apos;s LAN address in the settings:
              </p>
              <pre className="bg-surface-inset rounded-lg p-3 text-sm font-mono overflow-x-auto text-bitcoin">
                {"https://<your-mempool-hostname>.local/api"}
              </pre>
              <p className="text-muted leading-relaxed">
                Replace <code className="text-foreground">&lt;your-mempool-hostname&gt;</code> with the
                hostname shown in your StartOS dashboard for the mempool service.
              </p>
            </div>
          </div>
        </section>

        {/* Docker */}
        <section id="docker" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Terminal size={22} />
            Docker / Bare Metal
          </h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-4">
            <p className="text-muted leading-relaxed">
              If you run the official{" "}
              <a
                href="https://github.com/mempool/mempool"
                target="_blank"
                rel="noopener noreferrer"
                className="text-bitcoin underline hover:text-bitcoin/80"
              >
                mempool/mempool
              </a>{" "}
              Docker image or a bare-metal installation:
            </p>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">Docker</h3>
              <p className="text-muted leading-relaxed">
                The default Docker setup maps the frontend nginx to port 80 (or whichever port you configured).
                To persist CORS headers, mount a custom nginx config:
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
              <h3 className="text-lg font-semibold text-foreground">Bare metal</h3>
              <p className="text-muted leading-relaxed">
                Edit your mempool nginx config directly. The default location is typically{" "}
                <code className="text-foreground text-xs">/etc/nginx/conf.d/nginx-mempool.conf</code> or
                wherever you placed it during installation.
              </p>
            </div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">Remote access</h3>
              <p className="text-muted leading-relaxed">
                If your node is on the same machine, use <code className="text-bitcoin">http://localhost:&lt;port&gt;/api</code> directly.
                If it is on another machine on your network, use an SSH tunnel as described above.
              </p>
            </div>
          </div>
        </section>

        {/* Local CORS proxy alternative */}
        <section id="cors-proxy" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">
            Alternative: Local CORS Proxy
          </h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-4">
            <p className="text-muted leading-relaxed">
              If you cannot or do not want to modify your node&apos;s nginx config, you can run a
              small reverse proxy on your desktop that adds CORS headers. This sits between your
              browser and the SSH tunnel.
            </p>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">Using Caddy</h3>
              <p className="text-muted leading-relaxed">
                <a
                  href="https://caddyserver.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-bitcoin underline hover:text-bitcoin/80"
                >
                  Caddy
                </a>{" "}
                is a single-binary web server. Create a file called <code className="text-foreground text-xs">Caddyfile</code>:
              </p>
              <div className="relative">
                <pre className="bg-surface-inset rounded-lg p-3 text-xs font-mono overflow-x-auto whitespace-pre leading-relaxed">
                  {CADDY_SNIPPET}
                </pre>
                <CopyButton text={CADDY_SNIPPET} />
              </div>
              <p className="text-muted leading-relaxed">
                Then run <code className="text-foreground text-xs">caddy run</code> in the same directory.
                In am-i.exposed settings, enter:
              </p>
              <pre className="bg-surface-inset rounded-lg p-3 text-sm font-mono overflow-x-auto text-bitcoin">
                http://localhost:8090/api
              </pre>
              <p className="text-muted text-sm leading-relaxed">
                The flow: browser -{">"} Caddy (:8090, adds CORS) -{">"} SSH tunnel (:3006) -{">"} your node&apos;s mempool.
              </p>
            </div>
          </div>
        </section>

        {/* Tor */}
        <section id="tor" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Globe size={22} />
            Alternative: Tor Browser + .onion
          </h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-4">
            <p className="text-muted leading-relaxed">
              If both am-i.exposed and your mempool instance are accessed via <code className="text-foreground text-xs">.onion</code> addresses
              in Tor Browser, there is no mixed-content blocking (both are HTTP) and Tor Browser relaxes
              CORS restrictions for .onion-to-.onion requests.
            </p>
            <p className="text-muted leading-relaxed">
              This requires a .onion mirror of am-i.exposed. If one is available, use Tor Browser to
              visit the .onion URL, then enter your mempool&apos;s .onion address in the settings.
            </p>
            <p className="text-muted leading-relaxed">
              You still need CORS headers on your mempool nginx if the .onion addresses differ
              (which they will, since they are separate hidden services).
            </p>
          </div>
        </section>

        {/* Troubleshooting */}
        <section id="troubleshooting" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Troubleshooting</h2>
          <div className="space-y-3">
            {[
              {
                error: "\"Connection failed\" after setting up SSH tunnel",
                cause: "Missing CORS headers",
                fix: "This is the #1 issue. Your SSH tunnel works at the network level, but your browser blocks the response because mempool's nginx does not include CORS headers. Add the CORS headers from Step 1 and reload nginx.",
              },
              {
                error: "\"Blocked: HTTP from HTTPS page\"",
                cause: "Mixed content",
                fix: "You are entering an HTTP URL that is not localhost (e.g., http://umbrel.local:3006). Use an SSH tunnel to forward the port to localhost, then use http://localhost:3006/api.",
              },
              {
                error: "Health check passes but analysis returns no results",
                cause: "Missing /api suffix",
                fix: "Make sure your URL ends with /api. For example, http://localhost:3006/api - not http://localhost:3006. The app will warn you about this if it detects a missing suffix.",
              },
              {
                error: "\"Timeout (10s)\"",
                cause: "No connection",
                fix: "Check that your SSH tunnel is still running (the terminal session must stay open). Verify the port number matches your mempool instance. Check firewall rules on your node.",
              },
              {
                error: "\"HTTP 502\" or \"HTTP 503\"",
                cause: "Backend not ready",
                fix: "Your mempool frontend (nginx) is reachable, but the backend is not responding. This usually means the mempool backend is still syncing the blockchain. Wait for it to finish and try again.",
              },
              {
                error: "CORS changes lost after Umbrel restart",
                cause: "Docker container recreated",
                fix: "Umbrel recreates containers on updates. You need to re-apply CORS headers after each restart, or mount a persistent custom nginx config via Docker volume.",
              },
            ].map((item) => (
              <div
                key={item.error}
                className="bg-card-bg border border-card-border rounded-xl p-5 space-y-2 hover:border-bitcoin/20 transition-colors"
              >
                <h3 className="text-sm font-semibold text-foreground">{item.error}</h3>
                <p className="text-xs text-muted/70">
                  <span className="text-warning font-medium">Cause:</span> {item.cause}
                </p>
                <p className="text-sm text-muted leading-relaxed">{item.fix}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Verifying */}
        <section id="verify" className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">Verifying It Works</h2>
          <div className="bg-card-bg border border-card-border rounded-xl p-6 space-y-3">
            <ol className="space-y-2 text-muted leading-relaxed">
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0 font-bold">1.</span>
                <span>Click the gear icon in the header and enter your URL (e.g., <code className="text-bitcoin text-xs">http://localhost:3006/api</code>)</span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0 font-bold">2.</span>
                <span>Click <strong className="text-foreground">Apply</strong> - you should see a green checkmark and &quot;Connected. Using custom endpoint.&quot;</span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0 font-bold">3.</span>
                <span>Run an analysis on any transaction or address - results should load normally</span>
              </li>
              <li className="flex gap-2">
                <span className="text-bitcoin shrink-0 font-bold">4.</span>
                <span>The gear icon shows an orange dot when a custom endpoint is active</span>
              </li>
            </ol>
          </div>
        </section>

        {/* Back to scanner */}
        <div className="flex items-center justify-center py-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-bitcoin/10 border border-bitcoin/20 hover:border-bitcoin/40 text-bitcoin/80 hover:text-bitcoin transition-all text-sm"
          >
            <ArrowLeft size={14} />
            Back to scanner
          </Link>
        </div>
      </div>
    </div>
  );
}
