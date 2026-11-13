/**
 * Canonical Worker strict-write threat gate with automatic `threat_scan_triggered` telemetry.
 *
 * Centralizes `evaluateStrictWriteGate` + `recordServerProductEvent` across all persistent
 * write surfaces so `warn`-mode soak telemetry and `strict`-mode blocking never drift.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from './env';
import {
  evaluateStrictWriteGate,
  type ThreatGateDecision,
} from '../services/trust/threatPatterns';
import { recordServerProductEvent } from './productAnalytics';

export async function checkStrictWriteThreat(
  env: Env,
  input: {
    db?: D1Database;
    accountId?: string | null;
    sessionId?: string | null;
    path: string;
    surface: string;
    content: string;
  },
): Promise<ThreatGateDecision> {
  const decision = evaluateStrictWriteGate(env, input.content);
  if (decision.findings.length > 0) {
    await recordServerProductEvent(input.db ?? env.DB, {
      accountId: input.accountId && input.accountId !== 'guest' ? input.accountId : null,
      sessionId: input.sessionId ?? null,
      type: 'threat_scan_triggered',
      path: input.path,
      data: {
        surface: input.surface,
        mode: decision.mode,
        blocked: decision.blocked,
        patternId: decision.findings[0],
      },
    });
  }
  return decision;
}
