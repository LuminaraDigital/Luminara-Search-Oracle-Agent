import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Contract: docs/plans/user-activation-first-value.md decision lock
// "Settings: Never auto-open BYOK dump as first-run. Open only on explicit key
// need or post-audit CTA." Guided onboarding (DashboardView) and the zero-audit
// HomeCtaStrip own first-run activation, so App.tsx must not contain any
// first-run auto-open of the Settings/key modal.

const appSource = readFileSync(join(__dirname, '..', 'App.tsx'), 'utf8');

describe('first-run Settings auto-open removal (Slice D)', () => {
  it('App.tsx never auto-opens the key modal on first run', () => {
    expect(appSource).not.toContain('luminara_onboarding_shown');
    expect(appSource).not.toMatch(/sessionStorage[\s\S]{0,120}setIsKeyModalOpen\(true\)/);
  });

  it('manual Settings open paths stay intact', () => {
    // Explicit open paths (user action or deep link) must still exist.
    expect(appSource).toContain('luminara-open-settings');
    expect(appSource).toContain('setIsKeyModalOpen(true)');
  });
});
