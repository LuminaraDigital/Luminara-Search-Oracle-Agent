import { describe, expect, it, vi } from 'vitest';
import {
  computeQueryMetadata,
  findReplBlocks,
  RlmContextStore,
  RLMRunner,
  type RlmMessage,
} from '../services/rlm';
import { ClaimLedger } from '../services/evidenceBound/claimLedger';
import { compactConversation } from '../services/oracle/contextCompactorService';
import type { Message } from '../types';

describe('RLM (alexzhang13/rlm MIT port) core engine & Evidence-Bound gates', () => {
  it('computes QueryMetadata across str, list, and dict contexts', () => {
    const strMeta = computeQueryMetadata('hello world');
    expect(strMeta.contextType).toBe('str');
    expect(strMeta.contextTotalLength).toBe(11);

    const dictMeta = computeQueryMetadata({
      'https://example.com': 'Homepage content with FAQPage schema',
      'https://example.com/pricing': 'Pricing tier $49/mo Growth plan',
    });
    expect(dictMeta.contextType).toBe('dict');
    expect(dictMeta.keysOrCount).toEqual([
      'https://example.com',
      'https://example.com/pricing',
    ]);
    expect(dictMeta.contextTotalLength).toBeGreaterThan(50);
  });

  it('extracts ```repl blocks accurately', () => {
    const response = [
      'First let us probe the context:',
      '```repl',
      '{"op": "probe", "target": "context"}',
      '```',
      'And also list variables:',
      '```repl',
      '{"op": "show_vars"}',
      '```',
    ].join('\n');
    const blocks = findReplBlocks(response);
    expect(blocks).toHaveLength(2);
    expect(JSON.parse(blocks[0]).op).toBe('probe');
    expect(JSON.parse(blocks[1]).op).toBe('show_vars');
  });

  it('executes probe, regex_search, chunk, and llm_query_batched with untrusted fencing', async () => {
    const receivedPrompts: string[] = [];
    const store = new RlmContextStore({
      contextPayload: {
        'https://luminara.ai/': 'Luminara has Organization and FAQPage JSON-LD schema markup.',
        'https://luminara.ai/pricing': 'Agency plan includes API access and 50 audits per month.',
      },
      maxConcurrentSubcalls: 2,
      subLlmCall: async (prompt, model) => {
        receivedPrompts.push(prompt);
        return {
          rootModel: model || 'sub-fast',
          prompt,
          response: `Extracted summary (${prompt.length} chars)`,
          usageSummary: {
            modelUsageSummaries: {},
            totalInputTokens: 20,
            totalOutputTokens: 10,
            totalCostUsd: 0.0001,
          },
          executionTimeMs: 5,
        };
      },
    });

    const probeRes = await store.executeBlock('{"op": "probe", "target": "context"}');
    expect(probeRes.stderr).toBe('');
    expect(probeRes.stdout).toContain('type=dict keys(2)');

    const regexRes = await store.executeBlock(
      '{"op": "regex_search", "target": "context", "pattern": "FAQPage|Agency", "saveAs": "matches"}'
    );
    expect(regexRes.stderr).toBe('');
    expect(store.getVariable('matches')).toHaveLength(2);

    const chunkRes = await store.executeBlock(
      '{"op": "chunk", "target": "context", "saveAs": "page_chunks"}'
    );
    expect(chunkRes.stderr).toBe('');
    expect(store.getVariable('page_chunks')).toHaveLength(2);

    const batchRes = await store.executeBlock(
      JSON.stringify({
        op: 'llm_query_batched',
        itemsVar: 'page_chunks',
        promptTemplate: 'Audit this page: {{item}}',
        saveAs: 'page_audits',
      })
    );
    expect(batchRes.stderr).toBe('');
    expect(batchRes.rlmCalls).toHaveLength(2);
    expect(receivedPrompts[0]).toContain('<<<UNTRUSTED_REPL_BATCH_ITEM_0_BEGIN>>>');
    expect(store.getVariable('page_audits')).toHaveLength(2);
  });

  it('enforces Evidence-Bound ClaimLedger gate on submit_answer (rejects unsupported measured claims)', async () => {
    const ledger = new ClaimLedger();
    const store = new RlmContextStore({
      contextPayload: 'Homepage contains Organization JSON-LD schema and canonical link.',
      claimLedger: ledger,
    });

    // 1. Measured claim WITHOUT evidenceKey or sources -> rejected into stderr, ready remains false
    const badResult = await store.executeBlock(
      JSON.stringify({
        op: 'submit_answer',
        content: 'Site has 95% organic traffic growth.',
        ready: true,
        claims: [
          {
            text: 'Site has 95% organic traffic growth.',
            status: 'measured',
          },
        ],
      })
    );
    expect(badResult.finalAnswer).toBeNull();
    expect(badResult.stderr).toContain('EvidenceBoundError');
    expect(store.getAnswerBox().ready).toBe(false);

    // 2. Measured claim WITH supporting REPL variable -> accepted, ready flips true
    const goodResult = await store.executeBlock(
      JSON.stringify({
        op: 'submit_answer',
        content: 'Homepage contains Organization JSON-LD schema.',
        ready: true,
        claims: [
          {
            text: 'Homepage contains Organization JSON-LD schema.',
            status: 'measured',
            evidenceKey: 'context',
          },
        ],
      })
    );
    expect(goodResult.stderr).toBe('');
    expect(goodResult.finalAnswer).toBe('Homepage contains Organization JSON-LD schema.');
    expect(store.getAnswerBox().ready).toBe(true);
    expect(ledger.summary().measured).toBe(1);
  });

  it('runs multi-turn RLMRunner orchestration loop from probe to batched sub-query to final answer', async () => {
    let rootTurn = 0;
    const rootLlm = async (_messages: RlmMessage[]) => {
      rootTurn += 1;
      if (rootTurn === 1) {
        return {
          text: [
            'Turn 1: Probe the multi-page context and chunk pages.',
            '```repl',
            '[{"op": "probe", "target": "context"}, {"op": "chunk", "target": "context", "saveAs": "pages"}]',
            '```',
          ].join('\n'),
          model: 'root-orchestrator',
          inputTokens: 120,
          outputTokens: 45,
          costUsd: 0.001,
        };
      }
      if (rootTurn === 2) {
        return {
          text: [
            'Turn 2: Map sub-LLM extraction across all page chunks.',
            '```repl',
            '{"op": "llm_query_batched", "itemsVar": "pages", "promptTemplate": "Extract schemas: {{item}}", "saveAs": "extracted"}',
            '```',
          ].join('\n'),
          model: 'root-orchestrator',
          inputTokens: 180,
          outputTokens: 50,
          costUsd: 0.001,
        };
      }
      return {
        text: [
          'Turn 3: Submit verified answer.',
          '```repl',
          JSON.stringify({
            op: 'submit_answer',
            content: 'Verified: FAQPage and Product schemas detected across 2 pages.',
            ready: true,
            claims: [
              {
                text: 'FAQPage and Product schemas detected across 2 pages.',
                status: 'measured',
                evidenceKey: 'extracted',
              },
            ],
          }),
          '```',
        ].join('\n'),
        model: 'root-orchestrator',
        inputTokens: 210,
        outputTokens: 60,
        costUsd: 0.001,
      };
    };

    const subLlm = async (messages: RlmMessage[]) => ({
      text: `Found FAQPage and Product schemas in chunk (${messages[0].content.length} chars).`,
      model: 'sub-worker',
      inputTokens: 80,
      outputTokens: 20,
      costUsd: 0.0002,
    });

    const runner = new RLMRunner({
      rootLlm,
      subLlm,
      rootModelName: 'root-orchestrator',
      subModelName: 'sub-worker',
      maxIterations: 6,
    });

    const completion = await runner.completion(
      {
        'https://example.com': 'Home page with FAQPage schema',
        'https://example.com/shop': 'Product page with Product schema',
      },
      'Which JSON-LD schemas exist across the site?'
    );

    expect(completion.response).toBe(
      'Verified: FAQPage and Product schemas detected across 2 pages.'
    );
    expect(completion.metadata?.iterations).toHaveLength(3);
    expect(
      completion.usageSummary.modelUsageSummaries['root-orchestrator'].totalCalls
    ).toBe(3);
    expect(
      completion.usageSummary.modelUsageSummaries['sub-worker'].totalCalls
    ).toBe(2);
  });

  it('archives pre-compaction turns non-lossily when compactConversation triggers', () => {
    const store = new RlmContextStore({ compaction: true });
    const messages: Message[] = Array.from({ length: 10 }, (_, idx) => ({
      id: `m-${idx}`,
      role: idx % 2 === 0 ? 'user' : 'assistant',
      content: `Turn ${idx}: ${'Detailed SEO crawl telemetry '.repeat(40)}`,
      timestamp: Date.now() + idx,
    }));

    const res = compactConversation(messages, {
      contextLimitTokens: 500,
      thresholdPercent: 50,
      recentTurnsToKeep: 2,
      onArchiveSegment: (segment, summary) => {
        store.addHistory(segment);
        store.appendCompactionEntry({ segment, summary });
      },
    });

    expect(res.compacted).toBe(true);
    expect(res.archivedSegment).toHaveLength(8);
    expect(store.getHistoryCount()).toBe(1);
    expect((store.getVariable('history') as unknown[]).length).toBe(1);
  });

  it('guards against ReDoS regex patterns, $& replacement corruption, and partial claim leaks', async () => {
    const capturedPrompts: string[] = [];
    const ledger = new ClaimLedger();
    const store = new RlmContextStore({
      contextPayload: ['Price is $& and $$199 per month'],
      claimLedger: ledger,
      subLlmCall: async (prompt) => {
        capturedPrompts.push(prompt);
        return {
          rootModel: 'sub',
          prompt,
          response: 'ok',
          usageSummary: {
            modelUsageSummaries: {},
            totalInputTokens: 10,
            totalOutputTokens: 2,
            totalCostUsd: 0,
          },
          executionTimeMs: 1,
        };
      },
    });

    // 1. ReDoS pattern rejected
    const redosRes = await store.executeBlock(
      JSON.stringify({ op: 'regex_search', pattern: '(a+)+$' })
    );
    expect(redosRes.stderr).toContain('RegexSafetyError');

    // 2. $& and $$ in scraped items preserved verbatim in llm_query_batched
    await store.executeBlock(
      JSON.stringify({
        op: 'llm_query_batched',
        itemsVar: 'context',
        promptTemplate: 'Analyze pricing: {{item}}',
      })
    );
    expect(capturedPrompts[0]).toContain('Price is $& and $$199 per month');

    // 3. Atomic claim validation: if claim #2 fails, claim #1 is not leaked into ClaimLedger
    const atomicRes = await store.executeBlock(
      JSON.stringify({
        op: 'submit_answer',
        content: 'Pricing is $199 per month.',
        ready: true,
        claims: [
          {
            text: 'Price is 199 per month.',
            status: 'measured',
            evidenceKey: 'context',
          },
          {
            text: 'Unverified second claim without sources.',
            status: 'measured',
          },
        ],
      })
    );
    expect(atomicRes.stderr).toContain('EvidenceBoundError');
    expect(ledger.list()).toHaveLength(0);
    expect(store.getAnswerBox().ready).toBe(false);

    // 4. SHOW_VARS() shorthand works
    const showRes = await store.executeBlock('SHOW_VARS()');
    expect(showRes.stderr).toBe('');
    expect(showRes.stdout).toContain('Available variables:');
  });

  it('resets answerBox and usage counters when reusing persistentStore across RLMRunner completions', async () => {
    const persistentStore = new RlmContextStore({
      contextPayload: 'Initial context 0',
    });

    let callNum = 0;
    const runner = new RLMRunner({
      persistentStore,
      maxIterations: 3,
      rootLlm: async () => {
        callNum += 1;
        if (callNum === 1) {
          return {
            text: '```repl\n{"op": "submit_answer", "content": "First answer", "ready": true}\n```',
            model: 'root',
            inputTokens: 50,
            outputTokens: 20,
          };
        }
        if (callNum === 2) {
          return {
            text: '```repl\n{"op": "probe", "target": "context_1"}\n```',
            model: 'root',
            inputTokens: 50,
            outputTokens: 20,
          };
        }
        return {
          text: '```repl\n{"op": "submit_answer", "content": "Second answer after probe", "ready": true}\n```',
          model: 'root',
          inputTokens: 50,
          outputTokens: 20,
        };
      },
    });

    const first = await runner.completion('Context run 1', 'Question 1');
    expect(first.response).toBe('First answer');

    const second = await runner.completion('Context run 2', 'Question 2');
    // Must not short-circuit on Turn 1 with "First answer" when probing context_1
    expect(second.response).toBe('Second answer after probe');
    expect(second.metadata?.iterations).toHaveLength(2);
    expect(second.usageSummary.modelUsageSummaries['root'].totalCalls).toBe(2);
  });

  it('executes recursive rlm_query with depth increment and falls back to single subLlm at maxDepth', async () => {
    let subCalls = 0;
    const runner = new RLMRunner({
      maxDepth: 2,
      maxIterations: 2,
      rootLlm: async (messages) => {
        const joined = messages.map((m) => m.content).join('\n');
        const hasReplOutput = joined.includes('REPL output:');
        if (joined.includes('Root task') && !hasReplOutput) {
          return {
            text: '```repl\n{"op": "rlm_query", "prompt": "Child question", "contextVar": "context", "saveAs": "child_out"}\n```',
            model: 'root-model',
            inputTokens: 40,
            outputTokens: 20,
          };
        }
        if (joined.includes('Child question') && !hasReplOutput) {
          // Child RLM at depth=1 spawns another rlm_query which hits depth=2 >= maxDepth (fallback to subLlm)
          return {
            text: '```repl\n[{"op": "rlm_query", "prompt": "Grandchild leaf question", "saveAs": "leaf_out"}, {"op": "submit_answer", "fromVar": "leaf_out", "ready": true}]\n```',
            model: 'child-model',
            inputTokens: 30,
            outputTokens: 15,
          };
        }
        return {
          text: '```repl\n{"op": "submit_answer", "fromVar": "child_out", "ready": true}\n```',
          model: 'root-model',
          inputTokens: 30,
          outputTokens: 15,
        };
      },
      subLlm: async () => {
        subCalls += 1;
        return {
          text: 'Leaf verified finding',
          model: 'leaf-worker',
          inputTokens: 15,
          outputTokens: 10,
        };
      },
    });

    const result = await runner.completion('Deep corpus payload', 'Root task');
    expect(result.response).toBe('Leaf verified finding');
    expect(subCalls).toBe(1);
    expect(result.metadata?.finalAnswer).toBe('Leaf verified finding');
  });

  it('strips repl blocks and leaves metadata.finalAnswer null when RlmLimitExceededError or maxIterations triggers without submit_answer', async () => {
    const runner = new RLMRunner({
      maxIterations: 3,
      maxErrors: 1,
      rootLlm: async () => ({
        text: 'Partial prose summary before error.\n```repl\n{"op": "unknown_bad_op"}\n```',
        model: 'root',
        inputTokens: 20,
        outputTokens: 20,
      }),
    });

    const res = await runner.completion('Corpus text', 'Test error limit');
    expect(res.error).toContain('consecutive errors');
    expect(res.response).toBe('Partial prose summary before error.');
    expect(res.response).not.toContain('```repl');
    expect(res.metadata?.finalAnswer).toBeNull();
    expect(res.metadata?.hasErrors).toBe(true);
  });

  it('does not forward synthetic rlm-* role names as literal provider model IDs in createAiProviderRlmClient', async () => {
    const { aiProviderService } = await import('../services/aiProviderService');
    const { createAiProviderRlmClient, synthesizeRlmAuditEvidence } = await import(
      '../services/rlm'
    );

    const spy = vi
      .spyOn(aiProviderService, 'generateWithFailover')
      .mockResolvedValue({
        text: '```repl\n{"op": "submit_answer", "content": "Cross-page FAQ schema verified.", "ready": true}\n```',
        provider: 'groq',
        tokenUsage: { prompt: 100, completion: 30, total: 130 },
      });

    try {
      const client = createAiProviderRlmClient({ model: 'llama-3.3-70b-versatile' });
      const res = await client(
        [{ role: 'user', content: 'Hello' }],
        'rlm-audit-orchestrator'
      );
      expect(res.model).toBe('rlm-audit-orchestrator');
      expect(spy).toHaveBeenCalledWith(
        'Hello',
        expect.objectContaining({ model: 'llama-3.3-70b-versatile' })
      );

      const synth = await synthesizeRlmAuditEvidence({
        rlmCorpus: {
          'https://example.com': 'Home page content',
          'https://example.com/pricing': 'Pricing page content',
        },
        websiteUrl: 'https://example.com',
        focus: 'SEO',
      });
      expect(synth?.synthesisText).toBe('Cross-page FAQ schema verified.');
      expect(synth?.trajectory?.finalAnswer).toBe('Cross-page FAQ schema verified.');
    } finally {
      spy.mockRestore();
    }
  });
});

