import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionableFixList } from '../components/retention/ActionableFixList';
import { WeeklyDecisionCard } from '../components/audit/WeeklyDecisionCard';
import { VisibilityRetentionCard } from '../components/suite/VisibilityRetentionCard';
import { completeWeeklyMission } from '../services/referrals/referralClient';
import { productTelemetry } from '../services/analytics/productTelemetry';
import {
  FINDINGS_BOARD_KEY,
  ingestCrewFindings,
  listLocalFindings,
  patchFindingStatus,
  type BoardFinding,
} from '../services/audit/findingBoardService';
import { AUDIT_ACTIVITY_EVENT } from '../services/audit/auditActivity';

const root = resolve(__dirname, '..');

function makeMemoryStorage() {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, val: string) => {
      store.set(key, val);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

describe('Item 3 Retention, Fix List, Weekly Decision & Streak/Mission Loop', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    productTelemetry.resetForTesting();
  });

  it('completeWeeklyMission fires mission_completed telemetry and dispatches AUDIT_ACTIVITY_EVENT', async () => {
    const trackSpy = vi.spyOn(productTelemetry, 'track');
    const dispatched: string[] = [];
    vi.stubGlobal('window', {
      location: { protocol: 'https:', origin: 'https://luminarasuite.com', search: '' },
      dispatchEvent: (ev: Event) => {
        dispatched.push(ev.type);
        return true;
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, created: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    const res = await completeWeeklyMission('checklist_fix');
    expect(res).toEqual({ ok: true });
    expect(dispatched).toContain(AUDIT_ACTIVITY_EVENT);
    expect(trackSpy).toHaveBeenCalledWith('mission_completed', { mission: 'checklist_fix' });
  });

  it('patchFindingStatus persists doneOn and writes to the durable localStorage bag across reloads', async () => {
    const localMem = makeMemoryStorage();
    const sessionMem = makeMemoryStorage();
    vi.stubGlobal('localStorage', localMem);
    vi.stubGlobal('sessionStorage', sessionMem);
    vi.stubGlobal('window', {
      location: { protocol: 'https:', origin: 'https://luminarasuite.com', search: '' },
      dispatchEvent: () => true,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 401 })),
    );

    await ingestCrewFindings({
      domain: 'harbour.example',
      syncRemote: false,
      findings: [
        {
          id: 'finding-llms-1',
          category: 'technical_seo',
          severity: 'high',
          title: 'Add /llms.txt summary',
          description: 'Provide a concise summary at /llms.txt.',
          status: 'open',
        } as any,
      ],
    });

    const patched = await patchFindingStatus('harbour.example', 'finding-llms-1', 'done');
    expect(patched?.status).toBe('done');
    expect(patched?.doneOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Simulate tab close by clearing sessionStorage; listLocalFindings must restore done status from localStorage bag
    sessionMem.clear();
    const restored = listLocalFindings('harbour.example');
    expect(restored).toHaveLength(1);
    expect(restored[0].status).toBe('done');
    expect(restored[0].doneOn).toBe(patched?.doneOn);
    expect(localMem.getItem(FINDINGS_BOARD_KEY)).toContain('"status":"done"');
  });

  it('ActionableFixList moves side effects out of setCompletedFixes updater and tracks fix_shipped', () => {
    const src = readFileSync(resolve(root, 'components/retention/ActionableFixList.tsx'), 'utf8');
    expect(src).toContain("productTelemetry.track('fix_shipped'");
    expect(src).toContain("completeWeeklyMission('checklist_fix')");
    expect(src).toContain('notifyAuditActivity()');
    expect(src).not.toContain('setCompletedFixes((prev) =>');
    expect(src).not.toContain('\u2014');

    const html = renderToStaticMarkup(
      createElement(ActionableFixList, {
        domain: 'example.com',
        findings: [
          {
            id: 'llms-txt',
            title: 'Add a short page at /llms.txt',
            description: 'Add /llms.txt',
          },
        ],
      }),
    );
    expect(html).toContain('0 of 1 fixes done');
  });

  it('WeeklyDecisionCard renders Mark done in #tour-mark-done and wires fix_shipped + checklist_fix mission', () => {
    const src = readFileSync(resolve(root, 'components/audit/WeeklyDecisionCard.tsx'), 'utf8');
    expect(src).toContain("productTelemetry.track('fix_shipped'");
    expect(src).toContain("completeWeeklyMission('checklist_fix')");
    expect(src).not.toContain('\u2014');

    const primary: BoardFinding = {
      id: 'fix-1',
      domain: 'example.com',
      stableKey: 'fix-1',
      category: 'content_quality',
      severity: 'high',
      title: 'Add agency name to homepage title',
      description: 'Homepage title omits brand.',
      status: 'open',
    };
    const html = renderToStaticMarkup(
      createElement(WeeklyDecisionCard, {
        domain: 'example.com',
        primary,
        findings: [primary],
        commitment: null,
      }),
    );
    expect(html).toContain('id="tour-mark-done"');
    expect(html).toContain('Mark in progress');
    expect(html).toContain('Mark done');
    expect(html).toContain('Re-check');
  });

  it('VisibilityRetentionCard surfaces server-backed streak and weekly tasks in plain-language mode without Lumens theater', () => {
    const src = readFileSync(resolve(root, 'components/suite/VisibilityRetentionCard.tsx'), 'utf8');
    expect(src).toContain('Active streak:');
    expect(src).toContain('weekly tasks done');
    expect(src).not.toContain('\u2014');

    const guestHtml = renderToStaticMarkup(
      createElement(VisibilityRetentionCard, {
        signedIn: false,
        onNavigate: () => {},
        plainLanguage: true,
      }),
    );
    expect(guestHtml).toContain('Next fix');
    expect(guestHtml).toContain('Sign in to see your next fix.');
    expect(guestHtml).not.toContain('Scout after');
  });
});
