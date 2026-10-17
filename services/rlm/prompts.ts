/**
 * Recursive Language Model (RLM) Prompts & Parsing Utilities
 *
 * Adapted from alexzhang13/rlm (rlm/utils/prompts.py & rlm/utils/parsing.py).
 * MIT License - Copyright (c) 2026 Alex Zhang.
 *
 * Invariant: Never use em dashes (U+2014) in comments or output strings.
 */

import type { REPLResult, RLMIteration, RlmQueryMetadata } from './types';

export const RLM_MAX_BLOCK_OUTPUT_CHARS = 20_000;
export const RLM_DEFAULT_MAX_ITERATIONS = 12;

export const RLM_SYSTEM_PROMPT = `You are a Recursive Language Model (RLM): an orchestrator model with a prompt and an offloaded context stored in a persistent REPL variable store.
You interact with the REPL turn-by-turn until you have verified an evidence-bound answer to the query.

To execute operations in the REPL, emit a \`\`\`repl block containing a JSON object or array of operations. The REPL state persists across turns. Available in the REPL:
- \`context\` (and \`context_0..N\`): the offloaded evidence payload (string, list of pages, or dictionary keyed by URL/slot).
- \`history\`: full pre-compaction trajectory segments and summaries when compaction is enabled.
- \`{"op": "probe", "target": "context", "headChars": 800}\`: inspect type, keys, item counts, and a head preview of a variable.
- \`{"op": "slice", "target": "context", "start": 0, "end": 5000, "key": "...", "index": 0, "saveAs": "chunk_0"}\`: extract a slice, list index, or dictionary key into a variable.
- \`{"op": "regex_search", "target": "context", "pattern": "schema|faq|pricing", "flags": "i", "maxMatches": 15, "contextWindow": 240, "saveAs": "hits"}\`: search across string/list/dict variables without loading the entire text into your prompt.
- \`{"op": "chunk", "target": "context", "numChunks": 6, "saveAs": "chunks"}\`: split a large context into balanced chunks stored as a list variable.
- \`{"op": "llm_query", "prompt": "Extract all JSON-LD @type values...", "contextVar": "chunk_0", "saveAs": "res_0"}\`: run a fast single sub-LLM completion over a variable slice.
- \`{"op": "llm_query_batched", "promptTemplate": "Audit this page chunk for AEO citability: {{item}}", "itemsVar": "chunks", "saveAs": "batch_results"}\`: concurrently run up to 20 sub-LLM calls in parallel over a list variable.
- \`{"op": "rlm_query", "prompt": "Perform deep multi-step verification on...", "contextVar": "chunk_0", "saveAs": "deep_res"}\`: spawn a recursive child RLM when a subtask requires its own multi-turn loop.
- \`{"op": "rlm_query_batched", "promptTemplate": "Deeply verify chunk: {{item}}", "itemsVar": "chunks", "saveAs": "deep_batch"}\`: concurrently spawn recursive child RLMs across a list variable.
- \`{"op": "show_vars"}\`: list every variable currently stored in the REPL.
- \`{"op": "submit_answer", "content": "Final verdict...", "ready": true, "claims": [{"text": "...", "status": "measured", "evidenceKey": "chunk_0"}]}\`: populate the \`answer\` box and set \`ready: true\` to finish.

REPL outputs over 20,000 characters are truncated. Slice \`context\` or filter with \`regex_search\` and pass slices through \`llm_query\` / \`llm_query_batched\` rather than dumping raw context into stdout.

Plan in prose, execute one \`\`\`repl block per turn, inspect the output, and continue on the next turn. Never set \`ready: true\` on Turn 1 before probing \`context\`.`;

export const ORCHESTRATOR_ADDENDUM = [
  'As an RLM, act as an orchestrator, not a single-pass solver.',
  'Directly after you probe the `context` and understand the task, state how the task decomposes into REPL filtering and `llm_query_batched` steps. Execute one turn at a time, verify intermediate variables, and only submit `ready: true` once you have verified the candidate answer.',
  'Your own root context window must stay small. Push long-context reading, extraction, classification, and verification into `llm_query` or `llm_query_batched` calls instead of pulling raw text into your root message stream. Conversely, if `regex_search` or `probe` over `context` already pins the exact fact, read it directly without wasting a sub-call.',
  'Sub-call budget is finite on two axes: (1) Per-prompt capacity (~100K chars max per sub-call) and (2) Per-batch fan-out (~20 prompts max per `llm_query_batched`). Prefer fat-prompt small-batch execution over tiny-prompt mega-batches.',
  'Evidence-bound invariant: Never invent SEO metrics, traffic numbers, or citation counts. Every claim with status `measured` must reference an observed variable or source from `context`; otherwise label it `not_measured` or `unknown`.',
].join('\n\n');

export function buildRlmSystemPrompt(options: {
  queryMetadata: RlmQueryMetadata;
  rootPrompt?: string;
  customSystemPrompt?: string;
  orchestrator?: boolean;
  compaction?: boolean;
}): Array<{ role: 'system' | 'user'; content: string }> {
  const basePrompt = options.customSystemPrompt ?? RLM_SYSTEM_PROMPT;
  const orchestrator = options.orchestrator ?? true;
  let systemContent = orchestrator
    ? `${basePrompt}\n\n${ORCHESTRATOR_ADDENDUM}`
    : basePrompt;

  if (options.compaction) {
    systemContent +=
      '\n\nThe full conversation history (trajectory segments and summaries) is available in the REPL variable `history` as a list.';
  }

  const descriptor =
    options.queryMetadata.contextType === 'dict'
      ? `keys=[${(options.queryMetadata.keysOrCount as string[]).slice(0, 12).join(', ')}]`
      : `items=${options.queryMetadata.keysOrCount}`;

  const metadataBody = `Your context is a ${options.queryMetadata.contextType} (${descriptor}) of ${options.queryMetadata.contextTotalLength.toLocaleString()} total characters. Each sub-LLM call can handle roughly ~100k characters at once.`;

  const userContent = options.rootPrompt
    ? `Answer the following: ${options.rootPrompt}\n\n${metadataBody}`
    : metadataBody;

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ];
}

export function buildUserTurnPrompt(options: {
  iteration: number;
  maxIterations?: number;
  contextCount?: number;
  historyCount?: number;
}): { role: 'user'; content: string } {
  const maxIter = options.maxIterations ?? RLM_DEFAULT_MAX_ITERATIONS;
  const turnHeader = `Turn ${options.iteration + 1}/${maxIter}:`;
  const safeguard =
    options.iteration === 0
      ? 'You have not interacted with the REPL environment or seen your context yet. Probe `context` first; do not submit a final answer on Turn 1.\n\n'
      : '';

  let content = `${safeguard}${turnHeader}`;
  if ((options.contextCount ?? 1) > 1) {
    content += `\n\nNote: You have ${options.contextCount} contexts available (context_0 through context_${(options.contextCount ?? 1) - 1}).`;
  }
  if ((options.historyCount ?? 0) > 0) {
    content += `\n\nNote: You have ${options.historyCount} prior conversation history segment(s) available in the \`history\` variable.`;
  }
  return { role: 'user', content };
}

/**
 * Extract ```repl ... ``` blocks from an RLM assistant response.
 * Mirrors find_code_blocks in alexzhang13/rlm/rlm/utils/parsing.py while handling
 * indented fences and single-line blocks gracefully.
 */
export function findReplBlocks(text: string): string[] {
  const pattern = /```repl[ \t]*(?:\r?\n([\s\S]*?)\r?\n[ \t]*|[ \t]+([\s\S]*?)[ \t]*)```/gi;
  const blocks: string[] = [];
  let match: RegExpExecArray | null = pattern.exec(text);
  while (match !== null) {
    const raw = (match[1] ?? match[2] ?? '').trim();
    if (raw) {
      blocks.push(raw);
    }
    match = pattern.exec(text);
  }
  return blocks;
}

export function formatExecutionResult(result: REPLResult): string {
  const parts: string[] = [];
  if (result.stdout) {
    parts.push(result.stdout);
  }
  if (result.stderr) {
    parts.push(`[STDERR]\n${result.stderr}`);
  }
  const varNames = Object.keys(result.locals).filter(
    (k) => !k.startsWith('_') && k !== 'answer'
  );
  if (varNames.length > 0) {
    parts.push(`REPL variables: [${varNames.join(', ')}]`);
  }
  return parts.length > 0 ? parts.join('\n\n') : 'No output';
}

export function formatIterationMessages(
  iteration: RLMIteration,
  maxCharacterLength = RLM_MAX_BLOCK_OUTPUT_CHARS
): Array<{ role: 'assistant' | 'user'; content: string }> {
  const messages: Array<{ role: 'assistant' | 'user'; content: string }> = [
    { role: 'assistant', content: iteration.response },
  ];

  if (iteration.codeBlocks.length === 0) {
    return messages;
  }

  const multi = iteration.codeBlocks.length > 1;
  const parts = iteration.codeBlocks.map((block, idx) => {
    let formatted = formatExecutionResult(block.result);
    if (formatted.length > maxCharacterLength) {
      const remaining = formatted.length - maxCharacterLength;
      formatted = `${formatted.slice(0, maxCharacterLength)}... + [${remaining} chars truncated]`;
    }
    const header = multi ? `REPL output (block ${idx + 1}):` : 'REPL output:';
    return `${header}\n${formatted}`;
  });

  messages.push({ role: 'user', content: parts.join('\n\n') });
  return messages;
}
