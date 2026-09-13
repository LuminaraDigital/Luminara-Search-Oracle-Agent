#!/usr/bin/env node
/**
 * Reports whether Authenticode signing secrets are available for desktop CI.
 * Does not print secret values. Exit 0 always so local checks stay informative;
 * CI can set --require to fail unsigned public builds.
 */
const requireSigned = process.argv.includes('--require');
const hasLink = Boolean(process.env.WIN_CSC_LINK && String(process.env.WIN_CSC_LINK).trim());
const hasPass = Boolean(process.env.WIN_CSC_KEY_PASSWORD && String(process.env.WIN_CSC_KEY_PASSWORD).trim());

if (hasLink && hasPass) {
  console.log('[desktop-signing] READY: WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD are set (values not shown).');
  process.exit(0);
}

const missing = [];
if (!hasLink) missing.push('WIN_CSC_LINK');
if (!hasPass) missing.push('WIN_CSC_KEY_PASSWORD');

console.log(
  `[desktop-signing] UNSIGNED: missing GitHub Actions secrets ${missing.join(', ')}. ` +
    'Windows SmartScreen will warn until you buy an Authenticode cert (OV/EV), ' +
    'base64-encode the PFX into WIN_CSC_LINK, set WIN_CSC_KEY_PASSWORD, and rebuild desktop-v*. See docs/desktop-distribution.md.',
);

if (requireSigned) {
  process.exit(1);
}
process.exit(0);
