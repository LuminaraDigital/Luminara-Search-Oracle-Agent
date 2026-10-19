/**
 * One health-claim rule for prompts, one phrase list for paste-ready copy, one note for health sites.
 * The post-check is a string replace. It does not call a model.
 */

export const HEALTH_CLAIM_RULE =
  'Never write therapeutic, disease, or health-benefit claims (cure, treat, prevent, heal, boost immunity, detox, clinically proven, and similar). Never give medical advice. For a health, supplement, or wellness site, write factual product or service copy only, and note that the copy must be checked against the TGA Therapeutic Goods Advertising Code and Australian Consumer Law.';

export const HEALTH_SITE_NOTE =
  'Health and wellness copy in Australia must follow the TGA Advertising Code. Luminara gives marketing suggestions only, not medical or legal advice.';

export const REMOVED_HEALTH_CLAIM = '[removed health claim]';

export const HEALTH_CLAIM_WARNING =
  'Health-claim check: a therapeutic phrase was removed. Check this copy against the TGA Therapeutic Goods Advertising Code and the Australian Consumer Law before publishing.';

const HEALTH_SITE_KEYWORDS = [
  'health',
  'wellness',
  'clinic',
  'medical',
  'pharmacy',
  'supplement',
  'vitamin',
  'dental',
  'dentist',
  'therapy',
  'therapeutic',
  'nutrition',
  'immunity',
  'immune',
  'detox',
  'herbal',
  'naturopath',
  'chiropract',
  'physio',
  'probiotic',
  'medicinal',
  'disease',
  'symptom',
  'seamoss',
  'sea moss',
  'cbd',
  'collagen',
];

const CLAIM_OBJECTS =
  'cancer|disease|illness(?:es)?|infection|diabetes|pain|covid|arthritis|inflammation|symptoms?|colds?|flu|eczema|acne|anxiety|depression|obesity|insomnia|allerg(?:y|ies)|cholesterol|fatigue|virus|bacteria|joints?|bloating';

const CLAIM_PATTERNS: RegExp[] = [
  /\bboost(?:s|ing)?\s+(?:your\s+)?(?:immunity|immune system)\b/gi,
  /\bclinically[\s-]?proven\b/gi,
  /\bdetox(?:if(?:y|ies|ied)|ing|es|ed)?\b/gi,
  /\b(?:cure|cures|cured|curing)\b/gi,
  /\b(?:heal|heals|healed|healing)\b/gi,
  new RegExp(`\\b(?:treat|treats|treated|treating|prevent|prevents|prevented|preventing)\\s+(?:${CLAIM_OBJECTS})\\b`, 'gi'),
];

export function withHealthClaimRule(prompt: string): string {
  if (prompt.includes(HEALTH_CLAIM_RULE)) return prompt;
  return `${prompt}\n${HEALTH_CLAIM_RULE}`;
}

export function siteLooksHealthRelated(input: { domain?: string; title?: string; content?: string }): boolean {
  const hay = `${input.domain || ''} ${input.title || ''} ${input.content || ''}`.toLowerCase();
  return HEALTH_SITE_KEYWORDS.some((word) => hay.includes(word));
}

/** Strip high-risk therapeutic phrases from copy a founder might paste, then add one warning. */
export function guardPasteReadyCopy(input: string): { text: string; changed: boolean } {
  let text = String(input ?? '');
  let changed = false;
  for (const pattern of CLAIM_PATTERNS) {
    pattern.lastIndex = 0;
    text = text.replace(pattern, () => {
      changed = true;
      return REMOVED_HEALTH_CLAIM;
    });
  }
  if (!changed) return { text: String(input ?? ''), changed: false };
  if (!text.includes(HEALTH_CLAIM_WARNING)) {
    text = `${text.trimEnd()}\n\n${HEALTH_CLAIM_WARNING}`;
  }
  return { text, changed: true };
}
