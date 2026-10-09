/**
 * Watch-Only & Follow Service for Campaigns and Domains
 *
 * Implements Qubic's watchOnly paradigm: allows agencies, auditors,
 * and investors to monitor merchant campaigns and domain trust receipts
 * without connecting a private key or having signing privileges.
 *
 * Quality Invariants:
 * - Zero hardcoded hex colors
 * - Zero Math.random metrics
 * - No em dashes in copy or comments
 */

const CAMPAIGNS_KEY = 'luminara_watch_only_campaigns_v1';
const DOMAINS_KEY = 'luminara_watch_only_domains_v1';

type WatchListener = () => void;

const memoryFallback = new Map<string, string[]>();

function safeGet(key: string): string[] {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(key);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch {
    /* fallback to memory */
  }
  return memoryFallback.get(key) || [];
}

function safeSet(key: string, items: string[]): void {
  const unique = Array.from(new Set(items));
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, JSON.stringify(unique));
    }
  } catch {
    /* fallback to memory */
  }
  memoryFallback.set(key, unique);
}

export class WatchOnlyService {
  private listeners: Set<WatchListener> = new Set();

  public subscribe(listener: WatchListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        /* ignore */
      }
    }
  }

  // --- Campaign Tracking ---
  public getWatchedCampaigns(): string[] {
    return safeGet(CAMPAIGNS_KEY);
  }

  public isCampaignWatched(campaignId: string): boolean {
    if (!campaignId) return false;
    return this.getWatchedCampaigns().includes(campaignId);
  }

  public toggleWatchCampaign(campaignId: string): boolean {
    if (!campaignId) return false;
    const current = this.getWatchedCampaigns();
    const exists = current.includes(campaignId);
    const updated = exists ? current.filter((id) => id !== campaignId) : [...current, campaignId];
    safeSet(CAMPAIGNS_KEY, updated);
    this.notify();
    return !exists;
  }

  // --- Domain Tracking ---
  public getWatchedDomains(): string[] {
    return safeGet(DOMAINS_KEY);
  }

  public isDomainWatched(domain: string): boolean {
    if (!domain) return false;
    const norm = domain.trim().toLowerCase();
    return this.getWatchedDomains().includes(norm);
  }

  public toggleWatchDomain(domain: string): boolean {
    if (!domain) return false;
    const norm = domain.trim().toLowerCase();
    const current = this.getWatchedDomains();
    const exists = current.includes(norm);
    const updated = exists ? current.filter((d) => d !== norm) : [...current, norm];
    safeSet(DOMAINS_KEY, updated);
    this.notify();
    return !exists;
  }

  public clearAll(): void {
    safeSet(CAMPAIGNS_KEY, []);
    safeSet(DOMAINS_KEY, []);
    this.notify();
  }
}

export const watchOnlyService = new WatchOnlyService();
