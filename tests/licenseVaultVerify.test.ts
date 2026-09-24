import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const seed = await import(join(repoRoot, 'scripts', 'seed-license-vault.mjs'));
const verify = await import(join(repoRoot, 'scripts', 'verify-license-vault.mjs'));

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'luminara-vault-test-'));
}

let tempDir;
beforeEach(() => {
  tempDir = makeTempDir();
});
afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe('license vault generation id', () => {
  it('matches vg_<UTC YYYYMMDD>_<8 hex> format', () => {
    const g = seed.newVaultGeneration();
    expect(g).toMatch(/^vg_\d{8}_[0-9a-f]{8}$/);
  });

  it('two generations within the same millisecond are distinct', () => {
    const a = seed.newVaultGeneration();
    const b = seed.newVaultGeneration();
    expect(a).not.toBe(b);
  });
});

describe('licenseKeySha256 worker helper', () => {
  it('returns a full 64-char hex sha256', async () => {
    const { licenseKeySha256 } = await import('../worker/auditLog');
    const hex = await licenseKeySha256('LUM-GROWTH-30D-ABCD-1234');
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches sha256 over trimmed + uppercased key, and matches the seed script helper', async () => {
    const { licenseKeySha256 } = await import('../worker/auditLog');
    const workerHex = await licenseKeySha256('  lum-growth-30d-abcd-1234  ');
    const scriptHex = seed.keySha256('LUM-GROWTH-30D-ABCD-1234');
    expect(workerHex).toBe(scriptHex);
  });
});

describe('describeLicenseKey (worker)', () => {
  it('returns exists/fingerprint/redeemed/revoked/keySha256 without the raw key', async () => {
    const { describeLicenseKey } = await import('../worker/licenseService');
    const key = 'LUM-GROWTH-30D-DESC-0001';
    const record = {
      key,
      plan: 'growth',
      durationDays: 30,
      isTrial: false,
      createdAt: 1,
      redeemed: true,
      maxRedemptions: 1,
      redemptionCount: 1,
      keySha256: seed.keySha256(key),
      vaultGeneration: 'vg_20260925_ab12cd34',
    };
    const store = new Map([[`license:key:${key}`, JSON.stringify(record)]]);
    const env = {
      LUMINARA_KV: {
        async get(k, type) {
          const v = store.get(k);
          if (v === undefined) return null;
          return type === 'json' ? JSON.parse(v) : v;
        },
      },
    };
    const desc = await describeLicenseKey(env, key);
    expect(desc.exists).toBe(true);
    expect(desc.fingerprint).toMatch(/^[0-9a-f]{12}$/);
    expect(desc.redeemed).toBe(true);
    expect(desc.revoked).toBe(false);
    expect(desc.keySha256).toBe(record.keySha256);
    expect(desc.vaultGeneration).toBe(record.vaultGeneration);
    expect(JSON.stringify(desc)).not.toContain(key);
    expect(desc).not.toHaveProperty('key');
  });

  it('returns exists:false for unknown keys', async () => {
    const { describeLicenseKey } = await import('../worker/licenseService');
    const env = { LUMINARA_KV: { async get() { return null; } } };
    const desc = await describeLicenseKey(env, 'LUM-GROWTH-30D-NOPE-0000');
    expect(desc.exists).toBe(false);
  });
});

describe('seed script: KV bulk shape', () => {
  it('writes keySha256 + vaultGeneration into each record when generation is set', () => {
    const rows = [
      { key: 'LUM-GROWTH-30D-AAAA-BBBB', plan: 'growth', durationDays: 30 },
    ];
    const [bulk] = seed.toKvBulk(rows, 'vg_20260925_abcd1234', 1);
    const record = JSON.parse(bulk.value);
    expect(record.keySha256).toBe(seed.keySha256(rows[0].key));
    expect(record.vaultGeneration).toBe('vg_20260925_abcd1234');
    expect(record.redeemed).toBe(false);
    expect(record.maxRedemptions).toBe(1);
  });
});

describe('seed script: manifest shape', () => {
  it('builds a manifest with only sha256/plan/durationDays entries', () => {
    const rows = [
      { key: 'LUM-GROWTH-30D-AAAA-BBBB', plan: 'growth', durationDays: 30 },
      { key: 'LUM-STARTER-3D-CCCC-DDDD', plan: 'starter', durationDays: 3 },
    ];
    const manifest = seed.buildManifest(rows, 'vg_20260925_abcd1234', 0);
    expect(manifest.generation).toBe('vg_20260925_abcd1234');
    expect(manifest.count).toBe(2);
    expect(manifest.entries).toHaveLength(2);
    expect(manifest.entries[0].plan).toBe('growth');
    expect(manifest.entries[0].durationDays).toBe(30);
    expect(manifest.entries[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    // Raw keys must never appear in the manifest.
    expect(JSON.stringify(manifest)).not.toContain('LUM-GROWTH-30D-AAAA-BBBB');
  });

  it('writeManifest produces a json file under .secrets with the generation in the name', () => {
    const rows = [{ key: 'LUM-GROWTH-30D-AAAA-BBBB', plan: 'growth', durationDays: 30 }];
    const manifest = seed.buildManifest(rows, 'vg_20260925_abcd1234');
    const manifestPath = seed.writeManifest(manifest, tempDir);
    expect(manifestPath).toContain('license-vault.manifest.vg_20260925_abcd1234.json');
    expect(existsSync(manifestPath)).toBe(true);
    const loaded = JSON.parse(readFileSync(manifestPath, 'utf8'));
    expect(loaded.generation).toBe('vg_20260925_abcd1234');
  });
});

describe('seed script: main guard', () => {
  it('module imports are available without running main on import', () => {
    expect(typeof seed.keySha256).toBe('function');
    expect(typeof seed.newVaultGeneration).toBe('function');
    expect(typeof seed.buildManifest).toBe('function');
    expect(typeof seed.toKvBulk).toBe('function');
    expect(typeof seed.loadVault).toBe('function');
    expect(typeof seed.writeManifest).toBe('function');
  });
});

describe('verify: reconciliation', () => {
  it('verified: remote record matches sha256 + generation + not revoked', () => {
    const key = 'LUM-GROWTH-30D-AAAA-BBBB';
    const sha = seed.keySha256(key);
    const manifest = { generation: 'vg_20260925_abcd1234', count: 1, entries: [{ sha256: sha, plan: 'growth', durationDays: 30 }] };
    const remote = new Map([['license:key:' + key, { keySha256: sha, vaultGeneration: 'vg_20260925_abcd1234', revoked: false }]]);
    const { report, ok } = verify.buildVerifyReport(manifest, remote);
    expect(ok).toBe(true);
    expect(report.verified).toBe(1);
    expect(report.missing).toHaveLength(0);
    expect(report.stale_generation).toHaveLength(0);
    expect(report.revoked).toHaveLength(0);
    expect(report.unknown_remote).toHaveLength(0);
  });

  it('missing: manifest entry has no remote record', () => {
    const sha = seed.keySha256('LUM-GROWTH-30D-AAAA-BBBB');
    const manifest = { generation: 'vg_20260925_abcd1234', count: 1, entries: [{ sha256: sha, plan: 'growth', durationDays: 30 }] };
    const remote = new Map();
    const { report, ok } = verify.buildVerifyReport(manifest, remote);
    expect(ok).toBe(false);
    expect(report.verified).toBe(0);
    expect(report.missing).toHaveLength(1);
  });

  it('stale_generation: remote record exists but vaultGeneration differs', () => {
    const key = 'LUM-GROWTH-30D-AAAA-BBBB';
    const sha = seed.keySha256(key);
    const manifest = { generation: 'vg_20260925_abcd1234', count: 1, entries: [{ sha256: sha, plan: 'growth', durationDays: 30 }] };
    const remote = new Map([['license:key:' + key, { keySha256: sha, vaultGeneration: 'vg_20260901_00000000', revoked: false }]]);
    const { report, ok } = verify.buildVerifyReport(manifest, remote);
    expect(ok).toBe(false);
    expect(report.stale_generation).toHaveLength(1);
    expect(report.verified).toBe(0);
  });

  it('revoked: remote record exists but is revoked', () => {
    const key = 'LUM-GROWTH-30D-AAAA-BBBB';
    const sha = seed.keySha256(key);
    const manifest = { generation: 'vg_20260925_abcd1234', count: 1, entries: [{ sha256: sha, plan: 'growth', durationDays: 30 }] };
    const remote = new Map([['license:key:' + key, { keySha256: sha, vaultGeneration: 'vg_20260925_abcd1234', revoked: true }]]);
    const { report, ok } = verify.buildVerifyReport(manifest, remote);
    expect(ok).toBe(false);
    expect(report.revoked).toHaveLength(1);
    expect(report.verified).toBe(0);
  });

  it('legacy: pre-rotation remote records without keySha256 land in unknown_remote flagged legacy', () => {
    const legacyKey = 'LUM-GROWTH-30D-LEGA-CY01';
    const sha = seed.keySha256('LUM-GROWTH-30D-AAAA-BBBB');
    const manifest = { generation: 'vg_20260925_abcd1234', count: 1, entries: [{ sha256: sha, plan: 'growth', durationDays: 30 }] };
    const remote = new Map([
      ['license:key:LUM-GROWTH-30D-AAAA-BBBB', { keySha256: sha, vaultGeneration: 'vg_20260925_abcd1234', revoked: false }],
      ['license:key:' + legacyKey, { key: legacyKey, plan: 'agency', durationDays: 365, redeemed: false }], // no keySha256
    ]);
    const { report, ok } = verify.buildVerifyReport(manifest, remote);
    expect(ok).toBe(true);
    expect(report.verified).toBe(1);
    expect(report.legacy).toBe(1);
    expect(report.unknown_remote).toHaveLength(1);
    expect(report.unknown_remote[0].legacy).toBe(true);
  });

  it('unknown_remote: remote key with a sha256 not present in the manifest', () => {
    const sha = seed.keySha256('LUM-GROWTH-30D-AAAA-BBBB');
    const otherSha = seed.keySha256('LUM-GROWTH-30D-ZZZZ-9999');
    const manifest = { generation: 'vg_20260925_abcd1234', count: 1, entries: [{ sha256: sha, plan: 'growth', durationDays: 30 }] };
    const remote = new Map([
      ['license:key:LUM-GROWTH-30D-AAAA-BBBB', { keySha256: sha, vaultGeneration: 'vg_20260925_abcd1234', revoked: false }],
      ['license:key:LUM-GROWTH-30D-ZZZZ-9999', { keySha256: otherSha, vaultGeneration: 'vg_20260925_abcd1234', revoked: false }],
    ]);
    const { report, ok } = verify.buildVerifyReport(manifest, remote);
    expect(ok).toBe(true);
    expect(report.unknown_remote).toHaveLength(1);
    expect(report.unknown_remote[0].ref).toBe(otherSha);
    expect(report.unknown_remote[0].legacy).toBe(false);
  });

  it('pagination: many remote keys across synthetic pages still reconcile correctly', () => {
    const manifestEntries = [];
    const remote = new Map();
    const generation = 'vg_20260925_abcd1234';
    for (let i = 0; i < 25; i++) {
      const key = `LUM-GROWTH-30D-PAGE-${String(i).padStart(4, '0')}`;
      const sha = seed.keySha256(key);
      manifestEntries.push({ sha256: sha, plan: 'growth', durationDays: 30 });
      remote.set(`license:key:${key}`, { keySha256: sha, vaultGeneration: generation, revoked: i % 7 === 0 && i !== 0 });
    }
    const manifest = { generation, count: manifestEntries.length, entries: manifestEntries };
    const { report } = verify.buildVerifyReport(manifest, remote);
    expect(report.total).toBe(25);
    expect(report.verified + report.revoked.length).toBe(25);
  });

  it('report format: human summary prints counts only and JSON has structured fields', () => {
    const key = 'LUM-GROWTH-30D-AAAA-BBBB';
    const sha = seed.keySha256(key);
    const manifest = { generation: 'vg_20260925_abcd1234', count: 1, entries: [{ sha256: sha, plan: 'growth', durationDays: 30 }] };
    const remote = new Map([['license:key:' + key, { keySha256: sha, vaultGeneration: 'vg_20260925_abcd1234', revoked: false }]]);
    const { report } = verify.buildVerifyReport(manifest, remote);
    const human = verify.formatHumanReport(report);
    expect(human).toContain('verified 1/1');
    expect(human).toContain('vg_20260925_abcd1234');
    expect(human).not.toContain(key);
    const json = JSON.parse(verify.formatJsonReport(report));
    expect(json.ok).toBe(true);
    expect(json.verified).toBe(1);
    expect(json.total).toBe(1);
  });
});

describe('verify: manifest loading', () => {
  it('newest manifest is picked from a directory with multiple generations', () => {
    writeFileSync(join(tempDir, 'license-vault.manifest.vg_20260901_00000000.json'), JSON.stringify({ generation: 'vg_20260901_00000000', count: 1, entries: [{ sha256: 'a'.repeat(64), plan: 'growth', durationDays: 30 }] }));
    writeFileSync(join(tempDir, 'license-vault.manifest.vg_20260925_11111111.json'), JSON.stringify({ generation: 'vg_20260925_11111111', count: 1, entries: [{ sha256: 'b'.repeat(64), plan: 'growth', durationDays: 30 }] }));
    const newest = verify.loadNewestManifest(tempDir);
    expect(newest.ok).toBe(true);
    expect(newest.manifest.generation).toBe('vg_20260925_11111111');
  });

  it('empty manifest is rejected with a clear message', () => {
    writeFileSync(join(tempDir, 'license-vault.manifest.vg_20260925_abcd1234.json'), JSON.stringify({ generation: 'vg_20260925_abcd1234', count: 0, entries: [] }));
    const loaded = verify.loadNewestManifest(tempDir);
    expect(loaded.ok).toBe(false);
    expect(loaded.error).toMatch(/empty/i);
  });

  it('missing manifest directory reports a clear error', () => {
    const loaded = verify.loadNewestManifest(join(tempDir, 'no-such-dir'));
    expect(loaded.ok).toBe(false);
    expect(loaded.error).toMatch(/No vault manifest found/);
  });

  it('manifest entries must be an array', () => {
    writeFileSync(join(tempDir, 'license-vault.manifest.vg_20260925_abcd1234.json'), JSON.stringify({ generation: 'vg_20260925_abcd1234' }));
    const loaded = verify.loadNewestManifest(tempDir);
    expect(loaded.ok).toBe(false);
    expect(loaded.error).toMatch(/entries array/);
  });
});

describe('no raw key material in output', () => {
  it('captured stdout contains no raw license key material', async () => {
    const key = 'LUM-GROWTH-30D-RAWC-HECK1';
    const rows = [{ key, plan: 'growth', durationDays: 30, isTrial: false, campaign: 'ops' }];
    const manifest = seed.buildManifest(rows, 'vg_20260925_abcd1234');
    const remote = new Map([
      [`license:key:${key}`, { keySha256: seed.keySha256(key), vaultGeneration: 'vg_20260925_abcd1234', revoked: false }],
    ]);
    const { report } = verify.buildVerifyReport(manifest, remote);
    const captured = [];
    const origLog = console.log;
    console.log = (...args) => captured.push(args.join(' '));
    try {
      console.log(verify.formatHumanReport(report));
      console.log(verify.formatJsonReport(report));
      console.log(`Seeded 1 license keys into LUMINARA_KV.`);
    } finally {
      console.log = origLog;
    }
    const all = captured.join('\n');
    expect(all).not.toContain(key);
    expect(all).not.toContain('LUM-');
    expect(all).not.toContain('RAWC');
    expect(all).not.toContain('HECK1');
  });
});
