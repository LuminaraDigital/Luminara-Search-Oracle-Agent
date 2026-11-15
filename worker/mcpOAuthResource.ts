/**
 * RFC 8707 resource indicator for the MCP server.
 * The canonical resource is the request origin plus /api/mcp.
 * www, the apex, the configured public origin, and the staging host on staging name this same server.
 * The audience is stored on the KV token and the family connection row, not in D1.
 */

const MCP_RESOURCE_PATH = '/api/mcp';
const PRODUCTION_RESOURCES = [
  'https://www.luminarasuite.com/api/mcp',
  'https://luminarasuite.com/api/mcp',
] as const;
const STAGING_RESOURCE = 'https://staging.luminarasuite.com/api/mcp';
const STAGING_ORIGIN = 'https://staging.luminarasuite.com';

export const MCP_RESOURCE_ERROR = "resource must be this server's MCP URL.";

export type McpResourceEnv = { WEBAPP_URL?: string; ENVIRONMENT?: string };

export function canonicalMcpResource(origin: string): string {
  return `${origin}${MCP_RESOURCE_PATH}`;
}

/** Absolute MCP resource with no userinfo, query, or fragment. Host and scheme are normalized. */
export function parseMcpResource(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.hash || url.search) return null;
  if (url.pathname !== MCP_RESOURCE_PATH) return null;
  return canonicalMcpResource(url.origin);
}

function configuredOrigin(webappUrl: string | undefined): string | null {
  const raw = (webappUrl ?? '').trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

/** Every resource URI this request will treat as its own MCP server. */
export function acceptedMcpResources(origin: string, env: McpResourceEnv): Set<string> {
  const accepted = new Set<string>([canonicalMcpResource(origin)]);
  const configured = configuredOrigin(env.WEBAPP_URL);
  if (configured) accepted.add(canonicalMcpResource(configured));
  const staging =
    env.ENVIRONMENT === 'staging' || origin === STAGING_ORIGIN || configured === STAGING_ORIGIN;
  if (staging) accepted.add(STAGING_RESOURCE);
  if (env.ENVIRONMENT !== 'staging') {
    for (const resource of PRODUCTION_RESOURCES) accepted.add(resource);
  }
  return accepted;
}

/**
 * One accepted resource from the authorize request.
 * Empty input is not a match. Callers treat null as invalid_target when the client sent a value.
 */
export function resourceFromAuthorize(
  origin: string,
  env: McpResourceEnv,
  values: readonly string[],
): string | null {
  const accepted = acceptedMcpResources(origin, env);
  let chosen: string | null = null;
  for (const value of values) {
    const parsed = parseMcpResource(value);
    if (!parsed || !accepted.has(parsed)) return null;
    if (chosen && chosen !== parsed) return null;
    chosen = parsed;
  }
  return chosen;
}

/**
 * Token-request audience.
 * A bound code must see the same resource, or no resource.
 * An unbound code accepts a resource only when it names this server.
 */
export function decideMcpResource(
  accepted: ReadonlySet<string>,
  bound: string | null,
  requested: string | null,
): { ok: true; resource: string | null } | { ok: false } {
  if (requested === null) return { ok: true, resource: bound };
  const asked = parseMcpResource(requested);
  if (!asked) return { ok: false };
  if (bound) return asked === bound ? { ok: true, resource: bound } : { ok: false };
  if (!accepted.has(asked)) return { ok: false };
  return { ok: true, resource: asked };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** null when the field was absent. 'invalid' when it is present and not an MCP resource URI. */
export function boundResourceField(value: unknown): string | null | 'invalid' {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return 'invalid';
  return parseMcpResource(value) ?? 'invalid';
}

/** Resource field on a KV JSON record. Undefined when the row has no audience. */
export function resourceFieldOnRecord(raw: string | null): unknown {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !('resource' in value)) return undefined;
    return value.resource;
  } catch {
    return undefined;
  }
}
