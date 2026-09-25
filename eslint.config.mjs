import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    // Standalone Node.js sidecar (CommonJS, not part of Next.js app)
    "umbrel/tor-proxy/**",
    // Archived research articles (third-party HTML/JS, not our code)
    "docs/archive/**",
    // Generated WASM glue code
    "public/wasm/**",
    // CLI build artifacts and generated WASM bindings
    "cli/dist/**",
    "cli/wasm/**",
    // Utility scripts (Playwright captures, WASM tests, etc.)
    "scripts/**",
    "screenshots/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      // Allow underscore-prefixed variables to opt out of the unused-var check
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // src/lib is shared with the CLI and MCP server: it must stay framework-free.
  {
    files: ["src/lib/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/hooks/*", "@/components/*", "@/app/*", "@/context/*", "**/hooks/*", "**/components/*", "**/app/*", "**/context/*"],
              message: "src/lib must stay framework-free (shared with the CLI and MCP server).",
            },
          ],
        },
      ],
    },
  },
  // cli/tsconfig.json includes the DOM libs (shared src/lib code needs them),
  // so tsc cannot catch browser globals in Node-side CLI code.
  {
    files: ["cli/src/**"],
    rules: {
      "no-restricted-globals": [
        "error",
        ...["window", "document", "localStorage", "sessionStorage", "navigator"].map((name) => ({
          name,
          message: "CLI runs in Node",
        })),
      ],
    },
  },
  // Type-aware promise checks.
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
    },
  },
]);

export default eslintConfig;
