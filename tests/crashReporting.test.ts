import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  mainLogPath,
  sentryDsnToSubmitUrl,
  resolveCrashEndpoint,
  formatError,
  appendMainLog,
  setupCrashReporting,
  installProcessErrorHandlers,
} = require('../electron/crashReporting.cjs') as {
  mainLogPath: (dir: string) => string;
  sentryDsnToSubmitUrl: (dsn: string) => string | null;
  resolveCrashEndpoint: (env: Record<string, string | undefined>) => string | null;
  formatError: (value: unknown) => string;
  appendMainLog: (dir: string, line: string) => boolean;
  setupCrashReporting: (opts: {
    app: { name?: string; getVersion?: () => string };
    crashReporter?: { start: (opts: Record<string, unknown>) => void };
    env?: Record<string, string | undefined>;
    log?: (line: string) => void;
  }) => { started: boolean; reason?: string };
  installProcessErrorHandlers: (opts: {
    app: { getPath: (name: string) => string };
    dialog?: { showErrorBox: (title: string, content: string) => void };
    append?: (dir: string, line: string) => boolean;
    schedule?: (fn: () => void) => void;
    target?: { on: (event: string, cb: (arg: unknown) => void) => void };
  }) => { onUncaughtException: (err: unknown) => void; onUnhandledRejection: (reason: unknown) => void };
};

describe('crash endpoint resolution', () => {
  it('returns null with no endpoint configured and emits exactly one disable line', () => {
    const lines: string[] = [];
    const result = setupCrashReporting({
      app: { name: 'Luminara Suite', getVersion: () => '1.0.2' },
      crashReporter: { start: () => {} },
      env: {},
      log: (l) => lines.push(l),
    });
    expect(result.started).toBe(false);
    expect(result.reason).toBe('no_endpoint');
    expect(lines).toEqual(['crash reporting disabled: no endpoint configured']);
  });

  it('prefers CRASH_REPORT_URL and passes it through as the submit URL', () => {
    const started: Record<string, unknown>[] = [];
    const result = setupCrashReporting({
      app: { name: 'Luminara Suite', getVersion: () => '1.0.2' },
      crashReporter: { start: (o) => started.push(o) },
      env: { CRASH_REPORT_URL: 'https://crash.example.com/submit' },
      log: () => {},
    });
    expect(result.started).toBe(true);
    expect(started[0].submitURL).toBe('https://crash.example.com/submit');
    expect(started[0].uploadToServer).toBe(true);
  });

  it('supports SENTRY_DSN by converting it to the minidump endpoint', () => {
    const started: Record<string, unknown>[] = [];
    const result = setupCrashReporting({
      app: { name: 'Luminara Suite', getVersion: () => '1.0.2' },
      crashReporter: { start: (o) => started.push(o) },
      env: { SENTRY_DSN: 'https://abc123@sentry.example.io/42' },
      log: () => {},
    });
    expect(result.started).toBe(true);
    expect(started[0].submitURL).toBe(
      'https://sentry.example.io/api/42/minidump/?sentry_key=abc123&sentry_version=7',
    );
  });

  it('converts a DSN with a base path', () => {
    expect(sentryDsnToSubmitUrl('https://k@example.io/sentry/7')).toBe(
      'https://example.io/sentry/api/7/minidump/?sentry_key=k&sentry_version=7',
    );
  });

  it('rejects malformed DSNs and non-http URLs', () => {
    expect(sentryDsnToSubmitUrl('not-a-url')).toBeNull();
    expect(sentryDsnToSubmitUrl('ftp://key@example.io/1')).toBeNull();
    expect(sentryDsnToSubmitUrl('https://example.io/1')).toBeNull();
    expect(resolveCrashEndpoint({ CRASH_REPORT_URL: 'file:///etc/passwd' })).toBeNull();
  });

  it('never starts when crashReporter is unavailable', () => {
    const lines: string[] = [];
    const result = setupCrashReporting({
      app: {},
      crashReporter: undefined,
      env: { CRASH_REPORT_URL: 'https://crash.example.com/submit' },
      log: (l) => lines.push(l),
    });
    expect(result.started).toBe(false);
    expect(result.reason).toBe('no_reporter');
    expect(lines).toEqual(['crash reporting disabled: crashReporter unavailable']);
  });

  it('reports a start failure instead of crashing the shell', () => {
    const lines: string[] = [];
    const result = setupCrashReporting({
      app: {},
      crashReporter: {
        start: () => {
          throw new Error('boom');
        },
      },
      env: { CRASH_REPORT_URL: 'https://crash.example.com/submit' },
      log: (l) => lines.push(l),
    });
    expect(result.started).toBe(false);
    expect(result.reason).toBe('start_failed');
    expect(lines[0]).toContain('crash reporting failed to start');
  });
});

describe('main log helpers', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('resolves the log path under userData/logs', () => {
    expect(mainLogPath(join('data', 'Luminara'))).toBe(
      join('data', 'Luminara', 'logs', 'main.log'),
    );
  });

  it('appends timestamped single-line entries and never throws', () => {
    const dir = mkdtempSync(join(tmpdir(), 'luminara-crash-'));
    dirs.push(dir);
    expect(appendMainLog(dir, 'uncaughtException: Error: kaboom\nwith newline')).toBe(true);
    const raw = readFileSync(mainLogPath(dir), 'utf8');
    expect(raw).toMatch(/^\[\d{4}-\d{2}-\d{2}T/);
    expect(raw).toContain('] uncaughtException: Error: kaboom with newline\n');
    // Corrupt setup (read-only path replaced by a file) still does not throw.
    const fileAsDir = join(dir, 'iamafile.txt');
    rmSync(mainLogPath(dir));
    writeFileSync(fileAsDir, 'x');
    expect(appendMainLog(fileAsDir, 'nope')).toBe(false);
  });

  it('formats errors compactly with a stack preview', () => {
    const err = new Error('kaboom');
    expect(formatError(err)).toContain('Error: kaboom');
    expect(formatError('plain string')).toBe('plain string');
    expect(formatError(42)).toBe('42');
  });
});

describe('process error handlers', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('logs uncaughtException and unhandledRejection, shows a deferred dialog once', () => {
    const dir = mkdtempSync(join(tmpdir(), 'luminara-crash-'));
    dirs.push(dir);
    const lines: string[] = [];
    const dialogs: string[] = [];
    const scheduled: (() => void)[] = [];

    const handlers = installProcessErrorHandlers({
      app: { getPath: () => dir },
      dialog: { showErrorBox: (_t, c) => dialogs.push(c) },
      append: (_d, line) => {
        lines.push(line);
        return true;
      },
      schedule: (fn) => scheduled.push(fn),
      target: { on: () => {} },
    });

    handlers.onUncaughtException(new Error('first'));
    handlers.onUncaughtException(new Error('second'));
    handlers.onUnhandledRejection('rejected value');

    // Dialog is deferred (non-blocking) and deduplicated until flushed.
    expect(dialogs).toEqual([]);
    scheduled.forEach((fn) => fn());
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]).toContain('Error: first');
    expect(dialogs[0]).toContain('desktop log');

    // formatError appends a one-line stack preview to Error values; strip that
    // volatile suffix so the assertion checks the message, not the frame paths.
    const stripPreview = (l: string) => l.replace(/^\[[^\]]+\] /, '').replace(/\s+\(at .*\)$/, '');
    expect(lines.map(stripPreview)).toEqual([
      'uncaughtException: Error: first',
      'uncaughtException: Error: second',
      'unhandledRejection: rejected value',
    ]);
  });

  it('survives append and dialog failures without throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'luminara-crash-'));
    dirs.push(dir);
    const handlers = installProcessErrorHandlers({
      app: { getPath: () => dir },
      dialog: {
        showErrorBox: () => {
          throw new Error('dialog blew up');
        },
      },
      append: () => {
        throw new Error('append blew up');
      },
      schedule: (fn) => fn(),
      target: { on: () => {} },
    });
    expect(() => handlers.onUncaughtException(new Error('kaboom'))).not.toThrow();
    expect(() => handlers.onUnhandledRejection(new Error('reject'))).not.toThrow();
  });

  it('skips logging entirely when userData is unavailable', () => {
    const lines: string[] = [];
    const handlers = installProcessErrorHandlers({
      app: {
        getPath: () => {
          throw new Error('no userData yet');
        },
      },
      append: (_d, line) => {
        lines.push(line);
        return true;
      },
      schedule: (fn) => fn(),
      target: { on: () => {} },
    });
    expect(() => handlers.onUnhandledRejection('x')).not.toThrow();
    expect(lines).toEqual([]);
  });
});