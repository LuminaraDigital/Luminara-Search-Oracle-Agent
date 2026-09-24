/**
 * Admin API authorization: ADMIN_SECRET separation (P1 hardening).
 *
 * TELEGRAM_WEBHOOK_SECRET authorizes only Telegram webhook delivery. Admin routes
 * (/admin/users, /admin/license/generate, /admin/license/seed, /telegram/refund)
 * require a dedicated ADMIN_SECRET sent as the x-admin-secret header and compared
 * timing-safely. When ADMIN_SECRET is unset the admin API fails closed with 503
 * instead of silently accepting the webhook secret the way pre-separation code did.
 */
import type { Env } from './env';
import { json, secretEquals } from './workerUtils';

export type AdminAuthResult = { ok: true } | { ok: false; response: Response };

export function isAdminAuthorized(env: Env, request: Request): AdminAuthResult {
  const secret = (env.ADMIN_SECRET || '').trim();
  if (!secret) {
    // Fail closed: no configured secret means the admin API is disabled entirely,
    // including for callers that happen to know the webhook secret.
    return {
      ok: false,
      response: json({ error: 'admin API disabled: ADMIN_SECRET not configured' }, 503),
    };
  }
  const presented = request.headers.get('x-admin-secret') || '';
  if (!presented || !secretEquals(presented, secret)) {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          error:
            'Unauthorized. Send the ADMIN_SECRET value in the x-admin-secret header. Configure it with: npx wrangler secret put ADMIN_SECRET',
          code: 'ADMIN_SECRET_REQUIRED',
        },
        401,
      ),
    };
  }
  return { ok: true };
}