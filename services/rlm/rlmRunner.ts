/**
 * Recursive Language Model (RLM) Orchestrator Loop
 *
 * Adapted from alexzhang13/rlm (rlm/core/rlm.py).
 * MIT License - Copyright (c) 2026 Alex Zhang.
 *
 * Implements the iterative RLM completion loop:
 *   Prompt -> [Root LM <-> Sandboxed ContextStore + Sub-LM Map-Reduce] -> Verified Answer
 *
 * Invariant: Never use em dashes (U+2014) in comments or output strings.
 */

import { ClaimLedger } from '../evidenceBound/claimLedger';
import { estimateTokens } from '../oracle/contextCompactorService';
import { RlmContextStore } from './contextStore';
import {
  buildRlmSystemPrompt,
  buildUserTurnPrompt,
  findReplBlocks,
  formatIterationMessages,
  RLM_DEFAULT_MAX_ITERATIONS,
} from './prompts';
import {
  CodeBlock,
  computeQueryMetadata,
  ModelUsageSummary,
  RLMChatCompletion,
  RLMIteration,
  RlmContextPayload,
  UsageSummary,
} from './types';

export type RlmMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type RlmLlmClient = (
  messages: RlmMessage[],
  modelOverride?: string
) => Promise<{
  text: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}>;

export interface RlmRunnerOptions {
  rootLlm: RlmLlmClient;
  subLlm?: RlmLlmClient;
  rootModelName?: string;
  subModelName?: string;
  depth?: number;
  maxDepth?: number;
  maxIterations?: number;
  maxBudgetUsd?: number;
  maxTimeoutMs?: number;
  maxTokens?: number;
  maxErrors?: number;
  maxConcurrentSubcalls?: number;
  compaction?: boolean;
  compactionThresholdPct?: number;
  contextLimitTokens?: number;
  persistentStore?: RlmContextStore;
  claimLedger?: ClaimLedger;
  customSystemPrompt?: string;
  onIterationComplete?: (iteration: RLMIteration, index: number) => void;
}

export class RlmLimitExceededError extends Error {
  public readonly kind: 'timeout' | 'budget' | 'tokens' | 'errors';
  public readonly partialAnswer: string | null;

  constructor(
    kind: 'timeout' | 'budget' | 'tokens' | 'errors',
    message: string,
    partialAnswer: string | null
  ) {
    super(message);
    this.name = 'RlmLimitExceededError';
    this.kind = kind;
    this.partialAnswer = partialAnswer;
  }
}

export class RLMRunner {
  private readonly opts: Required<
    Pick<
      RlmRunnerOptions,
      | 'depth'
      | 'maxDepth'
      | 'maxIterations'
      | 'maxConcurrentSubcalls'
      | 'compaction'
      | 'compactionThresholdPct'
      | 'contextLimitTokens'
      | 'rootModelName'
      | 'subModelName'
    >
  > &
    RlmRunnerOptions;

  private usageByModel = new Map<string, ModelUsageSummary>();
  private consecutiveErrors = 0;
  private bestPartialAnswer: string | null = null;

  constructor(options: RlmRunnerOptions) {
    this.opts = {
      ...options,
      depth: options.depth ?? 0,
      maxDepth: options.maxDepth ?? 2,
      maxIterations: options.maxIterations ?? RLM_DEFAULT_MAX_ITERATIONS,
      maxConcurrentSubcalls: options.maxConcurrentSubcalls ?? 4,
      compaction: options.compaction ?? false,
      compactionThresholdPct: options.compactionThresholdPct ?? 0.85,
      contextLimitTokens: options.contextLimitTokens ?? 32_768,
      rootModelName: options.rootModelName ?? 'rlm-root',
      subModelName: options.subModelName ?? options.rootModelName ?? 'rlm-sub',
    };
  }

  public async completion(
    contextPayload: RlmContextPayload,
    rootPrompt?: string
  ): Promise<RLMChatCompletion> {
    const startMs = performance.now();
    this.usageByModel.clear();
    this.consecutiveErrors = 0;
    this.bestPartialAnswer = null;

    // Fallback to single-pass LM call if at or beyond maxDepth
    if (this.opts.depth >= this.opts.maxDepth) {
      return this.fallbackSingleCompletion(contextPayload, rootPrompt, startMs);
    }

    const store =
      this.opts.persistentStore ??
      new RlmContextStore({
        contextPayload,
        compaction: this.opts.compaction,
        maxConcurrentSubcalls: this.opts.maxConcurrentSubcalls,
        claimLedger: this.opts.claimLedger,
      });

    if (this.opts.persistentStore) {
      store.resetAnswerBox();
      store.addContext(contextPayload);
    }

    store.setSubCallHandlers({
      subLlmCall: (prompt, model) => this.executeSubLlmCall(prompt, model),
      subRlmCall: (prompt, model) => this.executeSubRlmCall(prompt, model, startMs),
    });

    const queryMetadata = computeQueryMetadata(contextPayload);
    let messageHistory: RlmMessage[] = buildRlmSystemPrompt({
      queryMetadata,
      rootPrompt,
      customSystemPrompt: this.opts.customSystemPrompt,
      orchestrator: true,
      compaction: this.opts.compaction,
    });

    const iterations: RLMIteration[] = [];
    let compactionCount = 0;

    try {
      for (let i = 0; i < this.opts.maxIterations; i++) {
        this.checkTimeout(i, startMs);

        if (this.opts.compaction && this.shouldCompact(messageHistory)) {
          compactionCount += 1;
          messageHistory = await this.compactHistory(
            store,
            messageHistory,
            compactionCount
          );
        }

        const turnUserMsg = buildUserTurnPrompt({
          iteration: i,
          maxIterations: this.opts.maxIterations,
          contextCount: store.getContextCount(),
          historyCount: store.getHistoryCount(),
        });
        messageHistory.push(turnUserMsg);

        const iterStartMs = performance.now();
        const promptSnapshot = messageHistory.map((m) => ({ ...m }));
        const rootResp = await this.callAndRecord(
          this.opts.rootLlm,
          messageHistory,
          this.opts.rootModelName
        );

        const replBlocks = findReplBlocks(rootResp.text);
        const codeBlocks: CodeBlock[] = [];
        let finalAnswer: string | null = null;

        for (const blockStr of replBlocks) {
          const result = await store.executeBlock(blockStr);
          codeBlocks.push({ code: blockStr, result });
          if (result.finalAnswer !== null && finalAnswer === null) {
            finalAnswer = result.finalAnswer;
          }
        }

        const iteration: RLMIteration = {
          iteration: i + 1,
          timestamp: new Date().toISOString(),
          prompt: promptSnapshot,
          response: rootResp.text,
          codeBlocks,
          finalAnswer,
          iterationTimeMs: performance.now() - iterStartMs,
        };

        iterations.push(iteration);
        const answerBox = store.getAnswerBox();
        const cleanedTurnText = rootResp.text
          .replace(/```repl[\s\S]*?```/gi, '')
          .trim();
        if (answerBox.content.trim()) {
          this.bestPartialAnswer = answerBox.content.trim();
        } else if (cleanedTurnText) {
          this.bestPartialAnswer = cleanedTurnText;
        }
        this.opts.onIterationComplete?.(iteration, i);

        this.checkIterationLimits(iteration, i);

        if (finalAnswer !== null) {
          if (this.opts.persistentStore) {
            store.addHistory(messageHistory);
          }
          return this.buildCompletionResult(
            rootPrompt || 'RLM Context Query',
            finalAnswer,
            iterations,
            startMs,
            undefined,
            true
          );
        }

        const nextMessages = formatIterationMessages(iteration);
        messageHistory.push(...nextMessages);
        if (this.opts.compaction) {
          store.appendCompactionEntry(nextMessages);
        }
      }
    } catch (err) {
      if (err instanceof RlmLimitExceededError && err.partialAnswer) {
        return this.buildCompletionResult(
          rootPrompt || 'RLM Context Query',
          err.partialAnswer,
          iterations,
          startMs,
          err.message,
          false
        );
      }
      throw err;
    }

    // Exhausted maxIterations: request one final synthesized answer
    messageHistory.push({
      role: 'user',
      content:
        'Maximum REPL turns reached. Provide your final evidence-bound answer now based on the REPL outputs gathered above.',
    });
    const fallbackResp = await this.callAndRecord(
      this.opts.rootLlm,
      messageHistory,
      this.opts.rootModelName
    );
    if (this.opts.persistentStore) {
      store.addHistory(messageHistory);
    }
    const cleanedFallback =
      fallbackResp.text.replace(/```repl[\s\S]*?```/gi, '').trim() ||
      store.getAnswerBox().content.trim() ||
      fallbackResp.text.trim();
    return this.buildCompletionResult(
      rootPrompt || 'RLM Context Query',
      cleanedFallback,
      iterations,
      startMs,
      undefined,
      false
    );
  }

  private async executeSubLlmCall(
    prompt: string,
    modelOverride?: string
  ): Promise<RLMChatCompletion> {
    const startMs = performance.now();
    const client = this.opts.subLlm ?? this.opts.rootLlm;
    const targetModel = modelOverride ?? this.opts.subModelName;
    const recordedPrompt =
      prompt.length > 4_000
        ? `${prompt.slice(0, 4_000)}\n... [Sub-prompt truncated for trajectory storage]`
        : prompt;
    try {
      const res = await this.callAndRecord(
        client,
        [{ role: 'user', content: prompt }],
        targetModel
      );
      return {
        rootModel: res.model,
        prompt: recordedPrompt,
        response: res.text,
        usageSummary: this.getUsageSummary(),
        executionTimeMs: performance.now() - startMs,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        rootModel: targetModel,
        prompt: recordedPrompt,
        response: `Error: Sub-LM query failed - ${msg}`,
        usageSummary: this.getUsageSummary(),
        executionTimeMs: performance.now() - startMs,
        error: msg,
      };
    }
  }

  private async executeSubRlmCall(
    prompt: string,
    modelOverride: string | undefined,
    parentStartMs: number
  ): Promise<RLMChatCompletion> {
    const nextDepth = this.opts.depth + 1;
    if (nextDepth >= this.opts.maxDepth) {
      return this.executeSubLlmCall(prompt, modelOverride);
    }

    const elapsed = performance.now() - parentStartMs;
    let remainingTimeout: number | undefined;
    if (this.opts.maxTimeoutMs !== undefined) {
      remainingTimeout = this.opts.maxTimeoutMs - elapsed;
      if (remainingTimeout <= 0) {
        throw new RlmLimitExceededError(
          'timeout',
          `RLM exceeded maxTimeoutMs (${this.opts.maxTimeoutMs}ms) before child RLM spawn`,
          this.bestPartialAnswer
        );
      }
    }

    const parentUsage = this.getUsageSummary();
    let remainingBudgetUsd: number | undefined;
    if (this.opts.maxBudgetUsd !== undefined) {
      remainingBudgetUsd = Math.max(
        0,
        this.opts.maxBudgetUsd - (parentUsage.totalCostUsd ?? 0)
      );
    }
    let remainingTokens: number | undefined;
    if (this.opts.maxTokens !== undefined) {
      const usedTokens =
        parentUsage.totalInputTokens + parentUsage.totalOutputTokens;
      remainingTokens = Math.max(0, this.opts.maxTokens - usedTokens);
    }

    const fenceIdx = prompt.indexOf('<<<UNTRUSTED_');
    const childQuestion =
      fenceIdx > 0
        ? prompt.slice(0, fenceIdx).trim()
        : prompt.slice(0, 400).trim();

    const child = new RLMRunner({
      ...this.opts,
      depth: nextDepth,
      rootModelName: modelOverride ?? this.opts.subModelName,
      maxTimeoutMs: remainingTimeout,
      maxBudgetUsd: remainingBudgetUsd,
      maxTokens: remainingTokens,
      persistentStore: undefined,
    });
    const result = await child.completion(prompt, childQuestion || 'Child RLM Query');
    this.mergeChildUsage(result.usageSummary);
    return result;
  }

  private async fallbackSingleCompletion(
    contextPayload: RlmContextPayload,
    rootPrompt: string | undefined,
    startMs: number
  ): Promise<RLMChatCompletion> {
    const textPayload =
      typeof contextPayload === 'string'
        ? contextPayload
        : JSON.stringify(contextPayload);
    const prompt = rootPrompt
      ? `${rootPrompt}\n\n${textPayload.slice(0, 60_000)}`
      : textPayload.slice(0, 60_000);
    const client = this.opts.subLlm ?? this.opts.rootLlm;
    const res = await this.callAndRecord(
      client,
      [{ role: 'user', content: prompt }],
      this.opts.subModelName
    );
    return {
      rootModel: res.model,
      prompt,
      response: res.text,
      usageSummary: this.getUsageSummary(),
      executionTimeMs: performance.now() - startMs,
    };
  }

  private shouldCompact(messages: RlmMessage[]): boolean {
    const totalTokens = messages.reduce(
      (sum, m) => sum + estimateTokens(m.content),
      0
    );
    const threshold = Math.floor(
      this.opts.contextLimitTokens * this.opts.compactionThresholdPct
    );
    return totalTokens >= threshold;
  }

  private async compactHistory(
    store: RlmContextStore,
    messageHistory: RlmMessage[],
    compactionCount: number
  ): Promise<RlmMessage[]> {
    const summaryPrompt: RlmMessage[] = [
      ...messageHistory,
      {
        role: 'user',
        content: [
          'Summarize your progress so far. Include:',
          '1. Which steps/sub-tasks you have completed and which remain.',
          '2. Any concrete intermediate results, URLs, or variable names you computed - preserve these exactly.',
          '3. What your next action should be.',
          'Be concise (1-3 paragraphs) and preserve all key evidence.',
        ].join('\n'),
      },
    ];
    const summaryResp = await this.callAndRecord(
      this.opts.rootLlm,
      summaryPrompt,
      this.opts.rootModelName
    );
    store.appendCompactionEntry({
      type: 'summary',
      compactionCount,
      content: summaryResp.text,
    });

    return [
      ...messageHistory.slice(0, 2),
      { role: 'assistant', content: summaryResp.text },
      {
        role: 'user',
        content: `Your conversation has been compacted ${compactionCount} time(s). Continue from the summary above. Do NOT repeat completed work. Use {"op": "show_vars"} to inspect existing REPL variables and check \`history\` if needed.`,
      },
    ];
  }

  private checkTimeout(iteration: number, startMs: number): void {
    if (this.opts.maxTimeoutMs === undefined) return;
    const elapsed = performance.now() - startMs;
    if (elapsed > this.opts.maxTimeoutMs) {
      throw new RlmLimitExceededError(
        'timeout',
        `Timeout exceeded before iteration ${iteration + 1}: ${Math.round(elapsed)}ms > ${this.opts.maxTimeoutMs}ms`,
        this.bestPartialAnswer
      );
    }
  }

  private checkIterationLimits(iteration: RLMIteration, iterationIdx: number): void {
    const hadError = iteration.codeBlocks.some((b) => Boolean(b.result.stderr));
    if (hadError) {
      this.consecutiveErrors += 1;
    } else {
      this.consecutiveErrors = 0;
    }

    if (
      this.opts.maxErrors !== undefined &&
      this.consecutiveErrors >= this.opts.maxErrors
    ) {
      throw new RlmLimitExceededError(
        'errors',
        `Error threshold exceeded: ${this.consecutiveErrors} consecutive errors (limit: ${this.opts.maxErrors})`,
        this.bestPartialAnswer
      );
    }

    const usage = this.getUsageSummary();
    if (
      this.opts.maxBudgetUsd !== undefined &&
      usage.totalCostUsd > this.opts.maxBudgetUsd
    ) {
      throw new RlmLimitExceededError(
        'budget',
        `Budget exceeded after iteration ${iterationIdx + 1}: $${usage.totalCostUsd.toFixed(4)} > $${this.opts.maxBudgetUsd.toFixed(4)}`,
        this.bestPartialAnswer
      );
    }

    const totalTokens = usage.totalInputTokens + usage.totalOutputTokens;
    if (this.opts.maxTokens !== undefined && totalTokens > this.opts.maxTokens) {
      throw new RlmLimitExceededError(
        'tokens',
        `Token limit exceeded after iteration ${iterationIdx + 1}: ${totalTokens} > ${this.opts.maxTokens}`,
        this.bestPartialAnswer
      );
    }
  }

  private async callAndRecord(
    client: RlmLlmClient,
    messages: RlmMessage[],
    defaultModel: string
  ) {
    const res = await client(messages, defaultModel);
    const modelKey = res.model || defaultModel;
    const inputTokens =
      res.inputTokens ??
      messages.reduce((acc, m) => acc + estimateTokens(m.content), 0);
    const outputTokens = res.outputTokens ?? estimateTokens(res.text);
    const costUsd = res.costUsd ?? 0;

    const existing = this.usageByModel.get(modelKey) ?? {
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
    };
    existing.totalCalls += 1;
    existing.totalInputTokens += inputTokens;
    existing.totalOutputTokens += outputTokens;
    existing.totalCostUsd = (existing.totalCostUsd ?? 0) + costUsd;
    this.usageByModel.set(modelKey, existing);

    return {
      text: res.text,
      model: modelKey,
      inputTokens,
      outputTokens,
    };
  }

  private mergeChildUsage(childSummary: UsageSummary): void {
    for (const [model, summary] of Object.entries(
      childSummary.modelUsageSummaries
    )) {
      const existing = this.usageByModel.get(model) ?? {
        totalCalls: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
      };
      existing.totalCalls += summary.totalCalls;
      existing.totalInputTokens += summary.totalInputTokens;
      existing.totalOutputTokens += summary.totalOutputTokens;
      existing.totalCostUsd =
        (existing.totalCostUsd ?? 0) + (summary.totalCostUsd ?? 0);
      this.usageByModel.set(model, existing);
    }
  }

  public getUsageSummary(): UsageSummary {
    const modelUsageSummaries: Record<string, ModelUsageSummary> = {};
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCostUsd = 0;

    for (const [model, summary] of this.usageByModel.entries()) {
      modelUsageSummaries[model] = { ...summary };
      totalInputTokens += summary.totalInputTokens;
      totalOutputTokens += summary.totalOutputTokens;
      totalCostUsd += summary.totalCostUsd ?? 0;
    }

    return {
      modelUsageSummaries,
      totalInputTokens,
      totalOutputTokens,
      totalCostUsd,
    };
  }

  private buildCompletionResult(
    contextQuestion: string,
    finalAnswer: string,
    iterations: RLMIteration[],
    startMs: number,
    error?: string,
    verifiedFinalAnswer = false
  ): RLMChatCompletion {
    const totalExecutionTimeMs = performance.now() - startMs;
    const hasErrors =
      Boolean(error) ||
      iterations.some((it) =>
        it.codeBlocks.some((b) => Boolean(b.result.stderr))
      );
    const hasVerifiedAnswer =
      verifiedFinalAnswer &&
      !error &&
      iterations.some((it) => it.finalAnswer !== null);
    return {
      rootModel: this.opts.rootModelName,
      prompt: contextQuestion,
      response: finalAnswer,
      usageSummary: this.getUsageSummary(),
      executionTimeMs: totalExecutionTimeMs,
      error,
      metadata: {
        config: {
          rootModel: this.opts.rootModelName,
          subModel: this.opts.subModelName,
          maxDepth: this.opts.maxDepth,
          maxIterations: this.opts.maxIterations,
          maxConcurrentSubcalls: this.opts.maxConcurrentSubcalls,
          compaction: this.opts.compaction,
        },
        iterations,
        contextQuestion,
        finalAnswer: hasVerifiedAnswer ? finalAnswer : null,
        totalExecutionTimeMs,
        hasErrors,
      },
    };
  }
}
