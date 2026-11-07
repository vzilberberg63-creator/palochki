import { defineConfig } from 'vitest/config';

// Яндекс Игры принимают zip-архив с index.html в корне,
// поэтому все пути в сборке должны быть относительными.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    target: 'es2020',
  },
  server: {
    host: true,
    port: 5173,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
