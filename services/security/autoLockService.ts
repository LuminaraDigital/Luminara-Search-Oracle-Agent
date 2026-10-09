/**
 * Inactivity Auto-Lock & Sensitive Action Re-Authentication Service
 *
 * Implements session idle timeout and inline re-auth challenge gates
 * inspired by Qubic's self-custody auto-lock and reAuthDialog patterns.
 *
 * Quality Invariants:
 * - Zero hardcoded hex colors
 * - Zero Math.random metrics
 * - No em dashes in copy or comments
 */

export type AutoLockTimeout = 0 | 300 | 900 | 1800 | 3600; // 0 = off, seconds

const TIMEOUT_STORAGE_KEY = 'luminara_autolock_timeout_sec';
const PIN_HASH_STORAGE_KEY = 'luminara_autolock_pin_hash';
const PIN_SALT_STORAGE_KEY = 'luminara_autolock_pin_salt';

type LockChangeListener = (locked: boolean) => void;

const memoryStore = new Map<string, string>();

function getStorage(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
  } catch {
    /* fallback to memory */
  }
  return memoryStore.get(key) ?? null;
}

function setStorage(key: string, val: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, val);
    }
  } catch {
    /* fallback to memory */
  }
  memoryStore.set(key, val);
}

function removeStorage(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    }
  } catch {
    /* fallback to memory */
  }
  memoryStore.delete(key);
}

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashPinWithSalt(pin: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${salt}:${pin}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return bufferToHex(hashBuffer);
}

export class AutoLockService {
  private isLockedState = false;
  private timeoutSeconds: AutoLockTimeout = 0;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private listeners: Set<LockChangeListener> = new Set();
  private isInitialized = false;

  constructor() {
    this.init();
  }

  private init() {
    try {
      const storedTimeout = getStorage(TIMEOUT_STORAGE_KEY);
      if (storedTimeout) {
        const val = parseInt(storedTimeout, 10);
        if ([0, 300, 900, 1800, 3600].includes(val)) {
          this.timeoutSeconds = val as AutoLockTimeout;
        }
      }
    } catch {
      this.timeoutSeconds = 0;
    }

    if (!this.isInitialized) {
      this.isInitialized = true;
      this.attachActivityListeners();
      this.resetTimer();
    }
  }

  private attachActivityListeners() {
    if (typeof window === 'undefined') return;

    const onActivity = () => {
      if (!this.isLockedState) {
        this.resetTimer();
      }
    };

    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity, { passive: true });
    window.addEventListener('touchstart', onActivity, { passive: true });
    window.addEventListener('wheel', onActivity, { passive: true });
  }

  private resetTimer() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }

    if (this.timeoutSeconds <= 0 || !this.hasPinSet()) {
      return;
    }

    this.timerId = setTimeout(() => {
      this.lock();
    }, this.timeoutSeconds * 1000);
  }

  public subscribe(listener: LockChangeListener): () => void {
    this.listeners.add(listener);
    listener(this.isLockedState);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.isLockedState);
      } catch {
        /* ignore listener errors */
      }
    }
  }

  public isLocked(): boolean {
    return this.isLockedState;
  }

  public lock(): void {
    if (!this.hasPinSet()) return;
    this.isLockedState = true;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.notify();
  }

  public async unlock(pin: string): Promise<boolean> {
    const valid = await this.verifyPin(pin);
    if (valid) {
      this.isLockedState = false;
      this.resetTimer();
      this.notify();
      return true;
    }
    return false;
  }

  public hasPinSet(): boolean {
    return Boolean(getStorage(PIN_HASH_STORAGE_KEY) && getStorage(PIN_SALT_STORAGE_KEY));
  }

  public async setPin(newPin: string): Promise<void> {
    if (!newPin || newPin.trim().length < 4) {
      throw new Error('Lock PIN must be at least 4 digits or characters.');
    }
    const saltBytes = new Uint8Array(16);
    crypto.getRandomValues(saltBytes);
    const salt = bufferToHex(saltBytes.buffer);
    const hash = await hashPinWithSalt(newPin.trim(), salt);

    setStorage(PIN_SALT_STORAGE_KEY, salt);
    setStorage(PIN_HASH_STORAGE_KEY, hash);
  }

  public clearPin(): void {
    removeStorage(PIN_SALT_STORAGE_KEY);
    removeStorage(PIN_HASH_STORAGE_KEY);
    this.setTimeout(0);
    this.isLockedState = false;
    this.notify();
  }

  public async verifyPin(pin: string): Promise<boolean> {
    if (!this.hasPinSet()) return true;
    const salt = getStorage(PIN_SALT_STORAGE_KEY);
    const expectedHash = getStorage(PIN_HASH_STORAGE_KEY);
    if (!salt || !expectedHash) return true;

    const actualHash = await hashPinWithSalt(pin.trim(), salt);
    return actualHash === expectedHash;
  }

  public getTimeout(): AutoLockTimeout {
    return this.timeoutSeconds;
  }

  public setTimeout(seconds: AutoLockTimeout): void {
    this.timeoutSeconds = seconds;
    setStorage(TIMEOUT_STORAGE_KEY, String(seconds));
    this.resetTimer();
  }
}

export const autoLockService = new AutoLockService();
