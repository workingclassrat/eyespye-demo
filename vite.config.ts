import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    // The Node API server (server/index.ts) holds the Claude API key.
    proxy: { "/api": "http://localhost:8787" },
  },
  // Pre-bundle pdf.js at startup so the first PDF drop doesn't trigger a dev-server page reload.
  optimizeDeps: { include: ["pdfjs-dist"] },
});
