import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

const sharedDir = fileURLToPath(new URL('../shared', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@shared': sharedDir,
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
