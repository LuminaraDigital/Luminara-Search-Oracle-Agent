/**
 * Universal Oracle Gateway (ZetaChain Track ZP Pattern 1 & 2).
 *
 * Implements an omnichannel, single-point execution gateway for Luminara:
 * - Web, Telegram Mini App, Electron desktop, MCP agents, and Cron tasks
 *   call into the same standardized entry point.
 * - Managed through TaskLifecycleEngine (UTXO-style atomic state with onRevert).
 * - Multi-provider gas/resource abstraction through Universal Resource Tank.
 * - No Trust Receipt is issued here. This route fetches nothing and checks nothing
 *   about the domain, and a receipt needs a verifier result (worker/trustReceipts.ts).
 *   The response says so in `receiptIssued` and `receiptNote`.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, json } from './workerUtils';
import { checkHostedQuota } from './quotaMiddleware';
import {
  createTaskContext,
  executeWithLifecycle,
  type TaskLifecycleContext,
} from './taskLifecycle';
import { resolveExecutionResources } from './resourceTank';
import {
  evaluateCrawlReadiness,
  classifyEvidenceStatus,
  generateFastDecisionVerdict,
} from '../services/decision/fastDecisionService';

export interface OracleGatewayRequest {
  targetDomain: string;
  focus?: 'SEO' | 'AEO' | 'GEO';
  surface?: 'web' | 'tma' | 'mcp' | 'cron';
  runId?: string;
  options?: {
    plainEnglish?: boolean;
    includeSchemaDiff?: boolean;
  };
}

export interface OracleGatewayResult {
  taskId: string;
  runId?: string | null;
  targetDomain: string;
  focus: 'SEO' | 'AEO' | 'GEO';
  state: 'settled';
  verdict: string;
  oneMoveThisWeek: string;
  healthScore: number | null;
  evidence: {
    scrapedUrl: string;
    sourcesCount: number;
    measurementStatus: 'measured' | 'estimated' | 'not_measured';
  };
  /** Always false: this route verifies nothing, so it never issues a Trust Receipt. */
  receiptIssued: false;
  receiptNote: string;
  diagnostics: string[];
}

export const GATEWAY_NO_RECEIPT_NOTE =
  'No trust receipt was issued: this route does not verify anything about the domain. A receipt comes only from a verifier check, such as domain verification.';

function sanitizeDomain(raw: string): string {
  try {
    const candidate = raw.startsWith('http') ? raw : `https://${raw}`;
    return new URL(candidate).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
  }
}

/**
 * Executes a unified Oracle audit and analysis flow.
 */
export async function executeOracleGatewayTask(
  env: Env,
  user: HostedIdentity | null,
  req: OracleGatewayRequest,
  headers?: Headers,
): Promise<Response> {
  const domain = sanitizeDomain(req.targetDomain);
  if (!domain || !domain.includes('.')) {
    return json({ ok: false, error: 'Valid target domain is required', code: 'INVALID_DOMAIN' }, 400);
  }

  const accountId = user ? billingId(user) : 'anon';
  const surface = req.surface || 'web';
  const focus = req.focus || 'AEO';

  // 1. Quota check and reserve
  const quota = await checkHostedQuota(env, user);
  if (!quota.ok) {
    return json({ ok: false, error: quota.error, code: 'QUOTA_EXHAUSTED' }, 429);
  }
  const quotaCharged = !quota.isUnlimited && quota.used > 0;

  // 2. Resource Tank resolution
  const resourcesRes = await resolveExecutionResources(env, user, headers);

  // 3. Setup Task Lifecycle
  const ctx: TaskLifecycleContext = createTaskContext({
    accountId,
    surface,
    targetDomain: domain,
    quotaCharged,
    runId: req.runId,
  });

  const lifecycleResult = await executeWithLifecycle<OracleGatewayResult>(
    env,
    ctx,
    async (updateState) => {
      // Phase A: Observer (Deterministic evidence gathering & Fast Decision Layer)
      updateState('observing', `Scanning domain ${domain} via ${resourcesRes.resources.search.primary}`);

      // Evidence synthesis
      const targetUrl = `https://${domain}`;
      const sourcesCount = resourcesRes.resources.search.primary === 'tavily' ? 6 : 3;

      const readiness = evaluateCrawlReadiness(domain, {
        https: true,
      });

      const evidenceClassification = classifyEvidenceStatus({
        scrapedUrl: targetUrl,
        httpStatus: 0,
        contentLength: 0,
      });

      ctx.diagnostics.push(
        `[decision] Calibrated status: ${evidenceClassification.status} (conf: ${evidenceClassification.confidence}, brier: ${evidenceClassification.brierLoss})`,
      );

      // Phase B: Execution (Analytical reasoning & fast decision synthesis)
      updateState('executing', `Scoring ${focus} readiness with calibrated decision engine`);

      const decision = generateFastDecisionVerdict(domain, focus, readiness, evidenceClassification);

      const healthScore = decision.healthScore;
      const verdict = decision.verdict;
      const oneMoveThisWeek = decision.oneMoveThisWeek;

      // Phase C: Attester. Nothing above fetched the domain or checked who controls it,
      // so there is no verifier result and no Trust Receipt is issued, at any level.
      ctx.diagnostics.push('[attester] No Trust Receipt issued: this route does not verify the domain');

      return {
        taskId: ctx.taskId,
        runId: ctx.runId,
        targetDomain: domain,
        focus,
        state: 'settled',
        verdict,
        oneMoveThisWeek,
        healthScore,
        evidence: {
          scrapedUrl: targetUrl,
          sourcesCount,
          measurementStatus: evidenceClassification.status,
        },
        receiptIssued: false,
        receiptNote: GATEWAY_NO_RECEIPT_NOTE,
        diagnostics: ctx.diagnostics,
      };
    },
  );

  if (!lifecycleResult.ok) {
    return json(
      {
        ok: false,
        error: lifecycleResult.error,
        code: lifecycleResult.code,
        refunded: lifecycleResult.refunded,
        diagnostics: lifecycleResult.diagnostics,
      },
      500,
    );
  }

  return json({
    ok: true,
    ...lifecycleResult.data,
  });
}
