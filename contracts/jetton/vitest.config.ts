import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // legacy/ holds the superseded LUMI v1 token and is deliberately not run.
    include: ['tests/**/*.spec.ts'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
