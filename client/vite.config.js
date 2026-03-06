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
  // Put maps/ here — it won't be processed or overwritten by Vite.
  // Access it in the browser at /maps/default.glb etc.
  publicDir: 'static',

  build: {
    outDir:      '../public',
    emptyOutDir: true,   // safe to wipe — maps live in static/, not public/
    target:      'esnext',
  },

  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat'],
  },
});