/**
 * CMS Fixer MCP Relay & Safety Gate (Stage 3)
 *
 * Bridges Luminara Suite with external CMS MCP servers:
 * 1. WordPress.com Official MCP (`https://public-api.wordpress.com/wpcom/v2/mcp/v1` - STRAP facade)
 * 2. GoBuildWP (`gobuildwp/wordpress-mcp-ai-gobuildwp` - Builder-aware refusal & HMAC confirmation)
 * 3. Respira (`respira-press/respira-wordpress-mcp` - 19 builders + snapshot-before-write)
 * 4. InstaWP (`InstaWP/mcp-wp` - Unified content & Yoast fields with SQL/PHP execution blocked)
 * 5. Wix Official MCP (`wix/wix-mcp` - `ListWixSites`, `CallWixSiteAPI`, `ManageWixSite`)
 * 6. Squarespace Code Injection Pack (`buildSquarespaceInjectionPack`)
 */

import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, json } from './workerUtils';
import { MAX_SMALL_BODY_BYTES, readBody } from './security';
import {
  buildSquarespaceInjectionPack,
  classifyRemediationTier,
  CMS_MCP_CONNECTOR_CATALOG,
  type CmsMcpConnectorId,
  type RemediationFindingInput,
} from '../services/deployment/remediationTierRouter';
export { CMS_MCP_CONNECTOR_CATALOG, type CmsMcpConnectorId };
import { checkOrRecordExternalEffect, finalizeExternalEffect } from './externalEffectsService';

const BLOCKED_DANGEROUS_MCP_TOOLS = new Set([
  'execute-php',
  'wp_execute_php',
  'sql-query',
  'wp_sql_query',
  'delete-plugin',
  'delete-theme',
  'install-plugin',
  'install-theme',
]);

const KNOWN_BUILDER_META_KEYS: Record<string, string> = {
  _elementor_edit_mode: 'Elementor',
  _bricks_page_content_2: 'Bricks',
  _fl_builder_data: 'Beaver Builder',
  _et_pb_use_builder: 'Divi',
  _ct_builder_shortcodes: 'Oxygen',
};

export interface WordPressMutationCheckInput {
  connectorId: CmsMcpConnectorId;
  toolName: string;
  pageMetaKeys?: string[];
  userConfirmed: boolean;
  snapshotCreated?: boolean;
}

export type WordPressMutationCheckResult =
  | {
      ok: true;
      detectedBuilder: string | null;
      enforcedFlags: Record<string, boolean>;
    }
  | {
      ok: false;
      code:
        | 'DANGEROUS_TOOL_BLOCKED'
        | 'BUILDER_OWNED_LAYOUT_REFUSED'
        | 'HUMAN_CONFIRMATION_REQUIRED'
        | 'SNAPSHOT_REQUIRED';
      error: string;
    };

/**
 * Enforces Production Safe rules across WordPress & Wix MCP connectors:
 * - Blocks raw PHP/SQL/plugin-deletion tools.
 * - Refuses generic REST content writes on pages owned by Elementor, Bricks, Divi, Beaver Builder, or Oxygen.
 * - Requires userConfirmed = true on mutating calls.
 * - Requires snapshotCreated = true on Respira builder mutations.
 */
export function validateCmsMcpMutation(
  input: WordPressMutationCheckInput,
): WordPressMutationCheckResult {
  const normalizedTool = (input.toolName || '').trim().toLowerCase();

  if (BLOCKED_DANGEROUS_MCP_TOOLS.has(normalizedTool)) {
    return {
      ok: false,
      code: 'DANGEROUS_TOOL_BLOCKED',
      error: `Tool "${input.toolName}" is blocked by Luminara's Production Safe MCP policy (no raw PHP, SQL, or plugin deletion).`,
    };
  }

  let detectedBuilder: string | null = null;
  for (const key of input.pageMetaKeys || []) {
    if (KNOWN_BUILDER_META_KEYS[key]) {
      detectedBuilder = KNOWN_BUILDER_META_KEYS[key]!;
      break;
    }
  }

  const isGenericContentWrite =
    normalizedTool === 'update_content' ||
    normalizedTool === 'wp_update_post' ||
    normalizedTool === 'posts_update';

  if (detectedBuilder && isGenericContentWrite) {
    return {
      ok: false,
      code: 'BUILDER_OWNED_LAYOUT_REFUSED',
      error: `Refused generic content write: this page layout is owned by ${detectedBuilder}. Use a builder-aware ability (GoBuildWP / Respira) so the layout tree is preserved.`,
    };
  }

  const isReadOnlyTool =
    normalizedTool.startsWith('list_') ||
    normalizedTool.startsWith('get_') ||
    normalizedTool.startsWith('search') ||
    normalizedTool.startsWith('read') ||
    normalizedTool.includes('check-setup') ||
    normalizedTool.includes('get-schema');

  if (!isReadOnlyTool && !input.userConfirmed) {
    return {
      ok: false,
      code: 'HUMAN_CONFIRMATION_REQUIRED',
      error: `Mutating CMS tool "${input.toolName}" requires explicit human approval (userConfirmed: true) from the Luminara Sign-off Desk.`,
    };
  }

  if (input.connectorId === 'respira_mcp' && !isReadOnlyTool && input.snapshotCreated === false) {
    return {
      ok: false,
      code: 'SNAPSHOT_REQUIRED',
      error: 'Respira MCP mutations require a mandatory before-image snapshot prior to writing.',
    };
  }

  return {
    ok: true,
    detectedBuilder,
    enforcedFlags: {
      user_confirmed: Boolean(input.userConfirmed),
      snapshot_before_write: input.connectorId === 'respira_mcp' ? true : Boolean(input.snapshotCreated),
    },
  };
}

/**
 * Builds a JSON-RPC 2.0 MCP tool call envelope for WordPress.com Official MCP
 * (`https://public-api.wordpress.com/wpcom/v2/mcp/v1`) using STRAP facade semantics.
 */
export function buildWpComMcpToolCall(args: {
  facadeTool: string;
  strapAction: 'list' | 'describe' | 'execute';
  siteIdOrDomain: string;
  ability?: string;
  parameters?: Record<string, unknown>;
  userConfirmed: boolean;
}): {
  endpoint: string;
  jsonRpcPayload: Record<string, unknown>;
} {
  return {
    endpoint: 'https://public-api.wordpress.com/wpcom/v2/mcp/v1',
    jsonRpcPayload: {
      jsonrpc: '2.0',
      id: `wpcom_${Date.now()}`,
      method: 'tools/call',
      params: {
        name: args.facadeTool,
        arguments: {
          action: args.strapAction,
          site: args.siteIdOrDomain,
          ability: args.ability,
          parameters: args.parameters ?? {},
          user_confirmed: args.userConfirmed,
        },
      },
    },
  };
}

/**
 * Builds a JSON-RPC 2.0 MCP tool call envelope for Wix Official MCP (`wix/wix-mcp`).
 */
export function buildWixMcpToolCall(args: {
  toolName: 'ListWixSites' | 'SearchWixRESTDocumentation' | 'ReadFullDocsMethodSchema' | 'CallWixSiteAPI' | 'ManageWixSite';
  siteId?: string;
  apiPath?: string;
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT';
  body?: Record<string, unknown>;
}): {
  endpoint: string;
  jsonRpcPayload: Record<string, unknown>;
} {
  return {
    endpoint: 'https://mcp.wix.com/sse',
    jsonRpcPayload: {
      jsonrpc: '2.0',
      id: `wix_${Date.now()}`,
      method: 'tools/call',
      params: {
        name: args.toolName,
        arguments: {
          siteId: args.siteId,
          path: args.apiPath,
          method: args.method ?? 'GET',
          body: args.body ?? {},
        },
      },
    },
  };
}

export async function prepareCmsMcpRemediationCall(
  env: Env,
  args: {
    accountId: string;
    projectId: string;
    connectorId: CmsMcpConnectorId;
    domain: string;
    title?: string;
    toolName?: string;
    pageMetaKeys?: string[];
    userConfirmed?: boolean;
    snapshotCreated?: boolean;
    schemaJsonLd?: string;
    parameters?: Record<string, unknown>;
  },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { accountId, projectId, connectorId, domain } = args;
  if (connectorId === 'squarespace_injection') {
    const pack = buildSquarespaceInjectionPack({
      domain,
      title: args.title || 'AEO Entity Remediation',
      schemaJsonLd: args.schemaJsonLd || '{}',
    });
    return {
      status: 200,
      body: {
        ok: true,
        connectorId,
        mode: 'squarespace_code_injection',
        pack,
      },
    };
  }

  const toolName = String(args.toolName || 'update_seo_metadata');
  const check = validateCmsMcpMutation({
    connectorId,
    toolName,
    pageMetaKeys: Array.isArray(args.pageMetaKeys) ? args.pageMetaKeys : [],
    userConfirmed: Boolean(args.userConfirmed),
    snapshotCreated: args.snapshotCreated,
  });

  if (!check.ok) {
    const fallbackBrief = classifyRemediationTier(
      {
        domain,
        findingCategory:
          check.code === 'BUILDER_OWNED_LAYOUT_REFUSED' ? 'page_builder_layout' : 'schema_jsonld',
        cmsPlatform: connectorId.includes('wix') ? 'wix' : 'wordpress',
        pageBuilderDetected: null,
        previousDeployBlocked: true,
        summary: check.error,
      },
      args.schemaJsonLd,
    );
    return {
      status: 422,
      body: {
        ok: false,
        code: check.code,
        error: check.error,
        validation: check,
        escalationDecision: fallbackBrief,
      },
    };
  }

  const rawParams = args.parameters ?? {};
  const effectCheck = await checkOrRecordExternalEffect<{
    envelope: Record<string, unknown>;
  }>(env, {
    accountId,
    projectId,
    targetSystem: connectorId,
    actionKind: toolName,
    payload: {
      domain,
      toolName,
      parameters: rawParams,
      schemaJsonLd: args.schemaJsonLd ?? '',
    },
  });

  if (effectCheck.duplicate && effectCheck.cachedResult?.envelope) {
    return {
      status: 200,
      body: {
        ok: true,
        duplicate: true,
        effectKey: effectCheck.effectKey,
        connectorId,
        detectedBuilder: check.detectedBuilder,
        enforcedFlags: check.enforcedFlags,
        validation: check,
        envelope: effectCheck.cachedResult.envelope,
      },
    };
  }

  const envelope =
    connectorId === 'wix_mcp'
      ? buildWixMcpToolCall({
          toolName: 'CallWixSiteAPI',
          siteId: domain,
          apiPath: '/wix-seo/v1/site-seo-settings',
          method: 'PATCH',
          body: Object.keys(rawParams).length ? rawParams : { schemaJsonLd: args.schemaJsonLd },
        })
      : buildWpComMcpToolCall({
          facadeTool: 'wpcom_site_management',
          strapAction: 'execute',
          siteIdOrDomain: domain,
          ability: toolName,
          parameters: {
            ...rawParams,
            ...(args.schemaJsonLd ? { luminara_aeo_schema: args.schemaJsonLd } : {}),
            ...check.enforcedFlags,
          },
          userConfirmed: Boolean(args.userConfirmed),
        });

  await finalizeExternalEffect(env, effectCheck.effectKey, accountId, { envelope });

  return {
    status: 200,
    body: {
      ok: true,
      duplicate: effectCheck.duplicate,
      effectKey: effectCheck.effectKey,
      connectorId,
      detectedBuilder: check.detectedBuilder,
      enforcedFlags: check.enforcedFlags,
      validation: check,
      envelope,
    },
  };
}

export async function handleCmsMcpRoute(
  request: Request,
  env: Env,
  user: HostedIdentity,
  path: string,
): Promise<Response | null> {
  if (!path.startsWith('/cms-mcp')) return null;
  const accountId = billingId(user);

  if (path === '/cms-mcp/catalog' && request.method === 'GET') {
    return json({
      ok: true,
      connectors: Object.values(CMS_MCP_CONNECTOR_CATALOG),
      blockedTools: [...BLOCKED_DANGEROUS_MCP_TOOLS],
    });
  }

  if (path === '/cms-mcp/connections' && request.method === 'GET') {
    const url = new URL(request.url);
    const projectId = (url.searchParams.get('projectId') || 'default').trim();
    if (!env.DB) return json({ ok: true, projectId, connections: [] });
    const rows = await env.DB.prepare(
      `SELECT effect_key, target_system as connector_id, result_json, created_at, updated_at
       FROM external_effects
       WHERE account_id = ? AND project_id = ? AND action_kind = 'register_cms_connection'
       ORDER BY updated_at DESC LIMIT 50`,
    )
      .bind(accountId, projectId)
      .all<Record<string, unknown>>();
    return json({ ok: true, projectId, connections: rows.results || [] });
  }

  if (path === '/cms-mcp/connections' && request.method === 'POST') {
    const parsed = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);
    const body = parsed.value as {
      projectId?: string;
      connectorId?: CmsMcpConnectorId;
      domain?: string;
      siteUrl?: string;
      endpointUrl?: string;
    } | null;
    const domain = String(body?.domain || body?.siteUrl || '').trim();
    if (!body?.connectorId || !domain || !(body.connectorId in CMS_MCP_CONNECTOR_CATALOG)) {
      return json({ ok: false, error: 'Valid connectorId and domain are required' }, 400);
    }
    const projectId = String(body.projectId || 'default').trim();
    const effectCheck = await checkOrRecordExternalEffect<Record<string, unknown>>(env, {
      accountId,
      projectId,
      targetSystem: body.connectorId,
      actionKind: 'register_cms_connection',
      payload: { domain, endpointUrl: body.endpointUrl || '' },
    });
    if (effectCheck.duplicate && effectCheck.cachedResult) {
      return json({
        ok: true,
        duplicate: true,
        effectKey: effectCheck.effectKey,
        connection: effectCheck.cachedResult,
      });
    }
    const connection = {
      connectorId: body.connectorId,
      domain,
      endpointUrl: body.endpointUrl || CMS_MCP_CONNECTOR_CATALOG[body.connectorId].endpointHint,
    };
    await finalizeExternalEffect(env, effectCheck.effectKey, accountId, connection);
    return json({ ok: true, duplicate: false, effectKey: effectCheck.effectKey, connection }, 201);
  }

  if (path === '/cms-mcp/classify' && request.method === 'POST') {
    const parsed = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);
    const body = parsed.value as {
      finding?: RemediationFindingInput;
      preparedSchemaSnippet?: string;
    } | null;
    if (!body?.finding || !body.finding.domain) {
      return json({ ok: false, error: 'finding.domain is required' }, 400);
    }

    const decision = classifyRemediationTier(body.finding, body.preparedSchemaSnippet);
    return json({ ok: true, decision });
  }

  if (path === '/cms-mcp/prepare-call' && request.method === 'POST') {
    const parsed = await readBody(request, MAX_SMALL_BODY_BYTES);
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status);
    const body = parsed.value as {
      projectId?: string;
      connectorId?: CmsMcpConnectorId;
      domain?: string;
      title?: string;
      toolName?: string;
      pageMetaKeys?: string[];
      userConfirmed?: boolean;
      snapshotCreated?: boolean;
      schemaJsonLd?: string;
      parameters?: Record<string, unknown>;
    } | null;
    if (!body?.connectorId || !body?.domain) {
      return json({ ok: false, error: 'connectorId and domain are required' }, 400);
    }
    if (!(body.connectorId in CMS_MCP_CONNECTOR_CATALOG)) {
      return json({ ok: false, error: `Unknown connectorId "${String(body.connectorId)}"` }, 400);
    }

    const res = await prepareCmsMcpRemediationCall(env, {
      accountId,
      projectId: String(body.projectId || 'default').trim(),
      connectorId: body.connectorId,
      domain: body.domain,
      title: body.title,
      toolName: body.toolName,
      pageMetaKeys: Array.isArray(body.pageMetaKeys) ? body.pageMetaKeys : [],
      userConfirmed: Boolean(body.userConfirmed),
      snapshotCreated: body.snapshotCreated,
      schemaJsonLd: body.schemaJsonLd,
      parameters: body.parameters,
    });
    return json(res.body, res.status);
  }

  return json({ error: 'Method not allowed' }, 405);
}
