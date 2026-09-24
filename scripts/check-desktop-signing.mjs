#!/usr/bin/env node
/**
 * Reports whether Authenticode signing secrets are available and whether the
 * built Windows installer under release/ is actually signed.
 * Does not print secret values.
 *
 * Modes:
 * - default: informative. Exit 0 always so local checks stay useful.
 * - --require: enforcement gate. Exit 1 when the built binary is unsigned
 *   (or missing / unverifiable), exit 0 when it carries a valid Authenticode
 *   signature. Output is the same in both modes; only the exit code differs.
 *
 * Signature inspection uses PowerShell Get-AuthenticodeSignature, so it only
 * runs on Windows (CI uses windows-latest). Off-Windows the script reports
 * secrets state only, and --require fails because it cannot verify.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const requireSigned = process.argv.includes('--require');
const hasLink = Boolean(process.env.WIN_CSC_LINK && String(process.env.WIN_CSC_LINK).trim());
const hasPass = Boolean(process.env.WIN_CSC_KEY_PASSWORD && String(process.env.WIN_CSC_KEY_PASSWORD).trim());
const secretsPresent = hasLink && hasPass;

/** Find the newest built installer under release/ (best effort). */
function findBuiltExe(releaseDir) {
  let entries;
  try {
    entries = fs.readdirSync(releaseDir);
  } catch {
    return null;
  }
  const exes = entries.filter((name) => /^Luminara-Suite-Setup-.*\.exe$/.test(name));
  if (exes.length === 0) return null;
  return exes
    .map((name) => path.join(releaseDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

/**
 * Signature status of the built installer.
 * 'signed' | 'unsigned' | 'unverifiable' | 'missing'
 */
function signatureStatus(exePath) {
  if (!exePath) return 'missing';
  if (process.platform !== 'win32') return 'unverifiable';
  try {
    const stdout = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-AuthenticodeSignature -FilePath '${exePath.replace(/'/g, "''")}').Status`,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    return stdout === 'Valid' ? 'signed' : 'unsigned';
  } catch {
    return 'unverifiable';
  }
}

const releaseDir = path.join(process.cwd(), 'release');
const builtExe = findBuiltExe(releaseDir);
const status = signatureStatus(builtExe);

if (status === 'signed') {
  console.log(`[desktop-signing] Built installer is Authenticode-signed: ${path.basename(builtExe)}`);
} else if (status === 'unsigned') {
  console.log(`[desktop-signing] Built installer is UNSIGNED: ${path.basename(builtExe)}`);
} else if (status === 'unverifiable') {
  console.log(
    `[desktop-signing] Found ${path.basename(builtExe)} but signature inspection requires Windows; cannot verify.`,
  );
}

if (secretsPresent) {
  console.log('[desktop-signing] READY: WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD are set (values not shown).');
  if (status === 'unsigned') {
    console.log(
      '[desktop-signing] FAIL: a certificate is configured but the built installer is unsigned. ' +
        'Check the electron-builder signing log and rebuild. See docs/desktop-distribution.md.',
    );
  }
} else {
  const missing = [];
  if (!hasLink) missing.push('WIN_CSC_LINK');
  if (!hasPass) missing.push('WIN_CSC_KEY_PASSWORD');
  console.log(
    `[desktop-signing] UNSIGNED: missing GitHub Actions secrets ${missing.join(', ')}. ` +
      'Windows SmartScreen will warn until you buy an Authenticode cert (OV/EV), ' +
      'base64-encode the PFX into WIN_CSC_LINK, set WIN_CSC_KEY_PASSWORD, and rebuild desktop-v*. See docs/desktop-distribution.md.',
  );
}

if (requireSigned && status !== 'signed') {
  if (status === 'missing') {
    console.log('[desktop-signing] FAIL (--require): no built installer found under release/ to verify.');
  } else if (status === 'unverifiable') {
    console.log('[desktop-signing] FAIL (--require): signature could not be verified (Windows required).');
  }
  process.exit(1);
}
process.exit(0);