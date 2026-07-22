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
    // legacy-modules/ parks unported modules (Plan 2 revives them one by one)
    // and its tests aren't wired to the new server-owned manifests yet.
    exclude: ["**/node_modules/**", "**/legacy-modules/**"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
