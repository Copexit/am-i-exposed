import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/hooks/__tests__/**"],
    coverage: {
      provider: "v8",
      include: [
        "src/lib/analysis/**",
        "src/lib/scoring/**",
        "src/lib/bitcoin/**",
        "src/lib/api/**",
      ],
      thresholds: {
        lines: 60,
        functions: 70,
        branches: 50,
      },
    },
  },
});
