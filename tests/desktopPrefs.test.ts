import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  readDesktopPrefs,
  writeDesktopPrefs,
  DEFAULTS,
} = require('../electron/desktopPrefs.cjs') as {
  readDesktopPrefs: (dir: string) => { autoUpdateEnabled: boolean };
  writeDesktopPrefs: (dir: string, patch: { autoUpdateEnabled?: boolean }) => { autoUpdateEnabled: boolean };
  DEFAULTS: { autoUpdateEnabled: boolean };
};

describe('desktop prefs', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('defaults automatic updates to on', () => {
    const dir = mkdtempSync(join(tmpdir(), 'luminara-prefs-'));
    dirs.push(dir);
    expect(readDesktopPrefs(dir)).toEqual(DEFAULTS);
    expect(DEFAULTS.autoUpdateEnabled).toBe(true);
  });

  it('persists automatic update toggle off and on', () => {
    const dir = mkdtempSync(join(tmpdir(), 'luminara-prefs-'));
    dirs.push(dir);
    expect(writeDesktopPrefs(dir, { autoUpdateEnabled: false }).autoUpdateEnabled).toBe(false);
    expect(readDesktopPrefs(dir).autoUpdateEnabled).toBe(false);
    expect(writeDesktopPrefs(dir, { autoUpdateEnabled: true }).autoUpdateEnabled).toBe(true);
    expect(readDesktopPrefs(dir).autoUpdateEnabled).toBe(true);
  });
});
