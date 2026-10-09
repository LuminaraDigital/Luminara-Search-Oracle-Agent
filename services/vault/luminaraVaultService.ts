/**
 * Encrypted Luminara Brand & Secret Vault (.luminara-vault)
 *
 * Implements client-side AES-256-GCM encryption with PBKDF2 key derivation.
 * Inspired by Qubic's self-custody vault architecture to enable safe,
 * portable backup and migration of Brand Memory, Business DNA, and BYOK API keys.
 *
 * Quality Invariants:
 * - Zero hardcoded hex colors
 * - Zero Math.random metrics
 * - No em dashes in copy or comments
 * - Fail closed on checksum or tampering
 */

export interface VaultManifest {
  format: 'luminara-vault';
  version: 1;
  createdAt: number;
  cipher: 'AES-256-GCM';
  kdf: 'PBKDF2-HMAC-SHA256';
  iterations: number;
  salt: string; // Base64
  iv: string; // Base64
  ciphertext: string; // Base64
  checksum: string; // SHA-256 hex
}

export interface VaultPayload {
  version: 1;
  exportedAt: number;
  brandMemory?: Array<{
    id: string;
    type: string;
    title: string;
    summary: string;
    domain?: string;
    createdAt: number;
    tags: string[];
  }>;
  businessDna?: Record<string, unknown> | null;
  apiKeys?: Record<string, string>;
  trustDomains?: string[];
  watchedCampaigns?: string[];
  metadata?: {
    appVersion?: string;
    platform?: string;
  };
}

export interface VaultExportOptions {
  includeBrandMemory?: boolean;
  includeBusinessDna?: boolean;
  includeApiKeys?: boolean;
  includeTrustDomains?: boolean;
  includeWatchOnly?: boolean;
}

export interface VaultSummary {
  version: number;
  exportedAt: number;
  brandMemoryCount: number;
  hasBusinessDna: boolean;
  apiKeysCount: number;
  trustDomainsCount: number;
  watchedCampaignsCount: number;
}

const KNOWN_API_KEY_NAMES = [
  'geminiApiKey',
  'gemini_api_key',
  'openaiApiKey',
  'openai_api_key',
  'anthropicApiKey',
  'anthropic_api_key',
  'dataforseoApiKey',
  'dataforseo_login',
  'dataforseo_password',
  'openRouterApiKey',
  'openrouter_api_key',
  'perplexityApiKey',
  'perplexity_api_key',
  'deepseekApiKey',
  'deepseek_api_key',
  'firecrawlApiKey',
  'firecrawl_api_key',
];

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function deriveAesGcmKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export class LuminaraVaultService {
  private static readonly ITERATIONS = 100_000;
  private static readonly SALT_LEN = 16;
  private static readonly IV_LEN = 12;

  /**
   * Collects current application state into a plain VaultPayload.
   */
  public collectPayload(options: VaultExportOptions = {}): VaultPayload {
    const {
      includeBrandMemory = true,
      includeBusinessDna = true,
      includeApiKeys = true,
      includeTrustDomains = true,
      includeWatchOnly = true,
    } = options;

    const payload: VaultPayload = {
      version: 1,
      exportedAt: Date.now(),
      metadata: {
        appVersion: '1.0.2',
        platform: typeof window !== 'undefined' ? window.navigator.userAgent : 'node',
      },
    };

    if (typeof localStorage === 'undefined') {
      return payload;
    }

    if (includeBrandMemory) {
      try {
        const raw = localStorage.getItem('luminara_brand_memory_events_v1');
        if (raw) {
          payload.brandMemory = JSON.parse(raw);
        }
      } catch {
        payload.brandMemory = [];
      }
    }

    if (includeBusinessDna) {
      try {
        const raw = localStorage.getItem('luminara_dna_profile');
        if (raw) {
          payload.businessDna = JSON.parse(raw);
        }
      } catch {
        payload.businessDna = null;
      }
    }

    if (includeApiKeys) {
      const keys: Record<string, string> = {};
      for (const k of KNOWN_API_KEY_NAMES) {
        const val = localStorage.getItem(k);
        if (val && val.trim().length > 0) {
          keys[k] = val.trim();
        }
      }
      payload.apiKeys = keys;
    }

    if (includeTrustDomains) {
      try {
        const raw = localStorage.getItem('luminara_trust_domains_v1');
        if (raw) {
          payload.trustDomains = JSON.parse(raw);
        }
      } catch {
        payload.trustDomains = [];
      }
    }

    if (includeWatchOnly) {
      try {
        const raw = localStorage.getItem('luminara_watch_only_v1');
        if (raw) {
          payload.watchedCampaigns = JSON.parse(raw);
        }
      } catch {
        payload.watchedCampaigns = [];
      }
    }

    return payload;
  }

  /**
   * Encrypts a VaultPayload with the user password and produces a VaultManifest JSON string.
   */
  public async encryptVault(payload: VaultPayload, password: string): Promise<string> {
    if (!password || password.length < 8) {
      throw new Error('Vault password must be at least 8 characters long.');
    }

    const salt = new Uint8Array(LuminaraVaultService.SALT_LEN);
    crypto.getRandomValues(salt);

    const iv = new Uint8Array(LuminaraVaultService.IV_LEN);
    crypto.getRandomValues(iv);

    const key = await deriveAesGcmKey(password, salt, LuminaraVaultService.ITERATIONS);

    const encoder = new TextEncoder();
    const encodedPayload = encoder.encode(JSON.stringify(payload));

    const ciphertextBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encodedPayload,
    );

    const checksum = await sha256Hex(ciphertextBuffer);

    const manifest: VaultManifest = {
      format: 'luminara-vault',
      version: 1,
      createdAt: Date.now(),
      cipher: 'AES-256-GCM',
      kdf: 'PBKDF2-HMAC-SHA256',
      iterations: LuminaraVaultService.ITERATIONS,
      salt: bufferToBase64(salt.buffer),
      iv: bufferToBase64(iv.buffer),
      ciphertext: bufferToBase64(ciphertextBuffer),
      checksum,
    };

    return JSON.stringify(manifest, null, 2);
  }

  /**
   * Decrypts a VaultManifest JSON string using the provided password and validates checksum.
   */
  public async decryptVault(manifestJson: string, password: string): Promise<VaultPayload> {
    let manifest: VaultManifest;
    try {
      manifest = JSON.parse(manifestJson) as VaultManifest;
    } catch {
      throw new Error('Invalid vault file format: could not parse JSON.');
    }

    if (manifest.format !== 'luminara-vault') {
      throw new Error('Unrecognized vault format. Expected luminara-vault.');
    }

    if (manifest.version !== 1) {
      throw new Error(`Unsupported vault version: ${manifest.version}.`);
    }

    const ciphertextBuffer = base64ToBuffer(manifest.ciphertext);
    const calculatedChecksum = await sha256Hex(ciphertextBuffer);

    if (calculatedChecksum !== manifest.checksum) {
      throw new Error('Vault integrity violation: checksum mismatch. The file may be corrupt or tampered with.');
    }

    const salt = new Uint8Array(base64ToBuffer(manifest.salt));
    const iv = new Uint8Array(base64ToBuffer(manifest.iv));

    const key = await deriveAesGcmKey(password, salt, manifest.iterations);

    let decryptedBuffer: ArrayBuffer;
    try {
      decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertextBuffer,
      );
    } catch {
      throw new Error('Decryption failed: Incorrect password or corrupted data.');
    }

    const decoder = new TextDecoder();
    const payloadText = decoder.decode(decryptedBuffer);

    try {
      return JSON.parse(payloadText) as VaultPayload;
    } catch {
      throw new Error('Decryption succeeded, but decrypted payload is not valid JSON.');
    }
  }

  /**
   * Extracts summary metrics from a decrypted VaultPayload without modifying storage.
   */
  public summarizePayload(payload: VaultPayload): VaultSummary {
    return {
      version: payload.version,
      exportedAt: payload.exportedAt,
      brandMemoryCount: payload.brandMemory?.length || 0,
      hasBusinessDna: Boolean(payload.businessDna && Object.keys(payload.businessDna).length > 0),
      apiKeysCount: Object.keys(payload.apiKeys || {}).length,
      trustDomainsCount: payload.trustDomains?.length || 0,
      watchedCampaignsCount: payload.watchedCampaigns?.length || 0,
    };
  }

  /**
   * Restores a decrypted VaultPayload into localStorage.
   * Options: merge (default true: non-destructive merge) or replace.
   */
  public restorePayload(payload: VaultPayload, merge = true): void {
    if (typeof localStorage === 'undefined') return;

    if (payload.brandMemory && payload.brandMemory.length > 0) {
      if (merge) {
        try {
          const raw = localStorage.getItem('luminara_brand_memory_events_v1');
          const existing = raw ? JSON.parse(raw) : [];
          const existingIds = new Set(existing.map((e: { id: string }) => e.id));
          const merged = [...existing];
          for (const ev of payload.brandMemory) {
            if (!existingIds.has(ev.id)) {
              merged.push(ev);
              existingIds.add(ev.id);
            }
          }
          localStorage.setItem('luminara_brand_memory_events_v1', JSON.stringify(merged.slice(-200)));
        } catch {
          localStorage.setItem('luminara_brand_memory_events_v1', JSON.stringify(payload.brandMemory.slice(-200)));
        }
      } else {
        localStorage.setItem('luminara_brand_memory_events_v1', JSON.stringify(payload.brandMemory.slice(-200)));
      }
    }

    if (payload.businessDna) {
      localStorage.setItem('luminara_dna_profile', JSON.stringify(payload.businessDna));
    }

    if (payload.apiKeys) {
      for (const [key, val] of Object.entries(payload.apiKeys)) {
        if (merge) {
          if (!localStorage.getItem(key)) {
            localStorage.setItem(key, val);
          }
        } else {
          localStorage.setItem(key, val);
        }
      }
    }

    if (payload.trustDomains && payload.trustDomains.length > 0) {
      if (merge) {
        try {
          const raw = localStorage.getItem('luminara_trust_domains_v1');
          const existing = raw ? JSON.parse(raw) : [];
          const merged = Array.from(new Set([...existing, ...payload.trustDomains]));
          localStorage.setItem('luminara_trust_domains_v1', JSON.stringify(merged));
        } catch {
          localStorage.setItem('luminara_trust_domains_v1', JSON.stringify(payload.trustDomains));
        }
      } else {
        localStorage.setItem('luminara_trust_domains_v1', JSON.stringify(payload.trustDomains));
      }
    }

    if (payload.watchedCampaigns && payload.watchedCampaigns.length > 0) {
      if (merge) {
        try {
          const raw = localStorage.getItem('luminara_watch_only_v1');
          const existing = raw ? JSON.parse(raw) : [];
          const merged = Array.from(new Set([...existing, ...payload.watchedCampaigns]));
          localStorage.setItem('luminara_watch_only_v1', JSON.stringify(merged));
        } catch {
          localStorage.setItem('luminara_watch_only_v1', JSON.stringify(payload.watchedCampaigns));
        }
      } else {
        localStorage.setItem('luminara_watch_only_v1', JSON.stringify(payload.watchedCampaigns));
      }
    }
  }

  /**
   * Helper to trigger a browser download for the encrypted vault file.
   */
  public downloadVaultFile(encryptedJson: string, filename?: string): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const dateStr = new Date().toISOString().split('T')[0];
    const resolvedName = filename || `luminara-vault-${dateStr}.luminara-vault`;
    const blob = new Blob([encryptedJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = resolvedName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}

export const luminaraVaultService = new LuminaraVaultService();
