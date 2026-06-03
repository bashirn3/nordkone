import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  envDir: '..',
  plugins: [react()],
  server: {
    port: 5177,
    proxy: {
      '/api': 'http://localhost:3030',
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
