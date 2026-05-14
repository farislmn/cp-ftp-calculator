import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy all /api requests to intervals.icu to avoid CORS in the browser.
    proxy: {
      '/api': {
        target: 'https://intervals.icu',
        changeOrigin: true,
      },
    },
  },
});
