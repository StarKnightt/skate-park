import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/skate-park/' : '/',
  server: { port: 5188, strictPort: true, host: '127.0.0.1' },
  preview: { port: 5189, strictPort: true, host: '127.0.0.1' },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1200,
    assetsInlineLimit: 0,
  },
}));
