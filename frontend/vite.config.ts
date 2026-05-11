import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import compression from 'vite-plugin-compression';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    // Precompress static assets at build time so nginx can serve `.gz`/`.br`
    // directly via `*_static on` with no runtime CPU cost. Brotli yields
    // ~15-20% smaller bundles than gzip for our JS.
    compression({ algorithm: 'gzip', ext: '.gz', threshold: 1024 }),
    compression({ algorithm: 'brotliCompress', ext: '.br', threshold: 1024 }),
  ],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  build: {
    sourcemap: process.env.SOURCEMAP === '1',
    target: 'es2022',
  },
});
