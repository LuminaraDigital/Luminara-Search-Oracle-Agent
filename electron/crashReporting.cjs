'use strict';

/**
 * Crash reporting and fatal-error logging for the desktop shell.
 *
 * The crash endpoint is never hardcoded; it comes from the environment
 * (packaged builds read user/system env vars, dev reads the shell env):
 * - CRASH_REPORT_URL: full minidump submit URL, used as-is.
 * - SENTRY_DSN: Sentry project DSN, converted to the minidump endpoint.
 *
 * Pure helpers stay testable without launching Electron; the wiring functions
 * take injectable deps the same way updater.cjs / desktopPrefs.cjs do.
 */

const fs = require('node:fs');
const path = require('node:path');

/** Absolute path of the main-process log file under userData. */
function mainLogPath(userDataDir) {
  return path.join(userDataDir, 'logs', 'main.log');
}

/** Convert a Sentry DSN into the minidump submit URL crashReporter expects. */
function sentryDsnToSubmitUrl(rawDsn) {
  let parsed;
  try {
    parsed = new URL(String(rawDsn));
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  const projectId = segments.pop();
  let publicKey = '';
  try {
    publicKey = decodeURIComponent(parsed.username || '');
  } catch {
    publicKey = parsed.username || '';
  }
  if (!projectId || !publicKey) return null;

  const basePath = segments.join('/');
  const submit = new URL(parsed.origin);
  submit.pathname = basePath
    ? `/${basePath}/api/${projectId}/minidump/`
    : `/api/${projectId}/minidump/`;
  submit.searchParams.set('sentry_key', publicKey);
  submit.searchParams.set('sentry_version', '7');
  return submit.toString();
}

/**
 * Resolve the crash endpoint from env. CRASH_REPORT_URL wins; SENTRY_DSN is
 * converted. Returns null when nothing usable is configured.
 * @param {Record<string, string | undefined> | undefined} env
 * @returns {string | null}
 */
function resolveCrashEndpoint(env) {
  const rawUrl = String(env?.CRASH_REPORT_URL || '').trim();
  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.toString();
    } catch {
      // fall through to SENTRY_DSN
    }
  }
  const dsn = String(env?.SENTRY_DSN || '').trim();
  if (dsn) return sentryDsnToSubmitUrl(dsn);
  return null;
}

/** Compact one-line error rendering for logs and dialogs. */
function formatError(value) {
  if (value instanceof Error) {
    const head = `${value.name}: ${value.message}`;
    if (!value.stack) return head;
    const frames = String(value.stack).split('\n').slice(1, 3).join(' | ');
    return frames ? `${head} (${frames.trim()})` : head;
  }
  return String(value);
}

/**
 * Best-effort timestamped append to logs/main.log under userData.
 * Never throws.
 * @returns {boolean} true when the line was written.
 */
function appendMainLog(userDataDir, line) {
  try {
    const file = mainLogPath(userDataDir);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const flat = String(line).replace(/\r?\n/g, ' ');
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${flat}\n`, 'utf8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the native crash reporter when an endpoint is configured.
 * Logs exactly one line when no endpoint exists; never throws.
 */
function setupCrashReporting({ app, crashReporter, env = process.env, log = console.log }) {
  const endpoint = resolveCrashEndpoint(env);
  if (!endpoint) {
    log('crash reporting disabled: no endpoint configured');
    return { started: false, reason: 'no_endpoint' };
  }
  if (typeof crashReporter?.start !== 'function') {
    log('crash reporting disabled: crashReporter unavailable');
    return { started: false, reason: 'no_reporter' };
  }
  try {
    crashReporter.start({
      productName: String(app?.name || 'Luminara Suite'),
      submitURL: endpoint,
      uploadToServer: true,
      ignoreSystemCrashHandler: false,
      extra: {
        shellVersion: String(app?.getVersion?.() || 'unknown'),
        platform: process.platform,
      },
    });
  } catch (err) {
    log(`crash reporting failed to start: ${formatError(err)}`);
    return { started: false, reason: 'start_failed' };
  }
  // Never log the endpoint itself: it can carry an access token.
  log('crash reporting enabled');
  return { started: true };
}

/**
 * Log uncaught exceptions and unhandled rejections to logs/main.log and show a
 * deferred (non-blocking) native error dialog for uncaught exceptions.
 * Never throws from the handlers.
 */
function installProcessErrorHandlers({
  app,
  dialog,
  append = appendMainLog,
  schedule = (fn) => setTimeout(fn, 0),
  target = process,
}) {
  const userDataDir = () => {
    try {
      return app.getPath('userData');
    } catch {
      return null;
    }
  };

  function record(kind, value) {
    const dir = userDataDir();
    if (!dir) return;
    try {
      append(dir, `${kind}: ${formatError(value)}`);
    } catch {
      // best-effort: never throw from an error handler
    }
  }

  let dialogScheduled = false;
  const onUncaughtException = (err) => {
    record('uncaughtException', err);
    if (dialogScheduled) return;
    dialogScheduled = true;
    schedule(() => {
      dialogScheduled = false;
      try {
        dialog?.showErrorBox?.(
          'Luminara Suite',
          `An unexpected error occurred:\n\n${formatError(err)}\n\nDetails were saved to the desktop log.`,
        );
      } catch {
        // best-effort
      }
    });
  };

  const onUnhandledRejection = (reason) => {
    record('unhandledRejection', reason);
  };

  target.on('uncaughtException', onUncaughtException);
  target.on('unhandledRejection', onUnhandledRejection);

  return { onUncaughtException, onUnhandledRejection };
}

module.exports = {
  mainLogPath,
  sentryDsnToSubmitUrl,
  resolveCrashEndpoint,
  formatError,
  appendMainLog,
  setupCrashReporting,
  installProcessErrorHandlers,
};