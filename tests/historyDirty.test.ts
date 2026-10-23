import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/sync/workspaceSyncService', async () => {
  const actual = await vi.importActual<typeof import('../services/sync/workspaceSyncService')>(
    '../services/sync/workspaceSyncService',
  );
  return {
    ...actual,
    noteWorkspaceDirty: vi.fn(),
    flushWorkspacePush: vi.fn(async () => {}),
  };
});

import { setAccountSignedIn } from '../services/apiClient';
import { auditHistoryService } from '../services/audit/auditHistoryService';
import { flushWorkspacePush, noteWorkspaceDirty, workspaceHistoryReady } from '../services/sync/workspaceSyncService';

afterEach(() => {
  auditHistoryService.clear();
  setAccountSignedIn(null);
});

describe('audit history workspace sync', () => {
  it('marks the workspace dirty after a successful history write', () => {
    auditHistoryService.record({
      domain: 'https://example.com/pricing',
      focus: 'AEO',
      reportText: 'A completed Instant Audit report with enough text to store as history for this domain.',
    });
    expect(noteWorkspaceDirty).toHaveBeenCalled();
    expect(flushWorkspacePush).toHaveBeenCalled();
  });

  it('waits for the sign-in pull before calling saved history ready', () => {
    expect(workspaceHistoryReady()).toBe(true);
    setAccountSignedIn(true);
    expect(workspaceHistoryReady()).toBe(false);
    setAccountSignedIn(null);
    expect(workspaceHistoryReady()).toBe(true);
  });
});
