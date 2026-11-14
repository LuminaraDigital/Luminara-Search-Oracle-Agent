import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AppRail, AppTabBar, AppTopBar, PRIMARY_VIEWS } from '../components/shell/AppShell';
import { ReviewView } from '../components/review/ReviewView';
import { actionQuestion, isOpen, type ActionRequestRow } from '../components/review/useActionRequests';
import { AppView } from '../types';

const noop = () => {};

function rail(view: AppView, businessName: string | null, pendingCount = 0): string {
  return renderToStaticMarkup(createElement(AppRail, {
    view,
    onNavigate: noop,
    onBrand: noop,
    brandTitle: 'Luminara home',
    businessName,
    onBusiness: noop,
    pendingCount,
    moreOpen: false,
    moreActive: false,
    onMore: noop,
    onSearch: noop,
    onSettings: noop,
    footer: null,
  }));
}

describe('app rail', () => {
  it('offers the business profile, the main tools and marks the open one', () => {
    const html = rail(AppView.INSTANT_AUDIT, null);
    expect(html).toContain('data-testid="add-business-pill"');
    expect(html).toContain('Add my business');
    for (const label of ['Ask', 'Instant Audit', 'Review', 'Dashboard', 'Memory', 'Studio', 'More tools', 'Jump to a tool', 'Settings and AI keys']) {
      expect(html, label).toContain(label);
    }
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*data-header-item="instant-audit"/);
  });

  it('names the business once it is set, and counts what waits in Review', () => {
    const html = rail(AppView.ORACLE_AGENT, 'Northfield Dental', 2);
    expect(html).toContain('Northfield Dental');
    expect(html).toContain('ND');
    expect(html).not.toContain('Add my business');
    expect(html).toContain('2 waiting');
  });

  it('shows no count when nothing waits', () => {
    expect(rail(AppView.ORACLE_AGENT, null, 0)).not.toContain('waiting');
  });
});

describe('phone tab bar', () => {
  it('has four tools and More, and Memory and Studio stay reachable through More', () => {
    const html = renderToStaticMarkup(createElement(AppTabBar, {
      view: AppView.REVIEW, onNavigate: noop, pendingCount: 1, moreOpen: false, moreActive: false, onMore: noop,
    }));
    const labels = [...html.matchAll(/<button[^>]*>.*?<\/svg>([^<]+)/g)].map((m) => m[1]);
    expect(labels).toEqual(['Ask', 'Audit', 'Review', 'Dashboard', 'More']);
    expect(html).toContain('lg-count');

    const app = readFileSync(resolve(__dirname, '..', 'App.tsx'), 'utf8');
    for (const v of ['BRAND_MEMORY', 'NOTEBOOK']) {
      expect(app, v).toContain(`onClick={() => { setView(AppView.${v}); setShowSuiteMenu(false); }}\n                    className="lg:hidden `);
    }
  });

  it('swaps with the rail at 1024px', () => {
    const css = readFileSync(resolve(__dirname, '..', 'ledger.css'), 'utf8');
    expect(css).toMatch(/\.lg-rail \{\s*display: none;/);
    expect(css).toContain('@media (min-width: 1024px) { .lg-rail { display: flex; } }');
    expect(css).toContain('@media (min-width: 1024px) { .lg-tabbar { display: none; } }');
  });

  it('counts every rail tool as primary, so More lights up only for the rest', () => {
    expect(PRIMARY_VIEWS.has(AppView.REVIEW)).toBe(true);
    expect(PRIMARY_VIEWS.has(AppView.TRUST_CENTER)).toBe(false);
  });
});

describe('top bar status', () => {
  const bar = (agent: 'idle' | 'working' | 'waiting', pendingCount: number) => renderToStaticMarkup(createElement(AppTopBar, {
    title: 'Ask', businessName: null, agent, pendingCount, onStatus: noop, onBrand: noop, brandTitle: 'Luminara home',
  }));

  it('says when the agent is waiting for the owner', () => {
    expect(bar('waiting', 3)).toContain('Waiting for your OK · 3');
    expect(bar('waiting', 3)).toContain('3 waiting for your OK. Open Review');
    expect(bar('working', 0)).toContain('Working');
    expect(bar('idle', 0)).toContain('Ready');
  });
});

describe('Ask composer', () => {
  it('keeps Quick and Thorough as the answer depth', () => {
    const src = readFileSync(resolve(__dirname, '..', 'components', 'InputBar.tsx'), 'utf8');
    expect(src).toContain("name: 'Quick'");
    expect(src).toContain("name: 'Thorough'");
  });
});

const NOW = Date.now();
const row = (over: Partial<ActionRequestRow>): ActionRequestRow => ({
  id: 'r1',
  project_id: null,
  tool_name: 'prepare_cms_mcp_call',
  args_json: '{"page":"/emergency"}',
  status: 'pending',
  kind: 'tool',
  decided_at: null,
  expires_at: NOW + 20 * 60000,
  created_at: NOW - 60000,
  ...over,
});

function review(props: Partial<Parameters<typeof ReviewView>[0]>): string {
  return renderToStaticMarkup(createElement(ReviewView, {
    signedIn: true,
    onSignIn: noop,
    rows: [],
    open: [],
    details: {},
    state: 'ready',
    onRefresh: noop,
    onDecide: async () => 'approved',
    ...props,
  }));
}

describe('Review', () => {
  it('asks a plain question for each known action and never shows a raw tool name', () => {
    expect(actionQuestion(row({}))).toBe('Prepare a change to your website?');
    expect(actionQuestion(row({ tool_name: 'decide_booking_signoff' }))).toBe('Decide on a proposed appointment?');
    expect(actionQuestion(row({ kind: 'budget_override' }))).toBe('Go past this run’s spending cap?');
    expect(actionQuestion(row({ tool_name: 'some_new_tool' }))).toBe('Run “some new tool” once?');
  });

  it('treats an expired or decided request as closed', () => {
    expect(isOpen(row({}), NOW)).toBe(true);
    expect(isOpen(row({ expires_at: NOW - 1 }), NOW)).toBe(false);
    expect(isOpen(row({ status: 'approved' }), NOW)).toBe(false);
  });

  it('shows what approving does, the details sent, and Approve and Deny', () => {
    const r = row({});
    const html = review({
      rows: [r],
      open: [r],
      details: {
        r1: { id: 'r1', toolName: r.tool_name, domain: 'example.com', args: r.args_json, argsTruncated: false, consequence: 'A change to your website will be prepared.', status: 'pending', expiresAt: r.expires_at },
      },
    });
    expect(html).toContain('Prepare a change to your website?');
    expect(html).toContain('A change to your website will be prepared.');
    expect(html).toContain('example.com');
    expect(html).toContain('&quot;page&quot;: &quot;/emergency&quot;');
    expect(html).toMatch(/<button[^>]*>.*Approve once<\/button>/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>.*Approve once/);
    expect(html).toContain('>Deny</button>');
  });

  it('allows Deny only while the details are loading or too long to show', () => {
    const r = row({});
    const loading = review({ rows: [r], open: [r] });
    expect(loading).toMatch(/<button[^>]*disabled=""[^>]*>.*Approve once/);
    const long = review({
      rows: [r],
      open: [r],
      details: { r1: { id: 'r1', toolName: r.tool_name, domain: null, args: '{}', argsTruncated: true, consequence: 'x', status: 'pending', expiresAt: r.expires_at } },
    });
    expect(long).toMatch(/<button[^>]*disabled=""[^>]*>.*Approve once/);
    expect(long).toContain('can only be denied');
  });

  it('lists recent decisions apart from what still waits', () => {
    const html = review({ rows: [row({ id: 'old', status: 'denied', decided_at: NOW - 1000 })] });
    expect(html).toContain('Nothing is waiting for you.');
    expect(html).toContain('Decided recently');
    expect(html).toContain('Denied');
  });

  it('asks a signed-out visitor to sign in instead of showing requests', () => {
    const html = review({ signedIn: false, state: 'idle' });
    expect(html).toContain('Sign in to see what your agents are asking.');
    expect(html).not.toContain('Approve once');
  });
});
