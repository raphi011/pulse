import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Git worktrees live inside the repo (.claude/worktrees/<name>) and carry
    // their own tests + node_modules; without this, a root `npm test` sweeps
    // them up and fails on duplicate React copies.
    exclude: ["**/node_modules/**", ".claude/**"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
