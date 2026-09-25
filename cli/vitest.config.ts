import { defineConfig } from "vitest/config";
import { resolve, join } from "path";
import { tmpdir } from "os";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "..", "src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    testTimeout: 30000,
    // Keep tests away from the real ~/.am-i-exposed cache
    env: { AM_I_EXPOSED_CACHE_DIR: join(tmpdir(), `am-i-exposed-cli-test-${process.pid}`) },
  },
});
