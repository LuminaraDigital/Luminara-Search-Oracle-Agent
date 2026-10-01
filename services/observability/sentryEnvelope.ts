/**
 * Shared Sentry-compatible envelope transport (browser + Worker).
 */
export type SentryReportInput = {
  dsn: string;
  message: string;
  level?: 'fatal' | 'error' | 'warning' | 'info';
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
  release?: string;
  environment?: string;
  platform?: string;
};

function parseDsn(dsn: string): { host: string; publicKey: string; projectId: string } | null {
  try {
    const u = new URL(dsn);
    const publicKey = u.username;
    const projectId = u.pathname.replace(/^\//, '').split('/')[0];
    if (!publicKey || !projectId) return null;
    return { host: u.host, publicKey, projectId };
  } catch {
    return null;
  }
}

export async function sendSentryEvent(input: SentryReportInput): Promise<boolean> {
  const parsed = parseDsn(input.dsn);
  if (!parsed) return false;
  const eventId = [...crypto.getRandomValues(new Uint8Array(16))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: input.platform || 'javascript',
    level: input.level || 'error',
    release: input.release,
    environment: input.environment || 'production',
    tags: input.tags,
    extra: input.extra,
    message: input.message.slice(0, 4000),
    exception: {
      values: [{ type: 'Error', value: input.message.slice(0, 2000) }],
    },
  };
  const envelopeHeader = JSON.stringify({
    event_id: eventId,
    dsn: input.dsn,
    sent_at: new Date().toISOString(),
  });
  const itemHeader = JSON.stringify({ type: 'event', content_type: 'application/json' });
  const body = `${envelopeHeader}\n${itemHeader}\n${JSON.stringify(event)}\n`;
  const url = `https://${parsed.host}/api/${parsed.projectId}/envelope/`;
  const auth = `Sentry sentry_version=7, sentry_client=luminara-sentry/1.0, sentry_key=${parsed.publicKey}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-sentry-envelope',
        'x-sentry-auth': auth,
      },
      body,
    });
    return res.ok || res.status === 200 || res.status === 202;
  } catch {
    return false;
  }
}
