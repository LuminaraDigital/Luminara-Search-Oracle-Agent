import { describe, expect, it } from 'vitest';
import { isChunkLoadError } from '../utils/lazyWithReload';

describe('isChunkLoadError', () => {
  it('detects Vite dynamic import fetch failures', () => {
    expect(
      isChunkLoadError(
        new Error('Failed to fetch dynamically imported module: https://www.luminarasuite.com/assets/PaywallModal-CcWXXQia.js'),
      ),
    ).toBe(true);
  });

  it('detects Chrome module script failures', () => {
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isChunkLoadError(new Error('Buffer is not defined'))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});
