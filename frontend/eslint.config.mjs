import js from "@eslint/js";
import tseslint from "typescript-eslint";

const NODE_API_MESSAGE =
  "Node APIs are unavailable in the webview; use a Wails-bound Go function.";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // `dist` at any depth (incl. build bundles inside nested worktree checkouts).
  // `bindings` is wails3-generated TS bound to Go services/events — not
  // source to lint. Sibling dirs outside frontend/ (../.claude/worktrees) are
  // outside this config's lint root (cwd is frontend/) and don't need an
  // ignore entry.
  { ignores: ["**/dist", "bindings"] },
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
              // Bare `node:` builtins only.
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
);
