/**
 * Client sync for audit findings board. Optimistic local + optional D1 via Worker.
 * Never map Oracle ValidatorFinding into this board.
 */
import type { AuditFinding, FindingWorkStatus } from '../agentCore/types';
import { findingStableKey } from './findingStableKey';
import { workerFetchWithAuthRetry, apiBase } from '../apiClient';
import { noteWorkspaceDirty } from '../sync/workspaceSyncService';
import { formatAuDay } from '../../utils/formatAuDate';
import { isDowngradedFinding } from './reportBlocks';

const LOCAL_PREFIX = 'luminara_findings_v1_';
/** One bag for every domain. The workspace save already pushes this key. A tick does not call the findings API. */
export const FINDINGS_BOARD_KEY = 'luminara_findings_board_v1';
const LAST_DOMAIN_KEY = 'luminara_findings_last_domain_v1';

export type BoardFinding = {
  id: string;
  domain: string;
  stableKey: string;
  category: AuditFinding['category'];
  severity: AuditFinding['severity'];
  title: string;
  description: string;
  status: FindingWorkStatus;
  /** Sydney calendar day (YYYY-MM-DD) the fix was marked done. Absent until then. */
  doneOn?: string;
  evidence?: unknown;
  auditRunId?: string;
  synced?: boolean;
};

function normalizeDomain(raw: string): string {
  return raw
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .split('/')[0]
    .toLowerCase()
    .trim();
}

function storageKey(domain: string): string {
  return `${LOCAL_PREFIX}${normalizeDomain(domain)}`;
}

function readLocal(domain: string): BoardFinding[] {
  try {
    const raw = sessionStorage.getItem(storageKey(domain));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BoardFinding[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocal(domain: string, findings: BoardFinding[]): void {
  try {
    sessionStorage.setItem(storageKey(domain), JSON.stringify(findings.slice(0, 100)));
  } catch {
    /* ignore quota */
  }
}

function readBag(): Record<string, BoardFinding[]> {
  try {
    const raw = localStorage.getItem(FINDINGS_BOARD_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, BoardFinding[]>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeBag(domain: string, findings: BoardFinding[]): void {
  const host = normalizeDomain(domain);
  if (!host) return;
  try {
    const bag = readBag();
    bag[host] = findings.slice(0, 100);
    localStorage.setItem(FINDINGS_BOARD_KEY, JSON.stringify(bag));
  } catch {
    /* ignore quota */
  }
}

/** Remember last audited domain so Decision Card remounts after AUDIT_URL draft clear / reload. */
export function rememberBoardDomain(domain: string): void {
  const host = normalizeDomain(domain);
  if (!host) return;
  try {
    sessionStorage.setItem(LAST_DOMAIN_KEY, host);
  } catch {
    /* ignore */
  }
}

export function readLastBoardDomain(): string {
  try {
    return sessionStorage.getItem(LAST_DOMAIN_KEY) || '';
  } catch {
    return '';
  }
}

/** Reject Oracle chat ValidatorFinding-shaped rows (validator + excerpt, no title). */
export function isCrewAuditFinding(f: unknown): f is AuditFinding {
  if (!f || typeof f !== 'object') return false;
  const o = f as Record<string, unknown>;
  if (typeof o.validator === 'string' && typeof o.excerpt === 'string' && !o.title) {
    return false;
  }
  return typeof o.title === 'string' && !!o.title && typeof o.category === 'string' && !!o.category;
}

/** Overlay remote upsert rows onto local board; never drop local keys missing from remote. */
export function mergeBoardWithRemote(
  local: BoardFinding[],
  remoteRows: Array<{
    id: string;
    domain?: string;
    stableKey: string;
    category: BoardFinding['category'];
    severity: BoardFinding['severity'];
    title: string;
    description: string;
    status?: FindingWorkStatus;
    evidence?: unknown;
    auditRunId?: string;
  }>,
  domain: string,
): BoardFinding[] {
  const byKey = new Map(local.map((m) => [m.stableKey, { ...m }]));
  for (const r of remoteRows) {
    if (!r.stableKey) continue;
    const prev = byKey.get(r.stableKey);
    byKey.set(r.stableKey, {
      id: r.id || prev?.id || r.stableKey,
      domain: r.domain || domain,
      stableKey: r.stableKey,
      category: r.category,
      severity: r.severity,
      title: r.title,
      description: r.description,
      status: (r.status || prev?.status || 'open') as FindingWorkStatus,
      evidence: r.evidence !== undefined ? r.evidence : prev?.evidence,
      auditRunId: r.auditRunId || prev?.auditRunId,
      synced: true,
    });
  }
  return Array.from(byKey.values());
}

/** Map crew AuditFinding[] into board rows (local + optional remote upsert). */
export async function ingestCrewFindings(opts: {
  domain: string;
  findings: AuditFinding[];
  auditRunId?: string;
  syncRemote?: boolean;
}): Promise<BoardFinding[]> {
  const domain = normalizeDomain(opts.domain);
  const auditRunId = opts.auditRunId || `local_${Date.now().toString(36)}`;
  const mapped: BoardFinding[] = opts.findings.filter(isCrewAuditFinding).map((f) => {
    const stableKey = f.stableKey || findingStableKey(domain, f.category, f.title);
    return {
      id: f.id || stableKey,
      domain,
      stableKey,
      category: f.category,
      severity: f.severity,
      title: f.title,
      description: f.description || '',
      status: f.status || 'open',
      evidence: {
        evidenceSource: f.evidenceSource,
        howWeKnowItFailed: f.howWeKnowItFailed,
        leadingIndicator: f.leadingIndicator,
        criticVerified: f.criticVerified,
        source: 'instant_audit_crew',
      },
      auditRunId,
      synced: false,
    };
  });

  const prev = readLocal(domain);
  const byKey = new Map(prev.map((p) => [p.stableKey, p]));
  for (const m of mapped) {
    const existing = byKey.get(m.stableKey);
    byKey.set(m.stableKey, existing ? { ...existing, ...m, status: existing.status } : m);
  }
  const merged = Array.from(byKey.values());
  writeLocal(domain, merged);
  writeBag(domain, merged);
  rememberBoardDomain(domain);

  if (opts.syncRemote === false) return merged;

  try {
    const res = await workerFetchWithAuthRetry(`${apiBase()}/api/findings/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        domain,
        auditRunId,
        findings: merged.map((m) => ({
          id: m.id,
          stableKey: m.stableKey,
          category: m.category,
          severity: m.severity,
          title: m.title,
          description: m.description,
          status: m.status,
          evidence: m.evidence,
          auditRunId,
        })),
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { findings?: BoardFinding[] };
      if (Array.isArray(data.findings) && data.findings.length) {
        const next = mergeBoardWithRemote(merged, data.findings as any, domain);
        writeLocal(domain, next);
        writeBag(domain, next);
        return next;
      }
    }
  } catch {
    /* offline / unsigned: keep local */
  }
  return merged;
}

export function listLocalFindings(domain: string): BoardFinding[] {
  const local = readLocal(domain);
  if (local.length) return local;
  const saved = readBag()[normalizeDomain(domain)];
  if (!saved?.length) return [];
  writeLocal(domain, saved);
  return saved;
}

/** Updates the board in place and marks the workspace dirty. It does not PATCH the findings API. */
export function setFindingStatusLocal(
  domain: string,
  findings: readonly BoardFinding[],
  findingId: string,
  status: FindingWorkStatus,
): BoardFinding[] {
  const today = formatAuDay(new Date());
  const next = findings.map((finding) => {
    if (finding.id !== findingId && finding.stableKey !== findingId) return finding;
    if (status !== 'done') {
      const cleared: BoardFinding = { ...finding, status };
      delete cleared.doneOn;
      return cleared;
    }
    return { ...finding, status, doneOn: finding.doneOn || today };
  });
  writeLocal(domain, next);
  writeBag(domain, next);
  try {
    noteWorkspaceDirty();
  } catch {
    /* the bag already holds the status */
  }
  return next;
}

export async function patchFindingStatus(
  domain: string,
  findingId: string,
  status: FindingWorkStatus,
): Promise<BoardFinding | null> {
  const local = readLocal(domain);
  const idx = local.findIndex((f) => f.id === findingId || f.stableKey === findingId);
  if (idx >= 0) {
    local[idx] = { ...local[idx], status };
    writeLocal(domain, local);
  }
  try {
    const res = await workerFetchWithAuthRetry(
      `${apiBase()}/api/findings/${encodeURIComponent(findingId)}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      },
    );
    if (res.ok) {
      const data = (await res.json()) as { finding?: any };
      if (data.finding) {
        const updated: BoardFinding = {
          id: data.finding.id,
          domain: data.finding.domain || normalizeDomain(domain),
          stableKey: data.finding.stableKey,
          category: data.finding.category,
          severity: data.finding.severity,
          title: data.finding.title,
          description: data.finding.description,
          status: data.finding.status,
          evidence: data.finding.evidence,
          auditRunId: data.finding.auditRunId,
          synced: true,
        };
        const next = readLocal(domain);
        const i = next.findIndex((f) => f.stableKey === updated.stableKey || f.id === updated.id);
        if (i >= 0) next[i] = updated;
        else next.unshift(updated);
        writeLocal(domain, next);
        return updated;
      }
    }
  } catch {
    /* keep local */
  }
  return idx >= 0 ? local[idx] : null;
}

export function pickPrimaryFinding(findings: BoardFinding[]): BoardFinding | null {
  const eligible = findings.filter((finding) => !isDowngradedFinding(finding));
  if (!eligible.length) return null;
  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const open = eligible.filter((f) => f.status === 'open' || f.status === 'in_progress');
  const pool = open.length ? open : eligible;
  return [...pool].sort(
    (a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9),
  )[0];
}
