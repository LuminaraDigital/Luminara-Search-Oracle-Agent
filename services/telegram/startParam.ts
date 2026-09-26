/**
 * Telegram startapp payloads.
 * View tokens stay case-insensitive. Domain payloads keep the host as typed,
 * then normalise to a hostname so Instant Audit can prefill the URL field.
 */
import { AppView } from '../../types';

export interface TelegramStartIntent {
  view: AppView;
  /** Hostname to prefill, when the payload is audit_<domain> or scan_<domain>. */
  auditUrl?: string;
}

const VIEW_BY_TOKEN: Record<string, AppView> = {
  AUDIT: AppView.INSTANT_AUDIT,
  SCAN: AppView.INSTANT_AUDIT,
  ORACLE: AppView.ORACLE_AGENT,
  CHAT: AppView.ORACLE_AGENT,
  ASK: AppView.ORACLE_AGENT,
  DASHBOARD: AppView.DASHBOARD,
  HOME: AppView.DASHBOARD,
  HARNESS: AppView.HARNESS,
  DEV: AppView.HARNESS,
  DNA: AppView.BUSINESS_DNA,
  PROFILE: AppView.BUSINESS_DNA,
  MEMORY: AppView.BRAND_MEMORY,
  VAULT: AppView.BRAND_MEMORY,
  BRAND_MEMORY: AppView.BRAND_MEMORY,
  NOTEBOOK: AppView.NOTEBOOK,
  NOTEBOOKS: AppView.NOTEBOOK,
  STUDIO: AppView.NOTEBOOK,
  LM: AppView.NOTEBOOK,
  PRIVACY: AppView.PRIVACY,
  PRIVACY_POLICY: AppView.PRIVACY,
  LEGAL: AppView.PRIVACY,
  TERMS: AppView.TERMS,
  TOS: AppView.TERMS,
};

/** Hostname from `audit_<domain>` / `scan_<domain>`. Null when the payload is not a domain deep link. */
export function parseAuditDomainPayload(raw: string | null | undefined): string | null {
  const trimmed = String(raw || '').trim();
  const match = /^(?:audit|scan)_(.+)$/i.exec(trimmed);
  if (!match) return null;
  let domain = match[1].trim();
  try {
    domain = decodeURIComponent(domain);
  } catch {
    /* keep the raw tail */
  }
  domain = domain.replace(/^https?:\/\//i, '').split(/[/?#]/)[0]?.trim() || '';
  domain = domain.replace(/:\d+$/, '').replace(/\.$/, '').toLowerCase();
  if (!domain || domain.length > 253 || /\s/.test(domain)) return null;
  if (domain.includes('@') || domain.includes('..')) return null;
  if (!domain.includes('.') && domain !== 'localhost') return null;
  return domain;
}

export function resolveTelegramStart(raw: string | null | undefined): TelegramStartIntent {
  const original = String(raw || '').trim();
  const auditUrl = parseAuditDomainPayload(original);
  if (auditUrl) return { view: AppView.INSTANT_AUDIT, auditUrl };

  const token = original.toUpperCase();
  if (!token) return { view: AppView.INSTANT_AUDIT };
  const mapped = VIEW_BY_TOKEN[token];
  if (mapped) return { view: mapped };
  if ((Object.values(AppView) as string[]).includes(token)) {
    return { view: token as AppView };
  }
  return { view: AppView.INSTANT_AUDIT };
}
