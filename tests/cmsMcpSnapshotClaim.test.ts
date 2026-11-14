import { beforeEach, describe, expect, it, vi } from 'vitest';

// Node test environment with no DOM: replace the hooks with a slot array so the
// panel can be called as a plain function and its click handler driven directly.
const slots: unknown[] = [];
let slotIndex = 0;
vi.mock('react', async (importActual) => {
  const actual = await importActual<typeof import('react')>();
  const useState = (initial: unknown) => {
    const i = slotIndex++;
    if (!(i in slots)) slots[i] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [slots[i], (v: unknown) => { slots[i] = v; }];
  };
  const hooks = { useState, useMemo: (fn: () => unknown) => fn(), useEffect: () => undefined };
  return { ...actual, ...hooks, default: { ...actual, ...hooks } };
});

const prepareSpy = vi.fn();
vi.mock('../worker/cmsMcpRelay', async (importActual) => {
  const actual = await importActual<typeof import('../worker/cmsMcpRelay')>();
  return { ...actual, prepareCmsMcpRemediationCall: (...a: unknown[]) => prepareSpy(...a) };
});

import { CmsMcpRemediationPanel } from '../components/audit/CmsMcpRemediationPanel';
import { CONVERSION_SPINE_MCP_TOOLS } from '../worker/mcpConversionTools';

const { prepareCmsMcpRemediationCall: realPrepare } = await vi.importActual<
  typeof import('../worker/cmsMcpRelay')
>('../worker/cmsMcpRelay');

const base = {
  accountId: 'acc_1',
  projectId: 'p1',
  domain: 'example.com',
  toolName: 'update_seo_metadata',
  userConfirmed: true,
};

describe('snapshot claim: relay', () => {
  it('reports false in the flags and the envelope when the caller omits the field', async () => {
    const res = await realPrepare({} as never, { ...base, connectorId: 'wordpress_com_mcp' });
    expect(res.status).toBe(200);
    expect(res.body.enforcedFlags).toMatchObject({ snapshot_before_write: false });
    const envelope = res.body.envelope as {
      jsonRpcPayload: { params: { arguments: { parameters: { snapshot_before_write: boolean } } } };
    };
    expect(envelope.jsonRpcPayload.params.arguments.parameters.snapshot_before_write).toBe(false);
  });

  it('allows Respira when the caller omits the field and reports false', async () => {
    const res = await realPrepare({} as never, { ...base, connectorId: 'respira_mcp' });
    expect(res.status).toBe(200);
    expect(res.body.enforcedFlags).toMatchObject({ snapshot_before_write: false });
  });

  it('passes through a caller that says true', async () => {
    const res = await realPrepare({} as never, {
      ...base,
      connectorId: 'respira_mcp',
      snapshotCreated: true,
    });
    expect(res.body.enforcedFlags).toMatchObject({ snapshot_before_write: true });
  });
});

describe('snapshot claim: MCP tool', () => {
  const tool = CONVERSION_SPINE_MCP_TOOLS.find((t) => t.name === 'prepare_cms_mcp_call')!;
  const run = (extra: Record<string, unknown>) =>
    tool.handler(
      { connectorId: 'wordpress_com_mcp', domain: 'example.com', ...extra },
      { env: {}, accountId: 'acc_1' } as never,
    );

  beforeEach(() => prepareSpy.mockReset().mockResolvedValue({ status: 200, body: { ok: true } }));

  it('passes an absent snapshotCreated on as absent', async () => {
    await run({});
    expect(prepareSpy.mock.calls[0][1].snapshotCreated).toBeUndefined();
  });

  it('keeps an explicit value', async () => {
    await run({ snapshotCreated: true });
    expect(prepareSpy.mock.calls[0][1].snapshotCreated).toBe(true);
  });
});

describe('snapshot claim: fix panel', () => {
  it('sends no snapshotCreated and shows the warning', async () => {
    slots.length = 0;
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, envelope: { jsonRpcPayload: { params: { arguments: { parameters: { snapshot_before_write: false } } } } } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const payload = { domain: 'example.com', title: 'Fix', schemaJsonLd: '{}' } as never;
    const render = () => {
      slotIndex = 0;
      return CmsMcpRemediationPanel({ payload }) as unknown as { props: unknown };
    };
    const findNode = (node: any, pred: (n: any) => boolean): any => {
      if (!node || typeof node !== 'object') return null;
      if (pred(node)) return node;
      const kids = [node.props?.children].flat(Infinity);
      for (const k of kids) {
        const hit = findNode(k, pred);
        if (hit) return hit;
      }
      return null;
    };
    const text = (node: any): string =>
      [node?.props?.children].flat(Infinity).map((c: any) => (typeof c === 'string' ? c : c ? text(c) : '')).join('');

    render();
    slots[0] = true; // expanded
    const button = findNode(render(), (n) => n.props?.onClick && text(n).includes('Prepare Verified MCP Envelope'));
    await button.props.onClick();

    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/cms-mcp/prepare-call'));
    const body = JSON.parse(String((call![1] as RequestInit).body));
    expect(body).not.toHaveProperty('snapshotCreated');
    expect(body.userConfirmed).toBe(true);

    const warning = findNode(render(), (n) => text(n).includes('No backup snapshot is taken. Back up the page first.'));
    expect(warning).not.toBeNull();
    vi.unstubAllGlobals();
  });
});
