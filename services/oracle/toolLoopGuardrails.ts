/**
 * Deterministic tool-call stall detector, large duplicate output stubber, and periodic cycle guard.
 *
 * Adapted from NousResearch/hermes-agent (`agent/tool_guardrails.py`)
 * at commit ca2269588fd028adb41f3cc45875b04f3c0b88b4. Copyright (c) 2025 Nous Research (MIT).
 * Reuses Luminara's canonical `canonicalJson` (`services/trust/receiptCrypto.ts`) and FNV-1a digest.
 */

import { canonicalJson } from '../trust/receiptCrypto';
import { fnv1a32 } from '../experiments/hermesAbExperiment';

export const DUPLICATE_RESULT_STUB_MIN_CHARS = 512;
export const IDENTICAL_TRIPLET_THRESHOLD = 3;
export const MAX_CYCLE_PERIOD = 4;

export const DEFAULT_POLLER_TOOLS: ReadonlySet<string> = new Set([
  'dream_status',
  'wait',
  'poll_status',
]);

export interface ToolGuardStepRecord {
  step: number;
  toolName: string;
  argsSig: string;
  resultSig: string;
  resultChars: number;
  isPoller: boolean;
}

export type ToolLoopAnomalyKind =
  | 'identical_triplet'
  | 'duplicate_large_output'
  | 'periodic_cycle';

export interface ToolGuardOutcome {
  stalled: boolean;
  anomaly: ToolLoopAnomalyKind | null;
  period: number | null;
  effectiveOutput: string;
  notice: string | null;
  record: ToolGuardStepRecord;
}

export function oracleLoopGuardsEnabled(
  env: { ORACLE_LOOP_GUARDS_ENABLED?: string } | null | undefined,
): boolean {
  return String(env?.ORACLE_LOOP_GUARDS_ENABLED ?? '').trim().toLowerCase() === 'true';
}

function stableArgsSignature(args: unknown): string {
  try {
    const normalized = canonicalJson(args ?? {});
    return `${fnv1a32(normalized).toString(16)}:${normalized.length}`;
  } catch {
    const fallback = JSON.stringify(args ?? {});
    return `${fnv1a32(fallback).toString(16)}:${fallback.length}`;
  }
}

function stableResultSignature(resultText: string): string {
  return `${fnv1a32(resultText).toString(16)}:${resultText.length}`;
}

function compositeStepKey(r: Pick<ToolGuardStepRecord, 'toolName' | 'argsSig' | 'resultSig'>): string {
  return `${r.toolName}|${r.argsSig}|${r.resultSig}`;
}

export class ToolLoopGuardrail {
  private readonly records: ToolGuardStepRecord[];
  private readonly pollerTools: ReadonlySet<string>;
  private readonly stubMinChars: number;

  constructor(opts?: {
    initialRecords?: readonly ToolGuardStepRecord[];
    pollerTools?: Iterable<string>;
    stubMinChars?: number;
  }) {
    this.records = opts?.initialRecords ? [...opts.initialRecords] : [];
    this.pollerTools = opts?.pollerTools ? new Set(opts.pollerTools) : DEFAULT_POLLER_TOOLS;
    this.stubMinChars = opts?.stubMinChars ?? DUPLICATE_RESULT_STUB_MIN_CHARS;
  }

  history(): ToolGuardStepRecord[] {
    return [...this.records];
  }

  observeCall(input: {
    toolName: string;
    args: unknown;
    resultText: string;
    isPoller?: boolean;
  }): ToolGuardOutcome {
    const toolName = String(input.toolName || '').trim();
    const rawResult = String(input.resultText ?? '');
    const isPoller = input.isPoller ?? this.pollerTools.has(toolName);
    const argsSig = stableArgsSignature(input.args);
    const resultSig = stableResultSignature(rawResult);
    const step = this.records.length + 1;

    const priorIdenticalLarge = !isPoller
      ? this.records.find(
          (r) =>
            !r.isPoller &&
            r.toolName === toolName &&
            r.argsSig === argsSig &&
            r.resultSig === resultSig &&
            rawResult.length >= this.stubMinChars,
        )
      : undefined;

    const current: ToolGuardStepRecord = {
      step,
      toolName,
      argsSig,
      resultSig,
      resultChars: rawResult.length,
      isPoller,
    };
    this.records.push(current);

    if (isPoller) {
      return {
        stalled: false,
        anomaly: null,
        period: null,
        effectiveOutput: rawResult,
        notice: null,
        record: current,
      };
    }

    const nonPollers = this.records.filter((r) => !r.isPoller);
    let stalled = false;
    let anomaly: ToolLoopAnomalyKind | null = null;
    let period: number | null = null;
    let notice: string | null = null;

    if (nonPollers.length >= IDENTICAL_TRIPLET_THRESHOLD) {
      const tail3 = nonPollers.slice(-IDENTICAL_TRIPLET_THRESHOLD);
      const first = tail3[0];
      if (first) {
        const firstKey = compositeStepKey(first);
        if (tail3.every((r) => compositeStepKey(r) === firstKey)) {
          stalled = true;
          anomaly = 'identical_triplet';
          period = 1;
          notice =
            `[Loop guard: tool "${toolName}" returned the identical output 3 times in a row ` +
            'with the same arguments. Stop repeating this call and change parameters or conclude.]';
        }
      }
    }

    if (!stalled) {
      for (let p = 2; p <= MAX_CYCLE_PERIOD; p++) {
        if (nonPollers.length < p * 2) continue;
        const prevWindow = nonPollers.slice(-p * 2, -p).map(compositeStepKey);
        const currWindow = nonPollers.slice(-p).map(compositeStepKey);
        const allSame = currWindow.every((k) => k === currWindow[0]);
        if (!allSame && prevWindow.every((k, idx) => k === currWindow[idx])) {
          stalled = true;
          anomaly = 'periodic_cycle';
          period = p;
          notice =
            `[Loop guard: detected a repeating ${p}-step tool cycle ending at "${toolName}". ` +
            'Break the loop by choosing a different action or concluding with current evidence.]';
          break;
        }
      }
    }

    let effectiveOutput = rawResult;
    if (priorIdenticalLarge) {
      if (!anomaly) anomaly = 'duplicate_large_output';
      effectiveOutput =
        `[Duplicate tool output omitted - identical to step #${priorIdenticalLarge.step} ` +
        `(${rawResult.length} chars) for "${toolName}".]`;
    }
    if (notice) {
      effectiveOutput = `${effectiveOutput}\n\n${notice}`;
    }

    return {
      stalled,
      anomaly,
      period,
      effectiveOutput,
      notice,
      record: current,
    };
  }
}
