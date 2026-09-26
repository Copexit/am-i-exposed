import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "workers/**/*.test.js",
      "umbrel/**/*.test.js",
    ],
    coverage: {
      provider: "v8",
      include: ["src/lib/**", "src/hooks/**"],
      exclude: [
        "**/__tests__/**",
        "**/*.test.{ts,tsx}",
        "**/*.json",
        "**/types.ts", // type-only modules
      ],
      // Measured floor minus 1 point: a regression below these fails CI
      thresholds: {
        statements: 87,
        lines: 89,
        functions: 89,
        branches: 81,
      },
    },
  },
});
