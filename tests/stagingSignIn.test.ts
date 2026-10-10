import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIREBASE_PUBLIC_CONFIG, resolveFirebaseWebConfig } from '../services/auth/firebasePublicConfig';
import { MINI_APP_URL, PRODUCTION_MINI_APP_URL, inviteUrlForCode, resolveMiniAppUrl } from '../services/referrals/rules';
import { TELEGRAM_MINI_APP_URL } from '../components/paywall/paymentOptions';
import { parseTeaserCreateBody } from '../worker/shareService';
import { parseJsonc } from '../scripts/lib/jsonc.mjs';

/**
 * Track SW, SW0a-14: staging can be signed in to. The staging build takes its own Firebase web
 * config and its own bot link from configuration; the production build is unchanged.
 */

const root = resolve(__dirname, '..');
const STAGING = {
  MODE: 'staging',
  VITE_FIREBASE_API_KEY: 'staging-web-api-value',
  VITE_FIREBASE_AUTH_DOMAIN: 'luminara-suite-staging.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'luminara-suite-staging',
  VITE_FIREBASE_APP_ID: '1:1:web:staging',
};

describe('the Firebase web config a build signs in with', () => {
  it('a production build with no overrides uses the published production project, unchanged', () => {
    expect(resolveFirebaseWebConfig({ MODE: 'production' })).toEqual({
      apiKey: FIREBASE_PUBLIC_CONFIG.apiKey,
      authDomain: 'luminara-suite.firebaseapp.com',
      projectId: 'luminara-suite',
      appId: FIREBASE_PUBLIC_CONFIG.appId,
      messagingSenderId: FIREBASE_PUBLIC_CONFIG.messagingSenderId,
      storageBucket: FIREBASE_PUBLIC_CONFIG.storageBucket,
    });
    expect(resolveFirebaseWebConfig({})?.projectId).toBe('luminara-suite');
    expect(resolveFirebaseWebConfig({ MODE: 'development' })?.projectId).toBe('luminara-suite');
  });

  it('a production build still lets each value be overridden', () => {
    expect(resolveFirebaseWebConfig({ MODE: 'production', VITE_FIREBASE_PROJECT_ID: 'other' })?.projectId).toBe('other');
  });

  it('a staging build with its own values signs in against the staging project', () => {
    const cfg = resolveFirebaseWebConfig(STAGING);
    expect(cfg).toMatchObject({ projectId: 'luminara-suite-staging', authDomain: 'luminara-suite-staging.firebaseapp.com' });
    // Nothing from the production project leaks in, optional fields included.
    expect(cfg?.messagingSenderId).toBeUndefined();
    expect(cfg?.storageBucket).toBeUndefined();
    expect(JSON.stringify(cfg)).not.toContain(FIREBASE_PUBLIC_CONFIG.apiKey);
  });

  it.each(['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'])(
    'a staging build missing %s is not configured, and never falls back to the production project',
    (missing) => {
      expect(resolveFirebaseWebConfig({ ...STAGING, [missing]: '' })).toBeNull();
      expect(resolveFirebaseWebConfig({ ...STAGING, [missing]: undefined })).toBeNull();
    },
  );

  it('a staging build with nothing set is not configured', () => {
    expect(resolveFirebaseWebConfig({ MODE: 'staging' })).toBeNull();
  });

  it('the staging Worker verifies the staging project, which is why the fallback would be refused', () => {
    const wrangler = parseJsonc(readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8')) as any;
    expect(wrangler.env.staging.vars.FIREBASE_PROJECT_ID).toBe('luminara-suite-staging');
    expect(wrangler.env.production.vars.FIREBASE_PROJECT_ID).toBe(FIREBASE_PUBLIC_CONFIG.projectId);
  });
});

describe('the Mini App link', () => {
  it('is the published production link when nothing is configured', () => {
    expect(PRODUCTION_MINI_APP_URL).toBe('https://t.me/LuminaraSuiteBot/app');
    expect(MINI_APP_URL).toBe(PRODUCTION_MINI_APP_URL);
    expect(TELEGRAM_MINI_APP_URL).toBe(PRODUCTION_MINI_APP_URL);
    for (const nothing of [undefined, null, '', '   ', 42]) expect(resolveMiniAppUrl(nothing)).toBe(PRODUCTION_MINI_APP_URL);
  });

  it('accepts a t.me bot link, with or without an app name', () => {
    expect(resolveMiniAppUrl('https://t.me/LuminaraStagingBot/app')).toBe('https://t.me/LuminaraStagingBot/app');
    expect(resolveMiniAppUrl(' https://t.me/LuminaraStagingBot ')).toBe('https://t.me/LuminaraStagingBot');
  });

  it.each([
    'http://t.me/LuminaraStagingBot/app',
    'https://t.me.evil.example/LuminaraStagingBot/app',
    'https://evil.example/?https://t.me/LuminaraStagingBot/app',
    'https://t.me/LuminaraStagingBot/app?startapp=x',
    'https://t.me/LuminaraStagingBot/app/extra',
    'https://t.me/ab',
    'javascript:alert(1)',
  ])('falls back to the production link for %s', (bad) => {
    expect(resolveMiniAppUrl(bad)).toBe(PRODUCTION_MINI_APP_URL);
  });

  it('invite links and share teasers written by the Worker use the configured bot', () => {
    expect(inviteUrlForCode('abcdefghj2')).toBe('https://t.me/LuminaraSuiteBot/app?startapp=ref_abcdefghj2');
    expect(inviteUrlForCode('abcdefghj2', 'https://t.me/LuminaraStagingBot/app')).toBe(
      'https://t.me/LuminaraStagingBot/app?startapp=ref_abcdefghj2',
    );
    const body = { domain: 'example.com', verdict: 'Readable by crawlers.', topFix: 'Add an llms.txt file.' };
    const byDefault = parseTeaserCreateBody(body);
    const onStaging = parseTeaserCreateBody(body, 'https://t.me/LuminaraStagingBot/app');
    expect(byDefault.ok && byDefault.payload.ctaUrl).toBe(PRODUCTION_MINI_APP_URL);
    expect(onStaging.ok && onStaging.payload.ctaUrl).toBe('https://t.me/LuminaraStagingBot/app');
  });

  it('the Worker variable exists, empty, in all three wrangler blocks', () => {
    const wrangler = parseJsonc(readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8')) as any;
    expect(wrangler.vars.TELEGRAM_MINI_APP_URL).toBe('');
    expect(wrangler.env.staging.vars.TELEGRAM_MINI_APP_URL).toBe('');
    expect(wrangler.env.production.vars.TELEGRAM_MINI_APP_URL).toBe('');
  });
});

describe('the deploy workflow', () => {
  const workflow = readFileSync(resolve(root, '.github', 'workflows', 'deploy-cloudflare.yml'), 'utf8').replace(/\r\n/g, '\n');
  const stagingJob = workflow.slice(workflow.indexOf('  deploy_staging:'), workflow.indexOf('  deploy_production:'));
  const productionJob = workflow.slice(workflow.indexOf('  deploy_production:'));

  it('gives the staging build its own values from the staging environment variables', () => {
    for (const name of [
      'VITE_FIREBASE_API_KEY',
      'VITE_FIREBASE_AUTH_DOMAIN',
      'VITE_FIREBASE_PROJECT_ID',
      'VITE_FIREBASE_APP_ID',
      'VITE_TELEGRAM_MINI_APP_URL',
    ]) {
      expect(stagingJob).toContain(`${name}: \${{ vars.${name} }}`);
    }
    expect(stagingJob).toContain('environment: staging');
    expect(stagingJob).toContain('run: npx vite build --mode staging');
  });

  it('leaves the production build exactly as it was: no build-time overrides', () => {
    expect(productionJob).not.toContain('VITE_FIREBASE_');
    expect(productionJob).not.toContain('VITE_TELEGRAM_MINI_APP_URL');
    expect(productionJob).toContain('run: npm run build');
  });

  it('reads public config from variables, never from secrets', () => {
    expect(workflow).not.toMatch(/VITE_[A-Z_]+: \$\{\{ secrets\./);
  });
});
