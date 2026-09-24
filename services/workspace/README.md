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
3. **Sync-on-login is server-wins.** `pullWorkspaceOnLogin()` (called from
   `App.tsx` and `AuthPanel.tsx` after sign-in) fetches the remote workspace;
   when `remote.updatedAt >= local.updatedAt` it applies the payload and
   dispatches `luminara-workspace-restored`. When local is newer and
   non-empty, it force-pushes local instead.
4. **Account switching purges.** If the logged-in account id differs from the
   locally stored one, `clearLocalWorkspace()` wipes memory keys, key-bag
   keys, and the chat session before applying the new payload.
5. **Push is debounced.** Mutations call `noteWorkspaceDirty()`, which writes
   a local meta timestamp and schedules a push after 2.5s
   (`scheduleWorkspacePush(2500)`); pushes are conflict-aware (server 409
   payload is applied locally).
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
  `users:index` sorted listing, account linking (one `account_id` across
  Telegram/Firebase logins), subscription dual-write, workspace payload
  round trip from KV.
