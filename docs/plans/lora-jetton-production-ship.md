# LORA Jetton: production and deployment plan

Owner: Luminara Digital. Author: Claude (sessions of 2026-10-07 and 2026-10-08). The status line is in section 0.

This plan takes the LORA Jetton in `contracts/jetton` from "works in a local sandbox" to "live on TON mainnet", without shipping any of the unreviewed work that sits uncommitted in the same checkout.

It inherits the rules in section 2 of `docs/plans/zoro-concepts-implementation-plan.md` (gates, release procedure, rollback, double-check protocol, licence keys) and adds the token-specific rules in section 2 below.

---

## 0. Verdict

**Status (2026-10-08): Phases 0 to 3 are done by the agent, up to an open pull request. Phases 4 and 5 need the owner's wallet. Nothing is deployed to any network.**

| Phase | What | Who | State |
|---|---|---|---|
| 0 | Decide the token and freeze its identity | Owner decided, agent applied | Done |
| 1 | Independent review, hardening, pinned code | Agent and reviewers | Done (section 8) |
| 2 | Launch and verification tooling | Agent | Done |
| 3 | Isolate the package from unreviewed work and ship it for CI | Agent | Done up to the pull request (section 9). Merging is the owner's (D5) |
| 4 | Testnet: launch, verify, rehearse | **Owner** approves in wallet | Not started |
| 5 | Mainnet: launch and verify | **Owner** approves in wallet | Blocked on Phase 4 by the tool |
| 6 | After launch | Owner and a later plan | Not started |

### 0.1 What "ready" means here

Ready for production means: the code that will be deployed is fixed and pinned by hash; it has been reviewed by reviewers other than its author and attacked with deliberate breaks; the only way to launch it is a tool that proves the launch locally first, cannot hold keys, and refuses mainnet until the same code and the same token identity have been exercised on testnet by a real wallet; and the result is checked on-chain by a script, not by eye.

It does not mean an outside audit firm has signed it off. The reviewers in section 8 are AI reviewers that did not write the code. An outside audit is the usual bar for a token that will hold real value, and it is listed as an owner decision in section 7.

### 0.2 What the agent cannot do

The agent cannot make the token live. Going live is one transaction that only the owner's wallet app can sign. The agent must never see a recovery phrase or a private key (rule J1), and has no Toncoin. Phases 4 and 5 are therefore a short checklist for the owner (section 6), backed by tools that do the checking.

---

## 1. Baseline

### 1.1 Verified on 2026-10-08

| Fact | Evidence |
|---|---|
| `origin/main` is `ee22a8c` and `origin/staging` is `cf6e698`. They have the same content: `main` is `staging` plus one merge commit | `git fetch`; `git diff --stat origin/staging origin/main` is empty |
| The main checkout is on `feat/trust-network-tn0-tn1` at `f741006` and holds uncommitted work from several sessions: 28 modified and 65 untracked paths, including vault, visibility, hub, `worker/oracleGateway.ts`, `worker/proofService.ts`, `worker/resourceTank.ts`, `worker/taskLifecycle.ts` and `.github/workflows/ton-ci.yml` | `git status --short` in the main checkout |
| The Jetton package is self-contained: its own `package.json` and lockfile, no import from app code. One file is read from outside it at run time: the deploy page serves the TON Connect browser bundle from the repository root's `node_modules` | `contracts/jetton/package.json`; a search for `../../` imports in `contracts/jetton/src`, `scripts` and `tests` finds none; `findTonConnectBundle` in `scripts/deploy.ts` |
| `staging` and `main` have no Jetton code and no LORA checkout. `contracts/` there is the Hardhat project | A search for "jetton" in tracked app code on `origin/staging` finds nothing |
| Root lint, typecheck and tests do not read `contracts/`: ESLint ignores `contracts/**`, `tsconfig.json` excludes `contracts`, Vitest includes only `tests/**/*.test.ts` | `eslint.config.js`, `tsconfig.json`, `vitest.config.ts` |
| A push to `staging` or `main` deploys the Worker. A push to `feat/**` only runs CI | `.github/workflows/deploy-cloudflare.yml` and `.github/workflows/ci.yml` (`on.push.branches`) |
| The token has 177 sandbox tests, and a mutation check with 143 deliberate breaks, every one of which is either caught by a test or shown to change nothing observable | `npm run jetton:test`, `npm run jetton:test:mutation` (section 9) |
| In the main checkout, another session's uncommitted app work adds LORA checkout and keeps it switched off | `JETTON_CHECKOUT_LIVE = false` in `worker/tonPayment.ts`, `Q402_SETTLEMENT_LIVE = false` in `worker/q402/facilitator.ts`, `tests/paymentFailClosed.test.ts` (all untracked or modified there, none on the release branch) |
| TON and Tonkeeper deep links have no documented parameter for contract code, so a wallet link cannot be relied on to deploy. TON Connect can carry contract code | Read on 2026-10-07: https://docs.ton.org/ecosystem/wallet-apps/deep-links, https://docs.tonconsole.com/tonkeeper/deep-linking |

### 1.2 The merchant wallet address

There is no variable called `TON_MERCHANT_WALLET_ADDRESS` in this repository. The merchant address is `TON_RECEIVING_ADDRESS`, a plain `vars` entry in `wrangler.jsonc`:

| Block | Value on `origin/staging` and `origin/main` |
|---|---|
| top level and `env.production` | `UQC2rrXgl2W5GhkSJ7lpoUAUXsBsDLNI4CXXUDqEdtCZ176T` |
| `env.staging` | `kQClpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpWTU`, a placeholder (its raw form is `0:a5a5...a5`) |

Three things follow.

1. **LORA needs no new merchant address.** A Jetton has no receiving address of its own. The merchant's LORA balance lives in a Jetton wallet contract that the token derives from the merchant address. LORA, USDT and Toncoin payments all name the same `TON_RECEIVING_ADDRESS`.
2. **Nobody but the owner can choose this address.** It must be the public address of a wallet whose recovery phrase the owner holds. An agent that "chose" one would either be inventing an address nobody controls or generating a key the owner does not hold. Rule J1 forbids both.
3. **The production value needs the owner's eyes.** Read through the public Toncenter API on 2026-10-07, `UQC2...176T` had never had a transaction on mainnet or testnet (account state `uninitialized`, last transaction `0`). That is normal for a wallet that has never been funded, and it is also what an address nobody controls looks like. The agent cannot tell which. Owner action O1 in section 7.

### 1.3 Not verified (each is closed by a named step)

| Unknown | Closed by |
|---|---|
| The token renders correctly (name, logo, balance) in a real wallet app and explorer | Phase 4, step T5 |
| A real wallet app accepts the TON Connect launch request with contract code attached | Phase 4, step T3 |
| The contracts behave on the real network as they do in the emulator | Phase 4, steps T3 to T5. The emulator is `@ton/sandbox` 0.45, whose fee and storage prices matched live mainnet when checked on 2026-10-07 |
| A Linux build produces the pinned code hashes | Phase 3, J3-5 (CI on the pull request) |
| The owner controls the production merchant address | Owner action O1 |
| Whether the earlier "LUMI" testnet deployment exists | Not needed. That token is retired (Phase 0). The owner can look up its address on testnet.tonviewer.com |

---

## 2. Rules

Rules 2.1 to 2.8 of `docs/plans/zoro-concepts-implementation-plan.md` apply. In addition:

| Rule | Text |
|---|---|
| **J1 Zero custody** | No recovery phrase, private key or wallet file is ever requested, read, generated for the owner, stored or used. Only the owner's wallet app signs. The agent sends no transaction on any network. |
| **J2 Pinned code** | Only code whose hashes equal `contracts/jetton/code-hashes.json` may be deployed. Changing the pin requires the full test suite, the mutation check and a review, in the same change. |
| **J3 Testnet first** | The mainnet deploy page does not start until the same pinned code is launched on testnet with the supply and metadata of `token.json`, has passed on-chain verification, and a real wallet has transferred and burned there. The tool checks this on-chain. |
| **J4 Isolation** | The release branch contains only the paths in section 4. Stage by explicit path. Never `git add -A`. |
| **J5 Checkout stays off** | Launching the token does not enable LORA checkout. The app must verify real Jetton transfers on-chain before it accepts them, and that is separate work with its own review. |
| **J6 Honest copy** | Nothing may describe LORA as taxed, yielding, revenue-sharing or auto-burning. The contract does none of those things. |
| **J7 One token** | LORA is the only in-house token. The retired LUMI v1 code is not shipped. |

Double-check protocol (rule 2.7, restated for this plan). After every task: re-run its acceptance check, typecheck and the targeted tests, and look for the regression it could cause. After every phase: full Jetton gates (tests, typecheck, sandbox run, mutation check when contracts or their tests changed), then re-read this plan's section against the code and correct whichever is wrong.

---

## 3. Phases

### Phase 0: Decide and freeze (done)

| Task | Result |
|---|---|
| J0-1 Choose the token | Owner decision 2026-10-07: the token built in `contracts/jetton` is the one in-house token. Name `Luminara Oracle Token`, symbol `LORA`, 9 decimals |
| J0-2 Single source of identity | `contracts/jetton/token.json`. Supply `100,000,000` |
| J0-3 Retire LUMI v1 | Kept out of the release branch (rule J7). It remains on the owner's disk under `contracts/jetton/legacy/`, untracked, until the owner deletes it (D6) |

### Phase 1: Independent review and hardening (done)

| Task | Acceptance |
|---|---|
| J1-1 Adversarial contract audit by a reviewer who did not write the code | Report with verified and suspected findings; every finding fixed or answered in section 8 |
| J1-2 Test-suite and tooling audit by a second reviewer | Same |
| J1-3 Redesign where the audits called for it, then a fresh audit of the redesign | Section 8, rounds 2 and 3 |
| J1-4 Mutation check | `npm run jetton:test:mutation` reports no surviving break |
| J1-5 Pin the code | `code-hashes.json` matches the build; `tests/deployment.spec.ts` enforces it; the compiler version is pinned exactly in `package.json` |

What the audits changed in the design:

- **Launch is a separate, admin-only step.** The first version minted the supply inside the deployment transaction. Anyone can send a deployment, so the tooling had to guard against the supply going to the wrong place. Now only the admin can send `Launch`, so the supply can only go to a wallet that has just signed. The option to name a different admin was removed.
- **Storage rent can no longer cost tokens.** A wallet that owed rent could lose a refund, and with it the tokens being refunded. Every handler now settles rent debt before it sends anything, and failed sends bounce instead of being dropped.
- **Fees are computed from the network's own prices**, not from constants, and the tests check the required amounts to the nanoTON.
- **The emulator was two years old.** It was replaced with the current one, whose prices match mainnet.

### Phase 2: Launch and verification tooling (done)

| Task | Acceptance |
|---|---|
| J2-1 Deploy page (`npm run jetton:deploy:testnet`) | Serves on `127.0.0.1` only. The admin is the connected wallet. Every request is dry-run on a local sandbox before it is shown. The address and amount are also printed in the terminal, where the page cannot change them. Server logic tested in `tests/deploy-server.spec.ts`; the page's own script tested click by click in `tests/deploy-page.spec.ts`; checked in a browser up to the wallet step |
| J2-2 On-chain verifier (`npm run jetton:verify`) | The same checks run against the sandbox in tests and against Toncenter for real networks. Exercised read-only against testnet |
| J2-3 Testnet rehearsal | One approval: a transfer and a burn from the admin wallet. Dry-run locally first |
| J2-4 Mainnet gate | `npm run jetton:deploy:mainnet` refuses unless `--confirm-mainnet` is passed and the testnet token passes on-chain checks: pinned code, launched, the supply and metadata of `token.json`, and a visible burn. Tested in `tests/deploy-server.spec.ts` |
| J2-5 Deployment record | `contracts/jetton/deployments.json`, written by the deploy tool after on-chain verification; never overwritten silently |

### Phase 3: Isolate and ship the package (done by the agent up to the pull request)

| Task | Acceptance |
|---|---|
| J3-1 Release worktree on a new branch from `origin/staging` | `git worktree list` shows it; the shared checkout's own files are untouched |
| J3-2 Copy only the paths in section 4 | `git status --short` in the worktree lists only those paths |
| J3-3 Jetton gates in the worktree | Tests, typecheck, sandbox run and mutation check pass there |
| J3-4 Root gates in the worktree | `npm run typecheck`, `npm run lint`, `npm test`, secrets and token checks pass, so the pre-push hook and CI will pass |
| J3-5 Commit, push the branch, open a pull request into `staging` | CI green, including `Jetton CI` on Linux reproducing the pinned code hashes |
| J3-6 Merge | **Owner (D5).** Follow rule 2.3. This change adds no Worker code and no migration; merging still triggers the usual staging deploy of the unchanged app |

### Phase 4: Testnet (owner, about 15 minutes)

Steps T1 to T6 in section 6. Exit criteria, all checked by tools:

- `npm run jetton:verify -- --network=testnet` passes;
- the rehearsal burn is visible in the total supply;
- `contracts/jetton/deployments.json` has a `testnet` entry, committed.

Phase 4 does not have to wait for the merge in J3-6. The package runs from any checkout that has it.

### Phase 5: Mainnet (owner, about 10 minutes)

Steps M1 to M5 in section 6. Entry is enforced by the mainnet gate (rule J3). Exit criteria:

- `npm run jetton:verify -- --network=mainnet --fresh` passes;
- `deployments.json` has a `mainnet` entry, committed;
- from that commit on, `tests/deployment.spec.ts` fails if the contract code in the repository ever differs from what is live.

### Phase 6: After launch (not part of this plan's execution)

| Item | Note |
|---|---|
| Finalise metadata, then drop the admin role or move it to a multisig | `DropAdmin` is irreversible. `ChangeAdmin` plus `ClaimAdmin` moves it |
| Move the supply to its long-term home | An ordinary transfer |
| LORA checkout in the app | Separate work (rule J5). Needs on-chain verification of Jetton transfers, per-asset decimals in pricing, the payer's Jetton wallet lookup, and an honest burn claim |
| Rent | The master costs about 0.0042 TON a year and keeps about 0.95 TON from the launch. `npm run jetton:verify` warns when its balance falls below 0.5 TON |
| Test tooling | Upgrade the test runner to clear its advisories (section 5). It does not touch the contract |

---

## 4. Release branch contents (rule J4)

Branch `feat/lora-jetton`, from `origin/staging`.

```
.github/workflows/jetton-ci.yml
contracts/.gitignore                      (adds the Jetton build output)
contracts/jetton/README.md
contracts/jetton/code-hashes.json
contracts/jetton/deployments.json
contracts/jetton/package.json
contracts/jetton/package-lock.json
contracts/jetton/tact.config.json
contracts/jetton/token.json
contracts/jetton/tsconfig.json
contracts/jetton/vitest.config.ts
contracts/jetton/contracts/*.tact         (3 files)
contracts/jetton/src/*.ts                 (7 files)
contracts/jetton/scripts/*                (7 files)
contracts/jetton/tests/*.ts               (13 files) and tests/fixtures/app-payloads.json
docs/plans/lora-jetton-production-ship.md
package.json                              (only the seven jetton:* script lines)
```

Deliberately left out:

| Path | Why |
|---|---|
| `contracts/jetton/legacy/` | Retired LUMI v1 (rule J7) |
| `tests/jettonContract.test.ts` | Imports `worker/q402` and `services/ton/jettonService.ts`, which exist only as another session's uncommitted work. It ships with that work |
| `.github/workflows/ton-ci.yml`, `contracts/ton/` | Another session's unreviewed work |
| `docs/plans/q402-qubic-ton-jetton-additive-plan.md` | Another session's document |
| Everything else in `git status` | Not part of the token |

After the pull request is merged, the main checkout still holds its own untracked copy of `contracts/jetton`. Git will refuse to bring the merged files in over it. Move `contracts/jetton/legacy/` aside if it is still wanted, delete the untracked copy, then pull.

---

## 5. Risks

| Risk | Likelihood | Effect | Control |
|---|---|---|---|
| A defect in the contract is found after mainnet | Low after review, never zero | Permanent: the code cannot be changed | Three review rounds, 143 deliberate breaks with none surviving, 450 random messages per test run, testnet rehearsal, owner decision D3 on an outside audit. The supply and admin stay with the owner, so a flawed token can be abandoned before it is distributed |
| The supply is created for an address nobody controls | Removed by design | Total, permanent loss of the supply | Only the admin can launch, and the admin is the wallet that signs the launch. There is no option to name another admin |
| The owner approves a mainnet transaction meaning to test | Low | 1 TON and a mainnet token at an address | Requests carry the network id and the sending wallet, which a wallet on the other network or account refuses. The mainnet page needs `--confirm-mainnet`, the testnet gate and three ticked statements |
| The deployed code is not the reviewed code | Low | Unknown behaviour, permanent | Pin (J2), dry run before every request, on-chain code hash check after |
| The page or a script it loads is tampered with and shows one address while requesting another | Low | Up to 5 TON sent to a contract that is not LORA. The real token is unaffected and can still be launched | The terminal prints the address and amount from the server process; the wallet app shows what it will sign; `npm run jetton:verify --fresh` checks the result without the browser |
| The real network behaves differently from the emulator | Low | A flow that passed locally fails live | Testnet launch and rehearsal with a real wallet before mainnet (J3); the emulator's prices are the network's own |
| Unreviewed work ships with the token | Was certain if the whole tree were pushed | Unreviewed code in production | Rule J4, section 4, release worktree |
| The token is announced with tax, yield or burn claims it does not implement | Medium | Misleading users; legal exposure | Rule J6; README; owner decision D4 |
| LORA checkout is enabled before on-chain verification exists | Medium | Paid plans without payment | Rule J5. Not part of this release |
| The master runs out of rent | Very low | Token contract frozen until topped up; balances are safe | The launch leaves about 0.95 TON, more than two hundred years at current prices; the verify script warns below 0.5 TON; anyone can top it up |
| The logo URL goes away | Low | Token shows without a logo | Owner checklist; metadata can be updated until the admin role is dropped |
| Toncenter public API is rate limited or down during a launch | Medium | The page cannot confirm the result | Reads are spaced and retried; `TONCENTER_API_KEY` raises the limit; "Check again" and `jetton:verify` work later. The launch itself does not depend on it |
| The page loses contact with its own local server for a moment | Seen on the owner's machine: a small share of new local connections time out | The page could look like a launch failed when it did not | The page retries by itself, and after the wallet has sent it never suggests sending again. Covered by `tests/deploy-page.spec.ts` |
| Advisories in build and test tools | Present | None on the token: the deployed contract is compiled bytecode with no dependencies | `npm audit` in `contracts/jetton` on 2026-10-08 reports 7: `protobufjs` 6.11.6 (critical, no fix published in its range) reached through the Tact compiler's `ipfs-unixfs-importer`, and the `vitest` 3 test runner with its `tinypool` and `@vitest/mocker` (fixed in `vitest` 5). The compiler only ever reads this repository's own contract source, and the test runner only runs this repository's own tests. Upgrading the test runner is a Phase 6 item; the root app uses the same runner version |

---

## 6. Operator checklist (owner)

Nothing below needs a recovery phrase. If anything asks for one, stop.

Run the commands from the repository root. If `contracts/jetton/node_modules` is missing, run `npm --prefix contracts/jetton ci` first.

### Testnet

| Step | Do | Expect |
|---|---|---|
| T1 | Set up a testnet wallet in your wallet app. In Tonkeeper this is a separate Testnet account (add a wallet and choose "Testnet account"; in older versions: Settings, tap the logo five times, switch to Testnet). A brand-new one is fine: the testnet wallet does not have to be the wallet that will own LORA on mainnet. Send its address to `@testgiver_ton_bot` on Telegram | About 2 test TON (one request). A testnet address starts with `k` or `0` |
| T2 | `npm run jetton:deploy:testnet`, open `http://127.0.0.1:4780/` | Page titled "Deploy Luminara Oracle Token (LORA) to testnet" with a TESTNET badge |
| T3 | Connect the wallet (scan the QR code). Press Deploy. Compare the "Token contract" address in three places: the page, the terminal, and the wallet app. Check the amount (1 TON). Approve | Page moves to "Check what is on-chain" |
| T4 | Wait for the checklist | "Verified", every line PASS. The terminal says the address was recorded |
| T5 | Press "Run the rehearsal", approve. Then look at LORA in the wallet and in the explorer link | Supply drops by 1 LORA. The token shows its name and the Luminara logo |
| T6 | Stop the page (Ctrl+C). Commit `contracts/jetton/deployments.json` on a branch and open a pull request into `staging`, or ask the agent to | A `testnet` entry |

If T3 fails because the wallet app does not accept the request, stop and report what the wallet showed. Nothing is lost: a launch that fails returns the Toncoin.

If the page says it could not finish checking after the wallet sent the transaction, do not approve again. Press "Check again".

### Mainnet

| Step | Do | Expect |
|---|---|---|
| M1 | Settle decisions D1 to D4 in section 7. Switch the wallet app back to Mainnet. Hold at least 1.2 TON | |
| M2 | `npm run jetton:deploy:mainnet -- --confirm-mainnet` | The tool reads testnet, prints PASS lines, then prints the page address. If any line is FAIL the page does not start |
| M3 | Open the page, connect the wallet that will own the token, tick the three statements, press Deploy, compare the address in the page, the terminal and the wallet, check the amount, approve | "Verified", every line PASS |
| M4 | Stop the page. `npm run jetton:verify -- --network=mainnet --fresh` | "Verified." |
| M5 | Commit `contracts/jetton/deployments.json` the same way as T6 | A `mainnet` entry. This address is LORA's permanent identity |

If `token.json` is edited after T5 (a new logo URL, a reworded description), the mainnet gate in M2 refuses, because that token has not been rehearsed. Remove the `testnet` entry from `deployments.json` and run T2 to T6 again. It costs test Toncoin only.

---

## 7. Owner decisions and actions

| Id | Item | Agent's recommendation |
|---|---|---|
| **O1** | Confirm the production merchant address. Open your wallet app on mainnet and compare its address with `UQC2rrXgl2W5GhkSJ7lpoUAUXsBsDLNI4CXXUDqEdtCZ176T` in `wrangler.jsonc`. If they differ, Toncoin payments are going to an address you may not control | Do this today. It affects live TON payments, not just LORA |
| **D1** | Which wallet owns LORA at launch | The wallet you launch from. The supply and the admin role can both be moved to a multisig later |
| **D2** | The logo at `https://luminarasuite.com/icon-512.png` | Keep it if it is the mark you want on the token. It can be changed until the admin role is dropped |
| **D3** | Outside audit before mainnet | Recommended if LORA will be sold or listed. Not required to launch and hold the whole supply yourself |
| **D4** | Legal review of how LORA is described | Required before any public sale or any claim about burns, yield or price |
| **D5** | Merge the release pull request into `staging`, then promote to `main` (rule 2.3) | Merge once CI is green. It changes no app behaviour |
| **D6** | Delete `contracts/jetton/legacy/` | Yes, once you no longer want the old LUMI code for reference |
| **D7** | The symbol. The app's glossary also uses "LORA" for an AI term (low-rank adaptation). There is no technical conflict | Keep LORA unless the overlap bothers you. Decide before mainnet: the symbol can be edited later, but people will have learned it |

---

## 8. Review record

The reviewers are AI reviewers run as separate agents. Each was given the code and asked to break it, not the author's conclusions.

| Round | Reviewers | Verdict | Outcome |
|---|---|---|---|
| 1 | Author's own mutation check on the first version: 31 deliberate breaks | 30 caught, 1 survived | Added a test for a bounced genesis mint; 31 of 31 caught |
| 2 | Contract security reviewer; test-suite and tooling reviewer (both wrote working proofs of their findings) | Not ready. 7 contract findings, 16 test and tooling findings | All fixed, most by redesign. Listed below |
| 3 | Pending | | |

Round 2 findings and what was done:

| Finding | Fix |
|---|---|
| A wallet in rent debt could lose a refund, and the refunded tokens with it | Every handler keeps back the rent owed before sending; reserve and send modes changed so a failed send bounces. Tests for wallets thirty years in debt and for frozen wallets |
| The discovery reply could strand Toncoin on the master | Reply mode changed; a request whose answer cannot be paid for bounces. Tested |
| Getters and messages worked before the supply existed | The contract answers nothing before launch except the admin's launch and top-ups. Tested for every message |
| The master's minimum balance covered too little rent | Launch requires 1 TON on the contract; about 0.95 TON stays |
| Test messages were sent with a zero message fee, so fee checks passed too easily | The harness charges the real fee; required amounts are now pinned to the nanoTON from the network's own formulas |
| A compiler option made every incoming message cost more gas than needed | Option set; gas budgets re-measured |
| The emulator was version 0.30 with old prices | Upgraded to 0.45; its prices compared with live mainnet |
| The mutation check missed a hidden mint and a drain of the master's Toncoin | New tests: no credit is ever sent by the master after launch, and the master's balance is unchanged by every message. Mutation list grew from 31 to 143 |
| A test depended on the wall clock | The local chain runs on a fixed clock |
| Metadata was only checked by encoding and decoding it with the same code | The exact bytes are pinned, key by key |
| The deploy tool passed a raw address to wallets and let the admin be someone other than the signer | Tool rewritten around the launch step: friendly bounceable address, the request names the wallet that must send it, the zero address is refused, no option to name another admin |
| `token.json` could carry control characters, a non-canonical URL or unknown fields | Strict validation, tested |
| The storage reserve and returned Toncoin were not pinned by tests | Exact-amount tests |
| The admin could replace on-chain metadata with a hosted file, or change the decimals | Metadata must stay on-chain and the decimals are fixed. Tested |
| Command-line tools accepted unknown or repeated options silently | Strict argument parsing, tested through each tool |
| Message layouts and query ids were not pinned | Layout tests for every standard message; query ids checked on every reply |
| Several assertions would have passed on the wrong failure | Matchers tightened to the exact exit code and sender |

---

## 9. Execution log

### 2026-10-07

- Phase 0: token identity fixed in `token.json`. LUMI v1 moved to `legacy/` and left out of the release.
- Phase 1, rounds 1 and 2. Contract redesigned around an admin-only launch; storage-rent handling rewritten; emulator upgraded; test suite rebuilt.
- Phase 2: deploy page, verifier, rehearsal, mainnet gate, deployment record.
- Phase 3: release worktree created from `origin/staging` at `cf6e698`; root gates run there.

### 2026-10-08

- Mutation check extended to 143 breaks and run in full. Result in the row below.
- A test of the deploy page server failed now and then on the owner's machine. Cause: that machine times out a small share of new loopback connections. The server's logic was separated from its socket layer and is now tested without sockets; the page retries by itself; a wallet-sent transaction is never reported as "nothing happened".
- The deploy page's own script had no automated test. It now has eleven, run against the real server logic and a local chain.
- The mainnet gate now also requires the testnet token's metadata to equal `token.json`.
- TON Connect's usage reporting is switched off on the deploy page.
- Round 3 review: pending.

| Gate | Result |
|---|---|
| `npm test` in `contracts/jetton` | Pending final run |
| `npm run typecheck` | Pending final run |
| `npm run test:mutation` | Pending final run |
| `npx tsx scripts/sandbox.ts` | Pending final run |
| Root `npm run typecheck`, `npm run lint`, `npm test` in the release worktree | Pending final run |
