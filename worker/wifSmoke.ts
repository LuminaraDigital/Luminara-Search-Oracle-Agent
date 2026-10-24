/**
 * Staging-only proof of the Workload Identity chain.
 * 404 unless ENVIRONMENT is staging. Does not read DATA_PLANE.
 * Writes, reads, and deletes one `_smoke/wif-<timestamp>` doc, then returns step timings.
 * The response has no access token, JWT, or signing key.
 */
import { isAdminAuthorized } from './adminAuth';
import type { Env } from './env';
import { createFirestoreClient, type FirestoreClient } from './firestoreRest';
import { exchangeForAccessToken, readWorkloadIdentityConfig, StubGcpTokenProvider } from './gcpToken';
import { json } from './workerUtils';

const SMOKE_COLLECTION = '_smoke';
const PROBE = 'wif';

export type WifSmokeStepName = 'sign' | 'sts' | 'impersonate' | 'write' | 'read' | 'delete';

export type WifSmokeStep = {
  step: WifSmokeStepName;
  ok: boolean;
  latencyMs: number;
  error?: string;
};

export type WifSmokeReport = {
  ok: boolean;
  doc: string;
  steps: WifSmokeStep[];
};

export function wifSmokeEnabled(env: { ENVIRONMENT?: string }): boolean {
  return (env.ENVIRONMENT ?? '').trim() === 'staging';
}

export async function handleWifSmokeRoute(request: Request, env: Env, path: string): Promise<Response | null> {
  if (path !== '/admin/wif-smoke') return null;
  if (!wifSmokeEnabled(env)) return json({ ok: false, error: 'Not found' }, 404);
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const admin = isAdminAuthorized(env, request);
  if (!admin.ok) return admin.response;
  const report = await runWifSmoke(env, { fetch: globalThis.fetch, now: Date.now() });
  return json(report, report.ok ? 200 : 502);
}

export async function runWifSmoke(
  env: Env,
  opts: { fetch: typeof fetch; now?: number },
): Promise<WifSmokeReport> {
  const now = opts.now ?? Date.now();
  const docId = `wif-${now}`;
  const doc = `${SMOKE_COLLECTION}/${docId}`;
  const steps: WifSmokeStep[] = [];
  const config = readWorkloadIdentityConfig(env);
  if (!config) {
    steps.push({ step: 'sign', ok: false, latencyMs: 0, error: 'workload identity config incomplete' });
    return { ok: false, doc, steps };
  }

  const exchanged = await exchangeForAccessToken(config, opts.fetch, now);
  steps.push(...exchanged.steps);
  if (!exchanged.ok) return { ok: false, doc, steps };

  const project = (env.GCP_PROJECT_ID ?? '').trim();
  if (!project) {
    steps.push({ step: 'write', ok: false, latencyMs: 0, error: 'gcp project unset' });
    return { ok: false, doc, steps };
  }

  let client: FirestoreClient;
  try {
    client = createFirestoreClient({
      project,
      tokenProvider: new StubGcpTokenProvider(exchanged.token),
      fetch: opts.fetch,
    });
  } catch {
    steps.push({ step: 'write', ok: false, latencyMs: 0, error: 'invalid gcp project id' });
    return { ok: false, doc, steps };
  }

  let wrote = false;
  try {
    await runStep(steps, 'write', async () => {
      await client.patch(SMOKE_COLLECTION, docId, { probe: PROBE, at: now });
      wrote = true;
    });
    await runStep(steps, 'read', async () => {
      const fields = await client.get(SMOKE_COLLECTION, docId);
      if (!fields || fields.probe !== PROBE || fields.at !== now) throw new Error('firestore read mismatch');
    });
  } catch {
    // runStep already recorded the failure. Delete still runs when the write landed.
  }
  if (wrote) {
    try {
      await runStep(steps, 'delete', () => client.delete(SMOKE_COLLECTION, docId));
    } catch {
      // runStep already recorded the delete failure.
    }
  }
  return { ok: steps.length === 6 && steps.every((step) => step.ok), doc, steps };
}

async function runStep(steps: WifSmokeStep[], step: WifSmokeStepName, run: () => Promise<void>): Promise<void> {
  const started = Date.now();
  try {
    await run();
    steps.push({ step, ok: true, latencyMs: Date.now() - started });
  } catch (err) {
    steps.push({ step, ok: false, latencyMs: Date.now() - started, error: safeError(err) });
    throw err;
  }
}

function safeError(err: unknown): string {
  const message = err instanceof Error ? err.message : 'request failed';
  if (message.length > 80 || /bearer|eyJ|private key|-----/i.test(message)) return 'request failed';
  return message;
}
