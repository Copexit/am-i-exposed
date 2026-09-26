import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:3333",
    headless: true,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
  webServer: {
    // No -s: single-page mode rewrites every path (even /graph/) to the root index.html
    command: "npx serve out -l 3333",
    port: 3333,
    reuseExistingServer: !process.env.CI,
  },
});
