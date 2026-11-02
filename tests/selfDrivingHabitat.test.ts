/**
 * End-to-end unit and integration tests for the Replit Self-Driving Company Agentic Loop (Phase 7):
 * - Pillar 1: Review-to-Skill Feedback Compiler (`compileFeedbackIntoSkillRule` + MCP denial auto-compilation)
 * - Pillar 2: Pre-Verified PR & Staging Handoff Bundle (`buildVerifiedRemediationPrBundle`)
 * - Pillar 3: Agent Habitat Ephemeral Scoped Credentials (`lm_hab_*`) & Risk/Project Boundary Enforcement
 * - Pillar 4: Coasean Cross-Role Handoff Packet (`buildCoaseanHandoffPacket` + `create_dev_ticket_from_finding`)
 *
 * No em dashes in copy.
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';
import { buildVerifiedRemediationPrBundle } from '../services/deployment/remediationTierRouter';
import {
  buildCoaseanHandoffPacket,
  compileFeedbackIntoSkillRule,
  getAgentHabitatStatus,
  handleAgentHabitatRoute,
  identifyHabitatToken,
  mintHabitatToken,
  SELF_DRIVING_MCP_TOOLS,
} from '../worker/selfDrivingHabitat';
import { createProject } from '../worker/projectService';
import { getProjectContext } from '../worker/projectContextService';
import { saveAgentReport } from '../worker/agentReportService';
import { recallUnifiedContext } from '../worker/unifiedMemoryRouter';
import { handleMcpRequest } from '../worker/mcpServer';
import { resolveMcpUser } from '../worker/apiAccess';
import { guardApiRoute } from '../worker/authMiddleware';
import { TOOL_GOVERNANCE, createActionRequest } from '../worker/mcpGovernance';
import { SelfDrivingHabitatBar } from '../components/audit/SelfDrivingHabitatBar';

function makeEnv(overrides: Partial<Env> = {}): Env {
  const db = createSqliteD1();
  const kvMap = new Map<string, string>();
  kvMap.set(
    'sub:acc_growth',
    JSON.stringify({ plan: 'growth', expiresAt: Date.now() + 30 * 86400000 }),
  );
  const kv = {
    get: async (key: string, type?: string) => {
      const val = kvMap.get(key) ?? null;
      if (!val) return null;
      if (type === 'json') {
        try {
          return JSON.parse(val);
        } catch {
          return null;
        }
      }
      return val;
    },
    put: async (key: string, value: string) => {
      kvMap.set(key, value);
    },
    delete: async (key: string) => {
      kvMap.delete(key);
    },
  };

  return {
    DB: db,
    LUMINARA_KV: kv,
    ...overrides,
  } as unknown as Env;
}

const growthUser: HostedIdentity = {
  id: 'fb:user_growth',
  source: 'firebase',
  accountId: 'acc_growth',
  name: 'Growth Operator',
};

const freeUser: HostedIdentity = {
  id: 'fb:user_free',
  source: 'firebase',
  accountId: 'acc_free',
  name: 'Free User',
};

describe('Pillar 2: Pre-Verified PR & Staging Handoff Bundle', () => {
  it('validates llms.txt structure, Schema.org JSON-LD syntax, and zero em-dash guard', () => {
    const validBundle = buildVerifiedRemediationPrBundle({
      domain: 'https://www.AcmeSolar.com.au/',
      brandName: 'Acme Solar',
      findingTitle: 'Add root llms.txt and Organization JSON-LD',
      findingId: 'find_101',
      llmsTxtContent: '# Acme Solar\n> Commercial solar engineering in Australia.\n\n## Pages\n- Official website: https://acmesolar.com.au\n',
      jsonLdContent: JSON.stringify(
        {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          url: 'https://acmesolar.com.au',
          name: 'Acme Solar',
        },
        null,
        2,
      ),
      comparisonMarkdown: '# Acme Solar vs Rival\nVerified comparison outline.',
    });

    expect(validBundle.domain).toBe('acmesolar.com.au');
    expect(validBundle.branchName).toBe('fix/luminara-aeo-acmesolar-com-au');
    expect(validBundle.validationReceipt.allPassed).toBe(true);
    expect(validBundle.validationReceipt.checks).toHaveLength(3);
    expect(validBundle.files).toHaveLength(3);
    expect(validBundle.ghCliScript).toContain('gh pr create');
    expect(validBundle.cursorDeepLinkPrompt).toContain('acmesolar.com.au');
  });

  it('flags malformed JSON-LD, missing llms.txt H1, and forbidden U+2014 em dashes', () => {
    const brokenBundle = buildVerifiedRemediationPrBundle({
      domain: 'broken.io',
      llmsTxtContent: 'missing h1 and link',
      jsonLdContent: '{ invalid json',
      comparisonMarkdown: 'Contains forbidden em dash \u2014 here',
    });

    expect(brokenBundle.validationReceipt.allPassed).toBe(false);
    const byId = Object.fromEntries(
      brokenBundle.validationReceipt.checks.map((c) => [c.id, c.passed]),
    );
    expect(byId.llms_txt_structure).toBe(false);
    expect(byId.jsonld_schema_valid).toBe(false);
    expect(byId.zero_em_dash_guard).toBe(false);
  });
});

describe('Pillar 1: Review-to-Skill Feedback Compiler', () => {
  it('compiles review rejection feedback into scoped constraint fact, temporal edge, dream event, and project writing_preferences', async () => {
    const env = makeEnv();
    const projRes = await createProject(env, 'acc_growth', {
      domain: 'acmesolar.com.au',
      name: 'Acme Solar',
    });
    expect(projRes.ok).toBe(true);
    if (!projRes.ok) return;

    const compiled = await compileFeedbackIntoSkillRule(env, {
      accountId: 'acc_growth',
      userId: growthUser.id,
      domain: 'acmesolar.com.au',
      projectId: projRes.project.id,
      reason: 'Never overwrite Elementor hero layout \u2014 always keep AUD GST pricing explicit.',
      targetToolOrAsset: 'prepare_cms_mcp_call',
      sourceRef: 'test_review',
    });

    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    // Em dash is automatically scrubbed from compiled rule
    expect(compiled.ruleText).not.toContain('\u2014');
    expect(compiled.ruleText).toContain('[Rule from prepare_cms_mcp_call]');
    expect(compiled.factId).toBeTruthy();
    expect(compiled.edgeId).toBeTruthy();
    expect(compiled.dreamEventId).toBeTruthy();
    expect(compiled.updatedProjectPreferences).toBe(true);

    // Verify project writing_preferences section received the compiled rule
    const ctx = await getProjectContext(env, 'acc_growth', projRes.project.id);
    const writingPrefs = ctx?.sections.find((s) => s.key === 'writing_preferences');
    expect(writingPrefs?.content).toContain(compiled.ruleText);

    // Verify habitat status surfaces the compiled strict constraint
    const status = await getAgentHabitatStatus(env, 'acc_growth', 'acmesolar.com.au');
    expect(status.compiledRules.some((r) => r.includes('Never overwrite Elementor hero layout'))).toBe(true);
  });

  it('auto-resolves projectId and domain bidirectionally before writing memory facts/edges and injects into recallUnifiedContext promptBlock', async () => {
    const env = makeEnv();
    const projRes = await createProject(env, 'acc_growth', {
      domain: 'autoresolve.io',
      name: 'Auto Resolve Co',
    });
    expect(projRes.ok).toBe(true);
    if (!projRes.ok) return;

    // 1) Pass domain only (omitting projectId, like SelfDrivingHabitatBar UI)
    const compiled = await compileFeedbackIntoSkillRule(env, {
      accountId: 'acc_growth',
      userId: growthUser.id,
      domain: 'autoresolve.io',
      reason: 'Always cite enterprise SLA tiers in comparison tables.',
      targetToolOrAsset: 'comparison_outline',
    });
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.updatedProjectPreferences).toBe(true);

    // 2) Pass projectId only (omitting domain, like an MCP action denial with only project_id)
    const compiledFromProjOnly = await compileFeedbackIntoSkillRule(env, {
      accountId: 'acc_growth',
      userId: growthUser.id,
      projectId: projRes.project.id,
      reason: 'Never mutate live Elementor hero sections without staging sign-off.',
      targetToolOrAsset: 'prepare_cms_mcp_call',
    });
    expect(compiledFromProjOnly.ok).toBe(true);

    const ctx = await getProjectContext(env, 'acc_growth', projRes.project.id);
    const writingPrefs = ctx?.sections.find((s) => s.key === 'writing_preferences');
    expect(writingPrefs?.content).toContain('Always cite enterprise SLA tiers in comparison tables.');
    expect(writingPrefs?.content).toContain('Never mutate live Elementor hero sections without staging sign-off.');

    // 3) Verify recallUnifiedContext (used by OracleChat on the next turn) surfaces both rules and temporal edges
    const recalled = await recallUnifiedContext(env, {
      accountId: 'acc_growth',
      projectId: projRes.project.id,
      domain: 'autoresolve.io',
      query: 'comparison tables and Elementor hero sections',
    });
    expect(recalled.strictConstraints?.some((c) => c.includes('Always cite enterprise SLA tiers'))).toBe(true);
    expect(recalled.strictConstraints?.some((c) => c.includes('Never mutate live Elementor hero sections'))).toBe(true);
    expect(recalled.activeEdges.some((e) => e.predicate === 'never_bring_up' && e.projectId === projRes.project.id)).toBe(true);
    expect(recalled.promptBlock).toContain('### Strict Negative Constraints (Never Bring Up)');
    expect(recalled.promptBlock).toContain('[DO NOT VIOLATE]');
  });
});

describe('Pillar 3: Agent Habitat Scoped Credentials & Trust Boundaries', () => {
  it('refuses habitat token minting on free plan and mints scoped lm_hab_* token on growth plan', async () => {
    const env = makeEnv();
    const deniedFree = await mintHabitatToken(env, freeUser, {
      domain: 'acmesolar.com.au',
      maxRisk: 'read',
    });
    expect(deniedFree.ok).toBe(false);
    if (!deniedFree.ok) {
      expect(deniedFree.status).toBe(403);
    }

    const minted = await mintHabitatToken(env, growthUser, {
      projectId: 'proj_locked_1',
      domain: 'acmesolar.com.au',
      maxRisk: 'read',
      ttlMinutes: 30,
      label: 'Read-Only Reviewer Agent',
    });
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;
    expect(minted.token.startsWith('lm_hab_')).toBe(true);
    expect(minted.record.maxRisk).toBe('read');
    expect(minted.record.projectId).toBe('proj_locked_1');

    const identified = await identifyHabitatToken(env, minted.token);
    expect(identified).not.toBeNull();
    expect(identified?.credential.projectId).toBe('proj_locked_1');
    expect(identified?.credential.domain).toBe('acmesolar.com.au');
    expect(identified?.credential.maxRisk).toBe('read');

    // Reject recursive token minting from an ephemeral hab:* identity
    if (identified) {
      const recursiveMint = await mintHabitatToken(env, identified.user, {
        domain: 'acmesolar.com.au',
        maxRisk: 'read',
      });
      expect(recursiveMint.ok).toBe(false);
      if (!recursiveMint.ok) {
        expect(recursiveMint.status).toBe(403);
      }
    }

    // Reject maxRisk: 'destructive' with HTTP 400
    const badRisk = await mintHabitatToken(env, growthUser, {
      domain: 'acmesolar.com.au',
      maxRisk: 'destructive',
    });
    expect(badRisk.ok).toBe(false);
    if (!badRisk.ok) {
      expect(badRisk.status).toBe(400);
    }
  });

  it('enforces project scope lock (HABITAT_PROJECT_SCOPE_VIOLATION) and risk ceiling (HABITAT_RISK_CEILING_EXCEEDED) on /mcp', async () => {
    const env = makeEnv();
    const minted = await mintHabitatToken(env, growthUser, {
      projectId: 'proj_alpha',
      domain: 'alpha.io',
      maxRisk: 'read',
      ttlMinutes: 30,
    });
    expect(minted.ok).toBe(true);
    if (!minted.ok) return;

    const reqCrossProject = new Request('https://luminarasuite.com/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${minted.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'get_project_context',
          arguments: { projectId: 'proj_other_client' },
        },
      }),
    });

    const resolved = await resolveMcpUser(reqCrossProject, env);
    expect('user' in resolved).toBe(true);
    if (!('user' in resolved)) return;

    const crossRes = await handleMcpRequest(reqCrossProject, env, resolved.user, resolved.credential);
    const crossJson = (await crossRes.json()) as {
      result?: { isError?: boolean; structuredContent?: { code?: string } };
    };
    expect(crossJson.result?.isError).toBe(true);
    expect(crossJson.result?.structuredContent?.code).toBe('HABITAT_PROJECT_SCOPE_VIOLATION');

    // Attempt a write tool (create_dev_ticket_from_finding) with a read-only habitat token
    const reqWriteTool = new Request('https://luminarasuite.com/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${minted.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'create_dev_ticket_from_finding',
          arguments: { domain: 'alpha.io' },
        },
      }),
    });
    const writeRes = await handleMcpRequest(reqWriteTool, env, resolved.user, resolved.credential);
    const writeJson = (await writeRes.json()) as {
      result?: { isError?: boolean; structuredContent?: { code?: string } };
    };
    expect(writeJson.result?.isError).toBe(true);
    expect(writeJson.result?.structuredContent?.code).toBe('HABITAT_RISK_CEILING_EXCEEDED');

    // Mint a write-scoped habitat token and verify:
    // 1) domain scope lock blocks cross-domain calls
    // 2) destructive tool (prepare_cms_mcp_call) is blocked by maxRisk: 'write'
    const writeMinted = await mintHabitatToken(env, growthUser, {
      projectId: 'proj_alpha',
      domain: 'alpha.io',
      maxRisk: 'write',
      ttlMinutes: 30,
    });
    expect(writeMinted.ok).toBe(true);
    if (!writeMinted.ok) return;

    const reqCrossDomain = new Request('https://luminarasuite.com/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${writeMinted.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'create_dev_ticket_from_finding',
          arguments: { domain: 'other-tenant.io', projectId: 'proj_alpha' },
        },
      }),
    });
    const writeResolved = await resolveMcpUser(reqCrossDomain, env);
    expect('user' in writeResolved).toBe(true);
    if (!('user' in writeResolved)) return;

    const crossDomainRes = await handleMcpRequest(reqCrossDomain, env, writeResolved.user, writeResolved.credential);
    const crossDomainJson = (await crossDomainRes.json()) as {
      result?: { isError?: boolean; structuredContent?: { code?: string } };
    };
    expect(crossDomainJson.result?.isError).toBe(true);
    expect(crossDomainJson.result?.structuredContent?.code).toBe('HABITAT_PROJECT_SCOPE_VIOLATION');

    const reqDestructiveTool = new Request('https://luminarasuite.com/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${writeMinted.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'prepare_cms_mcp_call',
          arguments: { domain: 'alpha.io', projectId: 'proj_alpha' },
        },
      }),
    });
    const destructiveRes = await handleMcpRequest(
      reqDestructiveTool,
      env,
      writeResolved.user,
      writeResolved.credential,
    );
    const destructiveJson = (await destructiveRes.json()) as {
      result?: { isError?: boolean; structuredContent?: { code?: string } };
    };
    expect(destructiveJson.result?.isError).toBe(true);
    expect(destructiveJson.result?.structuredContent?.code).toBe('HABITAT_RISK_CEILING_EXCEEDED');

    // Verify list_projects filters to the bound project and get_report blocks reports from other projects
    const pAlpha = await createProject(env, 'acc_growth', { domain: 'alpha.io', name: 'Alpha' });
    const pBeta = await createProject(env, 'acc_growth', { domain: 'beta.io', name: 'Beta' });
    expect(pAlpha.ok && pBeta.ok).toBe(true);
    if (!pAlpha.ok || !pBeta.ok) return;

    const savedBetaReport = await saveAgentReport(env, 'acc_growth', {
      projectId: pBeta.project.id,
      title: 'Beta Secret Audit',
      summary: 'Confidential Beta findings',
      html: '<html><body>Beta</body></html>',
    });
    expect(savedBetaReport.ok).toBe(true);
    if (!savedBetaReport.ok) return;

    const alphaMinted = await mintHabitatToken(env, growthUser, {
      projectId: pAlpha.project.id,
      domain: 'alpha.io',
      maxRisk: 'read',
      ttlMinutes: 30,
    });
    expect(alphaMinted.ok).toBe(true);
    if (!alphaMinted.ok) return;

    const reqListProjects = new Request('https://luminarasuite.com/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${alphaMinted.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'list_projects', arguments: {} },
      }),
    });
    const alphaResolved = await resolveMcpUser(reqListProjects, env);
    expect('user' in alphaResolved).toBe(true);
    if (!('user' in alphaResolved)) return;

    const listRes = await handleMcpRequest(reqListProjects, env, alphaResolved.user, alphaResolved.credential);
    const listJson = (await listRes.json()) as {
      result?: { structuredContent?: { projects?: Array<{ id: string }> } };
    };
    expect(listJson.result?.structuredContent?.projects?.map((p) => p.id)).toEqual([pAlpha.project.id]);

    const reqCrossReport = new Request('https://luminarasuite.com/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${alphaMinted.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'get_report', arguments: { reportId: savedBetaReport.report.id } },
      }),
    });
    const reportRes = await handleMcpRequest(reqCrossReport, env, alphaResolved.user, alphaResolved.credential);
    const reportJson = (await reportRes.json()) as {
      result?: { isError?: boolean; structuredContent?: { code?: string } };
    };
    expect(reportJson.result?.isError).toBe(true);
    expect(reportJson.result?.structuredContent?.code).toBe('HABITAT_PROJECT_SCOPE_VIOLATION');
  });

  it('guards /agent-habitat/* routes against unauthenticated requests in guardApiRoute', async () => {
    const env = makeEnv();
    const unsignedReq = new Request('https://luminarasuite.com/api/agent-habitat/status?domain=acme.io', {
      method: 'GET',
    });
    const guardRes = await guardApiRoute(unsignedReq, env, '/agent-habitat/status');
    expect(guardRes?.status).toBe(401);
  });
});

describe('Pillar 4: Coasean Cross-Role Handoff Packet & MCP Tools', () => {
  it('generates synchronized Engineering PR Bundle, Sales Reputation Brief, and 14-day QA Schedule and persists to prepared_assets', async () => {
    const env = makeEnv();
    const packet = await buildCoaseanHandoffPacket(env, {
      accountId: 'acc_growth',
      userId: growthUser.id,
      domain: 'acmesolar.com.au',
      brandName: 'Acme Solar',
      findingId: 'find_aeo_1',
      findingTitle: 'Clarify commercial solar service coverage in llms.txt',
      findingDescription: 'ChatGPT and Perplexity omitted WA/QLD commercial coverage on 9/12 buyer prompts.',
      rivalName: 'SunPeak Energy',
      verifyByDate: '2026-11-12',
    });

    expect(packet.domain).toBe('acmesolar.com.au');
    expect(packet.preparedAssetId).toMatch(/^pa_/);
    expect(packet.engineeringPrBundle.validationReceipt.allPassed).toBe(true);
    expect(packet.salesSupportBrief.headline).toContain('Acme Solar');
    expect(packet.salesSupportBrief.markdownBrief).toContain('SunPeak Energy');
    expect(packet.qaVerificationSchedule.verifyByDate).toBe('2026-11-12');
    expect(packet.qaVerificationSchedule.buyerPromptsToRetest).toHaveLength(3);
  });

  it('registers all 3 Self-Driving MCP tools in TOOL_GOVERNANCE and executes HTTP routes cleanly', async () => {
    for (const tool of SELF_DRIVING_MCP_TOOLS) {
      expect(TOOL_GOVERNANCE[tool.name]).toBeDefined();
      expect(TOOL_GOVERNANCE[tool.name]?.status).toBe('active');
    }

    const env = makeEnv();
    await createActionRequest(env, {
      userId: 'acc_growth',
      toolName: 'prepare_cms_mcp_call',
      projectId: 'proj_1',
      args: { domain: 'acmesolar.com.au' },
    });

    const statusReq = new Request('https://luminarasuite.com/api/agent-habitat/status?domain=acmesolar.com.au', {
      method: 'GET',
    });
    const statusRes = await handleAgentHabitatRoute(statusReq, env, growthUser, '/agent-habitat/status');
    expect(statusRes?.status).toBe(200);
    const statusJson = (await statusRes?.json()) as {
      ok: boolean;
      pendingRequests: Array<{ tool_name: string }>;
    };
    expect(statusJson.ok).toBe(true);
    expect(statusJson.pendingRequests).toHaveLength(1);
    expect(statusJson.pendingRequests[0]?.tool_name).toBe('prepare_cms_mcp_call');
  });

  it('renders SelfDrivingHabitatBar UI with 3/3 Pre-Flight checks, clean brand stem, and all 3 agentic tabs', () => {
    const html = renderToStaticMarkup(
      createElement(SelfDrivingHabitatBar, {
        domain: 'acmesolar.com.au',
        brandName: 'acmesolar.com.au',
        primary: {
          id: 'find_ui_1',
          title: 'Publish verified llms.txt and Organization JSON-LD',
          description: 'Ensure AI engines cite canonical solar engineering facts.',
          severity: 'high',
          category: 'aeo',
          status: 'open',
          effortMinutes: 25,
          expectedGain: 'Higher AI citation share',
        },
        reportMarkdown: 'Competitor: SunPeak Energy',
        verifyBy: '2026-11-12',
      }),
    );

    expect(html).toContain('Self-Driving Agentic Loop');
    expect(html).toContain('1. Coasean Handoff &amp; PR');
    expect(html).toContain('2. Review-to-Skill');
    expect(html).toContain('3. Agent Habitat');
    expect(html).toContain('Pre-Flight Verification: 3/3 Checks Passed');
    expect(html).toContain('fix/luminara-aeo-acmesolar-com-au');
  });
});
