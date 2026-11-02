import { describe, expect, it, vi } from 'vitest';
import { getAudit } from '../services/audit/auditHistoryService';
import { buildGuestScoutSummary } from '../services/audit/guestScoutSummary';
import { generateAuditReportUnlessDegraded } from '../services/audit/instantAuditHelpers';
import { geminiService } from '../services/geminiService';
import { auditFields, fieldsToAudit } from '../worker/dataPlaneDocs';
import { sanitizeAuditEntry } from '../worker/auditHistoryRoute';
import { readAuditRun } from '../worker/auditRunEntry';
import { newAuditRunId } from '../services/audit/auditRun';

const run = {
  runId: 'run_abc',
  model: 'llama',
  provider: 'groq',
  method: 'crew_search_rows' as const,
  queries: ['what is acme'],
};

const entry = { id: 'audit-1', domain: 'acme.com', measuredAt: 5, auditRun: run };

describe('audit run link', () => {
  it('mints an id both the findings route and the history route accept', () => {
    const id = newAuditRunId();
    expect(id.length).toBeLessThanOrEqual(64);
    expect(readAuditRun({ runId: id })?.runId).toBe(id);
  });

  it('keeps the run record through the entry whitelist', () => {
    const clean = sanitizeAuditEntry({ ...entry, reportExcerpt: 'r' });
    expect(clean.ok && clean.entry.auditRun).toEqual(run);
  });

  it('stores null for an older entry with no run record', () => {
    const clean = sanitizeAuditEntry({ id: 'audit-2', domain: 'acme.com', measuredAt: 5 });
    expect(clean.ok && clean.entry.auditRun).toBeNull();
  });

  it('keeps the run record through the Firestore fields', () => {
    const clean = sanitizeAuditEntry(entry);
    if (!clean.ok) throw new Error(clean.error);
    expect(fieldsToAudit(auditFields('acct', clean.entry, 1))?.auditRun).toEqual(run);
  });

  it('gives the report the same run id as the findings, and keeps it on the final saved row', async () => {
    const spy = vi.spyOn(geminiService, 'generateAuditReport').mockResolvedValue({
      text: '# Luminara\n\nOne move this week.',
      sources: [],
      auditHistoryId: 'audit-link',
      auditRun: run,
    } as Awaited<ReturnType<typeof geminiService.generateAuditReport>>);
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://example.com',
      measurementStatus: 'measured',
      citationRatePercent: 12,
      shareOfVoiceScore: 20,
      healthScore: 80,
      scrapedPageCount: 1,
      serpCount: 1,
      findings: [],
      hostedRail: 'signed_in_hosted',
    });
    await generateAuditReportUnlessDegraded({
      runId: 'run_abc',
      isGuest: false,
      summary,
      measurementStatus: 'measured',
      formattedUrl: 'https://example.com',
      targetFocus: 'AEO',
      dna: null,
      lenses: [],
    });
    expect(spy.mock.calls[0][4]?.runId).toBe('run_abc');
    expect(getAudit('audit-link')?.auditRun).toEqual(run);
    spy.mockRestore();
  });

  it('drops unknown keys, bad ids and unknown methods, and caps queries', () => {
    const read = readAuditRun({
      runId: 'bad id!',
      method: 'guess',
      extra: 'x',
      queries: [...Array.from({ length: 20 }, () => 'q'.repeat(400)), 7],
    });
    expect(read).toEqual({ runId: null, model: null, provider: null, method: null, queries: expect.any(Array) });
    expect(read?.queries).toHaveLength(12);
    expect(read?.queries[0]).toHaveLength(300);
  });
});
