import js from "@eslint/js";
import tseslint from "typescript-eslint";

const NODE_API_MESSAGE =
  "Node APIs are unavailable in the Tauri webview; use a Tauri plugin.";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { ignores: ["dist", "src-tauri/target", "drizzle"] },
  {
    // Webview code cannot reach Node builtins/globals — they throw at runtime.
    // Scoped to src/ only; tests legitimately run on Node.
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // Bare `node:` builtins only — NOT the `@tauri-apps/plugin-fs` etc. packages.
              group: ["node:*"],
              message: NODE_API_MESSAGE,
            },
          ],
          paths: [
            { name: "fs", message: NODE_API_MESSAGE },
            { name: "os", message: NODE_API_MESSAGE },
            { name: "path", message: NODE_API_MESSAGE },
            { name: "child_process", message: NODE_API_MESSAGE },
            { name: "crypto", message: NODE_API_MESSAGE },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "process", message: NODE_API_MESSAGE },
      ],
    },
  },
  {
    // The Node/test transport genuinely uses process.env.DASHBOARD_DB and a
    // dynamic better-sqlite3 import; it only runs off-webview. Exempt it.
    files: ["src/db/client.ts"],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-globals": "off",
    },
  },
);
