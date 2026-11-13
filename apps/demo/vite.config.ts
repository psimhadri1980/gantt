import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
export default defineConfig({
  plugins: [react()],
  build: { minify: process.env.GANTT_NO_MINIFY ? false : true, rollupOptions: { input: { main: resolve(__dirname, 'index.html'), bench: resolve(__dirname, 'bench.html') } } },
});
