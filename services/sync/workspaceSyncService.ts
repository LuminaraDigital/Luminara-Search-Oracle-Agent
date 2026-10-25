/**
 * Syncs product memory (and optional BYOK keys) to the Worker/D1 workspace for the
 * signed-in account so logging back in restores DNA, audits, VFS, chat, and keys.
 */
import {
  accountKnownSignedIn,
  apiBase,
  fetchWorkspace,
  putWorkspaceRemote,
  type WorkspacePayload,
} from '../apiClient';
import { takeAccountBoot } from '../auth/accountBoot';
import {
  encryptKeyBag,
  decryptKeyBag,
  getOrCreateAccountEncryptionPassphrase,
} from '../crypto/envelopeEncryptionService';

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
  'luminara_sitewide_evidence',
  'luminara_sitewide_max_pages',
  'luminara_audit_history_v1',
  'luminara_brand_memory_events_v1',
  'luminara_competitor_watchlist_v1',
  'luminara_competitor_alerts_v1',
  'luminara_agency_workspaces_v1',
  'luminara_agency_active_client',
  'luminara_visibility_history_v1',
  // Mem0 + hosted fact mirrors (cross-device memory completion)
  'luminara_mem0_facts_v1',
  'luminara_mem0_relations_v1',
  'luminara_memory_facts_v1',
  'luminara_first_run_tour',
  'luminara_findings_board_v1',
  'luminara_upgrade_dismissed_v1',
  'luminara_win_shares_v1',
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
  'luminara_dataforseo_login',
  'luminara_dataforseo_password',
  'luminara_dataforseo_key',
  'luminara_firecrawl_key',
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

async function collectPayload(accountId?: string): Promise<WorkspacePayload> {
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

  const hasKeys = Object.keys(keys).length > 0;
  // Keys leave the browser only encrypted. With no account to derive the passphrase from, or if
  // encryption fails, they stay on this device instead of reaching the server in plain text.
  if (!hasKeys || !accountId) {
    return { storage };
  }

  try {
    const passphrase = getOrCreateAccountEncryptionPassphrase(accountId);
    const encryptedKeys = await encryptKeyBag(keys, passphrase);
    return {
      storage,
      encryptedKeys,
    };
  } catch (err) {
    console.warn('[WorkspaceSync] Client-side key encryption failed; keys stay on this device', err);
    return { storage };
  }
}

async function applyPayload(payload: WorkspacePayload, accountId?: string): Promise<void> {
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

  // 1. If encrypted key bag is present, decrypt client-side
  if (payload.encryptedKeys && accountId) {
    try {
      const passphrase = getOrCreateAccountEncryptionPassphrase(accountId);
      const decryptedKeys = await decryptKeyBag(payload.encryptedKeys, passphrase);
      for (const [key, value] of Object.entries(decryptedKeys)) {
        try {
          localStorage.setItem(key, value);
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      console.warn('[WorkspaceSync] Client-side key decryption failed:', err);
    }
  }

  // 2. Backward compatibility: apply legacy unencrypted keys if present
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
/** True after this page's sign-in pull finishes or cannot run. Guests are ready without it. */
let pullSettled = false;

/** Signed-in history is ready only after the workspace pull has settled. */
export function workspaceHistoryReady(): boolean {
  return !accountKnownSignedIn() || pullSettled;
}

function settleWorkspacePull(accountId?: string): void {
  pullSettled = true;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('luminara-workspace-restored', { detail: { accountId } }));
}

/** The account this browser's workspace copy last synced with. Unset for a guest's copy. */
export function workspaceAccountId(): string | undefined {
  return readMeta().accountId;
}

/** Clears all local workspace memory, keys, and chat session from the browser (e.g. on sign-out). */
export function clearLocalWorkspace(): void {
  pullSettled = false;
  if (typeof window === 'undefined') return;
  for (const key of MEMORY_KEYS) {
    try { localStorage.removeItem(key); } catch {}
  }
  for (const key of KEY_BAG_KEYS) {
    try { localStorage.removeItem(key); } catch {}
  }
  try { sessionStorage.removeItem(CHAT_SESSION_KEY); } catch {}
  try { localStorage.removeItem(LOCAL_META_KEY); } catch {}
}

/** Pull server workspace after login; server wins when it is newer. */
export async function pullWorkspaceOnLogin(): Promise<{ ok: boolean; accountId?: string; error?: string }> {
  if (!apiBase() || typeof window === 'undefined') {
    settleWorkspacePull();
    return { ok: false, error: 'No API' };
  }
  if (syncing) return { ok: false, error: 'busy' };
  syncing = true;
  let accountId: string | undefined;
  try {
    const booted = await takeAccountBoot();
    const remote: Awaited<ReturnType<typeof fetchWorkspace>> = booted
      ? {
          ok: true,
          accountId: booted.accountId,
          updatedAt: booted.workspace.updatedAt,
          payload: booted.workspace.payload,
        }
      : await fetchWorkspace();
    if (!remote.ok) return { ok: false, error: remote.error || 'pull failed' };

    const local = readMeta();
    // If switching accounts on this browser, purge previous account's local storage first
    if (local.accountId && remote.accountId && local.accountId !== remote.accountId) {
      clearLocalWorkspace();
    }

    const remoteUpdated = remote.updatedAt || 0;
    accountId = remote.accountId;
    if (remoteUpdated > 0 && remoteUpdated >= local.updatedAt) {
      await applyPayload(remote.payload || {}, remote.accountId);
      writeMeta({ updatedAt: remoteUpdated, accountId: remote.accountId });
    } else {
      // Pushes encrypt the key bag with the account in meta, so record it before any push.
      writeMeta({ ...readMeta(), accountId: remote.accountId });
      const localPayload = await collectPayload(remote.accountId);
      const hasLocal =
        Object.keys(localPayload.storage || {}).length > 0 ||
        Boolean(localPayload.encryptedKeys);
      if (hasLocal) await flushWorkspacePush(true);
    }
    return { ok: true, accountId: remote.accountId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'pull failed' };
  } finally {
    syncing = false;
    settleWorkspacePull(accountId);
  }
}

/** Debounced push of local memory + keys to the account workspace. */
export function scheduleWorkspacePush(delayMs = 3000): void {
  if (!apiBase() || typeof window === 'undefined') return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    void flushWorkspacePush(false);
  }, delayMs);
}

let lastPushFailedAt = 0;

export async function flushWorkspacePush(force = false): Promise<void> {
  if (!apiBase() || typeof window === 'undefined') return;
  // Guests have no account workspace; local state stays local until they sign in.
  if (!accountKnownSignedIn()) return;
  // If recently rate-limited (within 10s), back off
  if (Date.now() - lastPushFailedAt < 10_000 && !force) return;

  const meta = readMeta();
  const payload = await collectPayload(meta.accountId);
  // Ensure monotonic timestamp to avoid clock-skew conflicts
  const updatedAt = Math.max(Date.now(), (meta.updatedAt || 0) + 1);
  const result = await putWorkspaceRemote({ updatedAt, payload, force });
  if (result.conflict && result.payload) {
    await applyPayload(result.payload, result.accountId || meta.accountId);
    writeMeta({ updatedAt: result.updatedAt || updatedAt, accountId: result.accountId });
    return;
  }
  if (result.ok) {
    lastPushFailedAt = 0;
    writeMeta({ updatedAt: result.updatedAt || updatedAt, accountId: result.accountId });
  } else {
    lastPushFailedAt = Date.now();
  }
}

/** Call after local DNA / keys / audit changes. */
export function noteWorkspaceDirty(): void {
  const meta = readMeta();
  writeMeta({ ...meta, updatedAt: Date.now() });
  scheduleWorkspacePush();
}
