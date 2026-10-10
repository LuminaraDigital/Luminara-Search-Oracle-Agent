import { defineConfig } from 'vitest/config';

export default defineConfig({
  envDir: 'non_existent_env_dir',
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 45000,
    hookTimeout: 45000,
    teardownTimeout: 45000,
    env: {
      VITE_FIRECRAWL_API_KEY: '',
      VITE_TAVILY_API_KEY: '',
      VITE_GROQ_API_KEY: '',
      VITE_GROQ_API_KEY_FALLBACK: '',
      VITE_TINKER_API_KEY: '',
      VITE_BROWSERBASE_API_KEY: '',
      VITE_EXA_API_KEY: '',
      VITE_FAL_KEY: '',
      VITE_NVIDIA_API_KEY: '',
      VITE_NVIDIA_ORG_ID: '',
      TAVILY_API_KEY: '',
      FIRECRAWL_API_KEY: '',
      GROQ_API_KEY: '',
      GROQ_API_KEY_FALLBACK: '',
      EXA_API_KEY: '',
      NVIDIA_API_KEY: '',
    },
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
