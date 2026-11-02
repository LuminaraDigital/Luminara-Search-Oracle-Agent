import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseJsonc } from '../scripts/lib/jsonc.mjs';

describe('Staging Environment & Branch Safety Controls', () => {
  const root = resolve(__dirname, '..');

  it('wrangler.jsonc separates staging and production environments', () => {
    const wranglerPath = resolve(root, 'wrangler.jsonc');
    expect(existsSync(wranglerPath)).toBe(true);

    const content = readFileSync(wranglerPath, 'utf8');
    expect(content).toContain('"env"');
    expect(content).toContain('"staging"');
    expect(content).toContain('"production"');

    // Staging routes and isolated databases / storage
    expect(content).toContain('staging.luminarasuite.com');
    expect(content).toContain('luminara-users-staging');
    expect(content).toContain('luminara-desktop-releases-staging');
    expect(content).toContain('luminara-audit-jobs-staging');
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
    expect(ciContent).toContain('Enforce staging-only merges into main');

    const deployContent = readFileSync(deployPath, 'utf8');
    expect(deployContent).toContain('deploy_staging');
    expect(deployContent).toContain('deploy_production');
    expect(deployContent).toContain('deploy --env staging');
    expect(deployContent).toContain('deploy --env production');
  });

  it('package.json deploy and remote D1 migration scripts always pass explicit --env flags', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts || {};
    expect(scripts.deploy).toContain('wrangler deploy --env production');
    expect(scripts['deploy:staging']).toContain('wrangler deploy --env staging');
    expect(scripts['db:migrate']).toContain('wrangler d1 migrations apply luminara-users --remote --env production');
    expect(scripts['db:migrate:staging']).toContain(
      'wrangler d1 migrations apply luminara-users-staging --remote --env staging',
    );
  });

  it('wrangler.jsonc keeps top-level bindings in parity with env.production and isolated from env.staging', () => {
    const config = parseJsonc(readFileSync(resolve(root, 'wrangler.jsonc'), 'utf8')) as {
      d1_databases?: Array<{ database_id?: string; database_name?: string }>;
      kv_namespaces?: Array<{ id?: string }>;
      r2_buckets?: Array<{ bucket_name?: string }>;
      queues?: unknown;
      routes?: unknown;
      vars?: Record<string, string>;
      env?: {
        staging?: {
          d1_databases?: Array<{ database_id?: string; database_name?: string }>;
          kv_namespaces?: Array<{ id?: string }>;
          r2_buckets?: Array<{ bucket_name?: string }>;
          vars?: Record<string, string>;
        };
        production?: {
          d1_databases?: Array<{ database_id?: string; database_name?: string }>;
          kv_namespaces?: Array<{ id?: string }>;
          r2_buckets?: Array<{ bucket_name?: string }>;
          queues?: unknown;
          routes?: unknown;
          vars?: Record<string, string>;
        };
      };
    };

    const prod = config.env?.production;
    const staging = config.env?.staging;
    expect(prod).toBeDefined();
    expect(staging).toBeDefined();

    expect(config.d1_databases).toEqual(prod?.d1_databases);
    expect(config.kv_namespaces).toEqual(prod?.kv_namespaces);
    expect(config.r2_buckets).toEqual(prod?.r2_buckets);
    expect(config.queues).toEqual(prod?.queues);
    expect(config.routes).toEqual(prod?.routes);

    expect(staging?.d1_databases?.[0]?.database_id).not.toBe(prod?.d1_databases?.[0]?.database_id);
    expect(staging?.kv_namespaces?.[0]?.id).not.toBe(prod?.kv_namespaces?.[0]?.id);
    expect(staging?.r2_buckets?.[0]?.bucket_name).not.toBe(prod?.r2_buckets?.[0]?.bucket_name);

    expect(config.vars?.STRIPE_CHECKOUT_LIVE).toBe('false');
    expect(staging?.vars?.STRIPE_CHECKOUT_LIVE).toBe('true');
    expect(prod?.vars?.STRIPE_CHECKOUT_LIVE).toBe('true');
  });

  it('scripts/validate-env.mjs passes for both production and staging modes', () => {
    const prodRes = spawnSync(process.execPath, [resolve(root, 'scripts/validate-env.mjs'), '--prod'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(prodRes.status).toBe(0);

    const stagingRes = spawnSync(process.execPath, [resolve(root, 'scripts/validate-env.mjs'), '--staging'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(stagingRes.status).toBe(0);
  });
});
