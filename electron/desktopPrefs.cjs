'use strict';

/**
 * Persist desktop shell preferences under Electron userData.
 * Pure enough to unit-test without launching Electron (pass a directory).
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = {
  autoUpdateEnabled: true,
};

/**
 * @param {string} userDataDir
 * @returns {string}
 */
function prefsPath(userDataDir) {
  return path.join(userDataDir, 'desktop-prefs.json');
}

/**
 * @param {string} userDataDir
 * @returns {{ autoUpdateEnabled: boolean }}
 */
function readDesktopPrefs(userDataDir) {
  try {
    const raw = fs.readFileSync(prefsPath(userDataDir), 'utf8');
    const parsed = JSON.parse(raw);
    return {
      autoUpdateEnabled:
        typeof parsed.autoUpdateEnabled === 'boolean'
          ? parsed.autoUpdateEnabled
          : DEFAULTS.autoUpdateEnabled,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/**
 * @param {string} userDataDir
 * @param {Partial<{ autoUpdateEnabled: boolean }>} patch
 * @returns {{ autoUpdateEnabled: boolean }}
 */
function writeDesktopPrefs(userDataDir, patch) {
  const next = { ...readDesktopPrefs(userDataDir), ...patch };
  if (typeof next.autoUpdateEnabled !== 'boolean') {
    next.autoUpdateEnabled = DEFAULTS.autoUpdateEnabled;
  }
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(prefsPath(userDataDir), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = {
  DEFAULTS,
  prefsPath,
  readDesktopPrefs,
  writeDesktopPrefs,
};
