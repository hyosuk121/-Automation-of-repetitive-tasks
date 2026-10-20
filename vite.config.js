import { defineConfig } from 'vite';
export default defineConfig({
  root: 'web',
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    host: '0.0.0.0',
    allowedHosts: ['terminal.local'],
    proxy: { '/api': 'http://127.0.0.1:4174' }
  }
});
