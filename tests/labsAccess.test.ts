import { describe, expect, it } from 'vitest';
import { labsVisible } from '../services/ui/labsAccess';

describe('labs visibility', () => {
  it('hides Labs from production sessions and keeps the dev toggle', () => {
    expect(labsVisible(false)).toBe(false);
    const storage: Record<string, string> = {};
    const previous = globalThis.localStorage;
    Object.assign(globalThis, {
      localStorage: {
        getItem: (key: string) => storage[key] ?? null,
        setItem: (key: string, value: string) => { storage[key] = value; },
        removeItem: (key: string) => { delete storage[key]; },
      },
    });
    expect(labsVisible(true)).toBe(true);
    storage.luminara_advanced_ui = '0';
    expect(labsVisible(true)).toBe(false);
    storage.luminara_advanced_ui = '1';
    expect(labsVisible(false)).toBe(false);
    Object.assign(globalThis, { localStorage: previous });
  });
});
