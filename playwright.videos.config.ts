import { defineConfig } from "@playwright/test";

// Flag-on suite: needs out-videos/ from scripts/build-videos-e2e.sh.
export default defineConfig({
  testDir: "e2e",
  testMatch: "site-videos.spec.ts",
  timeout: 30_000,
  retries: 0,
  use: { baseURL: "http://localhost:3334", headless: true },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "npx serve out-videos -l 3334",
    port: 3334,
    reuseExistingServer: !process.env.CI,
  },
});
