import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The Node bridge (server/index.ts) serves the UDP->WebSocket relay and config API
// on port 8787. In dev we proxy /api and /ws through Vite so the browser only
// talks to one origin.
export default defineConfig({
  // GitHub Pages project sites are served from /<repo>/; local dev and `vite preview` stay at /.
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  assetsInclude: ['**/*.vrm', '**/*.glb', '**/*.gltf', '**/*.fbx', '**/*.hdr', '**/*.exr'],
});
