/**
 * Worker-Safe RLM Context Store & Sandboxed REPL Executor
 *
 * Adapted from alexzhang13/rlm (rlm/environments/local_repl.py).
 * MIT License - Copyright (c) 2026 Alex Zhang.
 *
 * Replaces Python exec() with a zero-eval deterministic DSL so the RLM pattern
 * runs safely inside Cloudflare Workers V8 isolates and browsers while keeping
 * untrusted scraped content fenced inside <<<UNTRUSTED_...>>> boundaries.
 *
 * Invariant: Never use em dashes (U+2014) in comments or output strings.
 */

import { citationSupportHeuristic } from '../evidenceBound/citationSupport';
import { ClaimLedger } from '../evidenceBound/claimLedger';
import type { ClaimSource, ClaimStatus } from '../evidenceBound/types';
import { wrapUntrustedContent } from '../../utils/untrustedContent';
import type {
  AnswerBoxState,
  REPLResult,
  RLMChatCompletion,
  RlmContextPayload,
  RlmReplOperation,
} from './types';

export type SubLlmCallFn = (
  prompt: string,
  model?: string
) => Promise<RLMChatCompletion>;

export interface RlmContextStoreOptions {
  contextPayload?: RlmContextPayload;
  compaction?: boolean;
  maxConcurrentSubcalls?: number;
  maxBatchPrompts?: number;
  subLlmCall?: SubLlmCallFn;
  subRlmCall?: SubLlmCallFn;
  claimLedger?: ClaimLedger;
}

export class RlmContextStore {
  private readonly vars = new Map<string, unknown>();
  private readonly compactionHistory: unknown[] = [];
  private contextCount = 0;
  private historyCount = 0;
  private readonly compaction: boolean;
  private readonly maxConcurrentSubcalls: number;
  private readonly maxBatchPrompts: number;
  private subLlmCall?: SubLlmCallFn;
  private subRlmCall?: SubLlmCallFn;
  public readonly claimLedger: ClaimLedger;
  private answerBox: AnswerBoxState = {
    content: '',
    ready: false,
    verifiedClaims: [],
  };

  constructor(options: RlmContextStoreOptions = {}) {
    this.compaction = options.compaction ?? false;
    this.maxConcurrentSubcalls = Math.max(1, options.maxConcurrentSubcalls ?? 4);
    this.maxBatchPrompts = Math.max(1, options.maxBatchPrompts ?? 20);
    this.subLlmCall = options.subLlmCall;
    this.subRlmCall = options.subRlmCall;
    this.claimLedger = options.claimLedger ?? new ClaimLedger();

    if (this.compaction) {
      this.vars.set('history', this.compactionHistory);
    }

    if (options.contextPayload !== undefined) {
      this.addContext(options.contextPayload);
    }
  }

  public setSubCallHandlers(handlers: {
    subLlmCall?: SubLlmCallFn;
    subRlmCall?: SubLlmCallFn;
  }): void {
    if (handlers.subLlmCall) this.subLlmCall = handlers.subLlmCall;
    if (handlers.subRlmCall) this.subRlmCall = handlers.subRlmCall;
  }

  public addContext(payload: RlmContextPayload, explicitIndex?: number): number {
    const idx = explicitIndex ?? this.contextCount;
    const varName = `context_${idx}`;
    this.vars.set(varName, payload);
    if (idx === 0) {
      this.vars.set('context', payload);
    }
    this.contextCount = Math.max(this.contextCount, idx + 1);
    return idx;
  }

  public getContextCount(): number {
    return this.contextCount;
  }

  public addHistory(
    messages: Array<{ role: string; content: string }>,
    explicitIndex?: number
  ): number {
    const idx = explicitIndex ?? this.historyCount;
    const varName = `history_${idx}`;
    const copy = messages.map((m) => ({ ...m }));
    this.vars.set(varName, copy);
    if (idx === 0 && !this.compaction) {
      this.vars.set('history', copy);
    }
    this.historyCount = Math.max(this.historyCount, idx + 1);
    return idx;
  }

  public getHistoryCount(): number {
    return this.historyCount;
  }

  public appendCompactionEntry(entry: unknown): void {
    if (!this.compaction) return;
    this.compactionHistory.push(structuredClone(entry));
    this.vars.set('history', this.compactionHistory);
  }

  public getVariable(name: string): unknown {
    return this.vars.get(name);
  }

  public setVariable(name: string, value: unknown): void {
    this.vars.set(name, value);
    this.restoreScaffold();
  }

  public getAnswerBox(): AnswerBoxState {
    return {
      content: this.answerBox.content,
      ready: this.answerBox.ready,
      verifiedClaims: [...this.answerBox.verifiedClaims],
    };
  }

  public resetAnswerBox(): void {
    this.answerBox = {
      content: '',
      ready: false,
      verifiedClaims: [],
    };
  }

  public describeLocals(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, val] of this.vars.entries()) {
      if (key.startsWith('_')) continue;
      if (typeof val === 'string') {
        out[key] = `str(${val.length} chars)`;
      } else if (Array.isArray(val)) {
        out[key] = `list(${val.length} items)`;
      } else if (val && typeof val === 'object') {
        out[key] = `dict(${Object.keys(val as Record<string, unknown>).length} keys)`;
      } else {
        out[key] = typeof val;
      }
    }
    return out;
  }

  public showVars(): string {
    const summary = this.describeLocals();
    const keys = Object.keys(summary);
    if (keys.length === 0) {
      return 'No variables created yet. Use ```repl``` blocks to create variables.';
    }
    return `Available variables: ${JSON.stringify(summary)}`;
  }

  private restoreScaffold(): void {
    if (this.vars.has('context_0')) {
      this.vars.set('context', this.vars.get('context_0'));
    }
    if (this.compaction) {
      this.vars.set('history', this.compactionHistory);
    } else if (this.vars.has('history_0')) {
      this.vars.set('history', this.vars.get('history_0'));
    }
  }

  public async executeBlock(rawBlock: string): Promise<REPLResult> {
    const startMs = performance.now();
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const rlmCalls: RLMChatCompletion[] = [];
    let finalAnswer: string | null = null;

    let operations: RlmReplOperation[] = [];
    try {
      operations = parseReplOperations(rawBlock);
    } catch (err) {
      stderrLines.push(
        `SyntaxError: Invalid REPL JSON block: ${err instanceof Error ? err.message : String(err)}`
      );
      return {
        stdout: '',
        stderr: stderrLines.join('\n'),
        locals: this.describeLocals(),
        executionTimeMs: performance.now() - startMs,
        rlmCalls: [],
        finalAnswer: null,
      };
    }

    for (const op of operations) {
      try {
        await this.executeSingleOp(op, stdoutLines, stderrLines, rlmCalls);
        if (this.answerBox.ready && finalAnswer === null) {
          finalAnswer = this.answerBox.content;
        }
      } catch (err) {
        stderrLines.push(
          `RuntimeError in op "${op.op}": ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    this.restoreScaffold();

    return {
      stdout: stdoutLines.join('\n\n'),
      stderr: stderrLines.join('\n\n'),
      locals: this.describeLocals(),
      executionTimeMs: performance.now() - startMs,
      rlmCalls,
      finalAnswer,
    };
  }

  private async executeSingleOp(
    op: RlmReplOperation,
    stdoutLines: string[],
    stderrLines: string[],
    rlmCalls: RLMChatCompletion[]
  ): Promise<void> {
    switch (op.op) {
      case 'show_vars': {
        stdoutLines.push(this.showVars());
        return;
      }

      case 'probe': {
        const targetName = op.target || 'context';
        const val = this.vars.get(targetName);
        if (val === undefined) {
          stderrLines.push(`KeyError: Variable "${targetName}" does not exist.`);
          return;
        }
        const headChars = Math.min(Math.max(100, op.headChars ?? 600), 4000);
        if (typeof val === 'string') {
          stdoutLines.push(
            `[probe ${targetName}] type=str length=${val.length}\nPreview:\n${val.slice(0, headChars)}`
          );
        } else if (Array.isArray(val)) {
          const itemLengths = val.slice(0, 10).map((item, i) => {
            const s = typeof item === 'string' ? item : JSON.stringify(item);
            return `#${i}(${s.length} chars)`;
          });
          const sample =
            val.length > 0
              ? (typeof val[0] === 'string' ? val[0] : JSON.stringify(val[0])).slice(0, headChars)
              : '';
          stdoutLines.push(
            `[probe ${targetName}] type=list items=${val.length} lengths=[${itemLengths.join(', ')}]\nItem #0 preview:\n${sample}`
          );
        } else if (val && typeof val === 'object') {
          const record = val as Record<string, unknown>;
          const keys = Object.keys(record);
          const firstKey = keys[0];
          const firstVal = firstKey !== undefined ? stringifyValue(record[firstKey]).slice(0, headChars) : '';
          stdoutLines.push(
            `[probe ${targetName}] type=dict keys(${keys.length})=[${keys.slice(0, 20).join(', ')}]\nSample (${firstKey ?? 'none'}):\n${firstVal}`
          );
        } else {
          stdoutLines.push(`[probe ${targetName}] value=${String(val)}`);
        }
        return;
      }

      case 'slice': {
        const targetName = op.target || 'context';
        const val = this.vars.get(targetName);
        if (val === undefined) {
          stderrLines.push(`KeyError: Variable "${targetName}" does not exist.`);
          return;
        }
        let extracted: unknown;
        if (op.key !== undefined && val && typeof val === 'object' && !Array.isArray(val)) {
          extracted = (val as Record<string, unknown>)[op.key];
          if (extracted === undefined) {
            stderrLines.push(`KeyError: Key "${op.key}" not found in "${targetName}".`);
            return;
          }
        } else if (op.index !== undefined && Array.isArray(val)) {
          extracted = val[op.index];
          if (extracted === undefined) {
            stderrLines.push(`IndexError: Index ${op.index} out of bounds for "${targetName}".`);
            return;
          }
        } else {
          const strVal = stringifyValue(val);
          const start = Math.max(0, op.start ?? 0);
          const end = op.end !== undefined ? Math.min(strVal.length, op.end) : strVal.length;
          extracted = strVal.slice(start, end);
        }

        if (op.saveAs) {
          this.vars.set(op.saveAs, extracted);
        }
        const preview = stringifyValue(extracted);
        stdoutLines.push(
          `[slice ${targetName}${op.saveAs ? ` -> ${op.saveAs}` : ''}] (${preview.length} chars):\n${preview.slice(0, 1500)}`
        );
        return;
      }

      case 'regex_search': {
        const targetName = op.target || 'context';
        const val = this.vars.get(targetName);
        if (val === undefined) {
          stderrLines.push(`KeyError: Variable "${targetName}" does not exist.`);
          return;
        }
        if (!op.pattern || op.pattern.length > 250 || isUnsafeRegexPattern(op.pattern)) {
          stderrLines.push(
            `RegexSafetyError: Pattern "${op.pattern || ''}" is empty, exceeds 250 chars, or contains nested quantifiers.`
          );
          return;
        }
        const maxMatches = Math.min(Math.max(1, op.maxMatches ?? 15), 50);
        const windowChars = Math.min(Math.max(40, op.contextWindow ?? 200), 800);
        const safeFlags = (op.flags || 'gi').replace(/[^gimsuy]/g, '');
        const flags = safeFlags.includes('g') ? safeFlags : `${safeFlags}g`;
        let regex: RegExp;
        try {
          regex = new RegExp(op.pattern, flags);
        } catch (err) {
          stderrLines.push(
            `RegexSyntaxError: ${err instanceof Error ? err.message : String(err)}`
          );
          return;
        }

        const hay = stringifyValue(val).slice(0, 500_000);
        const matches: string[] = [];
        let m: RegExpExecArray | null = regex.exec(hay);
        while (m !== null && matches.length < maxMatches) {
          const idx = m.index;
          const start = Math.max(0, idx - Math.floor(windowChars / 2));
          const end = Math.min(hay.length, idx + m[0].length + Math.floor(windowChars / 2));
          matches.push(hay.slice(start, end).trim());
          if (m[0].length === 0) regex.lastIndex += 1;
          m = regex.exec(hay);
        }

        if (op.saveAs) {
          this.vars.set(op.saveAs, matches);
        }
        stdoutLines.push(
          `[regex_search /${op.pattern}/${flags} on ${targetName}] Found ${matches.length} match(es)${op.saveAs ? ` saved to ${op.saveAs}` : ''}:\n` +
            matches.map((snippet, idx) => `[#${idx + 1}] ${snippet}`).join('\n---\n')
        );
        return;
      }

      case 'chunk': {
        const targetName = op.target || 'context';
        const val = this.vars.get(targetName);
        if (val === undefined) {
          stderrLines.push(`KeyError: Variable "${targetName}" does not exist.`);
          return;
        }
        let chunks: string[] = [];
        if (Array.isArray(val)) {
          chunks = val.map((item) => stringifyValue(item));
        } else if (val && typeof val === 'object') {
          chunks = Object.entries(val as Record<string, unknown>).map(
            ([k, v]) => `[Key: ${k}]\n${stringifyValue(v)}`
          );
        } else {
          const text = String(val);
          const numChunks = Math.max(
            1,
            Math.min(
              op.numChunks ?? Math.ceil(text.length / (op.chunkSizeChars || 12_000)),
              this.maxBatchPrompts
            )
          );
          const size = Math.ceil(text.length / numChunks);
          for (let i = 0; i < numChunks; i++) {
            const slice = text.slice(i * size, (i + 1) * size);
            if (slice) chunks.push(slice);
          }
        }
        this.vars.set(op.saveAs, chunks);
        stdoutLines.push(
          `[chunk ${targetName} -> ${op.saveAs}] Created ${chunks.length} chunk(s), avg ${Math.round(
            chunks.reduce((a, c) => a + c.length, 0) / Math.max(1, chunks.length)
          )} chars.`
        );
        return;
      }

      case 'llm_query':
      case 'rlm_query': {
        const handler =
          op.op === 'rlm_query' ? (this.subRlmCall ?? this.subLlmCall) : this.subLlmCall;
        if (!handler) {
          stderrLines.push(`RuntimeError: No sub-LM handler configured for ${op.op}.`);
          return;
        }
        let fullPrompt = op.prompt;
        if (op.contextVar) {
          const ctxVal = this.vars.get(op.contextVar);
          if (ctxVal === undefined) {
            stderrLines.push(`KeyError: contextVar "${op.contextVar}" does not exist.`);
            return;
          }
          const fenced = wrapUntrustedContent(
            `REPL_VAR_${op.contextVar}`,
            stringifyValue(ctxVal).slice(0, 100_000)
          );
          fullPrompt = `${op.prompt}\n\n${fenced}`;
        }
        const completion = await handler(fullPrompt, op.model);
        rlmCalls.push(completion);
        if (op.saveAs) {
          this.vars.set(op.saveAs, completion.response);
        }
        stdoutLines.push(
          `[${op.op}${op.saveAs ? ` -> ${op.saveAs}` : ''}] (${completion.response.length} chars):\n${completion.response}`
        );
        return;
      }

      case 'llm_query_batched':
      case 'rlm_query_batched': {
        const handler =
          op.op === 'rlm_query_batched'
            ? (this.subRlmCall ?? this.subLlmCall)
            : this.subLlmCall;
        if (!handler) {
          stderrLines.push(`RuntimeError: No sub-LM handler configured for ${op.op}.`);
          return;
        }
        let prompts: string[] = [];
        if (Array.isArray(op.prompts) && op.prompts.length > 0) {
          prompts = op.prompts;
        } else if (op.itemsVar && op.promptTemplate) {
          const items = this.vars.get(op.itemsVar);
          if (!Array.isArray(items)) {
            stderrLines.push(
              `TypeError: itemsVar "${op.itemsVar}" must be a list for ${op.op}.`
            );
            return;
          }
          prompts = items.map((item, idx) => {
            const fencedItem = wrapUntrustedContent(
              `REPL_BATCH_ITEM_${idx}`,
              stringifyValue(item).slice(0, 100_000)
            );
            // Use split+join so $& or $$ in scraped content is never interpreted as RegExp replacement tokens
            return op.promptTemplate!.includes('{{item}}')
              ? op.promptTemplate!.split('{{item}}').join(fencedItem)
              : `${op.promptTemplate}\n\n${fencedItem}`;
          });
        } else {
          stderrLines.push(
            `ValueError: ${op.op} requires either \`prompts\` array or \`itemsVar\` + \`promptTemplate\`.`
          );
          return;
        }

        if (prompts.length > this.maxBatchPrompts) {
          stderrLines.push(
            `BatchLimitWarning: Truncating batch from ${prompts.length} to ${this.maxBatchPrompts} prompts (fat-prompt small-batch rule).`
          );
          prompts = prompts.slice(0, this.maxBatchPrompts);
        }

        const completions = await runBoundedPool(
          prompts,
          this.maxConcurrentSubcalls,
          (p) => handler(p, op.model)
        );
        rlmCalls.push(...completions);
        const responses = completions.map((c) => c.response);
        if (op.saveAs) {
          this.vars.set(op.saveAs, responses);
        }
        stdoutLines.push(
          `[${op.op}${op.saveAs ? ` -> ${op.saveAs}` : ''}] Completed ${responses.length} sub-calls:\n` +
            responses.map((r, i) => `[Batch #${i + 1}] ${r.slice(0, 600)}`).join('\n---\n')
        );
        return;
      }

      case 'submit_answer': {
        let rawContent = op.content || '';
        if (!rawContent && op.fromVar) {
          if (!this.vars.has(op.fromVar)) {
            stderrLines.push(`KeyError: Variable '${op.fromVar}' not found for submit_answer.`);
            return;
          }
          rawContent = stringifyValue(this.vars.get(op.fromVar));
        }
        const content = rawContent.trim();
        if (!content) {
          stderrLines.push('AnswerValidationError: submit_answer content cannot be empty.');
          return;
        }

        // Evidence-Bound Answer Gate: validate ALL structured claims atomically before mutating ledger
        const validatedToAppend: Array<{
          text: string;
          status: ClaimStatus;
          sources: ClaimSource[];
        }> = [];

        if (op.claims && op.claims.length > 0) {
          for (const rawClaim of op.claims) {
            const requestedStatus: ClaimStatus = rawClaim.status || 'estimated';
            const evidenceSpans: string[] = [];
            const sources: ClaimSource[] = rawClaim.sources ? [...rawClaim.sources] : [];

            if (rawClaim.evidenceKey && this.vars.has(rawClaim.evidenceKey)) {
              const spanText = stringifyValue(this.vars.get(rawClaim.evidenceKey));
              evidenceSpans.push(spanText);
              sources.push({
                kind: 'scrape',
                id: `repl:${rawClaim.evidenceKey}`,
                excerpt: spanText.slice(0, 200),
              });
            }

            if (requestedStatus === 'measured') {
              if (sources.length === 0) {
                stderrLines.push(
                  `EvidenceBoundError: Claim "${rawClaim.text}" marked as 'measured' without sources or a valid REPL evidenceKey. Downgrade to 'not_measured' or attach an inspected evidenceKey.`
                );
                this.answerBox.ready = false;
                return;
              }
              if (evidenceSpans.length > 0) {
                const check = citationSupportHeuristic({
                  claimText: rawClaim.text,
                  evidenceSpans,
                });
                if (check.verdict !== 'supports') {
                  stderrLines.push(
                    `EvidenceBoundError: Claim "${rawClaim.text}" is not supported by REPL variable "${rawClaim.evidenceKey}" (verdict=${check.verdict}). Revise the claim or downgrade status.`
                  );
                  this.answerBox.ready = false;
                  return;
                }
              }
            }

            validatedToAppend.push({
              text: rawClaim.text,
              status: requestedStatus,
              sources,
            });
          }

          for (const item of validatedToAppend) {
            const recorded = this.claimLedger.append(item);
            this.answerBox.verifiedClaims.push(recorded);
          }
        }

        this.answerBox.content = content;
        this.answerBox.ready = op.ready ?? true;
        stdoutLines.push(
          `[answer] content updated (${content.length} chars), ready=${this.answerBox.ready}`
        );
        return;
      }

      default: {
        const unknownOp = (op as { op?: unknown }).op;
        stderrLines.push(
          `ValueError: Unsupported REPL operation "${String(unknownOp)}". Valid ops: probe, slice, regex_search, chunk, llm_query, llm_query_batched, rlm_query, rlm_query_batched, show_vars, submit_answer.`
        );
        return;
      }
    }
  }
}

function isUnsafeRegexPattern(pattern: string): boolean {
  // Reject nested quantifiers such as (a+)+, (.*)*, ([a-z]+)* that cause catastrophic backtracking
  return /(\([^()]*[+*?][^()]*\))[+*?{]/.test(pattern);
}

function stringifyValue(val: unknown): string {
  if (typeof val === 'string') return val;
  if (val === undefined || val === null) return '';
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return String(val);
  }
}

function normalizeOpObject(raw: Record<string, unknown>): RlmReplOperation {
  const opRaw = String(raw.op || '').trim().toLowerCase();
  const normalizedOp =
    opRaw === 'final' || opRaw === 'final_var' ? 'submit_answer' : opRaw;
  return { ...raw, op: normalizedOp } as RlmReplOperation;
}

function parseReplOperations(rawBlock: string): RlmReplOperation[] {
  const trimmed = rawBlock.trim();
  if (/^show_vars\s*\(\s*\)\s*;?$/i.test(trimmed)) {
    return [{ op: 'show_vars' }];
  }
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item) => item && typeof item === 'object' && 'op' in item)
        .map((item) => normalizeOpObject(item as Record<string, unknown>));
    }
    if (parsed && typeof parsed === 'object' && 'op' in parsed) {
      return [normalizeOpObject(parsed as Record<string, unknown>)];
    }
  } catch {
    // Support JSON Lines or SHOW_VARS() lines inside a ```repl block
    const lines = trimmed
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//') && !l.startsWith('#'));
    const ops: RlmReplOperation[] = [];
    for (const line of lines) {
      if (/^show_vars\s*\(\s*\)\s*;?$/i.test(line)) {
        ops.push({ op: 'show_vars' });
        continue;
      }
      const parsedLine = JSON.parse(line);
      if (parsedLine && typeof parsedLine === 'object' && 'op' in parsedLine) {
        ops.push(normalizeOpObject(parsedLine as Record<string, unknown>));
      }
    }
    if (ops.length > 0) return ops;
  }
  throw new Error('Expected a JSON object or array of objects with an "op" field.');
}

async function runBoundedPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
