/**
 * HTTP(S) GET/POST through the Tor SOCKS agent. The module is picked by URL
 * protocol so plain http:// onion hosts work (port 80/443 by default).
 */
function createFetchViaAgent({ http, https, agent, maxBytes, defaultTimeoutMs }) {
  return function fetchViaAgent(url, { method = "GET", body, contentType, timeoutMs = defaultTimeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      const parsed = new URL(url);
      const isHttp = parsed.protocol === "http:";
      // Plain http only inside Tor (onion services are end-to-end encrypted); clearnet must be https.
      if ((isHttp && !parsed.hostname.endsWith(".onion")) || (!isHttp && parsed.protocol !== "https:")) {
        reject(new Error("Plain http is only allowed for .onion hosts"));
        return;
      }
      const headers = { Accept: "application/json" };
      if (body) {
        headers["Content-Type"] = contentType || "application/json";
        headers["Content-Length"] = Buffer.byteLength(body);
      }
      const req = (isHttp ? http : https).request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (isHttp ? 80 : 443),
          path: parsed.pathname + parsed.search,
          method,
          agent,
          headers,
          timeout: timeoutMs,
        },
        (res) => {
          const chunks = [];
          let totalBytes = 0;
          res.on("data", (chunk) => {
            totalBytes += chunk.length;
            if (totalBytes > maxBytes) {
              req.destroy();
              reject(new Error("Upstream response too large"));
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            const out = Buffer.concat(chunks).toString();
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(out);
            } else {
              reject(Object.assign(new Error(`Upstream ${res.statusCode}: ${out.slice(0, 200)}`), { status: res.statusCode }));
            }
          });
        },
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Upstream request timed out"));
      });
      if (body) req.write(body);
      req.end();
    });
  };
}

module.exports = { createFetchViaAgent };
