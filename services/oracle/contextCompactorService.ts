/**
 * Context Compactor Service (Track OP)
 *
 * Implements token-budget compaction and multimodal asset pruning for Oracle conversations.
 * Ported and adapted from the Odysseus context compaction pattern.
 *
 * Invariant: Never use em dashes (U+2014) in comments or output strings.
 */

import { Message } from '../../types';

export const DEFAULT_CONTEXT_LIMIT_TOKENS = 32768;
export const DEFAULT_COMPACT_THRESHOLD_PERCENT = 85; // Trigger at 85% of context limit
export const DEFAULT_MAX_MULTIMODAL_IMAGES = 4;

export interface StructuredSummary {
  userGoal: string;
  whatWasDone: string[];
  currentState: string;
  nextSteps: string[];
  turnsSummarized: number;
  compactedAt: number;
}

export interface CompactorOptions {
  contextLimitTokens?: number;
  thresholdPercent?: number;
  maxImages?: number;
  recentTurnsToKeep?: number; // Keep last N messages untouched
}

/**
 * Fast token estimation (~4 characters per token average for English and technical text).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimate total tokens across a list of chat messages.
 */
export function estimateMessagesTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateTokens(msg.content);
    if (msg.toolExecutions) {
      for (const tool of msg.toolExecutions) {
        if (tool.tool) total += estimateTokens(tool.tool);
        total += estimateTokens(tool.output);
        if (tool.args) {
          total += estimateTokens(JSON.stringify(tool.args));
        }
      }
    }
  }
  return total;
}

/**
 * Check if the current message history requires compaction.
 */
export function needsCompaction(
  messages: Message[],
  contextLimitTokens = DEFAULT_CONTEXT_LIMIT_TOKENS,
  thresholdPercent = DEFAULT_COMPACT_THRESHOLD_PERCENT
): boolean {
  if (!messages || messages.length <= 4) return false;
  const tokens = estimateMessagesTokens(messages);
  const thresholdTokens = Math.floor((contextLimitTokens * thresholdPercent) / 100);
  return tokens >= thresholdTokens;
}

/**
 * Uniformly sample visual/image attachments across message history to keep token budgets safe.
 */
export function pruneMultimodalImages(
  messages: Message[],
  maxImages = DEFAULT_MAX_MULTIMODAL_IMAGES
): Message[] {
  // Collect all image references across messages
  interface ImageLocation {
    messageIndex: number;
    urlIndex: number;
  }

  const locations: ImageLocation[] = [];

  messages.forEach((msg, mIdx) => {
    if (msg.groundingUrls) {
      msg.groundingUrls.forEach((_, uIdx) => {
        locations.push({ messageIndex: mIdx, urlIndex: uIdx });
      });
    }
  });

  if (locations.length <= maxImages) {
    return messages;
  }

  // Uniformly select maxImages indices
  const selected = new Set<string>();
  if (maxImages === 1) {
    const last = locations[locations.length - 1];
    selected.add(`${last.messageIndex}:${last.urlIndex}`);
  } else if (maxImages > 1) {
    for (let i = 0; i < maxImages; i++) {
      const idx = Math.round((i * (locations.length - 1)) / (maxImages - 1));
      const loc = locations[idx];
      selected.add(`${loc.messageIndex}:${loc.urlIndex}`);
    }
  }

  return messages.map((msg, mIdx) => {
    if (!msg.groundingUrls || msg.groundingUrls.length === 0) {
      return msg;
    }
    const filteredUrls = msg.groundingUrls.filter((_, uIdx) =>
      selected.has(`${mIdx}:${uIdx}`)
    );
    return {
      ...msg,
      groundingUrls: filteredUrls,
    };
  });
}

/**
 * Format a StructuredSummary into a concise system prompt primer.
 */
export function formatCompactSummary(summary: StructuredSummary): string {
  const actions = summary.whatWasDone.map(a => `- ${a}`).join('\n');
  const steps = summary.nextSteps.map(s => `- ${s}`).join('\n');

  return `[CONVERSATION COMPACTED CONTEXT]
Turns summarized: ${summary.turnsSummarized} | Compacted at: ${new Date(summary.compactedAt).toISOString()}

### User Goal
${summary.userGoal}

### What Was Done
${actions || '- Initial audit and discovery started.'}

### Current State
${summary.currentState}

### Next Recommended Steps
${steps || '- Continue analysis based on findings.'}`;
}

/**
 * Parse structured summary fields from text or generate fallback deterministic structure.
 */
export function synthesizeSummaryFromMessages(messagesToSummarize: Message[]): StructuredSummary {
  const userMessages = messagesToSummarize.filter(m => m.role === 'user');
  const initialGoal = userMessages.length > 0
    ? userMessages[0].content.slice(0, 180).trim()
    : 'Perform comprehensive AEO and SEO audit analysis';

  const whatWasDone: string[] = [];
  const nextSteps: string[] = [];

  for (const m of messagesToSummarize) {
    if (m.toolExecutions && m.toolExecutions.length > 0) {
      for (const t of m.toolExecutions) {
        whatWasDone.push(`Executed tool ${t.tool || 'diagnostic'}: completed`);
      }
    }
    // Extract key URLs or domain mentions
    const urls = m.content.match(/https?:\/\/[^\s)]+/g);
    if (urls) {
      urls.slice(0, 3).forEach(url => {
        whatWasDone.push(`Investigated URL: ${url}`);
      });
    }
  }

  // Deduplicate entries
  const uniqueDone = Array.from(new Set(whatWasDone)).slice(0, 10);
  if (uniqueDone.length === 0) {
    uniqueDone.push(`Reviewed initial user queries and explored site context across ${messagesToSummarize.length} turns.`);
  }

  const lastAssistant = [...messagesToSummarize].reverse().find(m => m.role === 'model' || m.role === 'assistant');
  const currentState = lastAssistant
    ? lastAssistant.content.slice(0, 240).trim()
    : 'Audit investigation in progress.';

  nextSteps.push('Address highlighted citation gaps and proceed with verified optimizations.');

  return {
    userGoal: initialGoal,
    whatWasDone: uniqueDone,
    currentState,
    nextSteps,
    turnsSummarized: messagesToSummarize.length,
    compactedAt: Date.now(),
  };
}

/**
 * Compact conversation history by summarizing older turns and keeping recent turns intact.
 */
export function compactConversation(
  messages: Message[],
  options: CompactorOptions = {}
): {
  messages: Message[];
  summary: StructuredSummary | null;
  compacted: boolean;
} {
  const contextLimit = options.contextLimitTokens ?? DEFAULT_CONTEXT_LIMIT_TOKENS;
  const threshold = options.thresholdPercent ?? DEFAULT_COMPACT_THRESHOLD_PERCENT;
  const recentTurnsToKeep = Math.max(2, options.recentTurnsToKeep ?? 4);

  if (!needsCompaction(messages, contextLimit, threshold)) {
    return { messages, summary: null, compacted: false };
  }

  // Prune images first
  const pruned = pruneMultimodalImages(messages, options.maxImages ?? DEFAULT_MAX_MULTIMODAL_IMAGES);

  // Split history into older turns and recent turns
  const splitIndex = Math.max(0, pruned.length - recentTurnsToKeep);
  const olderMessages = pruned.slice(0, splitIndex);
  const recentMessages = pruned.slice(splitIndex);

  if (olderMessages.length === 0) {
    return { messages: pruned, summary: null, compacted: false };
  }

  const summary = synthesizeSummaryFromMessages(olderMessages);
  const summaryMessage: Message = {
    id: `summary-${Date.now()}`,
    role: 'system',
    content: formatCompactSummary(summary),
    timestamp: Date.now(),
  };

  return {
    messages: [summaryMessage, ...recentMessages],
    summary,
    compacted: true,
  };
}
