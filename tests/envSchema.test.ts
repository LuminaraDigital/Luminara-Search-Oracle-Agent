import { describe, it, expect } from 'vitest';
import { validateClientEnv, validateWorkerEnv } from '../services/env/envSchema';

describe('Environment Schema Validation', () => {
  it('validates client environment in development mode', () => {
    const res = validateClientEnv({
      MODE: 'development',
      VITE_FIREBASE_PROJECT_ID: 'luminara-suite',
    });
    expect(res.valid).toBe(true);
    expect(res.mode).toBe('development');
    expect(res.errors.length).toBe(0);
  });

  it('detects staging environment and warns if using production firebase project id', () => {
    const res = validateClientEnv({
      MODE: 'staging',
      VITE_FIREBASE_PROJECT_ID: 'luminara-suite',
    });
    expect(res.valid).toBe(true);
    expect(res.mode).toBe('staging');
    expect(res.warnings.some((w) => w.includes('luminara-suite'))).toBe(true);
  });

  it('validates worker environment and requires WEBAPP_URL', () => {
    const invalidRes = validateWorkerEnv({});
    expect(invalidRes.valid).toBe(false);
    expect(invalidRes.errors.some((e) => e.includes('WEBAPP_URL'))).toBe(true);

    const validRes = validateWorkerEnv({
      ENVIRONMENT: 'production',
      WEBAPP_URL: 'https://luminarasuite.com/',
      LUMINARA_KV: {},
    });
    expect(validRes.valid).toBe(true);
    expect(validRes.mode).toBe('production');
  });

  it('enforces staging worker cannot point to production webapp url', () => {
    const res = validateWorkerEnv({
      ENVIRONMENT: 'staging',
      WEBAPP_URL: 'https://luminarasuite.com/',
      LUMINARA_KV: {},
    });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('Staging WEBAPP_URL cannot point to production'))).toBe(true);
  });
});
