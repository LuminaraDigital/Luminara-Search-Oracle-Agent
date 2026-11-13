import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { KVNamespace } from '@cloudflare/workers-types';
import {
  BYOK_PAID_CALL_COST_CENTS,
  HOSTED_PAID_CALL_COST_CENTS,
} from '../worker/budgets';
import { handleMcpRequest, listMcpToolCatalogue } from '../worker/mcpServer';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';
import {
  LUMINARA_MCP_TOOL_COSTS,
  TOOL_COSTS_BYOK_CENTS,
  TOOL_COSTS_HOSTED_CENTS,
  buildHermesManifestCosts,
  parseCostPolicy,
  unknownCostKeys,
  validateAgentPluginManifest,
  validatePortableMcpJson,
  validateSkillFrontmatter,
} from '../services/mcp/toolCosts';
import { scanForThreats } from '../services/trust/threatPatterns';
import { createSqliteD1 } from './helpers/sqliteD1';

function parseSimpleFrontmatter(md: string): Record<string, unknown> {
  const clean = md.replace(/^\ufeff/, '');
  if (!clean.startsWith('---\n') && !clean.startsWith('---\r\n')) {
    throw new Error('Missing YAML frontmatter');
  }
  const endMatch = /\r?\n---\s*\r?\n/.exec(clean.slice(3));
  if (!endMatch || endMatch.index === undefined) {
    throw new Error('Unterminated YAML frontmatter');
  }
  const yamlBlock = clean.slice(3, endMatch.index + 3);
  const out: Record<string, unknown> = {};
  const lines = yamlBlock.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    let val = line.slice(colonIdx + 1).trim();
    if (val === '>' || val === '|') {
      const folded: string[] = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) {
        i += 1;
        folded.push(lines[i].trim());
      }
      val = folded.join(' ');
    } else if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

describe('Agent Plugins v1 Package (plugins/luminara) & MCP Tool Cost Parity', () => {
  const pluginRoot = resolve(process.cwd(), 'plugins', 'luminara');

  it('validates mcp.json, plugin.json, cost synchronization, and zero drift across all 33 MCP tools', () => {
    expect(TOOL_COSTS_HOSTED_CENTS).toBe(HOSTED_PAID_CALL_COST_CENTS);
    expect(TOOL_COSTS_BYOK_CENTS).toBe(BYOK_PAID_CALL_COST_CENTS);

    const mcpRaw = JSON.parse(readFileSync(resolve(pluginRoot, 'mcp.json'), 'utf8'));
    const mcpValid = validatePortableMcpJson(mcpRaw);
    expect(mcpValid.ok).toBe(true);
    if (!mcpValid.ok) return;

    const manifestRaw = JSON.parse(readFileSync(resolve(pluginRoot, 'plugin.json'), 'utf8'));
    const manifestValid = validateAgentPluginManifest(manifestRaw, mcpValid.servers);
    expect(manifestValid.ok).toBe(true);
    if (!manifestValid.ok) return;

    const policy = manifestValid.costPolicies.luminara ?? null;
    expect(policy).not.toBeNull();
    expect(policy?.unit).toBe('cents');
    expect(policy?.limit).toBe(100);

    // Ensure plugin.json costs match buildHermesManifestCosts() byte-for-byte.
    const rawHermesCosts =
      manifestRaw.extensions['com.nousresearch.hermes'].servers.luminara.costs;
    expect(rawHermesCosts).toEqual(buildHermesManifestCosts());

    // Zero drift between live Worker tools/list and declared cost table.
    const liveTools = listMcpToolCatalogue();
    expect(liveTools).toHaveLength(33);
    const liveNames = liveTools.map((t) => t.name);
    expect(unknownCostKeys(policy, liveNames)).toEqual([]);
    expect(Object.keys(LUMINARA_MCP_TOOL_COSTS).sort()).toEqual([...liveNames].sort());

    for (const tool of liveTools) {
      const entry = LUMINARA_MCP_TOOL_COSTS[tool.name];
      expect(entry, `Missing cost entry for ${tool.name}`).toBeDefined();
      if (tool.creditClass === 'paid') {
        expect(entry.low).toBe(0);
        expect(entry.high).toBe(HOSTED_PAID_CALL_COST_CENTS);
        expect(entry.requiredScope).toBe('mcp:research');
      } else {
        expect(entry.high).toBe(0);
        expect(entry.requiredScope).toBe('mcp:free');
      }
    }
  });

  it('validates all 11 bundled SKILL.md files against Agent Plugins v1 frontmatter, strict threat scan, and no em dashes', () => {
    const skillsDir = resolve(pluginRoot, 'skills');
    const skillDirs = readdirSync(skillsDir).sort();
    expect(skillDirs).toHaveLength(11);

    for (const dirName of skillDirs) {
      const skillPath = resolve(skillsDir, dirName, 'SKILL.md');
      const content = readFileSync(skillPath, 'utf8');
      expect(content, `${dirName}/SKILL.md must not contain U+2014`).not.toContain('\u2014');

      const fm = parseSimpleFrontmatter(content);
      expect(validateSkillFrontmatter(fm, dirName)).toBeNull();
      expect(scanForThreats(content, 'strict'), `${dirName}/SKILL.md failed strict threat scan`).toEqual([]);
    }

    for (const rel of [
      'plugins/luminara/README.md',
      'plugins/luminara/plugin.json',
      'plugins/luminara/mcp.json',
      'docs/hermes-catalog/luminara-mcp.yaml',
    ]) {
      const text = readFileSync(resolve(process.cwd(), rel), 'utf8');
      expect(text, `${rel} must not contain U+2014`).not.toContain('\u2014');
    }

    const readme = readFileSync(resolve(pluginRoot, 'README.md'), 'utf8');
    expect(readme).not.toContain('Growth or Agency): `POST /api/api-keys`');
    expect(readme).toContain('hermes plugins install');
  });

  it('rejects malformed cost declarations and gates tools/list cost annotations behind MCP_DECLARED_COSTS_ENABLED', async () => {
    expect(() =>
      parseCostPolicy({ costs: { bad: [5, 1] }, where: 'test' }),
    ).toThrow(/min <= max/);
    expect(() =>
      parseCostPolicy({ costs: { bad: { cents: 1 } }, where: 'test' }),
    ).toThrow(/credits/);

    // Negative Agent Plugins v1 validation checks (traversal, bad trust, bad timeout, missing transport).
    const baseManifest = JSON.parse(readFileSync(resolve(pluginRoot, 'plugin.json'), 'utf8'));
    const traversalCheck = validateAgentPluginManifest(
      { ...baseManifest, skills: ['../outside'] },
      { luminara: { type: 'streamable-http', url: 'https://luminarasuite.com/api/mcp' } },
    );
    expect(traversalCheck.ok).toBe(false);

    const badServerDecl = validateAgentPluginManifest(
      {
        ...baseManifest,
        extensions: {
          'com.nousresearch.hermes': {
            servers: {
              luminara: { trust: 'admin', timeout: -5 },
            },
          },
        },
      },
      { luminara: { type: 'streamable-http', url: 'http://evil.example.com/mcp' } },
    );
    expect(badServerDecl.ok).toBe(false);
    if (!badServerDecl.ok) {
      expect(badServerDecl.errors.some((e) => e.includes('trust'))).toBe(true);
      expect(badServerDecl.errors.some((e) => e.includes('timeout'))).toBe(true);
      expect(badServerDecl.errors.some((e) => e.includes('https/loopback'))).toBe(true);
    }

    const db = createSqliteD1();
    const kv = {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
    } as unknown as KVNamespace;
    const user: HostedIdentity = {
      id: 'usr_mcp_1',
      accountId: 'acct_mcp_1',
      email: 'mcp@example.com',
      plan: 'free',
    };

    const makeReq = () =>
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });

    // Flag off (default): annotations contain readOnlyHint only.
    const offRes = await handleMcpRequest(makeReq(), { DB: db, LUMINARA_KV: kv } as Env, user);
    const offBody = (await offRes.json()) as {
      result: { tools: Array<{ name: string; annotations: Record<string, unknown> }> };
    };
    const offKw = offBody.result.tools.find((t) => t.name === 'research_keywords')!;
    expect(offKw.annotations.costCents).toBeUndefined();

    // Flag on: annotations expose costCents, costUnit, requiredScope, and costNote.
    const onRes = await handleMcpRequest(
      makeReq(),
      { DB: db, LUMINARA_KV: kv, MCP_DECLARED_COSTS_ENABLED: 'true' } as Env,
      user,
    );
    const onBody = (await onRes.json()) as {
      result: { tools: Array<{ name: string; annotations: Record<string, unknown> }> };
    };
    const onKw = onBody.result.tools.find((t) => t.name === 'research_keywords')!;
    expect(onKw.annotations).toMatchObject({
      readOnlyHint: false,
      costCents: [0, 1],
      costUnit: 'cents',
      requiredScope: 'mcp:research',
    });
    const onDraft = onBody.result.tools.find((t) => t.name === 'draft_fix')!;
    expect(onDraft.annotations).toMatchObject({
      costCents: 0,
      costUnit: 'cents',
      requiredScope: 'mcp:free',
    });
    expect(String(onDraft.annotations.costNote)).toContain('daily ask quota');

    // GET /api/mcp mirrors POST tools/list cost annotations symmetrically.
    const getOnRes = await handleMcpRequest(
      new Request('https://luminarasuite.com/api/mcp', { method: 'GET' }),
      { DB: db, LUMINARA_KV: kv, MCP_DECLARED_COSTS_ENABLED: 'true' } as Env,
      user,
    );
    const getOnBody = (await getOnRes.json()) as {
      tools: Array<{ name: string; annotations: Record<string, unknown> }>;
    };
    const getKw = getOnBody.tools.find((t) => t.name === 'research_keywords')!;
    expect(getKw.annotations.costCents).toEqual([0, 1]);

    // Streamable HTTP SSE probe (GET /api/mcp with Accept: text/event-stream) returns 405 cleanly.
    const sseProbeRes = await handleMcpRequest(
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'GET',
        headers: { accept: 'text/event-stream' },
      }),
      { DB: db, LUMINARA_KV: kv } as Env,
      user,
    );
    expect(sseProbeRes.status).toBe(405);
    expect(sseProbeRes.headers.get('access-control-allow-methods')).toContain('POST');

    // MCP protocolVersion negotiation supports 2025-03-26 / 2025-06-18 and defaults unknown versions to 2025-06-18.
    const init2025 = await handleMcpRequest(
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'initialize',
          params: { protocolVersion: '2025-03-26' },
        }),
      }),
      { DB: db, LUMINARA_KV: kv } as Env,
      user,
    );
    expect(
      ((await init2025.json()) as { result: { protocolVersion: string } }).result.protocolVersion,
    ).toBe('2025-03-26');

    const explicitFieldsManifest = validateAgentPluginManifest(
      { ...baseManifest, skills: ['./skills/luminara-context'], mcp: './mcp.json' },
      { luminara: { type: 'streamable-http', url: 'https://luminarasuite.com/api/mcp' } },
    );
    expect(explicitFieldsManifest.ok).toBe(true);
  });
});
