import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/env';
import {
  EPISTEMIC_STANCE_RULE,
  UNVERIFIED_HYPOTHESES_SECTION,
  UNVERIFIED_SECTION_HEADING,
  containsUnverifiedMarker,
  detectUnverifiedFactLeakage,
  parseUnverifiedSection,
} from '../services/trust/epistemicStance';
import {
  appendOutputContract,
  buildSingleRetryMessage,
  extractJsonCandidate,
  runWithSingleJsonRetry,
  validateJsonContract,
} from '../services/oracle/jsonContract';
import {
  buildCitationWatchEpistemicNote,
  validateCitationWatchEpistemicNote,
} from '../services/citationWatch/epistemicNote';
import { enqueueDreamEvent } from '../worker/dreamingQueue';
import { executeDreamRun } from '../worker/dreamingService';
import { runDreamAgent } from '../worker/dreamAgent';
import { epistemicStanceHonesty, runAllValidators } from '../worker/agentOutputValidators';
import {
  formatCompactSummary,
  synthesizeSummaryFromMessages,
} from '../services/oracle/contextCompactorService';

describe('Epistemic Stance, 1-Retry JSON Contract & Dream Consolidation', () => {
  it('contains zero em dashes (U+2014) across new epistemic and contract modules', () => {
    const files = [
      'services/trust/epistemicStance.ts',
      'services/oracle/jsonContract.ts',
      'services/citationWatch/epistemicNote.ts',
      'services/experiments/hermesAbExperiment.ts',
    ];
    for (const rel of files) {
      const content = readFileSync(resolve(process.cwd(), rel), 'utf8');
      expect(content, `${rel} must not contain U+2014`).not.toContain('\u2014');
    }
    expect(EPISTEMIC_STANCE_RULE).not.toContain('\u2014');
    expect(UNVERIFIED_HYPOTHESES_SECTION).not.toContain('\u2014');
  });

  it('parses Unverified / Working Hypotheses sections and detects inline or restated fact leakage', () => {
    const cleanDoc = [
      '## Verdict',
      'Measured citation rate is 40% across 10 prompts.',
      '',
      UNVERIFIED_SECTION_HEADING,
      '- UNVERIFIED: Competitor schema change caused the rank drop - awaiting crawl diff',
    ].join('\n');

    const parsed = parseUnverifiedSection(cleanDoc);
    expect(parsed.hasSection).toBe(true);
    expect(parsed.declaredNone).toBe(false);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.claim).toBe('Competitor schema change caused the rank drop');
    expect(parsed.items[0]?.basis).toBe('awaiting crawl diff');
    expect(detectUnverifiedFactLeakage(cleanDoc)).toEqual([]);

    const leakedDoc = [
      '## Verdict',
      'Competitor schema change caused the rank drop across priority pages.',
      'UNVERIFIED: Inline note placed outside section - raw draft',
      '',
      UNVERIFIED_SECTION_HEADING,
      '- UNVERIFIED: Competitor schema change caused the rank drop - awaiting crawl diff',
    ].join('\n');

    const leaks = detectUnverifiedFactLeakage(leakedDoc);
    expect(leaks.map((l) => l.kind)).toContain('inline_unverified_outside_section');
    expect(leaks.map((l) => l.kind)).toContain('hypothesis_restated_as_fact');

    const noneDoc = `## Summary\nAll claims verified.\n\n${UNVERIFIED_SECTION_HEADING}\nNone.`;
    const parsedNone = parseUnverifiedSection(noneDoc);
    expect(parsedNone.hasSection).toBe(true);
    expect(parsedNone.declaredNone).toBe(true);
    expect(detectUnverifiedFactLeakage(noneDoc)).toEqual([]);
  });

  it('extracts outermost JSON objects and arrays safely without slicing arrays to inner objects', () => {
    const fencedArray = '```json\n[\n  {"id": 1},\n  {"id": 2}\n]\n```';
    expect(JSON.parse(extractJsonCandidate(fencedArray))).toEqual([{ id: 1 }, { id: 2 }]);

    const proseWrappedObj = 'Here is the consolidated payload:\n{"summary":"ok","proposals":[]}\nDone.';
    expect(JSON.parse(extractJsonCandidate(proseWrappedObj))).toEqual({
      summary: 'ok',
      proposals: [],
    });

    const prosePrefixedFence =
      'Per source [1] for {acme.com}, here is the output:\n```json\n{"summary":"fenced","proposals":[]}\n```';
    expect(JSON.parse(extractJsonCandidate(prosePrefixedFence))).toEqual({
      summary: 'fenced',
      proposals: [],
    });

    const inlineCitationBeforeJson =
      'Per source [1], consolidated result: {"summary":"inline-safe","proposals":[]}';
    expect(JSON.parse(extractJsonCandidate(inlineCitationBeforeJson))).toEqual({
      summary: 'inline-safe',
      proposals: [],
    });

    const leadingFenceWithTrailingProse =
      '```json\n{"summary":"trailing-safe","proposals":[]}\n```\nHope this helps with acme.com.';
    expect(JSON.parse(extractJsonCandidate(leadingFenceWithTrailingProse))).toEqual({
      summary: 'trailing-safe',
      proposals: [],
    });
  });

  it('runs at most 1 bounded repair retry without re-pasting the full schema', async () => {
    const promptWithContract = appendOutputContract('Consolidate events.', {
      type: 'object',
      required: ['summary', 'proposals'],
    });
    expect(promptWithContract).toContain('OUTPUT CONTRACT (machine-validated):');
    expect(buildSingleRetryMessage(['Field x missing'])).toContain('- Field x missing');

    let retryCalls = 0;
    let capturedRetryMsg = '';
    const repaired = await runWithSingleJsonRetry({
      firstAttempt: async () => '{"summary": "missing proposals array"}',
      retryAttempt: async (msg) => {
        retryCalls += 1;
        capturedRetryMsg = msg;
        return '{"summary": "fixed", "proposals": []}';
      },
      validator: (val) => {
        const obj = val as { summary?: unknown; proposals?: unknown };
        if (obj && typeof obj === 'object' && Array.isArray(obj.proposals)) {
          return { ok: true, value: { summary: String(obj.summary || ''), proposals: obj.proposals } };
        }
        return { ok: false, errors: ['"proposals" must be an array.'] };
      },
    });

    expect(repaired.ok).toBe(true);
    expect(repaired.retried).toBe(true);
    expect(retryCalls).toBe(1);
    expect(capturedRetryMsg).toContain('"proposals" must be an array.');
    expect(capturedRetryMsg).not.toContain('"required"');

    let failCalls = 0;
    const exhausted = await runWithSingleJsonRetry({
      firstAttempt: async () => 'not json at all',
      retryAttempt: async () => {
        failCalls += 1;
        return 'still not json';
      },
      validator: (v) => ({ ok: true, value: v }),
    });
    expect(exhausted.ok).toBe(false);
    expect(exhausted.retried).toBe(true);
    expect(failCalls).toBe(1);

    const emptyCheck = validateJsonContract('   ', (v) => ({ ok: true, value: v }));
    expect(emptyCheck.ok).toBe(false);

    const nullRetry = await runWithSingleJsonRetry({
      firstAttempt: async () => '{"bad": 1}',
      retryAttempt: async () => null,
      validator: () => ({ ok: false, errors: ['Missing summary'] }),
    });
    expect(nullRetry.ok).toBe(false);
    if (!nullRetry.ok) {
      expect(nullRetry.errors).toContain('Missing summary');
      expect(nullRetry.errors).toContain('Retry returned empty/null completion.');
    }
  });

  it('contrasts baseline vs treatment Dream Agent on malformed JSON and unverified markers', async () => {
    const env = { GROQ_API_KEY: 'gsk_test_dummy' } as unknown as Env;
    const input = {
      domain: 'acme.com',
      activeMemories: [],
      pendingEvents: [
        {
          id: 'devt_1',
          accountId: 'acct_1',
          projectId: null,
          domain: 'acme.com',
          eventType: 'audit_completed' as const,
          sourceId: null,
          payload: { healthScore: 74 },
          contentHash: 'h1',
          signalWeight: 1,
          dreamRunId: null,
          createdAt: Date.now(),
        },
      ],
    };

    let attempt = 0;
    const mockRepairFetcher: typeof fetch = async () => {
      attempt += 1;
      const content =
        attempt === 1
          ? '{"summary": "broken first turn", "proposals": "not-an-array"}'
          : JSON.stringify({
              summary: 'Repaired consolidation',
              unverifiedHypotheses: ['UNVERIFIED: Bot block suspected - single probe timeout'],
              proposals: [
                {
                  action: 'create',
                  memoryType: 'visibility_profile',
                  title: 'Visibility Standing: acme.com',
                  content: 'UNVERIFIED: Score may have dipped after CDN change',
                  confidence: 0.92,
                  sourceRefs: ['devt_1'],
                  requiresApproval: false,
                  rationale: 'Observed audit event.',
                },
              ],
            });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    // Baseline fails on turn 1 and falls back deterministically without retry.
    attempt = 0;
    const baselineOut = await runDreamAgent(env, input, mockRepairFetcher, { variant: 'baseline' });
    expect(baselineOut.modelId).toBe('deterministic');
    expect(baselineOut.usedFallback).toBe(true);
    expect(baselineOut.contractRetried).toBe(false);

    // Treatment repairs on turn 2 and forces requiresApproval=true because content carries UNVERIFIED:.
    attempt = 0;
    const treatmentOut = await runDreamAgent(env, input, mockRepairFetcher, { variant: 'treatment' });
    expect(treatmentOut.modelId).toBe('openai/gpt-oss-120b');
    expect(treatmentOut.usedFallback).toBe(false);
    expect(treatmentOut.contractRetried).toBe(true);
    expect(treatmentOut.unverifiedHypotheses).toHaveLength(1);
    expect(containsUnverifiedMarker(treatmentOut.proposals[0]!.content)).toBe(true);
    expect(treatmentOut.proposals[0]!.requiresApproval).toBe(true);
  });

  it('records symmetric A/B exposure and dream_contract_result events in D1 when EPISTEMIC_AB_ENABLED=true', async () => {
    const db = createSqliteD1();
    const envOn = {
      DB: db,
      GROQ_API_KEY: 'gsk_test_dummy',
      EPISTEMIC_AB_ENABLED: 'true',
    } as unknown as Env;

    await enqueueDreamEvent(envOn, {
      accountId: 'acct_epistemic_d1',
      domain: 'luminarasuite.com',
      eventType: 'audit_completed',
      payload: { healthScore: 88, citationRatePercent: 70 },
    });

    const okFetcher: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Verified visibility update',
                  proposals: [
                    {
                      action: 'create',
                      memoryType: 'visibility_profile',
                      title: 'Visibility Standing',
                      content: 'Measured score 88%.',
                      confidence: 0.91,
                      sourceRefs: [],
                      requiresApproval: false,
                      rationale: 'Verified from audit event.',
                    },
                  ],
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );

    const runRes = await executeDreamRun(envOn, 'acct_epistemic_d1', 'luminarasuite.com', 'manual_user', {
      force: true,
      fetcher: okFetcher,
      request: new Request('https://luminarasuite.com/api/dreaming/run?epistemic=treatment', {
        method: 'POST',
      }),
    });
    expect(runRes.ok && runRes.woke).toBe(true);

    const events = await db
      .prepare(`SELECT event_type, account_id, payload_json FROM product_analytics_events ORDER BY rowid ASC`)
      .all<{ event_type: string; account_id: string | null; payload_json: string }>();
    const rows = events.results || [];
    expect(rows.map((r) => r.event_type)).toEqual([
      'epistemic_ab_exposed',
      'dream_contract_result',
    ]);
    expect(rows[0]?.account_id).toBe('acct_epistemic_d1');
    expect(JSON.parse(rows[1]!.payload_json)).toMatchObject({
      variant: 'treatment',
      usedFallback: false,
      contractRetried: false,
      proposalsCount: 1,
    });
  });

  it('formats Citation Watch epistemic notes cleanly and keeps runAllValidators block count symmetric', () => {
    const note = buildCitationWatchEpistemicNote({
      domain: 'example.com',
      engine: 'perplexity',
      classified: {
        verdict: 'drift',
        citedCount: 2,
        promptCount: 10,
        share: 0.2,
        comparedToRunId: 'cwr_prev',
        deltaShare: -0.3,
        reason: 'Share fell by 30 percentage points compared with baseline.',
      },
      hypotheses: [
        {
          claim: 'Updated pricing FAQ removed direct comparison table',
          basis: 'Last deploy touched /pricing 48h ago',
        },
      ],
    });

    expect(note).not.toContain('\u2014');
    const check = validateCitationWatchEpistemicNote(note);
    expect(check.ok).toBe(true);

    // Validator symmetry: neither clean baseline prose nor clean treatment prose triggers blocks.
    const baselineCheck = runAllValidators('Measured organic clicks increased according to https://example.com/report.');
    const treatmentCheck = runAllValidators(note);
    expect(baselineCheck.ok).toBe(true);
    expect(treatmentCheck.ok).toBe(true);

    const leakedFindings = epistemicStanceHonesty(
      `Pricing FAQ removal dropped citations.\n\n${UNVERIFIED_SECTION_HEADING}\n- UNVERIFIED: Pricing FAQ removal dropped citations - deploy timing`,
    );
    expect(leakedFindings).toHaveLength(1);
    expect(leakedFindings[0]?.severity).toBe('warn');
  });

  it('triggers Dream 1-retry on malformed proposal items, flags hypothesis token leakage, and preserves UNVERIFIED in contextCompactorService', async () => {
    const env = { GROQ_API_KEY: 'gsk_test_dummy' } as unknown as Env;
    const input = {
      domain: 'acme.com',
      activeMemories: [],
      pendingEvents: [
        {
          id: 'devt_leak',
          accountId: 'acct_1',
          projectId: null,
          domain: 'acme.com',
          eventType: 'audit_completed' as const,
          sourceId: null,
          payload: { healthScore: 81 },
          contentHash: 'h_leak',
          signalWeight: 1,
          dreamRunId: null,
          createdAt: Date.now(),
        },
      ],
    };

    let attempt = 0;
    const itemRepairFetcher: typeof fetch = async () => {
      attempt += 1;
      const content =
        attempt === 1
          ? JSON.stringify({
              summary: 'Malformed proposal item on turn 1',
              proposals: [{ action: 'not_valid_action', title: 'Bad' }],
            })
          : JSON.stringify({
              summary: 'Repaired item schema',
              unverifiedHypotheses: [
                'UNVERIFIED: Competitor schema change caused the rank drop - crawl diff pending',
              ],
              proposals: [
                {
                  action: 'create',
                  memoryType: 'visibility_profile',
                  title: 'Rank Drop Cause',
                  content: 'Competitor schema change caused the rank drop across priority pages.',
                  confidence: 0.94,
                  sourceRefs: ['devt_leak'],
                  requiresApproval: false,
                  rationale: 'Consolidated hypothesis.',
                },
              ],
            });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };

    const out = await runDreamAgent(env, input, itemRepairFetcher, { variant: 'treatment' });
    expect(out.contractRetried).toBe(true);
    expect(out.usedFallback).toBe(false);
    // Even without a literal UNVERIFIED: prefix in content, restating an unverifiedHypothesis forces requiresApproval=true!
    expect(out.proposals[0]?.requiresApproval).toBe(true);

    // ContextCompactor preserves UNVERIFIED: bullets separately from factual currentState.
    const compacted = synthesizeSummaryFromMessages([
      { id: 'm1', role: 'user', content: 'Audit acme.com visibility', timestamp: 1 },
      {
        id: 'm2',
        role: 'assistant',
        content:
          'Measured citation share is 35%.\n\n## Unverified / Working Hypotheses\n- UNVERIFIED: Bot block suspected - single probe timeout',
        timestamp: 2,
      },
    ]);
    expect(compacted.currentState).toBe('Measured citation share is 35%.');
    expect(compacted.unverifiedHypotheses).toEqual([
      'UNVERIFIED: Bot block suspected - single probe timeout',
    ]);
    const formatted = formatCompactSummary(compacted);
    expect(formatted).toContain('### Unverified / Working Hypotheses');
    expect(formatted).toContain('UNVERIFIED: Bot block suspected - single probe timeout');

    // Non-string items in unverifiedHypotheses trigger 1-retry contract repair in treatment, and fenced JSON parses in baseline.
    let hypTurn = 0;
    const hypRepair = await runDreamAgent(
      env,
      input,
      async () => {
        hypTurn += 1;
        const content =
          hypTurn === 1
            ? JSON.stringify({ summary: 'Bad hyp types', unverifiedHypotheses: [123], proposals: [] })
            : JSON.stringify({ summary: 'Clean', unverifiedHypotheses: ['UNVERIFIED: CDN timeout - single sample'], proposals: [] });
        return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
      },
      { variant: 'treatment' },
    );
    expect(hypRepair.contractRetried).toBe(true);
    expect(hypRepair.usedFallback).toBe(false);

    const fencedBaseline = await runDreamAgent(
      env,
      input,
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '```json\n{"summary":"Fenced baseline","proposals":[]}\n```' } }],
          }),
          { status: 200 },
        ),
      { variant: 'baseline' },
    );
    expect(fencedBaseline.usedFallback).toBeFalsy();
    expect(fencedBaseline.summary).toBe('Fenced baseline');
  });
});
