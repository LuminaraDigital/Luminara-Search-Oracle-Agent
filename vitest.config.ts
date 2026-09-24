import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      include: [
        'services/**/*.{ts,tsx}',
        'worker/**/*.ts',
        'utils/**/*.{ts,tsx}',
        'hooks/**/*.{ts,tsx}',
      ],
      exclude: [
        '**/*.d.ts',
        '**/playbooks.generated.json',
        '**/node_modules/**',
        'open-seo/**',
        'Switchyard/**',
        'electron/**',
        'crawler/**',
      ],
      // Floor for industry gate; raise as suites deepen. Report is always published.
      thresholds: {
        lines: 35,
        functions: 35,
        branches: 25,
        statements: 35,
      },
    },
  },
});
