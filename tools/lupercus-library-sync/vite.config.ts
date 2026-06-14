import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  root: __dirname,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5193,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4193,
    strictPort: true,
  },
  build: {
    outDir: '../../dist-lupercus-sync',
    emptyOutDir: true,
  },
});
