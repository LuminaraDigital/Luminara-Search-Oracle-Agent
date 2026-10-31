import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import {
  CMS_MCP_CONNECTOR_CATALOG,
  buildLuminaraDigitalBrief,
  buildSquarespaceInjectionPack,
  classifyRemediationTier,
} from '../services/deployment/remediationTierRouter';
import {
  buildWixMcpToolCall,
  buildWpComMcpToolCall,
  handleCmsMcpRoute,
  validateCmsMcpMutation,
} from '../worker/cmsMcpRelay';
import {
  BrowserActionLoop,
  MASKED_VALUE,
  classifyBotBlockPage,
  evaluateCelestoBrowserActionPolicy,
  maskSensitiveInputValue,
  resolvePointerBenchFallback,
  shouldTriggerVisionFallback,
  type ObservePayload,
} from '../services/browserAction/index';
import {
  SUBAGENT_ROLE_CATALOG,
  agentMatrixService,
  validateSubAgentOutput,
} from '../services/harness/agentMatrixService';
import { handleMcpRequest } from '../worker/mcpServer';
import { createSqliteD1 } from './helpers/sqliteD1';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';

const require = createRequire(import.meta.url);
const {
  createDesktopCoordinator,
  evaluateNoAgentRoutineProbe,
  resolveBrowserProfileDir,
  validateDesktopMcpInvocation,
} = require('../electron/coordinator/desktopCoordinator.cjs');

const TEST_USER: HostedIdentity = {
  id: 'usr_cms_1',
  email: 'dev@luminarasuite.com',
  plan: 'agency',
};

describe('Stage 3: 3-Tier CMS Remediation Router, MCP Relay & luminara.digital Funnel', () => {
  it('catalogues WordPress.com Official MCP, GoBuildWP, Respira, InstaWP, Wix MCP, and Squarespace Injection', () => {
    const ids = Object.keys(CMS_MCP_CONNECTOR_CATALOG);
    expect(ids).toEqual([
      'wordpress_com_mcp',
      'gobuildwp_mcp',
      'respira_mcp',
      'instawp_mcp',
      'wix_mcp',
      'squarespace_injection',
      'webflow_api',
      'github_pr',
    ]);
  });

  it('classifies safe metadata into Tier 1, builder-locked into Tier 2, and SSR/CWV into Tier 3', () => {
    const t1 = classifyRemediationTier({
      domain: 'harbourrealty.com.au',
      findingCategory: 'meta_tags',
      cmsPlatform: 'wordpress',
      summary: 'Update suburb canonical and title metadata',
    });
    expect(t1.tier).toBe('tier_1_instant_mcp');
    expect(t1.recommendedConnectors).toContain('wordpress_com_mcp');

    const t2 = classifyRemediationTier({
      domain: 'harbourrealty.com.au',
      findingCategory: 'page_builder_layout',
      cmsPlatform: 'wordpress',
      pageBuilderDetected: 'elementor',
      summary: 'Add FAQ accordion block inside Elementor template',
    });
    expect(t2.tier).toBe('tier_2_guided_builder');
    expect(t2.recommendedConnectors).toContain('respira_mcp');

    const t3 = classifyRemediationTier({
      domain: 'harbourrealty.com.au',
      findingCategory: 'ssr_hydration',
      cmsPlatform: 'custom',
      summary: 'Prerender client-hydrated property listings for AI crawlers',
    });
    expect(t3.tier).toBe('tier_3_luminara_digital_engineering');
    expect(t3.engineeringBrief?.partnerUrl).toContain('https://luminara.digital');
  });

  it('generates a luminara.digital engineering scope brief and Squarespace Code Injection Pack', () => {
    const brief = buildLuminaraDigitalBrief({
      domain: 'harbourrealty.com.au',
      findingCategory: 'cwv_performance',
      cmsPlatform: 'squarespace',
      summary: 'Sub-2.5s LCP Hero Hydration Bottleneck',
    });
    expect(brief.partnerUrl).toContain('https://luminara.digital/?utm_source=luminarasuite');
    expect(brief.headline).toContain('harbourrealty.com.au');
    expect(brief.architecturalReason).not.toContain('\u2014');

    const sqsp = buildSquarespaceInjectionPack({
      domain: 'harbourrealty.com.au',
      title: 'Harbour Realty',
      schemaJsonLd: '{"@context":"https://schema.org","@type":"RealEstateAgent"}',
    });
    expect(sqsp.headerInjectionHtml).toContain('application/ld+json');
    expect(sqsp.navigationSteps[1]).toContain('Code Injection');
  });

  it('enforces GoBuildWP builder-aware refusal, blocks raw PHP/SQL tools, and validates connectorId at HTTP boundary', async () => {
    const blockedPhp = validateCmsMcpMutation({
      connectorId: 'instawp_mcp',
      toolName: 'execute-php',
      userConfirmed: true,
    });
    expect(blockedPhp.ok).toBe(false);
    if (!blockedPhp.ok) {
      expect(blockedPhp.code).toBe('DANGEROUS_TOOL_BLOCKED');
    }

    const builderLocked = validateCmsMcpMutation({
      connectorId: 'gobuildwp_mcp',
      toolName: 'wp_update_post',
      pageMetaKeys: ['_elementor_edit_mode'],
      userConfirmed: true,
    });
    expect(builderLocked.ok).toBe(false);
    if (!builderLocked.ok) {
      expect(builderLocked.code).toBe('BUILDER_OWNED_LAYOUT_REFUSED');
    }

    const respiraNoSnapshot = validateCmsMcpMutation({
      connectorId: 'respira_mcp',
      toolName: 'elementor_patch_widget',
      pageMetaKeys: ['_elementor_edit_mode'],
      userConfirmed: true,
      snapshotCreated: false,
    });
    expect(respiraNoSnapshot.ok).toBe(false);
    if (!respiraNoSnapshot.ok) {
      expect(respiraNoSnapshot.code).toBe('SNAPSHOT_REQUIRED');
    }

    const respiraWithSnapshot = validateCmsMcpMutation({
      connectorId: 'respira_mcp',
      toolName: 'elementor_patch_widget',
      pageMetaKeys: ['_elementor_edit_mode'],
      userConfirmed: true,
      snapshotCreated: true,
    });
    expect(respiraWithSnapshot.ok).toBe(true);

    const wpEnvelope = buildWpComMcpToolCall({
      facadeTool: 'wpcom_site_management',
      strapAction: 'execute',
      siteIdOrDomain: 'example.wordpress.com',
      ability: 'wpcom_create_draft_post',
      parameters: { title: 'Suburb Guide' },
      userConfirmed: true,
    });
    expect(wpEnvelope.endpoint).toBe('https://public-api.wordpress.com/wpcom/v2/mcp/v1');

    const wixEnvelope = buildWixMcpToolCall({
      toolName: 'CallWixSiteAPI',
      siteId: 'site_123',
      apiPath: '/wix-data/v2/items/query',
      method: 'POST',
    });
    expect((wixEnvelope.jsonRpcPayload.params as { name: string }).name).toBe('CallWixSiteAPI');

    // Rejects unknown connectorId at Worker HTTP boundary
    const badConnectorReq = new Request('https://luminarasuite.com/api/cms-mcp/prepare-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connectorId: 'unknown_cms', domain: 'harbourrealty.com.au' }),
    });
    const badConnectorRes = await handleCmsMcpRoute(
      badConnectorReq,
      {} as Env,
      TEST_USER,
      '/cms-mcp/prepare-call',
    );
    expect(badConnectorRes?.status).toBe(400);
  });
});

describe('Stage 4: Grokbot Bot-Block Detection, OpenMausBot Secret Masking & PointerBench 1024x768 Fallback', () => {
  it('detects Cloudflare / CAPTCHA / WAF bot blocks and halts BrowserActionLoop immediately on predict()', async () => {
    const blocked = classifyBotBlockPage({
      title: 'Just a moment...',
      text: 'Checking if the site connection is secure. Verify you are human.',
    });
    expect(blocked.blockedByBotProtection).toBe(true);
    expect(blocked.matchedSignature).toBe('just a moment...');

    const chooseSpy = vi.fn();
    const loop = new BrowserActionLoop({
      goal: 'Update homepage schema',
      initialPage: {
        url: 'https://harbourrealty.com.au/wp-admin',
        title: 'Just a moment...',
        text: 'Checking if the site connection is secure. Verify you are human.',
        actions: [{ id: 'a1', kind: 'click', label: 'Verify', node: 'n1' }],
        fingerprint: 'fp_cf_1',
      },
      observe: async () => {
        throw new Error('Should not re-observe');
      },
      executeAct: async () => {
        throw new Error('Should not executeAct on bot block');
      },
      chooseFn: chooseSpy,
    });

    await loop.tick();
    expect(loop.state.status).toBe('blocked');
    expect(chooseSpy).not.toHaveBeenCalled();
  });

  it('masks sensitive input values with OpenMausBot MASKED_VALUE sentinel inside BrowserActionLoop history and text_calls', async () => {
    expect(maskSensitiveInputValue('Application Password', 'super-secret-123')).toBe(MASKED_VALUE);
    expect(maskSensitiveInputValue('API Key', 'sk_live_999')).toBe(MASKED_VALUE);
    expect(maskSensitiveInputValue('Suburb Search', 'Bondi Beach')).toBe('Bondi Beach');

    const page1: ObservePayload = {
      url: 'https://harbourrealty.com.au/wp-login.php',
      title: 'Log In',
      text: 'Enter Application Password',
      actions: [{ id: 'pwd_1', kind: 'fill', label: 'Application Password', node: 'n1' }],
      fingerprint: 'fp_login_1',
    };
    const page2: ObservePayload = { ...page1, fingerprint: 'fp_login_2' };

    let rawReceivedByBrowser: string | undefined;
    const loop = new BrowserActionLoop({
      goal: 'Enter application password',
      initialPage: page1,
      observe: async () => page2,
      executeAct: async (req) => {
        rawReceivedByBrowser = req.text;
        return page2;
      },
      chooseFn: async () => ({
        choice: 'pwd_1',
        operation: 'TYPE_TEXT',
        target: '0',
        confidence: 0.99,
        probabilities: { pwd_1: 0.99 },
        operation_probabilities: { TYPE_TEXT: 0.99 },
      }),
      fieldLlm: async () => JSON.stringify({ text: 'my-real-wp-app-password-999' }),
    });

    await loop.tick();
    expect(rawReceivedByBrowser).toBe('my-real-wp-app-password-999');
    expect(loop.state.history[0]?.text).toBe(MASKED_VALUE);
    expect(loop.state.text_calls[0]?.value).toBe(MASKED_VALUE);
  });

  it('triggers PointerBench 1024x768 fallback on 0 DOM actions and rejects normalized [0,1] coords', async () => {
    const emptyDomPage = {
      url: 'https://agency.example.com/canvas-map',
      title: 'Interactive Property Map',
      text: 'Canvas view',
      actions: [],
      fingerprint: 'fp_canvas_1',
    };

    const triggerCheck = shouldTriggerVisionFallback(emptyDomPage, []);
    expect(triggerCheck.trigger).toBe(true);

    const normalizedAttempt = await resolvePointerBenchFallback({
      goal: 'Click the Appraisal button on the canvas',
      page: emptyDomPage,
      history: [],
      plannerIntent: {
        action: 'click',
        target: 'Book Appraisal button in top right',
      },
      visionPointerCall: async () => '{"point": [0.45, 0.22]}',
    });
    expect(normalizedAttempt.triggered).toBe(true);
    expect(normalizedAttempt.ok).toBe(false);

    const validAttempt = await resolvePointerBenchFallback({
      goal: 'Click the Appraisal button on the canvas',
      page: emptyDomPage,
      history: [],
      plannerIntent: {
        action: 'click',
        target: 'Book Appraisal button in top right',
      },
      visionPointerCall: async () => '{"point": [820, 140]}',
    });
    expect(validAttempt.triggered).toBe(true);
    expect(validAttempt.ok).toBe(true);
    expect(validAttempt.point).toEqual([820, 140]);
  });
});

describe('Stage 4: Hermes-Class Desktop Coordinator (Electron Main Process)', () => {
  it('sanitizes browser profile paths and blocks path traversal', () => {
    const resolved = resolveBrowserProfileDir('/tmp/luminara-userdata', 'agency-client_01');
    expect(resolved.profileId).toBe('agency-client_01');
    expect(resolved.profilePath).toContain('agency-client_01');
    const sanitizedTraversal = resolveBrowserProfileDir('/tmp/luminara-userdata', '../../../etc');
    expect(sanitizedTraversal.profileId).toBe('etc');
  });

  it('enforces desktop MCP connector & tool allowlists across canonical CMS_MCP_CONNECTOR_CATALOG IDs', () => {
    expect(
      validateDesktopMcpInvocation({
        connectorId: 'wordpress_com_mcp',
        toolName: 'wpcom_get_posts',
        isWriteOperation: false,
      }).allowed,
    ).toBe(true);

    expect(
      validateDesktopMcpInvocation({
        connectorId: 'gobuildwp_mcp',
        toolName: 'wppilot_get_blocks',
        isWriteOperation: false,
      }).allowed,
    ).toBe(true);

    expect(
      validateDesktopMcpInvocation({
        connectorId: 'unknown_shell_mcp',
        toolName: 'run',
      }).allowed,
    ).toBe(false);

    expect(
      validateDesktopMcpInvocation({
        connectorId: 'instawp_mcp',
        toolName: 'wp_execute_php',
        isWriteOperation: true,
        userConfirmed: true,
      }).allowed,
    ).toBe(false);
  });

  it('runs Hermes-style no-agent deterministic routine probes and blocks private/loopback SSRF URLs', async () => {
    const coordinator = createDesktopCoordinator({
      userDataDir: '/tmp/luminara-test',
    });

    expect(() =>
      coordinator.upsertRoutine({
        name: 'Loopback SSRF Attempt',
        targetUrl: 'http://127.0.0.1:8080/admin',
      }),
    ).toThrow(/private\/loopback hosts blocked/i);

    const routine = coordinator.upsertRoutine({
      name: 'Client Schema & Robots Check',
      targetUrl: 'https://harbourrealty.com.au',
      mode: 'no-agent',
      expectedStatus: 200,
      requiredSubstrings: ['application/ld+json'],
    });

    const healthyRun = await coordinator.runRoutineOnce(routine.id, {
      status: 200,
      body: '<html><head><script type="application/ld+json">{}</script></head></html>',
    });
    expect(healthyRun.healthy).toBe(true);
    expect(healthyRun.llmEscalated).toBe(false);
    expect(healthyRun.tokensUsed).toBe(0);

    const driftRun = evaluateNoAgentRoutineProbe(routine, {
      status: 200,
      body: '<html><head><title>Missing Schema</title></head></html>',
    });
    expect(driftRun.healthy).toBe(false);
    expect(driftRun.llmEscalated).toBe(true);
    expect(driftRun.driftReason).toContain('application/ld+json');
  });

  it('enforces Celesto 2-tier browser policy, Hermes sub-agent matrix validation, and disk persistence', async () => {
    // 1. Celesto 2-tier policy & hard-banned Take Control fields
    const otpCheck = evaluateCelestoBrowserActionPolicy({
      kind: 'fill',
      label: 'Enter 2FA Verification Code',
    });
    expect(otpCheck.allowed).toBe(false);
    expect(otpCheck.tier).toBe('hard_banned_take_control');
    expect(otpCheck.requiresHumanTakeControl).toBe(true);

    const writeGate = evaluateCelestoBrowserActionPolicy(
      {
        kind: 'click',
        label: 'Publish Changes',
      },
      { writeApproved: false },
    );
    expect(writeGate.allowed).toBe(false);
    expect(writeGate.tier).toBe('tier_2_write');

    // 2. Hermes Sub-Agent Matrix role delegation & output validation
    expect(Object.keys(SUBAGENT_ROLE_CATALOG)).toEqual([
      'researcher',
      'cms_patcher',
      'enquiry_qualifier',
    ]);
    expect(
      validateSubAgentOutput('cms_patcher', {
        tier: 'tier_1_instant_mcp',
        connectorId: 'wordpress_com_mcp',
        patchPayload: { title: 'Updated' },
        requiresHumanApproval: true,
      }).ok,
    ).toBe(true);
    expect(validateSubAgentOutput('cms_patcher', { tier: 'invalid_tier' }).ok).toBe(false);

    const delegated = await agentMatrixService.delegateTask({
      role: 'enquiry_qualifier',
      goal: 'Qualify Bondi seller enquiry',
      contextSlice: { suburb: 'Bondi Beach' },
    });
    expect(delegated.ok).toBe(true);

    // 3. Desktop Coordinator disk persistence + IPv6 SSRF protection
    const tempDir = mkdtempSync(join(tmpdir(), 'luminara-coord-'));
    try {
      const c1 = createDesktopCoordinator({ userDataDir: tempDir, persistToDisk: true });
      c1.upsertRoutine({
        id: 'rt_persist_1',
        name: 'Persisted Routine',
        targetUrl: 'https://luminarasuite.com',
      });
      expect(() =>
        c1.upsertRoutine({
          name: 'IPv6 Loopback SSRF',
          targetUrl: 'http://[::1]:8788/session',
        }),
      ).toThrow(/private\/loopback hosts blocked/i);

      const c2 = createDesktopCoordinator({ userDataDir: tempDir, persistToDisk: true });
      expect(c2.listRoutines().some((r: { id: string }) => r.id === 'rt_persist_1')).toBe(true);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }

    // 4. MCP classify_cms_remediation tool
    const env = {
      DB: createSqliteD1(),
      LUMINARA_KV: {
        get: async () => null,
        put: async () => {},
        delete: async () => {},
      } as unknown as KVNamespace,
    } as Env;
    const mcpRes = await handleMcpRequest(
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 202,
          method: 'tools/call',
          params: {
            name: 'classify_cms_remediation',
            arguments: {
              summary: 'Custom Next.js Headless Migration & Multi-Step CRM Funnel',
              findingCategory: 'ssr_hydration',
              cmsPlatform: 'custom',
              domain: 'harbourrealty.com.au',
            },
          },
        }),
      }),
      env,
      TEST_USER,
    );
    const mcpBody = (await mcpRes.json()) as {
      result?: { structuredContent?: { decision?: { tier?: string } } };
    };
    expect(mcpBody.result?.structuredContent?.decision?.tier).toBe('tier_3_luminara_digital_engineering');

    // 5. Pass 3 regression: bare "Password" blocked as hard_banned_take_control while "Application Password" allowed
    const barePwd = evaluateCelestoBrowserActionPolicy({
      kind: 'fill',
      label: 'Password',
    });
    expect(barePwd.allowed).toBe(false);
    expect(barePwd.tier).toBe('hard_banned_take_control');

    const appPwd = evaluateCelestoBrowserActionPolicy({
      kind: 'fill',
      label: 'Application Password',
    });
    expect(appPwd.allowed).toBe(true);

    // 6. Pass 3 regression: BrowserActionLoop executes POINTERBENCH_POINT when visionFallback resolves on empty DOM
    const emptyCanvasPage: ObservePayload = {
      url: 'https://agency.example.com/canvas',
      title: 'Canvas Booking Widget',
      text: 'Interactive canvas',
      actions: [],
      fingerprint: 'fp_canvas_loop_1',
    };
    const nextCanvasPage: ObservePayload = {
      ...emptyCanvasPage,
      fingerprint: 'fp_canvas_loop_2',
    };
    let capturedPoint: readonly [number, number] | undefined;
    let capturedActionId: string | undefined;
    const canvasLoop = new BrowserActionLoop({
      goal: 'Click the canvas Book button',
      initialPage: emptyCanvasPage,
      observe: async () => nextCanvasPage,
      executeAct: async (req) => {
        capturedActionId = req.actionId;
        capturedPoint = req.point;
        return nextCanvasPage;
      },
      chooseFn: async () => ({
        choice: 'NONE',
        operation: 'STOP',
        target: '0',
        confidence: 0,
        probabilities: {},
        operation_probabilities: {},
      }),
      visionFallback: async () => ({
        triggered: true,
        ok: true,
        reason: 'Zero indexed DOM actions',
        point: [640, 320],
      }),
    });
    await canvasLoop.tick();
    expect(capturedActionId).toBe('POINTERBENCH_POINT');
    expect(capturedPoint).toEqual([640, 320]);

    // 7. Pass 3 regression: GET /cms-mcp/connections and POST /cms-mcp/connections
    const postConnRes = await handleCmsMcpRoute(
      new Request('https://luminarasuite.com/api/cms-mcp/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'proj_cms_1',
          connectorId: 'wordpress_com_mcp',
          siteUrl: 'https://harbourrealty.com.au',
          status: 'connected',
        }),
      }),
      env,
      TEST_USER,
      '/cms-mcp/connections',
    );
    expect([200, 201]).toContain(postConnRes?.status);
    const getConnRes = await handleCmsMcpRoute(
      new Request('https://luminarasuite.com/api/cms-mcp/connections?projectId=proj_cms_1'),
      env,
      TEST_USER,
      '/cms-mcp/connections',
    );
    expect(getConnRes?.status).toBe(200);

    // 8. Pass 4 regression: storeSecret return contract & delegateTask task recording + invalid role guard
    const tempSecDir = mkdtempSync(join(tmpdir(), 'luminara-sec-'));
    try {
      const noKeychain = createDesktopCoordinator({ userDataDir: tempSecDir, persistToDisk: false });
      expect(() => noKeychain.storeSecret('wp_app_pwd', 'sec_val_123')).toThrow(/secure storage/);
      expect(noKeychain.hasSecret('wp_app_pwd')).toBe(false);

      const secCoord = createDesktopCoordinator({
        userDataDir: tempSecDir,
        persistToDisk: false,
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: (value: string) => Buffer.from(`sealed:${value}`),
        },
      });
      const secStored = secCoord.storeSecret('wp_app_pwd', 'sec_val_123');
      expect(secStored.stored).toBe(true);
      expect(secStored.encrypted).toBe(true);
      expect(secCoord.hasSecret('wp_app_pwd')).toBe(true);
    } finally {
      rmSync(tempSecDir, { recursive: true, force: true });
    }

    const badRoleRes = await agentMatrixService.delegateTask({
      role: 'unknown_role' as unknown as 'researcher',
      goal: 'Test unknown role',
      contextSlice: {},
    });
    expect(badRoleRes.ok).toBe(false);
    expect(agentMatrixService.getTasks().length).toBeGreaterThan(0);
  });
});
