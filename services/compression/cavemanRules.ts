/**
 * Caveman Engine Compression Rules
 * Adapted from OmniRoute (open-sse/services/compression/cavemanRules.ts, MIT License).
 *
 * Rules and patterns to strip conversational filler, hedging, and pleasantries
 * from prompts and context while preserving substantive directives and semantic meaning.
 */

export interface CavemanRule {
  id: string;
  pattern: RegExp;
  replacement: string;
}

export const CAVEMAN_RULES: CavemanRule[] = [
  // Pleasantries and conversational openers
  {
    id: 'pleasantries_openers',
    pattern: /\b(?:hello|hi there|hey|good morning|good afternoon|good evening)[,!.]?\s*/gi,
    replacement: '',
  },
  {
    id: 'pleasantries_affirmations',
    pattern: /\b(?:certainly|sure thing|of course|happy to help|glad to help|absolutely|no problem)[,!.]?\s*/gi,
    replacement: '',
  },
  // Polite framing
  {
    id: 'polite_framing',
    pattern: /\b(?:could you please|would you please|can you please|kindly|please)\s+/gi,
    replacement: '',
  },
  {
    id: 'polite_desire',
    pattern: /\b(?:i would like you to|i want you to|i need you to|i'd like to ask you to)\s+/gi,
    replacement: '',
  },
  // Hedging and uncertainty fillers
  {
    id: 'hedging',
    pattern: /\b(?:it seems like|it appears that|i think that|i believe that|as far as i know)[,]?\s*/gi,
    replacement: '',
  },
  // Redundant adverb fillers
  {
    id: 'filler_adverbs',
    pattern: /\b(?:basically|essentially|actually|literally|simply)\s+/gi,
    replacement: '',
  },
  // Redundant phrasing
  {
    id: 'redundant_phrasing',
    pattern: /\b(?:due to the fact that|the reason is because)\b/gi,
    replacement: 'because',
  },
  {
    id: 'redundant_directives',
    pattern: /\b(?:make sure to|be sure to|it is important to remember to)\s+/gi,
    replacement: '',
  },
  // Softeners
  {
    id: 'softeners',
    pattern: /\b(?:if possible|when you get a chance|at your convenience)[,]?\s*/gi,
    replacement: '',
  },
  // Collapse duplicate whitespace
  {
    id: 'whitespace_collapse',
    pattern: /[ \t]{2,}/g,
    replacement: ' ',
  },
];
