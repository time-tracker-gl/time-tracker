import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// rpc Task Management – mobile-first prototype implementation
export default defineConfig({
  // Relative base so the build works at any path (incl. the GitHub Pages
  // project subpath /time-tracker/). The app is a single page with no
  // client-side routing, so relative asset URLs are sufficient.
  base: './',
  plugins: [react()],
  server: { host: true, port: 5173 },
});
