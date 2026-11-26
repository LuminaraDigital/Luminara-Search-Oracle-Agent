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
import { validateCmsEndpoint } from '../services/deployment/cmsEndpointValidator';
import { schemaSafetyGate } from '../services/deployment/schemaSafetyGate';
export { CMS_MCP_CONNECTOR_CATALOG, type CmsMcpConnectorId };
import { checkOrRecordExternalEffect, finalizeExternalEffect } from './externalEffectsService';

/**
 * Strict fail-closed allowlist of permitted CMS MCP tools mapped to read or write.
 * Any tool not explicitly listed here is rejected with DANGEROUS_TOOL_BLOCKED.
 */
export const ALLOWED_CMS_MCP_TOOLS: Readonly<Record<string, 'read' | 'write'>> = {
  // Read-only inspection tools
  wpcom_get_posts: 'read',
  wpcom_get_pages: 'read',
  wpcom_get_site: 'read',
  wpcom_list_posts: 'read',
  wpcom_check_setup: 'read',
  wppilot_get_blocks: 'read',
  wppilot_get_page: 'read',
  wppilot_list_pages: 'read',
  wppilot_get_schema: 'read',
  respira_get_page: 'read',
  respira_list_pages: 'read',
  instawp_get_posts: 'read',
  instawp_get_seo_metadata: 'read',
  listwixsites: 'read',
  searchwixrestdocumentation: 'read',
  readfulldocsmethodschema: 'read',
  get_seo_metadata: 'read',
  get_page_schema: 'read',
  list_posts: 'read',
  list_pages: 'read',
  // Write / mutation tools (require human confirmation; Respira writes also require snapshot)
  update_seo_metadata: 'write',
  update_schema_jsonld: 'write',
  update_llms_txt: 'write',
  wp_update_post: 'write',
  update_content: 'write',
  posts_update: 'write',
  wpcom_create_draft_post: 'write',
  wpcom_update_post_meta: 'write',
  wpcom_site_management: 'write',
  wppilot_patch_block: 'write',
  wppilot_update_seo_meta: 'write',
  elementor_patch_widget: 'write',
  bricks_patch_element: 'write',
  divi_patch_module: 'write',
  respira_patch_element: 'write',
  respira_create_snapshot: 'write',
  instawp_update_yoast_meta: 'write',
  callwixsiteapi: 'write',
  managewixsite: 'write',
};

function normalizePublicSiteUrl(domainOrUrl: string): string {
  const trimmed = String(domainOrUrl || '').trim();
  if (!trimmed) return '';
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

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
  const toolAccess = Object.hasOwn(ALLOWED_CMS_MCP_TOOLS, normalizedTool)
    ? ALLOWED_CMS_MCP_TOOLS[normalizedTool]
    : null;

  if (!toolAccess) {
    return {
      ok: false,
      code: 'DANGEROUS_TOOL_BLOCKED',
      error: `Tool "${input.toolName}" is not in Luminara's allowlisted CMS MCP tool catalog and is blocked by fail-closed policy.`,
    };
  }

  let detectedBuilder: string | null = null;
  for (const key of input.pageMetaKeys || []) {
    if (Object.hasOwn(KNOWN_BUILDER_META_KEYS, key)) {
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

  const isReadOnlyTool = toolAccess === 'read';

  if (!isReadOnlyTool && input.userConfirmed !== true) {
    return {
      ok: false,
      code: 'HUMAN_CONFIRMATION_REQUIRED',
      error: `Mutating CMS tool "${input.toolName}" requires explicit human approval (userConfirmed: true) from the Luminara Sign-off Desk.`,
    };
  }

  if (
    input.connectorId === 'respira_mcp' &&
    !isReadOnlyTool &&
    normalizedTool !== 'respira_create_snapshot' &&
    input.snapshotCreated !== true
  ) {
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
      user_confirmed: input.userConfirmed === true,
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
    endpointUrl?: string;
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
  if (!connectorId || !Object.hasOwn(CMS_MCP_CONNECTOR_CATALOG, connectorId)) {
    return { status: 400, body: { ok: false, error: `Unknown connectorId "${String(connectorId)}"` } };
  }

  const domainCheck = validateCmsEndpoint(normalizePublicSiteUrl(domain));
  if (!domainCheck.ok) {
    return {
      status: 400,
      body: { ok: false, code: 'INVALID_CMS_ENDPOINT', error: domainCheck.error },
    };
  }
  if (args.endpointUrl !== undefined && args.endpointUrl !== '') {
    const endpointCheck = validateCmsEndpoint(args.endpointUrl);
    if (!endpointCheck.ok) {
      return {
        status: 400,
        body: { ok: false, code: 'INVALID_CMS_ENDPOINT', error: endpointCheck.error },
      };
    }
  }

  let safeSchemaJsonLd = args.schemaJsonLd;
  if (typeof args.schemaJsonLd === 'string' && args.schemaJsonLd.trim().length > 0) {
    const schemaCheck = schemaSafetyGate.validate(args.schemaJsonLd);
    if (!schemaCheck.okToDeploy || !schemaCheck.canonicalJson) {
      return {
        status: 422,
        body: {
          ok: false,
          code: 'SCHEMA_SAFETY_BLOCKED',
          error: schemaCheck.issues.map((i) => i.message).join(' ') || 'Schema JSON-LD failed safety validation.',
          issues: schemaCheck.issues,
        },
      };
    }
    safeSchemaJsonLd = schemaCheck.canonicalJson;
  }

  if (connectorId === 'squarespace_injection') {
    const schemaCheck = schemaSafetyGate.validate(safeSchemaJsonLd || '');
    if (!schemaCheck.okToDeploy || !schemaCheck.canonicalJson) {
      return {
        status: 422,
        body: {
          ok: false,
          code: 'SCHEMA_SAFETY_BLOCKED',
          error: schemaCheck.issues.map((i) => i.message).join(' ') || 'Valid Schema JSON-LD is required.',
          issues: schemaCheck.issues,
        },
      };
    }
    const pack = buildSquarespaceInjectionPack({
      domain,
      title: args.title || 'AEO Entity Remediation',
      schemaJsonLd: schemaCheck.canonicalJson,
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
    userConfirmed: args.userConfirmed === true,
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
      safeSchemaJsonLd,
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
      schemaJsonLd: safeSchemaJsonLd ?? '',
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
          body: Object.keys(rawParams).length ? rawParams : { schemaJsonLd: safeSchemaJsonLd },
        })
      : buildWpComMcpToolCall({
          facadeTool: 'wpcom_site_management',
          strapAction: 'execute',
          siteIdOrDomain: domain,
          ability: toolName,
          parameters: {
            ...rawParams,
            ...(safeSchemaJsonLd ? { luminara_aeo_schema: safeSchemaJsonLd } : {}),
            ...check.enforcedFlags,
          },
          userConfirmed: args.userConfirmed === true,
        });

  const envelopeEndpointCheck = validateCmsEndpoint(envelope.endpoint);
  if (!envelopeEndpointCheck.ok) {
    return {
      status: 400,
      body: { ok: false, code: 'INVALID_CMS_ENDPOINT', error: envelopeEndpointCheck.error },
    };
  }

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
      allowedTools: ALLOWED_CMS_MCP_TOOLS,
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
    if (!body?.connectorId || !domain || !Object.hasOwn(CMS_MCP_CONNECTOR_CATALOG, body.connectorId)) {
      return json({ ok: false, error: 'Valid connectorId and domain are required' }, 400);
    }
    const siteCheck = validateCmsEndpoint(normalizePublicSiteUrl(domain));
    if (!siteCheck.ok) {
      return json({ ok: false, code: 'INVALID_CMS_ENDPOINT', error: siteCheck.error }, 400);
    }
    const rawEndpoint =
      typeof body.endpointUrl === 'string' && body.endpointUrl.trim()
        ? body.endpointUrl.trim()
        : CMS_MCP_CONNECTOR_CATALOG[body.connectorId].endpointHint;
    let validatedEndpoint = rawEndpoint;
    if (body.connectorId !== 'squarespace_injection' || (typeof body.endpointUrl === 'string' && body.endpointUrl.trim())) {
      const endpointCheck = validateCmsEndpoint(rawEndpoint);
      if (!endpointCheck.ok) {
        return json({ ok: false, code: 'INVALID_CMS_ENDPOINT', error: endpointCheck.error }, 400);
      }
      validatedEndpoint = endpointCheck.url;
    }
    const projectId = String(body.projectId || 'default').trim();
    const effectCheck = await checkOrRecordExternalEffect<Record<string, unknown>>(env, {
      accountId,
      projectId,
      targetSystem: body.connectorId,
      actionKind: 'register_cms_connection',
      payload: { domain, endpointUrl: validatedEndpoint },
    });
    if (effectCheck.duplicate) {
      if (effectCheck.cachedResult) {
        return json({
          ok: true,
          duplicate: true,
          effectKey: effectCheck.effectKey,
          connection: effectCheck.cachedResult,
        });
      }
      return json(
        {
          ok: false,
          code: 'EFFECT_IN_PROGRESS',
          error: 'Connection registration is already in progress. Retry shortly.',
        },
        409,
      );
    }
    const connection = {
      connectorId: body.connectorId,
      domain,
      endpointUrl: validatedEndpoint,
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
      endpointUrl?: string;
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
    if (!Object.hasOwn(CMS_MCP_CONNECTOR_CATALOG, body.connectorId)) {
      return json({ ok: false, error: `Unknown connectorId "${String(body.connectorId)}"` }, 400);
    }

    const res = await prepareCmsMcpRemediationCall(env, {
      accountId,
      projectId: String(body.projectId || 'default').trim(),
      connectorId: body.connectorId,
      domain: body.domain,
      endpointUrl: body.endpointUrl,
      title: body.title,
      toolName: body.toolName,
      pageMetaKeys: Array.isArray(body.pageMetaKeys) ? body.pageMetaKeys : [],
      userConfirmed: body.userConfirmed === true,
      snapshotCreated: body.snapshotCreated,
      schemaJsonLd: body.schemaJsonLd,
      parameters: body.parameters,
    });
    return json(res.body, res.status);
  }

  return json({ error: 'Method not allowed' }, 405);
}
