import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const ignoredNativeBuildOutput = [
  '**/src-tauri/target/**',
  '**/android/.gradle/**',
  '**/android/app/build/**',
  '**/android/build/**',
];

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ignoredNativeBuildOutput,
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
  },
});