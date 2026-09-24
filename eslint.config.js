import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

/**
 * Industry baseline: catch real bugs without forcing a whole-repo rewrite.
 * Typecheck remains the strict correctness gate (tsc).
 * React Compiler-era hooks rules stay off until components are migrated.
 */
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'release/**',
      'open-seo/**',
      'Switchyard/**',
      'scratch/**',
      'tmp/**',
      'build/**',
      'crawler/**',
      'electron/**',
      'services/skills/playbooks.generated.json',
      '**/*.min.js',
      '.wrangler/**',
      '.agents/**',
      '.claude/**',
      '.cursor/**',
      '.hallmark/**',
      '.hermes/**',
      'tmp-*.json',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-useless-escape': 'warn',
      'prefer-const': 'warn',
      'no-undef': 'off',
      'no-control-regex': 'warn',
    },
  },
);
