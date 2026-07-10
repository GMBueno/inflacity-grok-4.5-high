import { defineConfig } from 'vite';

// Project site: https://gmbueno.github.io/inflacity-grok-4.5-high/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/inflacity-grok-4.5-high/' : '/',
  root: '.',
  publicDir: 'public',
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    sourcemap: true,
  },
}));
