/**
 * Syncs product memory (and optional BYOK keys) to the Worker/D1 workspace for the
 * signed-in account so logging back in restores DNA, audits, VFS, chat, and keys.
 */
import { apiBase, fetchWorkspace, putWorkspaceRemote, type WorkspacePayload } from '../apiClient';

const MEMORY_KEYS = [
  'luminara_business_dna',
  'luminara_vfs_nodes_v2',
  'luminara_last_audit_report',
  'luminara_context_graph_decisions',
  'luminara_native_llm_order',
  'luminara_freellm_base_url',
  'luminara_freellm_prefer',
  'luminara_local_serp_enabled',
  'luminara_crawler_provider',
  'luminara_audit_history_v1',
  'luminara_brand_memory_events_v1',
  'luminara_competitor_watchlist_v1',
  'luminara_competitor_alerts_v1',
  'luminara_agency_workspaces_v1',
  'luminara_agency_active_client',
  'luminara_visibility_history_v1',
] as const;

const KEY_BAG_KEYS = [
  'luminara_api_key',
  'luminara_groq_key',
  'luminara_groq_fallback_key',
  'luminara_nvidia_key',
  'luminara_nvidia_org_id',
  'luminara_openrouter_key',
  'luminara_ollama_key',
  'luminara_freellm_key',
  'luminara_tavily_key',
  'luminara_exa_key',
  'luminara_firecrawl_key',
  'luminara_browserbase_key',
  'luminara_fal_key',
  'luminara_tinker_key',
  'luminara_umami_key',
] as const;

const CHAT_SESSION_KEY = 'luminara_chat_session';
const LOCAL_META_KEY = 'luminara_workspace_meta';

type LocalMeta = { updatedAt: number; accountId?: string };

function readMeta(): LocalMeta {
  try {
    const raw = localStorage.getItem(LOCAL_META_KEY);
    if (!raw) return { updatedAt: 0 };
    return JSON.parse(raw) as LocalMeta;
  } catch {
    return { updatedAt: 0 };
  }
}

function writeMeta(meta: LocalMeta): void {
  localStorage.setItem(LOCAL_META_KEY, JSON.stringify(meta));
}

function collectPayload(): WorkspacePayload {
  const storage: Record<string, string> = {};
  for (const key of MEMORY_KEYS) {
    const v = localStorage.getItem(key);
    if (v != null && v !== '') storage[key] = v;
  }
  try {
    const chat = sessionStorage.getItem(CHAT_SESSION_KEY);
    if (chat) storage[CHAT_SESSION_KEY] = chat;
  } catch {
    /* ignore */
  }

  const keys: Record<string, string> = {};
  for (const key of KEY_BAG_KEYS) {
    const v = localStorage.getItem(key);
    if (v != null && v.trim()) keys[key] = v;
  }

  return {
    storage,
    keys: Object.keys(keys).length ? keys : undefined,
  };
}

function applyPayload(payload: WorkspacePayload): void {
  const storage = payload.storage || {};
  for (const [key, value] of Object.entries(storage)) {
    if (key === CHAT_SESSION_KEY) {
      try {
        sessionStorage.setItem(CHAT_SESSION_KEY, value);
      } catch {
        /* ignore */
      }
      continue;
    }
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore quota */
    }
  }
  const keys = payload.keys || {};
  for (const [key, value] of Object.entries(keys)) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  }
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let syncing = false;

/** Pull server workspace after login; server wins when it is newer. */
export async function pullWorkspaceOnLogin(): Promise<{ ok: boolean; accountId?: string; error?: string }> {
  if (!apiBase() || typeof window === 'undefined') return { ok: false, error: 'No API' };
  if (syncing) return { ok: false, error: 'busy' };
  syncing = true;
  try {
    const remote = await fetchWorkspace();
    if (!remote.ok) return { ok: false, error: remote.error || 'pull failed' };

    const local = readMeta();
    const remoteUpdated = remote.updatedAt || 0;
    if (remoteUpdated > 0 && remoteUpdated >= local.updatedAt) {
      applyPayload(remote.payload || {});
      writeMeta({ updatedAt: remoteUpdated, accountId: remote.accountId });
      window.dispatchEvent(new CustomEvent('luminara-workspace-restored', { detail: { accountId: remote.accountId } }));
    } else {
      const localPayload = collectPayload();
      const hasLocal =
        Object.keys(localPayload.storage || {}).length > 0 ||
        Object.keys(localPayload.keys || {}).length > 0;
      if (hasLocal) await flushWorkspacePush(true);
    }
    return { ok: true, accountId: remote.accountId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'pull failed' };
  } finally {
    syncing = false;
  }
}

/** Debounced push of local memory + keys to the account workspace. */
export function scheduleWorkspacePush(delayMs = 2500): void {
  if (!apiBase() || typeof window === 'undefined') return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    void flushWorkspacePush(false);
  }, delayMs);
}

export async function flushWorkspacePush(force = false): Promise<void> {
  if (!apiBase() || typeof window === 'undefined') return;
  const payload = collectPayload();
  const updatedAt = Date.now();
  const result = await putWorkspaceRemote({ updatedAt, payload, force });
  if (result.conflict && result.payload) {
    applyPayload(result.payload);
    writeMeta({ updatedAt: result.updatedAt || updatedAt, accountId: result.accountId });
    return;
  }
  if (result.ok) {
    writeMeta({ updatedAt: result.updatedAt || updatedAt, accountId: result.accountId });
  }
}

/** Call after local DNA / keys / audit changes. */
export function noteWorkspaceDirty(): void {
  const meta = readMeta();
  writeMeta({ ...meta, updatedAt: Date.now() });
  scheduleWorkspacePush();
}
