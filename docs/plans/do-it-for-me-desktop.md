# Do It For Me: a desktop product for non-technical owners (Track DF)

**Status: Reviewed. GO for DF0, DF1 and DF2 once the owner approves. DF3 stays gated (section 4).**

Audited against `origin/staging` at `a799c15` on 2026-11-01. Line citations are to that commit.
Rules for every task (gates, flags, release) are inherited from section 2 of `docs/plans/zoro-concepts-implementation-plan.md`. Agent, roster and Fix Board work stays in Track SW.

## 0. Verdict

Do not add general computer control. Build one promise: **"We found the problem. Click once, approve it, and we fix it and prove it worked."**

That promise is only true on a connected platform, so it arrives in DF3, on one platform first. The steps before it make the app safe to install and test whether people want the fix:

1. Ship the safer Windows app and count who uses it (DF0).
2. Prove a new user can finish an audit with no keys, and detect their website platform (DF1).
3. Ship a guided fix pack with a live "Did it work?" check (DF2). **This is a demand test, not the product.** Someone who cannot paste code still needs another person, so it must never be sold as "done for you".
4. Ship the real "Do it for me" on one platform (DF3), if the gates in section 4 pass.

### Who uses it and who pays

- **User:** a non-technical small-business owner.
- **Buyer through 28 Dec:** an agency. The owner's growth plan (a Claude Doc, not in this repo) needs 10 paying agencies, and an agency can use a checked fix as a client deliverable across many sites.
- DF2 is tested on both. A paying agency is the stronger signal. Owner-level pricing is decided after that evidence exists. If the owner names small businesses as the buyer instead, DF2 is re-scoped before it starts.

## 1. Baseline

| Area | What is true today | Evidence |
|---|---|---|
| Automated fix | Does not exist. No Worker apply route. The browser calls the CMS directly | `services/deployment/cmsDeploymentService.ts:352`, `:433`, `:538-623` |
| Fix types | One: Organization JSON-LD. llms.txt and robots.txt are free tools only | `services/geminiService.ts:954`; `components/marketing/freeTools/` |
| WordPress | Hidden. Posts an unregistered setting, so a stock site cannot pass | `components/audit/CmsDeploymentModal.tsx:22-28` |
| Webflow | A 2xx counts as success. No read-back | `cmsDeploymentService.ts:410-470` |
| Read-back | WordPress only. A schema merged into `@graph` reads as missing. Any signed-in user can probe any public URL | `worker/deployReadback.ts`; `worker/README.md:81` |
| Undo | None for site changes | `cmsDeploymentService.ts` |
| Credentials | Plaintext browser localStorage if "remember" is ticked. No Worker-side token encryption exists; the envelope service is client-side and zero-knowledge | `cmsDeploymentService.ts:80`, `:120-158`; `worker/README.md:32` |
| Approval record | None for fixes. `external_effects` gives idempotency only | `worker/externalEffectsService.ts` |
| Preview | Raw code diff only | `cmsDeploymentService.ts:234` |
| Windows installer | Unsigned. v1.0.2 is from 2026-09-11 on Electron ^37.10.3; staging is ^44.7.2. It predates the hardening already on staging | `.github/workflows/desktop-windows.yml:26-55`; `package.json:117`; commits `11a5a42`, `3b6d22d` |
| Coordinator | Started, but only `validateMcpCall` is used. No routine timer. Crawler is not in the installer. Keychain falls back to base64 and reports success | `electron/coordinator/desktopCoordinator.cjs:185`, `:266-298`, `:313-331`, `:367`; `electron-builder.yml:7-10` |
| Notifications | No native notice, no start-at-login | `services/harness/reminderService.ts:113-122` |
| Measurement | No desktop dimension, no download counter, no fix events | `services/analytics/productTelemetry.ts:21`; `worker/productAnalytics.ts:22` |
| New-user language | "Keys", "evidence chips", SEO/AEO/GEO toggles, Business DNA and a Trinity engine panel reach new users | `services/audit/hostedScoutRail.ts:13`, `:16`, `:88`; `components/audit/InstantAuditView.tsx:614-627`, `:720`, `:901`; `App.tsx:1582` |

## 2. Constraints this plan keeps

- **Agents prepare; the founder ships** (`docs/plans/founder-swarm-business-brain-additive-plan.md:213`). Every write starts with the owner clicking Approve on one exact change. No agent starts a write. Decision 18 stays at its default.
- **No local agent runner** (`docs/plans/oracle-operations-layer-additive-plan.md:261-263`). Work runs on the server.
- **The deploy screen tells the truth** (SW0a-17). "Fixed" appears only after a live fetch saw the change.
- **Never invent metrics.** A missing result reads as not checked.
- **Telegram sells digital goods for Stars only** (`components/paywall/paymentOptions.ts:39`, `:73`).
- **Growth outranks new features until 28 Dec.**

## 3. What the owner experiences

**DF2, any site:** gets one plain sentence and one fix, then a pack with a plain-language message to give their web person. Anyone can then press **Did it work?**

**DF3, supported platform:**

1. Clicks **Do it for me** and connects once on the platform's own Allow screen.
2. Reads the change in plain words, with the exact change one click away, and clicks **Approve**.
3. Sees one honest outcome: **Fixed, we checked your live site**; **Waiting for your site to update**; or **Not confirmed, here is what to do**.
4. Can click **Undo**.

## 4. Phases

**Progress (2026-11-01):** DF0-2, DF0-3, DF1-2 and DF1-3 are built. DF1-1 is partial: `/api/health` reports `hostedAudit` and the smoke check warns when it is false, on each deploy, not on a schedule. A real full audit needs a test account from the owner. DF1-4 is partial: the focus and lens controls sit behind Advanced; the one-fix view waits for #287 and engine panels and Business DNA are unchanged. DF0-1 waits for this branch to reach staging.

### DF0: Safer Windows app (start now)

| Task | Change | Done when |
|---|---|---|
| DF0-1 | Tag a new `desktop-v*` release from staging. The hardening (`11a5a42`, `3b6d22d`) is already there. PR #255 (Electron 44.9.1, draft) is optional | Installed v1.0.2 updates to the new shell on a clean Windows machine |
| DF0-2 | Add a `surface` field to telemetry and a counter on `/desktop/windows` | Downloads and desktop activations can be counted |
| DF0-3 | Delete the base64 path so `storeSecret` throws. Confirm the installer holds no `.env` or secrets | Test covers the failure |
| DF0-4 | After the owner buys the certificate: set `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`, and fail a release when the secret is absent unless overridden on purpose | The installer shows Luminara as publisher |

`electron-builder.yml` sets no `publisherName`, so an unsigned install should accept a signed update. Test this on a real machine in DF0-4. Setting `publisherName` later could break updates for existing installs, so do not add it without that test.

### DF1: Prove the first audit and detect the platform (by the 5 Nov gate)

| Task | Change | Done when |
|---|---|---|
| DF1-1 | Scheduled smoke test: a new no-key account completes a full audit | The 5 Nov gate is measured, not assumed |
| DF1-2 | Record the detected platform (WordPress, Wix, Shopify, Squarespace, Webflow, other, unknown) on each audit | Platform share can be counted. This is a required input to DF3 |
| DF1-3 | Replace sign-in, allowance and failure copy. Signed-in users never see "keys" | `tests/plainLanguage.test.ts` extends to Instant Audit and the report. Does not hold the 5 Nov gate |
| DF1-4 | Default view is website box, verdict, one fix. Lens toggles, focus buttons, engine panels and Business DNA move behind Advanced | Screenshot review. Does not hold the 5 Nov gate |

DF1-4 needs `primaryFinding.ts`, which exists only in draft PR #287. Land or extract it first. Land #288 before adding telemetry events, because both touch `productTelemetry.ts`. Check the state of both PRs before starting each task, because open PRs can merge in bulk without notice.

### DF2: Guided fix pack and live check (by the 19 Nov gate)

No site credentials and no site writes. **Minimum for 19 Nov: DF2-1, DF2-2, DF2-6 and DF2-7.** DF2-3, DF2-4 and DF2-5 are stretch.

| Task | Change | Done when |
|---|---|---|
| DF2-1 | Fix types: Organization JSON-LD (exists), llms.txt, robots.txt AI-crawler rules. Reuse the free-tool generators | Output passes a validator. robots.txt output can never block all crawlers or remove a rule |
| DF2-2 | Generalise `/api/deploy/readback` to JSON-LD including `@graph`, `/llms.txt` and `/robots.txt`. Target is the audited origin on the caller's own audit record, with host and path taken from the stored fix. It refuses a different host, including after redirects, and keeps `fetchPublicUrl` and the standard-port limit. The body is never returned | The `@graph` limit is gone and the README invariant is updated. A test proves another user's site is refused |
| DF2-3 | Plain-English preview from templates, not from a model | The exact code stays one click away |
| DF2-4 | Where-to-paste guides per platform, plus a plain "what to ask your web person" message | No guide ships untested on a real site |
| DF2-5 | "Send to my web person": a copy-to-clipboard message and a printable page. No public link and no Luminara-sent email | The message reads clearly to someone who has never seen the audit |
| DF2-6 | **Did it work?** with the three outcomes, for the signed-in owner only | A delayed page reads as Waiting, not failed or fixed |
| DF2-7 | Events `fix_requested`, `fix_pack_opened`, `fix_verified`, added to the client union and Worker allow-list | Events appear in staging analytics |

A public share link is deferred until someone asks for it. If built, it needs: a token of at least 128 bits, stored hashed, expiring in 14 days and revocable; a snapshot of generated code only; noindex with `Referrer-Policy: no-referrer`; no token in logs; a check that takes only the token and accepts no URL; a limit counting only failed checks against the token, plus a separate per-IP limit.

The owner may walk people through DF2 personally. Real owners, agencies and design partners all count. Record the number who reach `fix_verified` and what stopped the others. At this volume, the result is evidence and not a statistical pass or fail.

### Gate to start DF3

All of these, reviewed by the owner after the 19 Nov growth gate:

- DF2 notes show people want the fix, and at least one agency or owner says they would pay for it to be done.
- Wix is about 10 percent or more of detected platforms in DF1-2, or the owner picks it knowingly. Otherwise choose again. At low volume, also count the owner's sales prospects.
- The Wix spike returns go.

**Stop rule:** the owner's growth plan sets 150 activated and 3 payers for 19 Nov. If that day shows under 75 activated or 0 payers, pause DF3 and put the effort into the growth plan.

DF3 has no date. It depends on a platform review we do not control.

### DF3: Real "Do it for me" on one platform

**First platform: Wix.** It is the only builder where research found official write APIs for all the fix types. Those claims come mostly from search snippets, so the spike confirms them. Self-hosted WordPress has larger reach, but core REST cannot write head code or root files, so it needs our own plugin, which is not a one-click task.

**Spike, 2 days at most, fixed go or no-go, on an owner-controlled Wix site:** live review time (docs conflict: up to 15 business days, or minutes); whether robots.txt is still Developer Preview and what that permits; read endpoints for llms.txt and embeds; whether changes go live at once; PKCE support; developer terms on automated changes. On no-go, stop and return to the owner. Do not silently switch platform.

| Task | Change | Done when |
|---|---|---|
| DF3-1 | Build Worker-side AES-GCM token encryption keyed by a new secret, with key id and rotation. Per-connection data key. Refresh tokens rotate on use. Failed refresh marks the connection `needs_reconnect`, blocks writes and tells the owner | Test asserts no token in D1 plaintext, any response, log or error |
| DF3-2 | Connections table and OAuth: state is single-use, bound to user and session, expires in 10 minutes. PKCE if supported. Exact redirect URI. A site instance binds to one Luminara account through an OAuth grant from a Wix account that owns the site, and apply checks that its primary domain equals the audited domain. A claim is released by Disconnect or a verified Wix uninstall webhook, and uninstall is treated as Disconnect. Disconnect deletes the token even if the revoke call fails | A second account is refused with a plain message. Every route takes the account from the session; a tenant isolation test proves it |
| DF3-3 | Fix applications table: finding, payload hash, approver, changed-field before-image (256 KB cap), after-state hash, outcome, timestamps. Before-images are kept 90 days, or until 30 days after Disconnect, deleted with the account and never shown unauthenticated. Migration named at PR time; #287 claims 0044 | One row tells the full story of a change |
| DF3-4 | Single-use approval bound to session user, connection id, payload hash and short expiry, after typing the domain name to confirm. Apply needs a session under 15 minutes old, otherwise re-sign-in. Every apply and undo notifies the account owner by email. The token is scoped to one site | Changed payload, replay or expired approval is refused |
| DF3-5 | Worker apply route: read the before-image, refuse if the site changed since preview or the before-image is unreadable, write, read back under the DF2-2 same-host rule. robots.txt and llms.txt get a marked block appended, never a whole-file replace. Limits: 5 applies a day per account, 2 per site. Use `checkOrRecordExternalEffect` and `finalizeExternalEffect` for idempotency, with the connection id and payload hash in the key | No write without a stored before-image. Two clicks produce one write |
| DF3-6 | Worker undo route: writes only when the live value equals the stored after-state hash, and restores only what Luminara wrote. Otherwise it refuses and shows the before-image for manual restore. If the token is dead, it shows the same manual steps with a copy button and offers Reconnect, which re-authorises the same site and then offers Undo | Undo cannot overwrite newer owner work. A lapsed paid plan does not block Undo. A dead token never strands the owner |
| DF3-7 | Flag `DO_IT_FOR_ME_ENABLED`, in all three wrangler blocks, default false. Off means guided pack only. Disconnect always works, and Undo works while the token is live | Verified on staging |
| DF3-8 | One button across web and desktop. Telegram paid path goes to Stars | Tested per surface |
| DF3-9 | Entitlement: one free verified fix per account, then Growth | Refused writes spend nothing. Copy stays "30 days" |
| DF3-10 | Privacy policy and terms cover site access, tokens and before-images, with retention and deletion | Owner approves before the flag turns on |
| DF3-11 | Owner-site trial recorded here, then limited rollout | Apply, read-back, undo and disconnect pass on a real site |

Fix content rules:

- Payloads come from validated templates. `@type` and `@context` values come only from templates.
- Crawled text is data. It is length-capped, URLs must be https, and `<`, `>` and `&` are written as JSON unicode escapes (`<`, `>`, `&`).
- A test feeds in `</script>`, `<!--` and Unicode line separators and confirms the JSON-LD stays valid and inert.
- Scopes are the minimum for the fix types. Deleting a Luminara account disconnects every site.
- A failed read-back never says Fixed and never retries the write on its own.

Agencies managing client sites need a design for the one-account-per-site rule before they can use DF3, and the buyer through 28 Dec is an agency. Settle this before DF3 starts. Confirm too that account email can be sent, because DF3-4 depends on it.

### Not planned before 28 Dec

- **Desktop notices and start-at-login:** already Track SW SW8-5, fed by server-side watches. SW8-6 and SW8-7 are save-file and release.
- **Second platform:** chosen from DF1-2 data. Shopify and Squarespace stay guided for now.
- **Mac app.**
- **Controlling the user's browser or computer:** needs repeated user demand that connectors cannot meet, a threat model, an owner-approved exception to the no-local-runner rule, and paying users. AutoCua and `trycua/cua` stay on a watch list. Nothing from the pasted list is imported.

## 5. Measures

| Measure | Source |
|---|---|
| Desktop downloads, sign-ins, audits | DF0-2 |
| No-key audit success | DF1-1 |
| Share of audits by platform, including Wix | DF1-2 |
| Fix requested, pack opened, verified | DF2-7 |
| Fix approved, undone | DF3 |
| Paying agencies | Existing payment events |

## 6. Decisions the owner must make

1. **Buy the Authenticode certificate (OV or EV) now.** Decision 30 in Track SW. The unsigned-installer warning is the likeliest place a non-technical person gives up.
2. Confirm the buyer through 28 Dec is an agency.
3. Before DF3: confirm a server-side write after the owner's single Approve counts as the founder acting, so Decision 18 stays at "no agent writes".
4. Before DF3: confirm one free verified fix, then Growth.
5. Before DF3: create the Wix developer account and provide a test site. Claude does not create accounts.
6. Before DF3: approve privacy and terms changes.

## 7. Review record

Audits on 2026-11-01: fix apply path, Electron app, activation and plans, platform connections (research, mostly from search snippets).

Round 1 on draft 1:

- **Citation verifier: FAIL.** PR #255 was wrongly named as the hardening; the envelope service cannot encrypt Worker tokens; a wrong path; a wrong line; SW8 scope. All fixed.
- **Security: NO-GO.** Share link, read-back ownership, OAuth and site binding, undo safety and token handling. All nine items applied.
- **CEO: GO WITH CHANGES.** Guided pack relabelled a demand test; buyer named; DF3 date removed; 3-user gate and stop rule replaced; DF4 and DF5 reduced to one line each; Wix share made a gate; certificate moved to first decision. Not applied as written: the CEO advised dropping detailed DF3 tasks until DF3 starts; they stay because they hold the security requirements. DF1-3 and DF1-4 stay in the plan but do not hold the 5 Nov gate.

Round 2 on draft 2:

- **Citation verifier: FAIL on two small items.** One wrong line, fixed. Growth gate numbers are not in the repo, now labelled as the owner's growth plan. Wix claims stay marked as snippet research.
- **Security: GO WITH CHANGES.** Dead-token Undo, takeover limits, site claim and release, read-back scope and idempotency key applied. The public link limit is recorded with the deferred link.
- **CEO: GO for DF0 to DF2, DF3 gated.** Public share link deferred, minimum DF2 set named, PR state check added, stop rule given a number, buyer decision made to change scope.

Final check: the corrected line was confirmed by direct read. Round 2's changes were mechanical and no reviewer issued a round 3. Open before DF3: the Wix spike, the agency-site design, email sending, and the owner decisions in section 6.
