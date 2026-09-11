import { describe, expect, it } from 'vitest';
import {
  encryptKeyBag,
  decryptKeyBag,
  getOrCreateAccountEncryptionPassphrase,
} from '../services/crypto/envelopeEncryptionService';

describe('Zero-Knowledge Client-Side Envelope Encryption (AES-256-GCM + PBKDF2)', () => {
  const sampleKeys = {
    luminara_groq_key: 'gsk_sample_enterprise_test_key_12345',
    luminara_nvidia_key: 'nvapi_test_enterprise_secret_67890',
    luminara_tavily_key: 'tvly-test-sample-secret-abcd',
  };
  const passphrase = 'enterprise-super-secret-passphrase-2026';

  it('encrypts and decrypts a key bag with 100% fidelity', async () => {
    const encrypted = await encryptKeyBag(sampleKeys, passphrase);

    expect(encrypted.v).toBe(1);
    expect(encrypted.ciphertext).toBeTruthy();
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.salt).toBeTruthy();

    // Plaintext secrets MUST NOT appear anywhere in the ciphertext bundle
    expect(encrypted.ciphertext).not.toContain('gsk_sample');
    expect(encrypted.ciphertext).not.toContain('nvapi_test');
    expect(encrypted.ciphertext).not.toContain('tvly-test');

    const decrypted = await decryptKeyBag(encrypted, passphrase);
    expect(decrypted).toEqual(sampleKeys);
  });

  it('fails cleanly when decrypting with an incorrect passphrase', async () => {
    const encrypted = await encryptKeyBag(sampleKeys, passphrase);
    const wrongPassphrase = 'wrong-enterprise-passphrase-9999';

    await expect(decryptKeyBag(encrypted, wrongPassphrase)).rejects.toThrow(
      /Decryption failed: invalid passphrase or corrupted ciphertext/,
    );
  });

  it('fails cleanly if ciphertext is tampered with', async () => {
    const encrypted = await encryptKeyBag(sampleKeys, passphrase);
    // Tamper with ciphertext by corrupting characters
    const tampered = {
      ...encrypted,
      ciphertext: 'AAAA' + encrypted.ciphertext.slice(4),
    };

    await expect(decryptKeyBag(tampered, passphrase)).rejects.toThrow(
      /Decryption failed: invalid passphrase or corrupted ciphertext/,
    );
  });

  it('requires a secure passphrase length (>= 8 chars)', async () => {
    await expect(encryptKeyBag(sampleKeys, 'short')).rejects.toThrow(
      /Passphrase must be at least 8 characters long/,
    );
  });

  it('generates consistent zero-knowledge account passphrase for the same device and account', () => {
    const p1 = getOrCreateAccountEncryptionPassphrase('acct-enterprise-001');
    const p2 = getOrCreateAccountEncryptionPassphrase('acct-enterprise-001');
    expect(p1).toBe(p2);
    expect(p1).toContain('acct-enterprise-001');

    // Custom user master key takes precedence when provided
    const custom = getOrCreateAccountEncryptionPassphrase('acct-enterprise-001', 'my-master-password');
    expect(custom).toBe('my-master-password:acct-enterprise-001');
  });
});
