# Workspace (agency clients + zero-knowledge sync)

## What this does

`services/workspace/agencyWorkspaceService.ts` holds per-client workspaces
(name, domains, DNA, notes) for Pro/Agency plans. Sync with the account-scoped
workspace blob is handled by `services/sync/workspaceSyncService.ts`; the
server side lives in `worker/userStore.ts` (D1 preferred, KV fallback). See
`specs/0002-project-memory.md` for the D1 project-memory record shape.

## Invariants

1. **Zero-knowledge key bag.** `EncryptedKeyBag` in the workspace payload is
   encrypted client-side with AES-256-GCM over a key derived with PBKDF2
   (SHA-256, 100,000 iterations); passphrase must be >= 8 chars
   (`services/crypto/envelopeEncryptionService.ts`). The server stores the
   bag opaquely and never sees plaintext keys; the legacy plaintext `keys`
   map is kept only for backward compatibility on pull.
2. **Workspace blob shape.** `WorkspacePayload = { storage?: Record<string, string>, keys?: Record<string, string>, encryptedKeys?: EncryptedKeyBag }`
   (`worker/userStore.ts`). Storage entries are localStorage-style key/value
   strings; nothing else may be added without updating both readers.
3. **Sync is versioned and server-wins.** The server's `updatedAt` is the
   version. Local meta (`luminara_workspace_meta`) keeps `baseVersion` (the
   version this copy was last pulled or saved as) and `dirty` (edits not yet
   pushed). `pullWorkspaceOnLogin()` (called from `App.tsx` and
   `AuthPanel.tsx`; concurrent callers share one pull) applies the server copy
   and dispatches `luminara-workspace-restored`, unless this copy is dirty and
   its `baseVersion` is still the server's version, or the server has nothing
   yet and the browser does. Only then does it push the local copy. The server
   has no force override. A pull that started before `clearLocalWorkspace()`
   (sign-out) does not apply its copy. Until this page's pull has succeeded, a
   push runs the pull instead, so leftovers from another account are never sent.
   `onWorkspaceRestored()` fires after every pull and after a refused push; App
   re-reads DNA and chat from storage on it.
4. **Account switching purges.** If the logged-in account id differs from the
   locally stored one, `clearLocalWorkspace()` wipes memory keys, key-bag
   keys, and the chat session before applying the new payload.
5. **Only real edits push, debounced.** Mutations call `noteWorkspaceDirty()`,
   which sets `dirty` and schedules a push after 3 s. Mount and restore must not
   call it: `saveWorkspaceItem()` writes an item and marks it dirty only
   when the stored value changes (App's DNA effect uses it). A push sends
   `baseVersion`. On a 409 the stored copy is applied locally and wins. No push
   starts while a pull or another push runs; edits made meanwhile are pushed
   once it ends. A failed or offline push never throws: it keeps `dirty`,
   backs off for 10 s, and retries after 11 s and on the browser's `online`
   event. A 4xx other than 429 is not retried, since the same body would fail
   again.
6. **Agency workspaces are plan-gated and bounded.** `createClient` enforces
   `entitlementsFor(planId).agencyClientLimit`; `canUseAgency` is false when
   the limit is 0. Names trimmed to 120 chars; domains normalized
   (protocol/www/port/path stripped, lowercased).
7. **Active-client DNA overlay.** `setActiveClient` overlays the client's DNA
   into `luminara_business_dna` so audits personalize, and fires
   `luminara-workspace-restored`.

## Stubbed vs live status today

- Live: client CRUD, plan gating, DNA overlay, debounced push, login pull,
  conflict handling, KV fallback for D1.
- Live: AES-256-GCM + PBKDF2 envelope encryption client-side; verified in
  `services/crypto/envelopeEncryptionService.ts`.
- D1 binding in production: preferred when `DB` is bound, KV otherwise
  (worker/userStore.ts header); local tests run against KV fakes.

## Env vars

Front-end: none directly (uses `apiBase()` from `services/apiClient`).
Worker: `DB` (D1, optional), `LUMINARA_KV` (KV fallback), plus auth/session
env covered in `worker/README.md`.

## Key tests

- `tests/userStore.test.ts`: KV profile upsert preserving `created_at`,
  `users:index` sorted listing, explicit account linking (one `account_id`
  across Telegram/Firebase logins, paid side wins, dual-paid refuses with
  no write), subscription dual-write, workspace payload round trip from KV.
- `tests/accountLink.test.ts`: `identify()` with both credentials does not
  merge; `POST /api/auth/link` requires `{ confirm: true }`.
- `tests/workspaceSyncVersion.test.ts`: mount/restore are not edits, a stale
  browser takes the newer server copy, a 409 fires the restored event, no
  push during a pull or before one succeeded, offline push backs off and
  retries. `tests/workspaceVersionRoute.test.ts`: the Worker side.
