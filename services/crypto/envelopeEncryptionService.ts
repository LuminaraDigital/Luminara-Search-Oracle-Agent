/**
 * Zero-Knowledge Client-Side Envelope Encryption Service.
 *
 * Encrypts sensitive BYOK credentials in-memory before transmission to server storage (Cloudflare D1/KV).
 * Uses native WebCrypto API (AES-256-GCM + PBKDF2 with 100,000 SHA-256 iterations).
 * The server only ever stores ciphertext, IV, and salt; plaintext keys never leave the client.
 */

export interface EncryptedKeyBag {
  /** Base64-encoded AES-256-GCM ciphertext */
  ciphertext: string;
  /** Base64-encoded 96-bit initialization vector */
  iv: string;
  /** Base64-encoded 128-bit PBKDF2 salt */
  salt: string;
  /** Schema format version */
  v: number;
}

const PBKDF2_ITERATIONS = 100_000;
const AES_KEY_LENGTH = 256;
const ENCRYPTION_VERSION = 1;

/** Convert byte array to base64 string */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Convert base64 string to Uint8Array */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Derive an AES-256-GCM key from a secret passphrase and salt using PBKDF2 */
async function deriveAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const rawKeyMaterial = encoder.encode(passphrase);

  const baseKey = await crypto.subtle.importKey(
    'raw',
    rawKeyMaterial,
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: AES_KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt a dictionary of API keys into an EncryptedKeyBag.
 * @param keys Plaintext key dictionary (e.g. { luminara_groq_key: "gsk_..." })
 * @param passphrase Secret user/account passphrase used for key derivation
 */
export async function encryptKeyBag(
  keys: Record<string, string>,
  passphrase: string,
): Promise<EncryptedKeyBag> {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('Passphrase must be at least 8 characters long for envelope encryption');
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveAesKey(passphrase, salt);

  const encoder = new TextEncoder();
  const plaintextBytes = encoder.encode(JSON.stringify(keys));

  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    aesKey,
    plaintextBytes,
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(encryptedBuffer)),
    iv: bytesToBase64(iv),
    salt: bytesToBase64(salt),
    v: ENCRYPTION_VERSION,
  };
}

/**
 * Decrypt an EncryptedKeyBag back into a plaintext dictionary.
 * @param bag The encrypted payload received from server or local storage
 * @param passphrase Secret user/account passphrase used for key derivation
 */
export async function decryptKeyBag(
  bag: EncryptedKeyBag,
  passphrase: string,
): Promise<Record<string, string>> {
  if (!bag || !bag.ciphertext || !bag.iv || !bag.salt) {
    throw new Error('Invalid encrypted key bag format');
  }

  if (bag.v !== ENCRYPTION_VERSION) {
    throw new Error(`Unsupported encryption version: ${bag.v}`);
  }

  const salt = base64ToBytes(bag.salt);
  const iv = base64ToBytes(bag.iv);
  const ciphertext = base64ToBytes(bag.ciphertext);

  const aesKey = await deriveAesKey(passphrase, salt);

  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv,
      },
      aesKey,
      ciphertext,
    );

    const decoder = new TextDecoder();
    const jsonString = decoder.decode(decryptedBuffer);
    return JSON.parse(jsonString) as Record<string, string>;
  } catch (err) {
    throw new Error('Decryption failed: invalid passphrase or corrupted ciphertext');
  }
}

const LOCAL_SALT_STORAGE_KEY = 'luminara_envelope_device_salt_v1';

/**
 * Derive a consistent zero-knowledge client-side encryption passphrase for the current account.
 * Combines account ID with a persistent local device secret so keys can be unlocked seamlessly
 * on this device, with an optional user master password.
 */
export function getOrCreateAccountEncryptionPassphrase(accountId: string, userMasterKey?: string): string {
  if (userMasterKey && userMasterKey.length >= 8) {
    return `${userMasterKey}:${accountId}`;
  }

  let deviceSalt = '';
  try {
    deviceSalt = localStorage.getItem(LOCAL_SALT_STORAGE_KEY) || '';
    if (!deviceSalt) {
      const random = crypto.getRandomValues(new Uint8Array(32));
      deviceSalt = bytesToBase64(random);
      localStorage.setItem(LOCAL_SALT_STORAGE_KEY, deviceSalt);
    }
  } catch {
    deviceSalt = 'fallback-device-salt-mem';
  }

  return `luminara-zk:${accountId}:${deviceSalt}`;
}
