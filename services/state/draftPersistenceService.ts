/**
 * Draft Persistence Service
 * Safely preserves unsaved user input across view transitions, tab switches, and accidental reloads.
 * Uses sessionStorage (ephemeral to tab) with fallbacks, ensuring zero privacy leaks across devices.
 */

const STORAGE_PREFIX = 'luminara_draft_';

export const DRAFT_KEYS = {
  CHAT_INPUT: 'chat_prompt',
  AUDIT_URL: 'instant_audit_target',
  BUSINESS_DNA_INPUT: 'business_dna_input',
} as const;

export type DraftKey = (typeof DRAFT_KEYS)[keyof typeof DRAFT_KEYS] | string;

class DraftPersistenceService {
  private memoryCache: Map<string, string> = new Map();

  private getFullKey(key: string): string {
    return `${STORAGE_PREFIX}${key}`;
  }

  public getDraft(key: DraftKey): string {
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        const value = window.sessionStorage.getItem(this.getFullKey(key));
        if (value !== null) return value;
      }
    } catch {
      // In case sessionStorage is blocked (e.g. restricted iframe or private mode)
    }
    return this.memoryCache.get(key) || '';
  }

  public setDraft(key: DraftKey, value: string): void {
    const trimmed = value;
    this.memoryCache.set(key, trimmed);
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        if (!trimmed) {
          window.sessionStorage.removeItem(this.getFullKey(key));
        } else {
          window.sessionStorage.setItem(this.getFullKey(key), trimmed);
        }
      }
    } catch {
      // Ignore quota errors
    }
  }

  public clearDraft(key: DraftKey): void {
    this.memoryCache.delete(key);
    try {
      if (typeof window !== 'undefined' && window.sessionStorage) {
        window.sessionStorage.removeItem(this.getFullKey(key));
      }
    } catch {
      // Ignore
    }
  }

  public hasDraft(key: DraftKey): boolean {
    return Boolean(this.getDraft(key).trim());
  }
}

export const draftPersistenceService = new DraftPersistenceService();
