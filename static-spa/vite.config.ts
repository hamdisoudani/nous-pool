import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

// Build the SPA into ../static/ so FastAPI can serve it from
// /ui/ — FastAPI mounts it as StaticFiles at /ui with no trailing /
export default defineConfig({
  plugins: [react()],
  base: "/ui/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "../static",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy /admin and /v1 to the FastAPI dev server
      "/admin": "http://127.0.0.1:7890",
      "/v1": "http://127.0.0.1:7890",
    },
  },
});