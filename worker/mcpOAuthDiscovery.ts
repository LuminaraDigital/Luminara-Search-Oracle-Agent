/**
 * Public MCP OAuth discovery (RFC 9728 and RFC 8414).
 * These paths sit outside /api so a client can derive them from the server URL, and they answer
 * on every host so the www redirect cannot move the issuer.
 */
import type { Env } from './env';
import { json } from './workerUtils';
import { SUPPORTED_GRANT_TYPES } from './mcpOAuthRefresh';
import { canonicalMcpResource } from './mcpOAuthResource';

/** Scope granted by the connector consent screen. */
const CONNECTOR_SCOPE = 'mcp:free';

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/mcp/authorize`,
    token_endpoint: `${origin}/api/oauth/mcp/token`,
    registration_endpoint: `${origin}/api/oauth/mcp/register`,
    revocation_endpoint: `${origin}/api/oauth/mcp/revoke`,
    revocation_endpoint_auth_methods_supported: ['none'],
    response_types_supported: ['code'],
    grant_types_supported: [...SUPPORTED_GRANT_TYPES],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['mcp:free', 'mcp:research'],
  };
}

/** Where a 401 from /api/mcp sends an MCP client to discover how to sign in (RFC 9728). */
export function mcpResourceMetadataUrl(request: Request): string {
  return `${new URL(request.url).origin}/.well-known/oauth-protected-resource/api/mcp`;
}

const DISCOVERY_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, mcp-protocol-version',
};

export function handleOAuthDiscovery(request: Request): Response | null {
  const url = new URL(request.url);
  const resource = url.pathname.startsWith('/.well-known/oauth-protected-resource');
  const authorization = url.pathname.startsWith('/.well-known/oauth-authorization-server');
  if (!resource && !authorization) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: DISCOVERY_CORS });
  if (request.method !== 'GET') return null;
  if (resource) {
    return json(
      {
        resource: canonicalMcpResource(url.origin),
        resource_name: 'Luminara Suite',
        authorization_servers: [url.origin],
        scopes_supported: [CONNECTOR_SCOPE],
        bearer_methods_supported: ['header'],
      },
      200,
      DISCOVERY_CORS,
    );
  }
  return json(authorizationServerMetadata(url.origin), 200, DISCOVERY_CORS);
}

/**
 * HTTP proof for the MCP Registry domain namespace. The owner sets
 * MCP_REGISTRY_AUTH_TOKEN to the challenge from `mcp-publisher`. Absent means 404.
 */
export function handleMcpRegistryAuth(request: Request, env: Env): Response | null {
  if (new URL(request.url).pathname !== '/.well-known/mcp-registry-auth') return null;
  const token = env.MCP_REGISTRY_AUTH_TOKEN?.trim();
  if (!token) return new Response('not found', { status: 404 });
  return new Response(token, {
    status: 200,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}
