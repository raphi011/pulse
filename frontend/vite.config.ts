import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // Wails' dev-server asset proxy dials tcp4 127.0.0.1; without an explicit
  // host Vite binds `localhost`, which Node ≥17 may resolve to ::1 only.
  server: { host: "127.0.0.1" },
  resolve: { alias: { "@": resolve(__dirname, "./src") } },
  build: {
    outDir: "dist",
    // better-sqlite3 is only used by the test transport + drizzle-kit; never bundle it for the webview.
    rollupOptions: { external: ["better-sqlite3"] },
  },
});
