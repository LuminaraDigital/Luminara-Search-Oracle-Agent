/**
 * Caveman Engine
 * Adapted from OmniRoute (open-sse/services/compression/caveman.ts, MIT License).
 *
 * Compresses natural language messages by removing polite framing, hedging,
 * pleasantries, and conversational fillers while preserving code blocks, JSON schemas,
 * brand identifiers, and URLs intact.
 */

import { CAVEMAN_RULES } from './cavemanRules';

export interface CavemanCompressionResult {
  compressed: string;
  originalChars: number;
  compressedChars: number;
  estimatedTokensSaved: number;
  reductionPercentage: number;
}

const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const INLINE_CODE_RE = /`[^`]+`/g;
const URL_RE = /https?:\/\/[^\s)\]>"']+/g;

export class CavemanEngine {
  /**
   * Compresses input text while strictly preserving code fences, inline code, and URLs.
   */
  public static compress(text: string): CavemanCompressionResult {
    if (!text || typeof text !== 'string') {
      return {
        compressed: text || '',
        originalChars: 0,
        compressedChars: 0,
        estimatedTokensSaved: 0,
        reductionPercentage: 0,
      };
    }

    const originalChars = text.length;
    const preservedBlocks: string[] = [];

    // Step 1: Extract and protect code blocks
    let workingText = text.replace(CODE_BLOCK_RE, (match) => {
      const idx = preservedBlocks.length;
      preservedBlocks.push(match);
      return `__CAVEMAN_PRESERVED_${idx}__`;
    });

    // Step 2: Extract and protect inline code
    workingText = workingText.replace(INLINE_CODE_RE, (match) => {
      const idx = preservedBlocks.length;
      preservedBlocks.push(match);
      return `__CAVEMAN_PRESERVED_${idx}__`;
    });

    // Step 3: Extract and protect URLs
    workingText = workingText.replace(URL_RE, (match) => {
      const idx = preservedBlocks.length;
      preservedBlocks.push(match);
      return `__CAVEMAN_PRESERVED_${idx}__`;
    });

    // Step 4: Apply Caveman Rules
    for (const rule of CAVEMAN_RULES) {
      workingText = workingText.replace(rule.pattern, rule.replacement);
    }

    // Step 5: Restore preserved blocks
    for (let i = 0; i < preservedBlocks.length; i++) {
      workingText = workingText.replace(`__CAVEMAN_PRESERVED_${i}__`, preservedBlocks[i]);
    }

    const compressed = workingText.trim();
    const compressedChars = compressed.length;
    const savedChars = Math.max(0, originalChars - compressedChars);
    const estimatedTokensSaved = Math.ceil(savedChars / 4);
    const reductionPercentage = originalChars > 0 ? Math.round((savedChars / originalChars) * 100) : 0;

    return {
      compressed,
      originalChars,
      compressedChars,
      estimatedTokensSaved,
      reductionPercentage,
    };
  }
}
