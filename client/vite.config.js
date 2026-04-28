import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/colyseus': {
        target:  'ws://localhost:3000',
        ws:       true,
        changeOrigin: true,
      },
    },
  },

  // Everything in static/ is copied into the build output as-is.
  publicDir: 'static',

  build: {
    outDir:      '../public',
    emptyOutDir: true,
    target:      'esnext',
  },

  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});
