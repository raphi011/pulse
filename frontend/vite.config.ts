import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  resolve: { alias: { "@": resolve(__dirname, "./src") } },
  build: {
    outDir: "dist",
    // better-sqlite3 is only used by the test transport + drizzle-kit; never bundle it for the webview.
    rollupOptions: { external: ["better-sqlite3"] },
  },
});
