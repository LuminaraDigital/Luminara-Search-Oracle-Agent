'use strict';

/**
 * Best-effort Windows GPU/sandbox recovery inspired by Hermes Desktop patterns.
 * Does not disable sandbox unless a previous launch recorded a fatal GPU crash.
 */

const fs = require('node:fs');
const path = require('node:path');

const MARKER = 'windows-sandbox-marker.json';

/**
 * @param {import('electron').App} app
 */
function applyWindowsHardening(app) {
  if (process.platform !== 'win32') return;

  const markerPath = path.join(app.getPath('userData'), MARKER);
  let marker = { state: 'ok' };
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch {
    marker = { state: 'ok' };
  }

  if (marker.state === 'fallback' || process.env.ELECTRON_DISABLE_SANDBOX === '1') {
    app.commandLine.appendSwitch('no-sandbox');
    process.env.ELECTRON_DISABLE_SANDBOX = '1';
  }

  let relaunchAttempted = false;
  app.on('child-process-gone', (_event, details) => {
    if (relaunchAttempted) return;
    if (details?.type !== 'GPU' && details?.reason !== 'crashed') return;
    if (process.env.ELECTRON_DISABLE_SANDBOX === '1') return;

    relaunchAttempted = true;
    try {
      fs.mkdirSync(path.dirname(markerPath), { recursive: true });
      fs.writeFileSync(
        markerPath,
        JSON.stringify({ state: 'fallback', reason: 'gpu-crash', at: new Date().toISOString() }, null, 2),
      );
    } catch {
      // ignore marker write failures
    }

    const args = process.argv.slice(1).filter((a) => a !== '--no-sandbox');
    args.push('--no-sandbox');
    app.relaunch({ args });
    app.exit(0);
  });
}

module.exports = { applyWindowsHardening };
