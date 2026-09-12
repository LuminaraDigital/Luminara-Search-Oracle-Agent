import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Staging Environment & Branch Safety Controls', () => {
  const root = resolve(__dirname, '..');

  it('wrangler.jsonc separates staging and production environments', () => {
    const wranglerPath = resolve(root, 'wrangler.jsonc');
    expect(existsSync(wranglerPath)).toBe(true);

    const content = readFileSync(wranglerPath, 'utf8');
    expect(content).toContain('"env"');
    expect(content).toContain('"staging"');
    expect(content).toContain('"production"');

    // Staging routes and isolated databases
    expect(content).toContain('staging.luminarasuite.com');
    expect(content).toContain('luminara-users-staging');
  });

  it('example environment files exist for staging and production', () => {
    expect(existsSync(resolve(root, '.env.staging.example'))).toBe(true);
    expect(existsSync(resolve(root, '.env.production.example'))).toBe(true);
  });

  it('pre-push hook blocks direct pushes to main / prod and requires smoke tests', () => {
    const prePushPath = resolve(root, '.githooks/pre-push');
    expect(existsSync(prePushPath)).toBe(true);

    const content = readFileSync(prePushPath, 'utf8');
    expect(content).toContain('current_branch');
    expect(content).toContain('ALLOW_DIRECT_PROD_PUSH');
    expect(content).toContain('smoke-check.mjs');
    expect(content).toContain('typecheck');
  });

  it('CI and deployment workflows validate staging and smoke tests', () => {
    const ciPath = resolve(root, '.github/workflows/ci.yml');
    const deployPath = resolve(root, '.github/workflows/deploy-cloudflare.yml');

    expect(existsSync(ciPath)).toBe(true);
    expect(existsSync(deployPath)).toBe(true);

    const ciContent = readFileSync(ciPath, 'utf8');
    expect(ciContent).toContain('staging');
    expect(ciContent).toContain('env:validate');
    expect(ciContent).toContain('smoke-check.mjs');

    const deployContent = readFileSync(deployPath, 'utf8');
    expect(deployContent).toContain('deploy_staging');
    expect(deployContent).toContain('deploy_production');
    expect(deployContent).toContain('deploy --env staging');
    expect(deployContent).toContain('deploy --env production');
  });
});
