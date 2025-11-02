import { defineConfig } from 'vite';
import { fileURLToPath, URL } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const sharedDir = fileURLToPath(new URL('../shared', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@shared': sharedDir,
    },
  },
  server: {
    fs: {
      allow: [repoRoot],
    },
  },
  build: {
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
});
