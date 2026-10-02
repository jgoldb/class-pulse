import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
// The harness swaps Clerk for a local stub so the real teacher shell renders with no credentials.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@clerk/react': fileURLToPath(new URL('./clerk-stub.tsx', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 5188, strictPort: true },
  envDir: false,
});
