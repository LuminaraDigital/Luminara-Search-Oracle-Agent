/**
 * Recursive Language Model (RLM) Subsystem Barrel
 *
 * Adapted from alexzhang13/rlm (MIT License - Copyright (c) 2026 Alex Zhang).
 *
 * Invariant: Never use em dashes (U+2014) in comments or output strings.
 */

import type { ChatTurn, GenerateOptions } from '../../types';
import { aiProviderService } from '../aiProviderService';
import type { RlmLlmClient, RlmMessage } from './rlmRunner';

export * from './types';
export * from './prompts';
export * from './contextStore';
export * from './rlmRunner';

/**
 * Create an RlmLlmClient backed by Luminara's multi-provider AIProviderService
 * (Groq, NVIDIA NIM, OpenRouter, Ollama, FreeLLM with adaptive circuit breaking).
 */
export function createAiProviderRlmClient(
  baseOptions: GenerateOptions = {}
): RlmLlmClient {
  return async (messages: RlmMessage[], modelOverride?: string) => {
    const systemPrompt = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');

    const nonSystem = messages.filter((m) => m.role !== 'system');
    const lastUser = nonSystem[nonSystem.length - 1];
    const history: ChatTurn[] = nonSystem.slice(0, -1).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));

    const prompt = lastUser ? lastUser.content : '';
    const effectiveModel =
      modelOverride && !/^rlm-/i.test(modelOverride)
        ? modelOverride
        : baseOptions.model;
    const result = await aiProviderService.generateWithFailover(prompt, {
      ...baseOptions,
      model: effectiveModel,
      systemPrompt: systemPrompt || baseOptions.systemPrompt,
      history,
    });

    return {
      text: result.text,
      model: modelOverride || baseOptions.model || 'ai-provider',
      inputTokens: result.tokenUsage?.prompt,
      outputTokens: result.tokenUsage?.completion,
    };
  };
}

/**
 * Run a bounded RLM verification pass over a multi-page SiteEvidencePack rlmCorpus.
 * Returns verified cross-page synthesis text and full RLMTrajectoryMetadata for UI inspection.
 */
export async function synthesizeRlmAuditEvidence(options: {
  rlmCorpus: Record<string, string>;
  websiteUrl: string;
  focus: string;
  maxIterations?: number;
  maxTimeoutMs?: number;
}): Promise<{
  synthesisText: string;
  trajectory?: import('./types').RLMTrajectoryMetadata;
} | null> {
  const keys = Object.keys(options.rlmCorpus || {});
  const totalChars = keys.reduce(
    (sum, k) => sum + (options.rlmCorpus[k]?.length || 0),
    0
  );
  if (keys.length === 0 || (keys.length === 1 && totalChars <= 4000)) {
    return null;
  }

  try {
    const client = createAiProviderRlmClient({ temperature: 0.2 });
    const { RLMRunner } = await import('./rlmRunner');
    const runner = new RLMRunner({
      rootLlm: client,
      subLlm: client,
      rootModelName: 'rlm-audit-orchestrator',
      subModelName: 'rlm-audit-worker',
      maxIterations: options.maxIterations ?? 3,
      maxTimeoutMs: options.maxTimeoutMs ?? 10_000,
      maxConcurrentSubcalls: 4,
    });

    const completion = await runner.completion(
      options.rlmCorpus,
      `Extract cross-page ${options.focus} schema, heading, FAQ, and entity findings across all ${keys.length} scraped URLs for ${options.websiteUrl}.`
    );
    const cleanedText = (completion.response || '')
      .replace(/```repl[\s\S]*?```/gi, '')
      .trim();
    return {
      synthesisText: cleanedText,
      trajectory: completion.metadata,
    };
  } catch {
    return null;
  }
}


