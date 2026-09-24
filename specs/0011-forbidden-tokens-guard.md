# Spec 0011: Repository Identity Guard (Forbidden Tokens)

Source pattern: paperclip `scripts/check-forbidden-tokens.mjs`. Brand: Luminara only.

## Context
`scripts/check-secrets.mjs` already scans for credential-shaped strings and forbidden filenames on staged/all files, and `.githooks` + `install-git-hooks.mjs` wire repo hooks. Gap: nothing blocks personal identity tokens (local usernames, home paths) or a configurable project token list from being committed. The 2026-09-22 audit (55 keys in history) shows why repo-side guards matter in addition to runtime redaction (spec 0009).

## Objective
Add `scripts/check-forbidden-tokens.mjs` (full-tree or staged scan for forbidden literal tokens) with a committed token list file, and wire it into the existing hooks/check pipeline.

## Requirements
1. New script `scripts/check-forbidden-tokens.mjs`:
   - Resolves forbidden tokens from two sources, merged and deduped (trimmed, non-empty):
     a. `.githooks/forbidden-tokens.txt` (one token per line, `#` comments allowed; missing file = empty list, not an error)
     b. Dynamic local identity: `process.env.USER / LOGNAME / USERNAME` plus `os.userInfo().username` fallback; ALSO the last path segment of `os.homedir()` if non-empty. Guard os calls in try/catch and degrade gracefully.
   - Modes: `--staged` (default, uses `git diff --cached --name-only --diff-filter=ACM`) or `--all` (uses tracked-file list via `git ls-files` plus untracked non-ignored files via `git ls-files --others --exclude-standard`). Match how `check-secrets.mjs` enumerates files where practical; read that script first and reuse its conventions.
   - Scan text files only: skip binary by extension list and by size cap (files > 2 MB skipped with a note). Skip the token list file itself and `.env*.example` files are already handled by check-secrets, still scan them here (tokens are literal strings, placeholders would only match if an operator literally listed them).
   - Matching: case-sensitive literal substring; report `file:line: which token source class (list|identity)` without printing the token itself when it came from identity resolution (print `local username` instead of the value). List-file tokens may be printed (they are committed by definition).
   - Exit 0 clean, 1 on findings or scan error; human-readable output consistent with check-secrets.mjs style.
2. `.githooks/forbidden-tokens.txt` committed with an initial list: placeholder comment header explaining format, plus entries the CEO decides are always forbidden (at minimum: the machine hostname patterns are NOT listed; keep initial list minimal with instructions).
3. Wire-in:
   - package.json: add `"tokens:check": "node scripts/check-forbidden-tokens.mjs --all"` script. Do not rename or remove `secrets:check`.
   - `.githooks/pre-commit` (read it first): append a call to `node scripts/check-forbidden-tokens.mjs --staged` after the existing secrets scan, failing the commit on exit 1. Keep hook POSIX-sh compatible.
4. Tests: `tests/forbiddenTokens.test.ts` (>= 10 cases): token file parsing (comments, blanks, missing file), identity resolution with mocked env/os, dedupe, staged/all enumeration via a temp git repo created in the test (`git init`, commit a file containing a token, assert detection; assert clean pass without it), identity-value non-disclosure in output, size cap skip.

## Edge cases
- Not inside a git work tree: exit 0 with a note (same tolerance as install-git-hooks.mjs).
- Token shorter than 3 chars in the list file: ignored with warning (false-positive guard).
- CRLF line endings in token file handled.

## Definition of done
- `node scripts/check-forbidden-tokens.mjs --all` exits 0 on the current repo.
- `npm run typecheck` green; `npx vitest run tests/forbiddenTokens.test.ts` green.
- New tests + no regressions in `npx vitest run tests/honestyGates.test.ts tests/envSchema.test.ts`.
- No em dashes; Luminara-only branding; comments mention no external vendor names.

## Iteration budget: 2 build-review loops. Verification: commands above.
