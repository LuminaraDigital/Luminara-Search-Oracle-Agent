/**
 * RTK Tool Output Compressor
 * Adapted from OmniRoute (open-sse/services/compression/toolResultCompressor.ts, MIT License).
 *
 * Compresses scraped HTML trees, large tool results, command line logs, and repetitive
 * file content before sending to LLM context, saving tokens and speeding up inference.
 */

const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;
const PROGRESS_BAR_REGEX = /(?:\[[=\->\s]{5,}\]|\b\d{1,3}%\s*\|[█▎▌▋▊▉\s]{5,}\|)/g;

export interface ToolCompressionResult {
  compressed: string;
  originalChars: number;
  compressedChars: number;
  savedChars: number;
  reductionPercentage: number;
}

/**
 * Strips ANSI terminal escape sequences.
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

/**
 * Elides the middle lines of an oversized content string.
 */
export function elideLines(
  text: string,
  keepHead = 30,
  keepTail = 10
): { text: string; elidedCount: number } {
  const lines = text.split('\n');
  if (lines.length <= keepHead + keepTail + 2) {
    return { text, elidedCount: 0 };
  }

  const head = lines.slice(0, keepHead).join('\n');
  const tail = lines.slice(-keepTail).join('\n');
  const elidedCount = lines.length - keepHead - keepTail;
  const result = `${head}\n… [${elidedCount} lines elided for brevity] …\n${tail}`;
  return { text: result, elidedCount };
}

/**
 * Strips progress bars, carriage return updates, and noisy repeated status lines.
 */
export function cleanLogNoise(text: string): string {
  let cleaned = text.replace(PROGRESS_BAR_REGEX, '');
  // Collapse duplicate blank lines
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  return cleaned.trim();
}

/**
 * Minifies JSON strings while keeping structural readability if oversized.
 */
export function compressJsonString(jsonStr: string, maxChars = 2000): string {
  try {
    const parsed = JSON.parse(jsonStr);
    const compact = JSON.stringify(parsed);
    if (compact.length <= maxChars) {
      return compact;
    }
    // Truncate long arrays inside JSON safely
    if (Array.isArray(parsed) && parsed.length > 10) {
      const truncated = [...parsed.slice(0, 5), `... (${parsed.length - 10} items elided) ...`, ...parsed.slice(-5)];
      return JSON.stringify(truncated);
    }
    return compact.slice(0, maxChars) + ' ... [truncated JSON]';
  } catch {
    return jsonStr;
  }
}

/**
 * Main tool and scrape result compressor.
 */
export function compressToolResult(
  content: string,
  options: { keepHead?: number; keepTail?: number; maxChars?: number } = {}
): ToolCompressionResult {
  if (!content) {
    return {
      compressed: '',
      originalChars: 0,
      compressedChars: 0,
      savedChars: 0,
      reductionPercentage: 0,
    };
  }

  const originalChars = content.length;
  let processed = stripAnsi(content);
  processed = cleanLogNoise(processed);

  // If content is pure JSON, compress JSON
  if (processed.startsWith('{') || processed.startsWith('[')) {
    processed = compressJsonString(processed, options.maxChars || 4000);
  } else {
    // Elide long text/DOM dumps
    const { text } = elideLines(processed, options.keepHead ?? 40, options.keepTail ?? 15);
    processed = text;
  }

  const compressedChars = processed.length;
  const savedChars = Math.max(0, originalChars - compressedChars);
  const reductionPercentage = originalChars > 0 ? Math.round((savedChars / originalChars) * 100) : 0;

  return {
    compressed: processed,
    originalChars,
    compressedChars,
    savedChars,
    reductionPercentage,
  };
}
