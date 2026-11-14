import { createHmac } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceBrandForm } from '../components/suite/WorkspaceBrandForm';
import { entitlementsFor } from '../services/plans/planEntitlements';
import { buildAuditDossierHtml } from '../services/reports/portableDossierService';
import {
  applyReportBrandHtml,
  contrastLabel,
  contrastRatio,
  logoPayloadOk,
  LOGO_MAX_BYTES,
  luminaraReportBrand,
  POWERED_BY_LINE,
  reportBrandFromWorkspace,
  textOnColour,
} from '../services/reports/reportBrand';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import { handleMcpRequest } from '../worker/mcpServer';
import { SESSION_MCP_CREDENTIAL } from '../worker/userTypes';
import { createProject } from '../worker/projectService';
import { saveAgentReport } from '../worker/agentReportService';
import { createSqliteD1 } from './helpers/sqliteD1';

const botToken = '123456:BRAND_TEST_TOKEN';
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

function mockKv(seed?: Record<string, string>): KVNamespace {
  const store = new Map<string, string>(Object.entries(seed || {}));
  return {
    get: async (key: string, type?: string) => {
      const value = store.get(key);
      if (value === undefined) return null;
      return type === 'json' ? JSON.parse(value) : value;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function makeEnv(seed?: Record<string, string>): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: mockKv(seed),
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    REQUIRE_TG_AUTH: 'true',
    BOT_TOKEN: botToken,
  } as Env;
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function headers(userId: number): HeadersInit {
  return { 'content-type': 'application/json', 'x-telegram-init-data': signInitData(userId) };
}

function stubLogoFetch(body: Uint8Array = png, contentType = 'image/png') {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('cloudflare-dns.com')) {
      return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '1.1.1.1' }] }), {
        status: 200,
        headers: { 'content-type': 'application/dns-json' },
      });
    }
    return new Response(body, { status: 200, headers: { 'content-type': contentType } });
  });
}

async function call(env: Env, userId: number, path: string, init?: RequestInit) {
  return worker.fetch(new Request(`https://luminarasuite.com/api${path}`, { ...init, headers: headers(userId) }), env, ctx);
}

describe('report brand', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the powered-by line unless the plan flag allows it to come off', () => {
    expect(entitlementsFor('free').whiteLabelRemovePoweredBy).toBe(false);
    expect(entitlementsFor('starter').whiteLabelRemovePoweredBy).toBe(false);
    expect(entitlementsFor('growth').whiteLabelRemovePoweredBy).toBe(false);
    expect(entitlementsFor('agency').whiteLabelRemovePoweredBy).toBe(true);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(textOnColour('#ffffff').text).toBe('#111111');
    expect(textOnColour('#000000').text).toBe('#ffffff');
    expect(textOnColour('#1b4d3e').ratio).toBeGreaterThanOrEqual(4.5);
    expect(contrastLabel('#1b4d3e').text).toContain('Passes WCAG AA');
    expect(contrastLabel('red').ok).toBe(false);
  });

  it('renders a workspace brand and refuses an SVG logo', () => {
    const workspace = reportBrandFromWorkspace(
      { name: 'Harbour', displayName: 'Harbour Realty', logoUrl: 'https://cdn.harbour.co/logo.png', primaryColour: '#1B4D3E' },
      true,
    );
    const branded = buildAuditDossierHtml({
      domain: 'ada.example',
      markdownText: 'Hello',
      generatedAt: 1,
      brand: { ...workspace, showPoweredBy: true },
    });
    const quiet = buildAuditDossierHtml({
      domain: 'ada.example',
      markdownText: 'Hello',
      generatedAt: 1,
      brand: { ...workspace, showPoweredBy: false },
    });
    const plain = buildAuditDossierHtml({ domain: 'ada.example', markdownText: 'Hello', generatedAt: 1 });
    expect(branded).toContain('Harbour Realty');
    expect(branded).toContain(POWERED_BY_LINE);
    expect(branded).toContain('https://cdn.harbour.co/logo.png');
    expect(quiet).not.toContain(POWERED_BY_LINE);
    expect(plain).toContain('Luminara Suite');
    expect(plain).toContain(POWERED_BY_LINE);
    expect(plain).not.toContain('Harbour Realty');

    const html = applyReportBrandHtml('<html><body><p>Hi</p></body></html>', workspace);
    expect(html).toContain('Harbour Realty');
    expect(html).toContain(POWERED_BY_LINE);
    expect(html).not.toContain('<script');
    const hidden = applyReportBrandHtml('<html><body><p>Hi</p></body></html>', { ...workspace, showPoweredBy: false });
    expect(hidden).not.toContain(POWERED_BY_LINE);

    expect(logoPayloadOk(png, 'image/png').ok).toBe(true);
    expect(logoPayloadOk(png, 'image/svg+xml').ok).toBe(false);
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(logoPayloadOk(svg, 'image/svg+xml').ok).toBe(false);
    expect(logoPayloadOk(new Uint8Array(LOGO_MAX_BYTES + 1), 'image/png').ok).toBe(false);
    expect(reportBrandFromWorkspace(
      { name: 'Harbour', displayName: null, logoUrl: 'https://cdn.harbour.co/mark.svg', primaryColour: '#1B4D3E' },
      true,
    ).logoUrl).toBeNull();

    const form = renderToStaticMarkup(createElement(WorkspaceBrandForm, {
      workspace: { displayName: 'Harbour Realty', logoUrl: null, primaryColour: '#1b4d3e', reportDomain: 'reports.harbour.co' },
      onSaved: () => {},
    }));
    expect(form).toContain('Passes WCAG AA');
    expect(form).toContain('Logo URL');
    expect(form).toContain('Harbour Realty');
    expect(form).not.toContain('reports.harbour.co');
    expect(luminaraReportBrand(true).kind).toBe('luminara');
  });

  it('stamps the workspace brand on a project share and keeps isolation', async () => {
    stubLogoFetch();
    const env = makeEnv();
    await env.DB!.prepare(
      `INSERT INTO users (id, source, email, display_name, created_at, last_seen_at, account_id, email_verified)
       VALUES ('802', 'firebase', 'viewer@example.com', 'Ada', 1, 1, '802', 1)`,
    ).run();
    expect((await call(env, 701, '/workspaces/current', {
      method: 'POST',
      body: JSON.stringify({ name: 'Harbour Realty' }),
    })).status).toBe(200);
    const brand = await call(env, 701, '/workspaces/current', {
      method: 'PATCH',
      body: JSON.stringify({
        displayName: 'Harbour Realty',
        logoUrl: 'https://cdn.harbour.co/logo.png',
        primaryColour: '#1B4D3E',
      }),
    });
    expect(brand.status).toBe(200);
    const svg = await call(env, 701, '/workspaces/current', {
      method: 'PATCH',
      body: JSON.stringify({ logoUrl: 'https://cdn.harbour.co/logo.svg', primaryColour: '#1B4D3E' }),
    });
    expect(svg.status).toBe(400);
    stubLogoFetch(new TextEncoder().encode('<svg><script>alert(1)</script></svg>'), 'image/svg+xml');
    const scripted = await call(env, 701, '/workspaces/current', {
      method: 'PATCH',
      body: JSON.stringify({ logoUrl: 'https://cdn.harbour.co/logo.png', primaryColour: '#1B4D3E' }),
    });
    expect(scripted.status).toBe(400);
    stubLogoFetch();

    const ada = await call(env, 701, '/workspaces/current/clients', {
      method: 'POST',
      body: JSON.stringify({ name: 'Ada', domain: 'ada.example' }),
    });
    const adaBody = (await ada.json()) as { projectId: string; clientId: string };
    const project = await call(env, 701, `/projects/${adaBody.projectId}`);
    const projectBody = (await project.json()) as { reportBrand: { kind: string; displayName: string; showPoweredBy: boolean } };
    expect(projectBody.reportBrand.kind).toBe('workspace');
    expect(projectBody.reportBrand.displayName).toBe('Harbour Realty');
    expect(projectBody.reportBrand.showPoweredBy).toBe(true);

    const share = await call(env, 701, '/share/reports', {
      method: 'POST',
      body: JSON.stringify({
        markdownText: '# Ada',
        projectId: adaBody.projectId,
        branding: { agencyName: 'Spoof Agency', logoUrl: 'javascript:alert(1)' },
      }),
    });
    expect(share.status).toBe(200);
    const token = ((await share.json()) as { token: string }).token;
    const opened = await worker.fetch(
      new Request(`https://luminarasuite.com/api/share/reports/${token}`),
      env,
      ctx,
    );
    const openedBody = (await opened.json()) as { report: { branding?: { agencyName?: string; showPoweredBy?: boolean; logoUrl?: string } } };
    expect(openedBody.report.branding?.agencyName).toBe('Harbour Realty');
    expect(openedBody.report.branding?.logoUrl).toBe('https://cdn.harbour.co/logo.png');
    expect(openedBody.report.branding?.showPoweredBy).toBe(true);

    await env.LUMINARA_KV.put('sub:701', JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 86_400_000 }));
    const agencyShare = await call(env, 701, '/share/reports', {
      method: 'POST',
      body: JSON.stringify({ markdownText: '# Ada again', projectId: adaBody.projectId }),
    });
    const agencyToken = ((await agencyShare.json()) as { token: string }).token;
    const agencyOpened = await worker.fetch(
      new Request(`https://luminarasuite.com/api/share/reports/${agencyToken}`),
      env,
      ctx,
    );
    const agencyBody = (await agencyOpened.json()) as { report: { branding?: { showPoweredBy?: boolean; agencyName?: string } } };
    expect(agencyBody.report.branding?.agencyName).toBe('Harbour Realty');
    expect(agencyBody.report.branding?.showPoweredBy).toBe(false);

    const loose = await call(env, 900, '/share/reports', {
      method: 'POST',
      body: JSON.stringify({ markdownText: '# No workspace', branding: { agencyName: 'Acme' } }),
    });
    const looseToken = ((await loose.json()) as { token: string }).token;
    const looseOpened = await worker.fetch(
      new Request(`https://luminarasuite.com/api/share/reports/${looseToken}`),
      env,
      ctx,
    );
    const looseBody = (await looseOpened.json()) as { report: { branding?: { agencyName?: string } } };
    expect(looseBody.report.branding?.agencyName).toBeUndefined();

    const invite = await call(env, 701, '/workspaces/current/invites', {
      method: 'POST',
      body: JSON.stringify({ email: 'viewer@example.com', role: 'client_viewer', clientId: adaBody.clientId }),
    });
    expect(invite.status).toBe(200);
    const other = await call(env, 802, '/share/reports', {
      method: 'POST',
      body: JSON.stringify({ markdownText: '# Other', projectId: 'missing-project' }),
    });
    expect(other.status).toBe(404);
    const own = await call(env, 802, '/share/reports', {
      method: 'POST',
      body: JSON.stringify({
        markdownText: '# Own',
        projectId: adaBody.projectId,
        branding: { agencyName: 'Viewer spoof' },
      }),
    });
    expect(own.status).toBe(200);
    const ownToken = ((await own.json()) as { token: string }).token;
    const ownOpened = await worker.fetch(
      new Request(`https://luminarasuite.com/api/share/reports/${ownToken}`),
      env,
      ctx,
    );
    const ownBody = (await ownOpened.json()) as { report: { branding?: { agencyName?: string } } };
    expect(ownBody.report.branding?.agencyName).toBe('Harbour Realty');

    const saved = await handleMcpRequest(
      new Request('https://luminarasuite.com/mcp', {
        method: 'POST',
        headers: headers(701),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'save_report',
            arguments: {
              projectId: adaBody.projectId,
              title: 'Ada report',
              summary: 'Verdict: not measured. One action: fix the title.',
              html: '<html><body><p>Hi</p></body></html>',
            },
          },
        }),
      }),
      env,
      { id: '701', source: 'telegram', accountId: '701' },
      SESSION_MCP_CREDENTIAL,
    );
    const savedBody = (await saved.json()) as { result?: { isError?: boolean; structuredContent?: { report?: { id: string } } } };
    expect(savedBody.result?.isError).toBeFalsy();
    const reportId = savedBody.result?.structuredContent?.report?.id || '';
    const read = await handleMcpRequest(
      new Request('https://luminarasuite.com/mcp', {
        method: 'POST',
        headers: headers(701),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: { name: 'get_report', arguments: { reportId, includeHtml: true } },
        }),
      }),
      env,
      { id: '701', source: 'telegram', accountId: '701' },
      SESSION_MCP_CREDENTIAL,
    );
    const readBody = (await read.json()) as {
      result?: { structuredContent?: { report?: { html?: string }; brand?: { displayName?: string; showPoweredBy?: boolean } } };
    };
    expect(readBody.result?.structuredContent?.brand?.displayName).toBe('Harbour Realty');
    expect(readBody.result?.structuredContent?.brand?.showPoweredBy).toBe(false);
    expect(readBody.result?.structuredContent?.report?.html).toContain('Harbour Realty');
    expect(readBody.result?.structuredContent?.report?.html).not.toContain(POWERED_BY_LINE);

    const direct = await createProject(env, '701', { domain: 'bea.example', name: 'Bea', clientId: 'bea' });
    expect(direct.ok).toBe(true);
    if (!direct.ok) return;
    const hidden = await saveAgentReport(env, '701', {
      projectId: direct.project.id,
      title: 'Bea report',
      summary: 'Verdict: not measured. One action: leave it.',
      html: '<html><body><p>Bea</p></body></html>',
    });
    expect(hidden.ok).toBe(true);
    if (!hidden.ok) return;
    const viewerRead = await handleMcpRequest(
      new Request('https://luminarasuite.com/mcp', {
        method: 'POST',
        headers: headers(802),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'get_report', arguments: { reportId: hidden.report.id, includeHtml: true } },
        }),
      }),
      env,
      { id: '802', source: 'telegram', accountId: '802' },
      SESSION_MCP_CREDENTIAL,
    );
    const viewerBody = (await viewerRead.json()) as { result?: { isError?: boolean } };
    expect(viewerBody.result?.isError).toBe(true);
  });
});
