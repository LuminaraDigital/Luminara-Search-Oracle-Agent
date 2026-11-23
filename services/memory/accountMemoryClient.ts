/**
 * Account memory for the web app's own chat (every signed-in plan; the Agency server Oracle chat
 * does this itself). Before a reply: fetch the fenced memory block for the question. After the
 * reply: send the user's message so the server can extract facts, when the server says it should.
 * Memory is best-effort: a slow, failed or signed-out call gives no block and no extraction, and
 * while the server reports memory switched off the app stops asking for a while.
 */
import { apiBase, workerFetchWithAuthRetry } from '../apiClient';

export type AccountMemoryContext = { block: string; extract: boolean };

export const NO_ACCOUNT_MEMORY: AccountMemoryContext = { block: '', extract: false };

/** How long the chat waits for memory (sign-in token included) before replying without it. */
export const ACCOUNT_MEMORY_TIMEOUT_MS = 800;

/** After the server says recall and extraction are both off, ask again only after this long. */
export const MEMORY_OFF_RECHECK_MS = 10 * 60 * 1000;
const OFF_UNTIL_KEY = 'luminara_account_memory_off_until';

function memoryOffNow(): boolean {
  try {
    return Number(sessionStorage.getItem(OFF_UNTIL_KEY) || 0) > Date.now();
  } catch {
    return false;
  }
}

function rememberMemoryOff(): void {
  try {
    sessionStorage.setItem(OFF_UNTIL_KEY, String(Date.now() + MEMORY_OFF_RECHECK_MS));
  } catch {
    /* storage unavailable: ask again next time */
  }
}

async function requestMemory(base: string, query: string, timeoutMs: number): Promise<AccountMemoryContext> {
  const res = await workerFetchWithAuthRetry(`${base}/api/memory/context`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return NO_ACCOUNT_MEMORY;
  const data = (await res.json()) as { block?: unknown; recall?: unknown; extract?: unknown };
  const extract = data.extract === true;
  if (data.recall === false && !extract) rememberMemoryOff();
  return { block: typeof data.block === 'string' ? data.block : '', extract };
}

export async function fetchAccountMemory(query: string, timeoutMs = ACCOUNT_MEMORY_TIMEOUT_MS): Promise<AccountMemoryContext> {
  const base = apiBase();
  if (!base || !query.trim() || memoryOffNow()) return NO_ACCOUNT_MEMORY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<AccountMemoryContext>((resolve) => {
    timer = setTimeout(() => resolve(NO_ACCOUNT_MEMORY), timeoutMs);
  });
  return Promise.race([requestMemory(base, query, timeoutMs).catch(() => NO_ACCOUNT_MEMORY), timedOut]).finally(() =>
    clearTimeout(timer),
  );
}

/** Sends the user's own message for fact extraction. Never the assistant's reply. */
export async function rememberFromMessage(message: string): Promise<void> {
  const base = apiBase();
  if (!base || !message.trim()) return;
  try {
    await workerFetchWithAuthRetry(`${base}/api/memory/extract`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, autoStore: true }),
    });
  } catch {
    /* best-effort */
  }
}
