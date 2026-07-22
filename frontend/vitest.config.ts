import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Vitest's root is frontend/ (cwd for all npm scripts); nested worktree
    // checkouts live under ../.claude/worktrees/<name>, outside this subtree,
    // so they're never swept up and don't need an explicit exclude.
    exclude: ["**/node_modules/**"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
