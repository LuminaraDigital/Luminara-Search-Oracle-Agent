import { describe, expect, it, beforeEach } from 'vitest';
import { AppView } from '../types';
import { auditHistoryService } from '../services/audit/auditHistoryService';
import {
  HOME_CTA_HEADING,
  HOME_CTA_PRIMARY_LABEL,
  HOME_CTA_SECONDARY_LABEL,
  HOME_CTA_SUB,
  auditCountFromStorage,
  homeCtaTarget,
  shouldShowHomeCta,
} from '../components/suite/homeCtaStripLogic';

// Minimal localStorage shim (vitest runs in node env here; mirrors the
// approach used by tests/chatModelPicker.test.ts).
const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => storage[k] || null,
  setItem: (k: string, v: string) => { storage[k] = String(v); },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach((k) => delete storage[k]); },
};
(globalThis as any).localStorage = mockLocalStorage;

describe('HomeCtaStrip content contract', () => {
  it('exposes the heading, sub and both CTA labels', () => {
    expect(HOME_CTA_HEADING).toBe('Run your first audit');
    expect(HOME_CTA_SUB).toContain('SEO, AEO and GEO');
    expect(HOME_CTA_PRIMARY_LABEL).toBe('Start Instant Audit');
    expect(HOME_CTA_SECONDARY_LABEL).toBe('Set up Business DNA first');
  });

  it('primary CTA targets INSTANT_AUDIT (what onNavigate receives)', () => {
    const calls: AppView[] = [];
    const onNavigate = (view: AppView) => calls.push(view);
    onNavigate(homeCtaTarget('primary'));
    expect(calls).toEqual([AppView.INSTANT_AUDIT]);
  });

  it('secondary CTA targets BUSINESS_DNA', () => {
    expect(homeCtaTarget('secondary')).toBe(AppView.BUSINESS_DNA);
  });
});

describe('zero-audit strip decision', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    auditHistoryService.clear();
  });

  it('shows the strip when the persisted audit history is empty', () => {
    expect(auditCountFromStorage()).toBe(0);
    expect(shouldShowHomeCta(auditCountFromStorage())).toBe(true);
  });

  it('hides the strip when the audit history has entries', () => {
    auditHistoryService.record({
      domain: 'https://example.com',
      focus: 'instant',
      reportText: 'Health Score: 72/100. A sample audit report with enough length to matter.',
    });
    expect(auditCountFromStorage()).toBe(1);
    expect(shouldShowHomeCta(auditCountFromStorage())).toBe(false);
  });

  it('hides the strip for any non-zero count', () => {
    expect(shouldShowHomeCta(3)).toBe(false);
    expect(shouldShowHomeCta(0)).toBe(true);
  });
});
