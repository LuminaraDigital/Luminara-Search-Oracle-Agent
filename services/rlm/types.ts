/**
 * Recursive Language Model (RLM) Core Types & Trajectory Schema
 *
 * Adapted from alexzhang13/rlm (rlm/core/types.py & visualizer/src/lib/types.ts).
 * MIT License - Copyright (c) 2026 Alex Zhang.
 *
 * Invariant: Never use em dashes (U+2014) in comments or output strings.
 */

import type { Claim, ClaimSource } from '../evidenceBound/types';

export type RlmContextPayload =
  | string
  | string[]
  | Record<string, unknown>
  | Array<Record<string, unknown>>;

export interface RlmQueryMetadata {
  contextLengths: number[];
  contextTotalLength: number;
  contextType: 'str' | 'list' | 'dict';
  keysOrCount: string[] | number;
}

export interface ModelUsageSummary {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd?: number;
}

export interface UsageSummary {
  modelUsageSummaries: Record<string, ModelUsageSummary>;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

export interface RLMChatCompletion {
  rootModel: string;
  prompt: string | Array<{ role: string; content: string }>;
  response: string;
  usageSummary: UsageSummary;
  executionTimeMs: number;
  metadata?: RLMTrajectoryMetadata;
  error?: string;
}

export interface REPLResult {
  stdout: string;
  stderr: string;
  locals: Record<string, string>;
  executionTimeMs: number;
  rlmCalls: RLMChatCompletion[];
  finalAnswer: string | null;
}

export interface CodeBlock {
  code: string;
  result: REPLResult;
}

export interface RLMIteration {
  iteration: number;
  timestamp: string;
  prompt: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  response: string;
  codeBlocks: CodeBlock[];
  finalAnswer: string | null;
  iterationTimeMs: number;
}

export interface RLMConfigMetadata {
  rootModel: string;
  subModel: string;
  maxDepth: number;
  maxIterations: number;
  maxConcurrentSubcalls: number;
  compaction: boolean;
}

export interface RLMTrajectoryMetadata {
  config: RLMConfigMetadata;
  iterations: RLMIteration[];
  contextQuestion: string;
  finalAnswer: string | null;
  totalExecutionTimeMs: number;
  hasErrors: boolean;
}

/**
 * Worker-safe RLM REPL DSL operations.
 * Because Cloudflare Workers forbid eval() and new Function(), the model
 * interacts with the offloaded context store through deterministic JSON/DSL
 * operations inside ```repl blocks.
 */
export type RlmReplOperation =
  | {
      op: 'probe';
      target?: string;
      headChars?: number;
    }
  | {
      op: 'slice';
      target?: string;
      start?: number;
      end?: number;
      index?: number;
      key?: string;
      saveAs?: string;
    }
  | {
      op: 'regex_search';
      target?: string;
      pattern: string;
      flags?: string;
      maxMatches?: number;
      contextWindow?: number;
      saveAs?: string;
    }
  | {
      op: 'chunk';
      target?: string;
      chunkSizeChars?: number;
      numChunks?: number;
      saveAs: string;
    }
  | {
      op: 'llm_query';
      prompt: string;
      contextVar?: string;
      model?: string;
      saveAs?: string;
    }
  | {
      op: 'llm_query_batched';
      prompts?: string[];
      promptTemplate?: string;
      itemsVar?: string;
      model?: string;
      saveAs?: string;
    }
  | {
      op: 'rlm_query';
      prompt: string;
      contextVar?: string;
      model?: string;
      saveAs?: string;
    }
  | {
      op: 'rlm_query_batched';
      prompts?: string[];
      promptTemplate?: string;
      itemsVar?: string;
      model?: string;
      saveAs?: string;
    }
  | {
      op: 'show_vars';
    }
  | {
      op: 'submit_answer';
      content?: string;
      fromVar?: string;
      ready?: boolean;
      claims?: Array<{
        text: string;
        status?: 'measured' | 'estimated' | 'not_measured' | 'unknown';
        sources?: ClaimSource[];
        evidenceKey?: string;
      }>;
    };

export interface AnswerBoxState {
  content: string;
  ready: boolean;
  verifiedClaims: Claim[];
}

export function computeQueryMetadata(payload: RlmContextPayload): RlmQueryMetadata {
  if (typeof payload === 'string') {
    return {
      contextLengths: [payload.length],
      contextTotalLength: payload.length,
      contextType: 'str',
      keysOrCount: 1,
    };
  }
  if (Array.isArray(payload)) {
    const lengths = payload.map((item) =>
      typeof item === 'string' ? item.length : JSON.stringify(item ?? '').length
    );
    return {
      contextLengths: lengths,
      contextTotalLength: lengths.reduce((acc, n) => acc + n, 0),
      contextType: 'list',
      keysOrCount: payload.length,
    };
  }
  const keys = Object.keys(payload);
  const lengths = keys.map((k) => {
    const val = payload[k];
    return typeof val === 'string' ? val.length : JSON.stringify(val ?? '').length;
  });
  return {
    contextLengths: lengths,
    contextTotalLength: lengths.reduce((acc, n) => acc + n, 0),
    contextType: 'dict',
    keysOrCount: keys,
  };
}
