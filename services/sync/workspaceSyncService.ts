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

/**
 * `baseVersion` is the server version (its `updatedAt`) this copy was last pulled from or saved as.
 * `dirty` means local edits since then that the server does not have yet. Older builds wrote only a
 * local-clock `updatedAt`; such a copy reads as based on nothing and not dirty, so it takes the server copy.
 */
type LocalMeta = { accountId?: string; baseVersion?: number; dirty?: boolean };

function readMeta(): LocalMeta {
  try {
    const raw = localStorage.getItem(LOCAL_META_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as LocalMeta;
  } catch {
    return {};
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

type PullResult = { ok: boolean; accountId?: string; error?: string };

const RESTORED_EVENT = 'luminara-workspace-restored';
/** A failed push is tried again once the 10 s backoff has passed. */
const PUSH_RETRY_MS = 11_000;

let pushTimer: ReturnType<typeof setTimeout> | null = null;
/** The running sign-in pull. No push starts while it runs, and a second caller shares it. */
let pullInFlight: Promise<PullResult> | null = null;
let pushInFlight: Promise<void> | null = null;
/** Bumped on every local edit, so a pull or push can tell whether edits landed while it ran. */
let editSeq = 0;
/** True after this page's sign-in pull finishes or cannot run. Guests are ready without it. */
let pullSettled = false;
/** True once this page's pull succeeded. Until then storage may hold another account's leftovers. */
let pullSucceeded = false;
/** Bumped by clearLocalWorkspace, so a pull that started before a sign-out does not apply its copy. */
let clearSeq = 0;
let onlineHooked = false;

/** Signed-in history is ready only after the workspace pull has settled. */
export function workspaceHistoryReady(): boolean {
  return !accountKnownSignedIn() || pullSettled;
}

function settleWorkspacePull(accountId?: string): void {
  pullSettled = true;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(RESTORED_EVENT, { detail: { accountId } }));
}

/**
 * Runs `listener` after every pull settles and after a refused push applied the stored copy, so
 * whatever shows synced state can re-read it from storage. Returns the unsubscribe.
 */
export function onWorkspaceRestored(listener: () => void): () => void {
  window.addEventListener(RESTORED_EVENT, listener);
  return () => window.removeEventListener(RESTORED_EVENT, listener);
}

/** The account this browser's workspace copy last synced with. Unset for a guest's copy. */
export function workspaceAccountId(): string | undefined {
  return readMeta().accountId;
}

/** Clears all local workspace memory, keys, and chat session from the browser (e.g. on sign-out). */
export function clearLocalWorkspace(): void {
  pullSettled = false;
  pullSucceeded = false;
  clearSeq += 1;
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

function hasLocalContent(): boolean {
  const stored = (key: string) => Boolean(localStorage.getItem(key));
  if (MEMORY_KEYS.some(stored) || KEY_BAG_KEYS.some(stored)) return true;
  try {
    return Boolean(sessionStorage.getItem(CHAT_SESSION_KEY));
  } catch {
    return false;
  }
}

/**
 * Pull the server workspace after login. The server copy wins unless this browser holds edits
 * made on top of the version the server still has (or the server has nothing yet); only then is
 * the local copy pushed. Concurrent callers share one pull.
 */
export function pullWorkspaceOnLogin(): Promise<PullResult> {
  if (!pullInFlight) {
    pullInFlight = runPull().finally(() => {
      pullInFlight = null;
    });
  }
  return pullInFlight;
}

async function runPull(): Promise<PullResult> {
  if (!apiBase() || typeof window === 'undefined') {
    settleWorkspacePull();
    return { ok: false, error: 'No API' };
  }
  const seq = editSeq;
  const cleared = clearSeq;
  let accountId: string | undefined;
  try {
    // A push already on the wire lands first, so the meta read below carries its version.
    await pushInFlight;
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
    // Signed out while this pull was on the wire: the copy belongs to the account that left.
    if (clearSeq !== cleared) return { ok: false, error: 'signed out' };

    let local = readMeta();
    // If switching accounts on this browser, purge previous account's local storage first
    if (local.accountId && remote.accountId && local.accountId !== remote.accountId) {
      clearLocalWorkspace();
      local = {};
    }

    const remoteVersion = remote.updatedAt || 0;
    accountId = remote.accountId;
    const ownEdits =
      (local.baseVersion || 0) === remoteVersion && (remoteVersion === 0 ? hasLocalContent() : Boolean(local.dirty));
    if (remoteVersion > 0 && !ownEdits) {
      // The server moved past this copy, or this copy has no edits of its own: the server copy wins.
      await applyPayload(remote.payload || {}, remote.accountId);
      writeMeta({ accountId: remote.accountId, baseVersion: remoteVersion, dirty: editSeq !== seq });
    } else {
      // Pushes encrypt the key bag with the account in meta, so record it before any push.
      writeMeta({ ...readMeta(), accountId: remote.accountId });
      if (ownEdits) await pushNow();
    }
    pullSucceeded = true;
    return { ok: true, accountId: remote.accountId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'pull failed' };
  } finally {
    settleWorkspacePull(accountId);
    // Pushes asked for during the pull were skipped; send those edits now.
    if (editSeq !== seq) scheduleWorkspacePush();
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

/**
 * Pushes the local copy now. `force` only skips the failure backoff: the server still refuses a
 * copy based on an older version than it holds. Skipped while a pull or another push runs; each
 * of those reschedules when edits landed during it. Before this page's pull has succeeded it runs
 * the pull instead, which pushes the local edits only when they belong on the server's version.
 */
export async function flushWorkspacePush(force = false): Promise<void> {
  if (!apiBase() || typeof window === 'undefined') return;
  // Guests have no account workspace; local state stays local until they sign in.
  if (!accountKnownSignedIn()) return;
  if (pullInFlight || pushInFlight) return;
  if (!pullSucceeded) {
    void pullWorkspaceOnLogin();
    return;
  }
  // If recently rate-limited (within 10s), back off and try again after it.
  if (Date.now() - lastPushFailedAt < 10_000 && !force) {
    scheduleWorkspacePush(PUSH_RETRY_MS);
    return;
  }
  // This push covers a debounced one still waiting; edits after it reschedule on their own.
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
  pushInFlight = pushNow().finally(() => {
    pushInFlight = null;
  });
  await pushInFlight;
}

/** Tries a failed push again after the backoff, or as soon as the browser is back online. */
function retryPushLater(): void {
  scheduleWorkspacePush(PUSH_RETRY_MS);
  if (onlineHooked) return;
  onlineHooked = true;
  window.addEventListener('online', () => {
    if (!readMeta().dirty) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = null;
    void flushWorkspacePush(true);
  });
}

/** One push based on the server version in meta. Never throws: a failure starts the backoff. */
async function pushNow(): Promise<void> {
  const meta = readMeta();
  const seq = editSeq;
  try {
    const payload = await collectPayload(meta.accountId);
    const result = await putWorkspaceRemote({ baseVersion: meta.baseVersion || 0, payload });
    const accountId = result.accountId || meta.accountId;
    if (result.conflict && result.payload) {
      // Another device saved first. Its copy wins, as it does on sign-in.
      await applyPayload(result.payload, accountId);
      writeMeta({ accountId, baseVersion: result.updatedAt || 0, dirty: false });
      window.dispatchEvent(new CustomEvent(RESTORED_EVENT, { detail: { accountId } }));
      return;
    }
    if (!result.ok) {
      lastPushFailedAt = Date.now();
      // Worth another try when the server was busy or down. A body it refused would fail again.
      if (!result.status || result.status === 429 || result.status >= 500) retryPushLater();
      return;
    }
    lastPushFailedAt = 0;
    const editedSince = editSeq !== seq;
    writeMeta({ accountId, baseVersion: result.updatedAt || 0, dirty: editedSince });
    if (editedSince) scheduleWorkspacePush();
  } catch {
    // Offline, or the request never completed.
    lastPushFailedAt = Date.now();
    retryPushLater();
  }
}

/** Call after a real local edit to synced state, never on mount or restore. */
export function noteWorkspaceDirty(): void {
  editSeq += 1;
  writeMeta({ ...readMeta(), dirty: true });
  scheduleWorkspacePush();
}

/** Stores one synced localStorage item. Only a value that differs from the stored one is an edit. */
export function saveWorkspaceItem(key: string, value: string | null): void {
  if (localStorage.getItem(key) === value) return;
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
  noteWorkspaceDirty();
}
