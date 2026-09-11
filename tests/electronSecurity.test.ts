import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createNavigationGuard } = require('../electron/security.cjs') as {
  createNavigationGuard: (options: { allowedOrigins: string[] }) => {
    isAllowed: (url: string) => boolean;
  };
};

describe('electron navigation guard', () => {
  const guard = createNavigationGuard({
    allowedOrigins: ['https://luminarasuite.com', 'https://www.luminarasuite.com'],
  });

  it('allows the suite origin and auth hosts', () => {
    expect(guard.isAllowed('https://luminarasuite.com/app')).toBe(true);
    expect(guard.isAllowed('https://accounts.google.com/o/oauth2')).toBe(true);
    expect(guard.isAllowed('https://luminara-suite.firebaseapp.com/__/auth/handler')).toBe(true);
  });

  it('blocks unrelated hosts', () => {
    expect(guard.isAllowed('https://evil.example/phish')).toBe(false);
    expect(guard.isAllowed('javascript:alert(1)')).toBe(false);
  });
});
