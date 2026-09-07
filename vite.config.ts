import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Secrets are intentionally NOT inlined here. Vite already exposes VITE_-prefixed variables via
// import.meta.env, and anything exposed that way ships to every visitor's browser. Keys entered in
// the Settings modal live in localStorage only. For production, move provider calls behind a
// server function so keys never reach the client.
export default defineConfig(() => ({
  server: {
    port: 3000,
    host: '0.0.0.0',
    proxy: {
      '/api/nim-proxy': {
        target: 'https://integrate.api.nvidia.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/nim-proxy/, ''),
      },
    },
  },
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom'],
          genai: ['@google/genai'],
          markdown: ['marked', 'dompurify'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
}));
