import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    assetsInlineLimit: 100000000,
  },
  server: {
    open: true,
  },
});
