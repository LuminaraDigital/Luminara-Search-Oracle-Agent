import { describe, it, expect } from 'vitest';
import { luminaraVaultService, type VaultPayload } from '../services/vault/luminaraVaultService';

describe('LuminaraVaultService', () => {
  const samplePayload: VaultPayload = {
    version: 1,
    exportedAt: 1728300000000,
    brandMemory: [
      {
        id: 'bm-1',
        type: 'audit',
        title: 'Initial SEO Audit',
        summary: 'Identified canonical issues.',
        domain: 'example.com',
        createdAt: 1728300000000,
        tags: ['seo', 'canonical'],
      },
    ],
    businessDna: {
      name: 'Acme Corp',
      industry: 'Technology',
    },
    apiKeys: {
      openaiApiKey: 'sk-dummy-test-key-12345',
      geminiApiKey: 'ai-test-secret-gemini-67890',
    },
    trustDomains: ['example.com', 'acme.org'],
    watchedCampaigns: ['camp-101'],
  };

  it('encrypts and decrypts payload successfully with correct password', async () => {
    const password = 'CorrectHorseBatteryStaple99!';
    const encryptedJson = await luminaraVaultService.encryptVault(samplePayload, password);

    expect(encryptedJson).toContain('"format": "luminara-vault"');
    expect(encryptedJson).toContain('"cipher": "AES-256-GCM"');
    expect(encryptedJson).not.toContain('sk-dummy-test-key-12345');

    const decrypted = await luminaraVaultService.decryptVault(encryptedJson, password);
    expect(decrypted.version).toBe(1);
    expect(decrypted.brandMemory).toHaveLength(1);
    expect(decrypted.brandMemory?.[0].title).toBe('Initial SEO Audit');
    expect(decrypted.apiKeys?.openaiApiKey).toBe('sk-dummy-test-key-12345');
    expect(decrypted.trustDomains).toEqual(['example.com', 'acme.org']);
  });

  it('fails decryption if password is wrong', async () => {
    const password = 'CorrectHorseBatteryStaple99!';
    const encryptedJson = await luminaraVaultService.encryptVault(samplePayload, password);

    await expect(
      luminaraVaultService.decryptVault(encryptedJson, 'WrongPassword123!'),
    ).rejects.toThrow(/Decryption failed/i);
  });

  it('fails encryption if password is less than 8 characters', async () => {
    await expect(
      luminaraVaultService.encryptVault(samplePayload, 'short'),
    ).rejects.toThrow(/at least 8 characters/i);
  });

  it('detects tampering and rejects corrupted ciphertext with checksum mismatch', async () => {
    const password = 'SecurePassword2026!';
    const encryptedJson = await luminaraVaultService.encryptVault(samplePayload, password);
    const parsed = JSON.parse(encryptedJson);

    // Tamper with ciphertext
    const rawCiphertext = atob(parsed.ciphertext);
    const tamperedCiphertext = btoa(rawCiphertext.slice(0, -4) + 'AAAA');
    parsed.ciphertext = tamperedCiphertext;

    await expect(
      luminaraVaultService.decryptVault(JSON.stringify(parsed), password),
    ).rejects.toThrow(/integrity violation/i);
  });

  it('summarizes decrypted payload accurately', () => {
    const summary = luminaraVaultService.summarizePayload(samplePayload);
    expect(summary.brandMemoryCount).toBe(1);
    expect(summary.hasBusinessDna).toBe(true);
    expect(summary.apiKeysCount).toBe(2);
    expect(summary.trustDomainsCount).toBe(2);
    expect(summary.watchedCampaignsCount).toBe(1);
  });
});
