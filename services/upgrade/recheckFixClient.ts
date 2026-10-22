/**
 * Asks the worker to re-read one check. The worker spends one daily check and refunds it when unmeasured.
 */
import { apiBase, workerFetchWithAuthRetry } from '../apiClient';

export interface RecheckResponse {
  ok: boolean;
  measured: boolean;
  passed: boolean | null;
  detail: string;
  code?: string;
}

export async function requestRecheck(input: { domain: string; checkId: string; expect?: string }): Promise<RecheckResponse> {
  const base = apiBase();
  if (!base) {
    return { ok: false, measured: false, passed: null, detail: 'Not measured. This check was not rechecked.', code: 'NO_API' };
  }
  try {
    const res = await workerFetchWithAuthRetry(`${base}/api/audit/scout-run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ recheck: true, domain: input.domain, checkId: input.checkId, expect: input.expect }),
    });
    const body = (await res.json().catch(() => null)) as Partial<RecheckResponse> | null;
    if (!body || typeof body.detail !== 'string') {
      return { ok: false, measured: false, passed: null, detail: 'Not measured. This check was not rechecked.', code: res.ok ? 'BAD_RESPONSE' : 'PAYWALL_EXCEEDED' };
    }
    return {
      ok: Boolean(body.ok),
      measured: body.measured === true,
      passed: body.passed === true ? true : body.passed === false ? false : null,
      detail: body.detail,
      code: typeof body.code === 'string' ? body.code : undefined,
    };
  } catch {
    return { ok: false, measured: false, passed: null, detail: 'Not measured. This check was not rechecked.', code: 'UNAVAILABLE' };
  }
}
