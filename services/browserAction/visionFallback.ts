/**
 * Browser Action Resilience & Vision Fallback (Stage 4):
 * 1. Grokbot-derived Bot-Block Classifier (`classifyBotBlockPage`)
 * 2. OpenMausBot-derived Sensitive Field Masking (`MASKED_VALUE`, `maskSensitiveInputValue`)
 * 3. PointerBench 1024x768 Grounded Vision Fallback (`resolvePointerBenchFallback`)
 *
 * Reuses canonical PointerBench primitives from `services/grounding/`.
 * Zero em dashes. Rejects normalized [0,1] coordinates and planner coordinate smuggling.
 */

import {
  FRAME_HEIGHT,
  FRAME_WIDTH,
  assertFixedFrame,
  buildPointerMessages,
  parseGeometry,
  plannerEmittedCoordinates,
  type PlannerIntent,
  type Point,
} from '../grounding/index';
import type { HistoryEntry, ObservePayload } from './types';

export { FRAME_WIDTH as POINTERBENCH_FRAME_WIDTH, FRAME_HEIGHT as POINTERBENCH_FRAME_HEIGHT };

/** OpenMausBot control-character sentinel so sensitive values never leak into LLM history or traces. */
export const MASKED_VALUE = '\u0007\u0007\u0007\u0007';

/** Grokbot-derived WAF / bot-block signatures. */
export const BOT_BLOCK_SIGNATURES: readonly string[] = [
  'just a moment...',
  'attention required! | cloudflare',
  'cf-chl-bypass',
  'verify you are human',
  'checking if the site connection is secure',
  'enable javascript and cookies to continue',
  'g-recaptcha',
  'h-captcha',
  'access denied',
  'ddos-guard',
  'please complete the security check',
];

export interface BotBlockClassification {
  blockedByBotProtection: boolean;
  matchedSignature: string | null;
  reason: string | null;
}

/**
 * Inspects observed page title and text for WAF/CAPTCHA/Cloudflare challenges
 * before burning browser action budget.
 */
export function classifyBotBlockPage(page: {
  title?: string;
  text?: string;
  url?: string;
}): BotBlockClassification {
  const combined = `${page.title ?? ''}\n${page.text ?? ''}`.toLowerCase();
  for (const sig of BOT_BLOCK_SIGNATURES) {
    if (combined.includes(sig)) {
      return {
        blockedByBotProtection: true,
        matchedSignature: sig,
        reason: `Bot challenge or WAF wall detected (${sig}). Halting automated loop.`,
      };
    }
  }
  return {
    blockedByBotProtection: false,
    matchedSignature: null,
    reason: null,
  };
}

const SENSITIVE_FIELD_PATTERNS: readonly RegExp[] = [
  /\bpass(word|code|phrase)?\b/i,
  /\bsecret\b/i,
  /\bapi[-_\s]?key\b/i,
  /\btoken\b/i,
  /\bcvv\b/i,
  /\bcvc\b/i,
  /\bcredit[-_\s]?card\b/i,
  /\bssn\b/i,
  /\btfn\b/i,
  /\bauth[-_\s]?code\b/i,
];

export function isSensitiveFieldLabel(labelOrRole?: string | null): boolean {
  if (!labelOrRole) return false;
  return SENSITIVE_FIELD_PATTERNS.some((re) => re.test(labelOrRole));
}

export function maskSensitiveInputValue(
  labelOrRole: string | null | undefined,
  rawValue: string | null | undefined,
): string | null {
  if (rawValue == null) return null;
  return isSensitiveFieldLabel(labelOrRole) ? MASKED_VALUE : rawValue;
}

const HARD_BANNED_TAKE_CONTROL_PATTERNS: readonly RegExp[] = [
  /\b(password|passcode)\b/i,
  /\b(credit[-_\s]?card|card\s*number|cvv|cvc|expiry|iban|bank\s*account)\b/i,
  /\b(one[-_\s]?time\s*code|2fa|mfa|totp|verification\s*code)\b/i,
];

const TIER_2_COMMIT_WRITE_PATTERNS: readonly RegExp[] = [
  /\b(publish|submit|save|delete|remove|deploy|update|confirm|pay|checkout)\b/i,
];

export interface CelestoBrowserActionPolicyDecision {
  tier: 'tier_1_read' | 'tier_2_write' | 'hard_banned_take_control';
  allowed: boolean;
  requiresHumanTakeControl: boolean;
  reason: string | null;
}

/**
 * Celesto Two-Tier Browser Action Policy:
 * - Tier 1 (Read / Observe / Scroll / Wait): zero-approval autonomous execution.
 * - Tier 2 (Write / Commit / Publish): requires operator approval (`writeApproved !== false`).
 * - Hard-Banned (Consumer Login Passwords, Payment/Card, MFA/OTP): blocked unless `allowSensitiveFill: true` (human Take Control).
 */
export function evaluateCelestoBrowserActionPolicy(
  action: { kind: string; label?: string | null; role?: string | null },
  opts?: { writeApproved?: boolean; allowSensitiveFill?: boolean },
): CelestoBrowserActionPolicyDecision {
  const combined = `${action.label ?? ''} ${action.role ?? ''}`.trim();
  const isAppPassword = /\bapplication\s+password\b/i.test(combined);

  if (
    action.kind === 'fill' &&
    !isAppPassword &&
    HARD_BANNED_TAKE_CONTROL_PATTERNS.some((re) => re.test(combined))
  ) {
    if (opts?.allowSensitiveFill === true) {
      return {
        tier: 'tier_2_write',
        allowed: true,
        requiresHumanTakeControl: false,
        reason: null,
      };
    }
    return {
      tier: 'hard_banned_take_control',
      allowed: false,
      requiresHumanTakeControl: true,
      reason: `Autonomous fill blocked on protected field "${action.label || action.role || 'credential'}". Human Take Control is required.`,
    };
  }

  if (action.kind === 'wait' || action.kind === 'scroll') {
    return {
      tier: 'tier_1_read',
      allowed: true,
      requiresHumanTakeControl: false,
      reason: null,
    };
  }

  const isCommitWrite = TIER_2_COMMIT_WRITE_PATTERNS.some((re) => re.test(combined));
  if (isCommitWrite && opts?.writeApproved === false) {
    return {
      tier: 'tier_2_write',
      allowed: false,
      requiresHumanTakeControl: false,
      reason: `Tier 2 write action "${action.label || action.kind}" requires operator approval before execution.`,
    };
  }

  return {
    tier: isCommitWrite || action.kind === 'fill' || action.kind === 'select' ? 'tier_2_write' : 'tier_1_read',
    allowed: true,
    requiresHumanTakeControl: false,
    reason: null,
  };
}

export interface PointerBenchFallbackInput {
  goal: string;
  page: ObservePayload;
  history: HistoryEntry[];
  frameWidth?: number;
  frameHeight?: number;
  plannerIntent: PlannerIntent;
  /** Vision model callback returning raw JSON string for the 1024x768 screenshot. */
  visionPointerCall: (prompt: { system: string; user: string }) => Promise<string>;
}

export interface PointerBenchFallbackResult {
  triggered: boolean;
  ok: boolean;
  point: Point | null;
  instruction: string | null;
  reason: string;
  nextPage?: ObservePayload;
}

/**
 * Determines whether the DOM action loop should escalate to PointerBench 1024x768
 * vision grounding (either 0 interactive DOM elements or 3 repeated no-op steps,
 * provided the page is not a WAF/CAPTCHA challenge).
 */
export function shouldTriggerVisionFallback(
  page: ObservePayload,
  history: HistoryEntry[],
): { trigger: boolean; reason: string } {
  const botCheck = classifyBotBlockPage(page);
  if (botCheck.blockedByBotProtection) {
    return {
      trigger: false,
      reason: botCheck.reason ?? 'Blocked by bot protection',
    };
  }

  const interactiveActions = page.actions.filter(
    (a) => a.kind === 'click' || a.kind === 'fill' || a.kind === 'select',
  );
  if (interactiveActions.length === 0) {
    return {
      trigger: true,
      reason: 'Zero interactive DOM elements observed; escalating to PointerBench 1024x768 grounding.',
    };
  }

  const tail = history.slice(-3);
  if (
    tail.length === 3 &&
    tail.every((h) => h.page_changed === false && h.kind !== 'wait')
  ) {
    return {
      trigger: true,
      reason: 'Three consecutive DOM actions produced no page change; escalating to PointerBench 1024x768 grounding.',
    };
  }

  return {
    trigger: false,
    reason: 'DOM action space is healthy; no vision fallback required.',
  };
}

/**
 * Executes a single PointerBench 1024x768 planner/pointer fallback step
 * using canonical `services/grounding` protocol helpers.
 */
export async function resolvePointerBenchFallback(
  input: PointerBenchFallbackInput,
): Promise<PointerBenchFallbackResult> {
  assertFixedFrame(input.frameWidth ?? FRAME_WIDTH, input.frameHeight ?? FRAME_HEIGHT);

  const check = shouldTriggerVisionFallback(input.page, input.history);
  if (!check.trigger) {
    return {
      triggered: false,
      ok: false,
      point: null,
      instruction: null,
      reason: check.reason,
    };
  }

  if (
    plannerEmittedCoordinates(input.plannerIntent.target) ||
    (input.plannerIntent.constraints &&
      plannerEmittedCoordinates(input.plannerIntent.constraints))
  ) {
    throw new Error('Planner intent smuggled coordinates; violating PointerBench planner/pointer split.');
  }

  const messages = buildPointerMessages(input.plannerIntent, {
    answerType: 'point',
    luminaraSurface: false,
  });

  const rawModelResponse = await input.visionPointerCall({
    system: messages.system,
    user: messages.user,
  });

  const parsed = parseGeometry(rawModelResponse, 'point', {
    rejectNormalized: true,
    frameWidth: FRAME_WIDTH,
    frameHeight: FRAME_HEIGHT,
  });

  if (!parsed?.point) {
    return {
      triggered: true,
      ok: false,
      point: null,
      instruction: messages.request.instruction,
      reason: 'Pointer model response did not contain valid 1024x768 absolute pixel coordinates.',
    };
  }

  const [x, y] = parsed.point;
  if (x < 0 || x > FRAME_WIDTH || y < 0 || y > FRAME_HEIGHT) {
    return {
      triggered: true,
      ok: false,
      point: null,
      instruction: messages.request.instruction,
      reason: `Pointer coordinates [${x}, ${y}] out of 1024x768 bounds.`,
    };
  }

  return {
    triggered: true,
    ok: true,
    point: [Math.round(x), Math.round(y)],
    instruction: messages.request.instruction,
    reason: check.reason,
  };
}
