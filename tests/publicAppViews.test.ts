import { describe, expect, it } from 'vitest';
import { PUBLIC_APP_VIEWS } from '../services/auth/useAppAuth';
import { AppView } from '../types';

describe('PUBLIC_APP_VIEWS (activation Slice A)', () => {
  it('allows guest Instant Audit without Firebase', () => {
    expect(PUBLIC_APP_VIEWS.has(AppView.INSTANT_AUDIT)).toBe(true);
    expect(PUBLIC_APP_VIEWS.has('INSTANT_AUDIT')).toBe(true);
  });

  it('still gates non-scout product surfaces', () => {
    expect(PUBLIC_APP_VIEWS.has(AppView.ORACLE_AGENT)).toBe(false);
    expect(PUBLIC_APP_VIEWS.has(AppView.DASHBOARD)).toBe(false);
    expect(PUBLIC_APP_VIEWS.has(AppView.BUSINESS_DNA)).toBe(false);
  });
});
