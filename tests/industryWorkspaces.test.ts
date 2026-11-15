import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndustrySelect } from '../components/industries/IndustrySelect';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import { createSqliteD1 } from './helpers/sqliteD1';
import { createProject } from '../worker/projectService';
import { handleMcpRequest } from '../worker/mcpServer';
import { SESSION_MCP_CREDENTIAL } from '../worker/userTypes';
import {
  DEFAULT_INDUSTRY_ID,
  INDUSTRY_CHECK_IDS,
  INDUSTRY_IDS,
  competitorDiscoveryHints,
  fillKeywordTemplate,
  industryProfile,
} from '../services/industries/industryProfiles';
import { entitlementsFor } from '../services/plans/planEntitlements';
import { evaluateRealEstateChecks, formatRealEstateChecks } from '../services/audit/realEstateChecks';

const botToken = '123456:INDUSTRY_TEST_TOKEN';

function signInitData(userId: number): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Tester' }),
  };
  const dcs = Object.keys(fields).sort().map((key) => `${key}=${fields[key]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

function mockKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function makeEnv(): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: mockKv(),
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    REQUIRE_TG_AUTH: 'true',
    BOT_TOKEN: botToken,
  } as Env;
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function headers(userId: number): HeadersInit {
  return {
    'content-type': 'application/json',
    'x-telegram-init-data': signInitData(userId),
  };
}

async function call(env: Env, userId: number, path: string, init?: RequestInit) {
  return worker.fetch(new Request(`https://luminarasuite.com/api${path}`, { ...init, headers: headers(userId) }), env, ctx);
}

async function insertUser(env: Env, id: string, email: string) {
  await env.DB!.prepare(
    `INSERT INTO users (id, source, email, display_name, created_at, last_seen_at, account_id, email_verified)
     VALUES (?, 'firebase', ?, 'Ada', 1, 1, ?, 1)`,
  ).bind(id, email, id).run();
}

describe('industry profiles', () => {
  it('keeps real estate agency as the default and fills a keyword', () => {
    expect(INDUSTRY_IDS).toHaveLength(15);
    expect(industryProfile(null).id).toBe(DEFAULT_INDUSTRY_ID);
    expect(industryProfile('real_estate_agency').defaultChecks).toEqual([...INDUSTRY_CHECK_IDS]);
    expect(industryProfile('mortgage_broker').defaultChecks).not.toContain('listing_pages');
    expect(fillKeywordTemplate(industryProfile('real_estate_agency'), { service: 'agent', suburb: 'Richmond' })).toBe('agent Richmond');
    expect(competitorDiscoveryHints(industryProfile('mortgage_broker'), { suburb: 'Richmond' })).toContain('mortgage broker Richmond');
    expect(industryProfile('nope').reportHeading).toBe('Real estate checks');
    expect(entitlementsFor('free').workspaceClientLimit).toBe(1);
    expect(entitlementsFor('agency').workspaceClientLimit).toBe(10);
  });

  it('leaves the unscoped real estate check list unchanged', () => {
    const checks = evaluateRealEstateChecks([]);
    expect(checks.map((check) => check.id)).toEqual([...INDUSTRY_CHECK_IDS]);
    expect(formatRealEstateChecks(checks)).toContain('## Real estate checks');
    expect(formatRealEstateChecks(checks)).not.toContain('Written for');
    const broker = evaluateRealEstateChecks([], 'mortgage_broker');
    expect(broker.some((check) => check.id === 'listing_pages')).toBe(false);
    expect(formatRealEstateChecks(broker, 'mortgage_broker')).toContain('Written for borrowers.');
    const html = renderToStaticMarkup(createElement(IndustrySelect, { id: 'industry', value: 'mortgage_broker', onChange: () => {} }));
    expect(html).toContain('Mortgage broker');
    expect(html).toContain('Franchise head office');
    expect(html).toContain('value="mortgage_broker"');
  });
});

describe('industry and client workspaces', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it('backfills existing accounts and does not overwrite a later choice', async () => {
    const env = makeEnv();
    await insertUser(env, 'acct_old', 'old@example.com');
    const sql = readFileSync('migrations/0053_industry_workspaces.sql', 'utf8');
    await env.DB!.exec(sql);
    const first = await env.DB!.prepare(`SELECT industry_id FROM account_industries WHERE account_id = ?`)
      .bind('acct_old')
      .first<{ industry_id: string }>();
    expect(first?.industry_id).toBe('real_estate_agency');
    await env.DB!.prepare(`UPDATE account_industries SET industry_id = 'mortgage_broker' WHERE account_id = ?`)
      .bind('acct_old')
      .run();
    await env.DB!.exec(sql);
    const second = await env.DB!.prepare(`SELECT industry_id FROM account_industries WHERE account_id = ?`)
      .bind('acct_old')
      .first<{ industry_id: string }>();
    expect(second?.industry_id).toBe('mortgage_broker');
  });

  it('stores industry on create and get, and blocks a second client on the free placeholder', async () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('cloudflare-dns.com')) {
        return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '1.1.1.1' }] }), {
          status: 200,
          headers: { 'content-type': 'application/dns-json' },
        });
      }
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
    });
    const env = makeEnv();
    const created = await call(env, 701, '/workspaces/current', {
      method: 'POST',
      body: JSON.stringify({ name: 'Harbour Realty' }),
    });
    expect(created.status).toBe(200);
    const badBrand = await call(env, 701, '/workspaces/current', {
      method: 'PATCH',
      body: JSON.stringify({ logoUrl: 'javascript:alert(1)', primaryColour: 'red' }),
    });
    expect(badBrand.status).toBe(400);
    const brand = await call(env, 701, '/workspaces/current', {
      method: 'PATCH',
      body: JSON.stringify({
        displayName: 'Harbour',
        logoUrl: 'https://cdn.harbour.co/logo.png',
        primaryColour: '#1B4D3E',
        reportDomain: null,
      }),
    });
    expect(brand.status).toBe(200);
    const brandBody = (await brand.json()) as { workspace: { primaryColour: string; reportDomain: string | null } };
    expect(brandBody.workspace.primaryColour).toBe('#1b4d3e');
    expect(brandBody.workspace.reportDomain).toBeNull();
    const first = await call(env, 701, '/workspaces/current/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ada', domain: 'ada.example', industryId: 'buyers_agent' }),
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { projectId: string };
    const project = await call(env, 701, `/projects/${firstBody.projectId}`);
    const projectBody = (await project.json()) as { project: { industryId: string } };
    expect(projectBody.project.industryId).toBe('buyers_agent');
    const second = await call(env, 701, '/workspaces/current/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bea', domain: 'bea.example' }),
    });
    expect(second.status).toBe(403);
    const industries = await call(env, 701, '/industries');
    const listed = (await industries.json()) as { industries: Array<{ id: string }> };
    expect(listed.industries.map((row) => row.id)).toEqual([...INDUSTRY_IDS]);
    vi.unstubAllGlobals();
  });

  it('stops a client viewer reading another client, and lets staff read both', async () => {
    const env = makeEnv();
    await insertUser(env, '802', 'viewer@example.com');
    await insertUser(env, '803', 'staff@example.com');
    await call(env, 701, '/workspaces/current', { method: 'POST', body: JSON.stringify({ name: 'Harbour' }) });
    const ada = await call(env, 701, '/workspaces/current/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ada', domain: 'ada.example' }),
    });
    expect(ada.status).toBe(200);
    const adaBody = (await ada.json()) as { projectId: string; clientId: string };
    const direct = await createProject(env, '701', { domain: 'bea.example', name: 'Bea', clientId: 'bea' });
    expect(direct.ok).toBe(true);
    if (!direct.ok) return;
    const inviteViewer = await call(env, 701, '/workspaces/current/invites', {
      method: 'POST',
      body: JSON.stringify({ email: 'viewer@example.com', role: 'client_viewer', clientId: adaBody.clientId }),
    });
    expect(inviteViewer.status).toBe(200);
    const viewerBody = (await inviteViewer.json()) as { member: { id: string; status: string } };
    expect(viewerBody.member.status).toBe('invited');
    const inviteStaff = await call(env, 701, '/workspaces/current/invites', {
      method: 'POST',
      body: JSON.stringify({ email: 'staff@example.com', role: 'staff' }),
    });
    expect(inviteStaff.status).toBe(200);
    const staffBody = (await inviteStaff.json()) as { member: { id: string } };
    expect((await call(env, 802, `/workspaces/invites/${viewerBody.member.id}/accept`, { method: 'POST' })).status).toBe(200);
    expect((await call(env, 803, `/workspaces/invites/${staffBody.member.id}/accept`, { method: 'POST' })).status).toBe(200);

    const own = await call(env, 802, `/projects/${adaBody.projectId}`);
    expect(own.status).toBe(200);
    const other = await call(env, 802, `/projects/${direct.project.id}`);
    expect(other.status).toBe(404);
    const write = await call(env, 802, `/projects/${adaBody.projectId}`, {
      method: 'PATCH',
      body: JSON.stringify({ industryId: 'mortgage_broker' }),
    });
    expect(write.status).toBe(403);
    const listed = await call(env, 802, '/projects');
    const listedBody = (await listed.json()) as { projects: Array<{ id: string }> };
    expect(listedBody.projects.map((project) => project.id)).toEqual([adaBody.projectId]);
    const staffAda = await call(env, 803, `/projects/${adaBody.projectId}`);
    const staffBea = await call(env, 803, `/projects/${direct.project.id}`);
    expect(staffAda.status).toBe(200);
    expect(staffBea.status).toBe(200);
    const members = await call(env, 802, '/workspaces/current/members');
    expect(members.status).toBe(404);

    const mcpOther = await handleMcpRequest(
      new Request('https://luminarasuite.com/mcp', {
        method: 'POST',
        headers: headers(802),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'get_project_context', arguments: { projectId: direct.project.id } },
        }),
      }),
      env,
      { id: '802', source: 'telegram', accountId: '802' },
      SESSION_MCP_CREDENTIAL,
    );
    const mcpBody = (await mcpOther.json()) as { result?: { isError?: boolean } };
    expect(mcpBody.result?.isError).toBe(true);

    const mcpList = await handleMcpRequest(
      new Request('https://luminarasuite.com/mcp', {
        method: 'POST',
        headers: headers(701),
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'list_industries', arguments: {} } }),
      }),
      env,
      { id: '701', source: 'telegram', accountId: '701' },
      SESSION_MCP_CREDENTIAL,
    );
    const listBody = (await mcpList.json()) as { result?: { structuredContent?: { industries?: unknown[] } } };
    expect(listBody.result?.structuredContent?.industries).toHaveLength(15);
  });
});
