import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API = process.env.VITE_API_ORIGIN || 'http://localhost:3001';
const buildVersion = randomUUID();
const deployed = process.env.PWA_DEPLOYMENT === 'true';

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss(), {
    name: 'pulsera-release',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: buildVersion }) });
      if (deployed) this.emitFile({ type: 'asset', fileName: 'sw.js', source: readFileSync(resolve(__dirname, 'service-worker.js'), 'utf8').replace('__BUILD_VERSION__', buildVersion) });
    },
  }],
  // Deployment opts in explicitly; local dev AND local production previews stay worker-free.
  define: {
    'import.meta.env.PWA_ENABLED': JSON.stringify(command === 'build' && deployed),
    'import.meta.env.BUILD_VERSION': JSON.stringify(buildVersion),
  },
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
        // Clerk shares React runtime helpers; splitting it out creates a circular chunk that
        // can execute before React initializes and prevent the app (and PWA) from starting.
        manualChunks: { vendor: ['react', 'react-dom', 'react-router', '@tanstack/react-query', '@clerk/react'], charts: ['recharts'], motion: ['framer-motion'] },
      },
    },
  },
}));
