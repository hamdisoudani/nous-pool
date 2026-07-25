import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build the SPA into ../static/ so FastAPI can serve it from
// src/nous_pool/static (the directory it already mounts).
export default defineConfig({
  plugins: [react()],
  base: '/ui/',
  build: {
    outDir: '../static',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Proxy /admin and /v1 to the FastAPI dev server
      '/admin': 'http://127.0.0.1:7890',
      '/v1': 'http://127.0.0.1:7890',
    },
  },
});