import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { DashboardView } from '../components/suite/DashboardView';
import { auditHistoryService } from '../services/audit/auditHistoryService';
import { productTelemetry } from '../services/analytics/productTelemetry';
import { AppView } from '../types';

const storage: Record<string, string> = {};
const mockStorage = {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => { storage[key] = String(value); },
  removeItem: (key: string) => { delete storage[key]; },
  clear: () => { Object.keys(storage).forEach((key) => delete storage[key]); },
};
Object.assign(globalThis, { localStorage: mockStorage, sessionStorage: mockStorage });

function auditStep(html: string): string {
  const start = html.indexOf('1. Run Instant Audit');
  const end = html.indexOf('2. Set business profile');
  return html.slice(start, end);
}

describe('dashboard onboarding and labs', () => {
  beforeEach(() => {
    mockStorage.clear();
    auditHistoryService.clear();
    storage.luminara_advanced_ui = '0';
  });

  it('does not mark Instant Audit done before a saved audit', () => {
    productTelemetry.recordOnboardingStep('quick_scout');
    sessionStorage.setItem('luminara_last_board_domain', 'clinic.example');
    const html = renderToStaticMarkup(createElement(DashboardView, {
      onNavigate: () => {},
      dna: null,
      advancedUi: true,
      signedIn: true,
    }));
    expect(auditStep(html)).toContain('Next');
    expect(auditStep(html)).not.toContain('Done');
  });

  it('marks Instant Audit done after a saved audit and hides labs outside dev', () => {
    auditHistoryService.record({
      domain: 'clinic.example',
      focus: 'AEO',
      reportText: 'Measured audit',
      title: 'Audit',
    });
    const html = renderToStaticMarkup(createElement(DashboardView, {
      onNavigate: (view: AppView) => { void view; },
      dna: null,
      advancedUi: true,
      signedIn: true,
    }));
    expect(auditStep(html)).toContain('Done');
    expect(html).not.toContain('DEV MODE');
  });
});
