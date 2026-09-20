import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API = process.env.VITE_API_ORIGIN || 'http://localhost:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Environment comes from the repo-root .env (shared with the API) so keys live in one place.
  envDir: resolve(__dirname, '../../'),
  server: {
    port: Number(process.env.WEB_PORT) || 5173,
    strictPort: true,
    proxy: {
      '/api': { target: API, changeOrigin: false },
      '/auth': { target: API, changeOrigin: false },
      '/health': { target: API, changeOrigin: false },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { vendor: ['react', 'react-dom', 'react-router', '@tanstack/react-query'], charts: ['recharts'], motion: ['framer-motion'], clerk: ['@clerk/react'] },
      },
    },
  },
});
