# Track GD: Is Gemini Decision good enough to stand in for Jev? Probe and offline replay

Status: reviewed, verdict go after three rounds (2026-11-15). The owner approved building the script; it is built, and the probe passed (section 10). The site list awaits approval (section 11). The staging audits, replay and marking are not done.

**Which code this describes.** Every `file:line` citation is against `origin/staging` at commit `477c5160`. The main checkout was 198 commits behind staging on that date, so line numbers there differ. Read cited files with `git show origin/staging:<path>`.

New plans inherit the rules in section 2 of `docs/plans/zoro-concepts-implementation-plan.md`. They are not restated here.

## 0. Verdict

Do the small thing first: one live probe call, then replay about 30 saved public-site audit checks through `gemini-decision-1` and compare with what Jev answered, judged against rules fixed in advance (section 5). No change to the product, no Worker change, no table, no flag.

**What a user gains today: nothing visible.** The audit already carries on unchanged when Jev fails (`services/audit/jevVerifier.ts:204-229`). This is insurance against Jev being withdrawn, repriced or unreliable, and a cheap data point for the typed-decision-engine plan (Track TD). It does not help reach 1,000 users.

Round 1 of this plan proposed a flagged shadow call in the Worker relay with a new table. The CEO-level review rejected that as too large for the question at 13 users. It is not part of this plan. Section 6 says what would reopen it, and the appendix lists the traps found while checking it.

Size: about a day of agent work and about two hours of the owner's time.

## 1. Baseline

### Verified in code (origin/staging)

- The audit evidence check runs in the browser. `reviewFindingsWithJev` is called from `services/agentCore/crewOrchestrator.ts:395`. It posts to `/api/providers/typesafe/v1/systemone` on the Worker relay (`services/audit/jevVerifier.ts:166-170`, `services/apiClient.ts:436`, `:461`).
- The request is `{ model, state, questions }` (`services/audit/jevVerifier.ts:197-200`). `state` is at most 6 pages and 6 files, excerpts clipped to 400 and 240 characters (`:76-96`). Questions are `finding_N` (yes/no), `site_type` (pick one), `brand_name` (yes/no), `brand_pick` (pick one) (`:98-131`).
- Each finding gets a yes-probability: how likely it is that the evidence supports the finding. Under 0.6 the finding is downgraded to "not measured" (`services/audit/jevVerifier.ts:14`, `:231-235`). This plan calls 0.6 and above "supported" and under 0.6 "not supported".
- The browser gives up after 3 s and leaves the audit unchanged on any failure (`services/audit/jevVerifier.ts:13`, `:190-191`, `:204-229`).
- The request is only sent when the page is talking to the Worker (`services/apiClient.ts:87-89`, `services/audit/jevVerifier.ts:184-187`) and the hosted sign-in circuit is not tripped (`services/apiClient.ts:444`).
- The relay forwards the typesafe body without changing its content (`worker/providerRelay.ts:214-226`, `:662`). Free accounts get 6 Jev answers a day per Worker isolate (`worker/providerRelay.ts:648-660`, `worker/isolateDailyCap.ts:8`).
- A direct Jev call is `POST https://api.typesafe.ai/v1/systemone` with `Authorization: Bearer <key>` (`worker/freeAiAnswer.ts:29`, `:206-209`).
- The Worker already calls Google's Gemini host with `GEMINI_API_KEY` (`worker/env.ts:111`, `worker/providerRelay.ts:163-176`, `worker/dreamAgent.ts:252`).
- There is no labelled audit data in the repository. `evals/cases/` holds four files of recorded Oracle answers, not audit findings.
- `scratch/` is git-ignored (`.gitignore:80`).

### Verified from Google's documentation (read 2026-11-15, no live call)

- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/decisions`, header `x-goog-api-key`, body `{ model: "gemini-decision-1", input, questions }`. `v1beta` only.
- Question types use the same strings as Jev: `noul` (yes/no), `choice` (pick one), `score` (rubric). The `criteria` shape for `choice` matches what `questionsFor` already builds, so the same `questions` object can be sent to both providers.
- Response: `{ answers: { <key>: { type, noul | choice | score, confidence, probabilities } }, usage }`.
- Free tier: 200 requests a minute, 10,000 a day.

### One live call (2026-11-15, unplanned)

While checking the command line, the agent ran `replay` expecting a "key not set" error; the key was set in the shell, so one real call went to the Decisions API. Content was made up (host `a.test`, one yes/no question). Result: HTTP 200 in 446 ms, answer `{ type: "noul", noul: 0.909, confidence: 0.909 }`, which passed GD-1b. The response had no `model` field. This is one call, not the probe; GD-1 still runs.

### Not verified

- The response to a full audit request. The probe (GD-1, section 10) confirmed all three question types on a small made-up request.
- Price and data terms. A summary of the pricing page says about $0.10 per million input tokens on the paid tier, free of charge on the free tier, and that free-tier content may be used to improve Google's products.
- Accuracy and latency. Google publishes neither for this model.
- Whether the model is a preview.
- Whether `TYPESAFE_API_KEY` is set on staging, and how many audits and Jev answers a day the test account gets there. GD-2a checks both on the first audit.

## 2. Plan conflicts, settled for this plan

1. **"No TypeSafe / Jev runtime dependency"** (`services/evidenceBound/README.md:11`, `docs/plans/evidence-bound-decision-100x.md:33` and `:166`). This plan adds nothing to the product at runtime, so it does not touch that rule. The existing hosted Jev check already sits outside it; whether to record that in `specs/0019` is owner decision 3.
2. **"Generative confidence is not calibrated"** (`specs/0019-evidence-bound-decisions.md:26`). Nothing here acts on a probability. They are compared offline.
3. **Audit content going to Google.** The replay sends only excerpts from public sites the owner picks and the findings our own audit wrote about them. No customer account content. Owner decision 1 approves that before the replay runs.
4. **Overlap with Track TD** (session "Open-alternative-jev library review": `docs/plans/typed-decision-engine.md`, types and metrics in the existing `services/evidenceBound/` module since TD v0.3, a parked shared `decision_runs` table and an offline scoring bench). This plan creates no table and no provider interface. TD's bench imports this script's exported helpers (`validAnswers`, `domainOf`, `parseCsv`, `capturesToFiles`, `markingFiles`) and relies on its `main()` guard, so changes to those are agreed with TD first. Its output is a results file and a one-paragraph finding handed to Track TD, which treats Gemini Decision as one candidate provider. Any shared results table belongs to Track TD.

## 3. Stage GD-1: probe

**GD-1a. Script.** Add `scripts/decision-probe.mjs`. In probe mode it sends one made-up page excerpt and three questions (one of each type) to the Decisions API three times. It reads `GEMINI_API_KEY` from the environment and never prints it. It prints, for each try: HTTP status, time taken, the answer keys and fields, and the `usage` block.
Acceptance: the script exits non-zero with a clear message when the key is missing; a unit test covers the request it builds and the checks in GD-1b.

**GD-1b. Validity checks.** One module, shared with the replay.
- An answer is valid when its key was asked, its `type` matches the question, a `noul` is a number from 0 to 1, a `choice` is one of the offered options, and `confidence` is a number.
- A call is valid when the status is 200 and every question asked has a valid answer.

**GD-1c. Owner runs it once** with the command in section 7.

**Stop rules.** Stop the plan and record one line in section 9 if:
- none of the three tries is a valid call within 2 s; or
- the call is refused for the account or region.
If the answer fields differ from section 1, correct GD-1b to match what came back and carry on.

## 4. Stage GD-2: offline replay

**GD-2a. Collect requests and Jev's answers.** An agent runs the Instant Audit on the staging site in the browser pane for public sites from a list the owner approves: about 30 sites, at least 20, mostly real-estate agencies of mixed size plus five of other kinds so `site_type: other` is exercised. The owner signs in on staging in the browser pane first if the site asks.
- Before each audit the agent installs a temporary fetch wrapper in the page that copies, for requests to `/api/providers/typesafe/v1/systemone` only, the JSON request body, the response status and the response JSON. No headers, cookies or tokens are copied. No product code changes. The browser's network log is not relied on, because it may not show request bodies. `node scripts/decision-probe.mjs snippet` prints the wrapper; it collects into `window.__gdCaptures`.
- After each audit the agent copies `JSON.stringify(window.__gdCaptures)` into a file under `scratch/` and runs `node scripts/decision-probe.mjs save <that file>`.
- Each capture is saved as one file in `scratch/decision-replay/requests/` with a request id. The page retries once after a 401 (`services/apiClient.ts:326-331`), so when one audit produces two entries keep the last. The page aborts at 3 s, so a capture can have a request and no response; that counts as "no Jev answer". A page reload removes the wrapper, so it is installed again before every audit.
- **First-audit check.** After the first audit, look at the captured status. 200 with answers: carry on. 503: staging has no Jev key. 429: the daily Jev cap is spent. In the last two cases the request body is still captured but Jev's answer is missing; see GD-2b.
- Do not raise any quota or cap for this. If caps slow it down, spread the audits over up to three days.
Acceptance: at least 20 saved files, each with `state` and `questions`.

**GD-2b. Replay.** In replay mode the script reads each saved file and:
- sends it once to Gemini with a 5 s limit, with `model` replaced by `gemini-decision-1`, `state` moved into `input` as `JSON.stringify(state)`, and `questions` unchanged;
- uses the captured Jev answer when the capture was a valid call;
- when the capture has no valid Jev answer and `TYPESAFE_API_KEY` is set in the environment, calls Jev directly once with the saved body; when the key is not set, marks that request "no Jev answer".
It writes `scratch/decision-replay/results.jsonl`, one line per request and provider. The owner runs it with the command in section 7. Fields, shared with Track TD's offline bench so it can read the file unchanged:
- `request_id`: matches the file name in `requests/`.
- `domain`: host of the first page in `state`.
- `provider`: `jev` or `gemini`.
- `model`: the model string sent.
- `model_returned`: the `model` field of the response when it has one, else null. Whether Jev and Gemini return a versioned model id is not verified; the probe and the first capture show it.
- `source`: `captured` (from the browser) or `direct` (called by the script).
- `status`: HTTP status, or 0 when there was no response.
- `ms`: time taken; null for captured Jev answers.
- `valid`: true or false, by the call rule in GD-1b.
- `answers`: the validated answers keyed by question key, or null.
The saved request file holds `state` and `questions`, so claims and evidence are read from there, not repeated in the results.

**GD-2c. Summary.** The script prints, as plain counts:
- R: requests replayed to Gemini; how many Gemini calls were valid; how many took longer than 1.5 s;
- P: usable pairs, meaning requests where both Gemini and Jev have a valid call; and how many requests had no Jev answer;
- Q: finding questions compared across the P pairs, and D: how many of them landed on different sides of 0.6;
- for `site_type` and `brand_pick`, how many picks differ. These two are for information only and are not part of the rules.

It also writes `scratch/decision-replay/to-mark.csv` with every one of the D rows, or a random 40 of them when D is over 40 (the summary prints D and the number sampled). Each row has a row id, the claim, the evidence excerpts and the page link, and shows the two answers as "A says supported / B says not supported", with A and B assigned at random per row. A separate key file maps row id to request id, question key, and which provider is A. The marker does not see the key file.

**GD-2d. Owner marks the rows.** The CSV has one empty column for the mark. For each row write: supported, not supported, or cannot tell. Judge only from the evidence shown in the row. If that is not enough to judge, mark cannot tell. Keep every row and its row id, including the cannot-tell rows. Expected under 40 rows. Then run `node scripts/decision-probe.mjs decide`, which needs no key and prints the counts and the outcome under section 5.

## 5. Decision rules, fixed before looking

Definitions, all computed by the script from `results.jsonl`, the marked CSV and the key file:
- R, P, Q, D as in GD-2c.
- M: rows marked supported or not supported. Rows marked cannot tell are left out.
- A provider is **wrong** on a row when the marker said supported and the provider said not supported, or the reverse.
- J = marked rows where Jev was wrong. G = marked rows where Gemini was wrong. When D was sampled down to 40, J and G are counts on that sample and the rules apply to the sample as written.

Apply the steps in this order. The first one that decides the outcome ends it.

**Step 1: does Gemini answer, and fast enough?** Judged on all R calls.
1. At most 1 of the R Gemini calls was not valid.
2. At most 2 of the R Gemini calls took longer than 1.5 s.
If either fails, the outcome is **do nothing**, whatever P is.

**Step 2: is there enough to judge accuracy?** The outcome is **inconclusive** (do nothing, and say so) if any of these holds:
- P is under 20;
- more than one third of the rows shown were marked cannot tell;
- M is under 8 and Q is under 100.

**Step 3: does Gemini agree with Jev well enough?**
3. G is no more than J + 2, counted on the marks that exist. When M is under 8, D must also be at most 10% of Q.
If rule 3 holds, the outcome is **good enough to be a fallback candidate**. If it fails, the outcome is **do nothing**.

For every outcome, record the counts in section 9. Do nothing and inconclusive both close this plan.

**Clearly better**, indicative only: the outcome is good enough and J is at least G + 5. Tell Track TD; still build nothing here.

What these rules cannot show:
- Only disagreements are marked, so a finding both providers get wrong is invisible. The result says how Gemini compares with Jev, not how accurate either is.
- About 30 sites is a small sample. It can show Gemini is unusable or roughly on par. It cannot justify replacing Jev.
- Gemini's timings are taken from the owner's machine, not from Cloudflare. Treat them as rough.

## 6. What happens after

- **Good enough:** hand the results file and the counts to Track TD as a candidate provider. A live shadow call in the Worker relay is reconsidered only if one of these happens: the first paying customer; a Jev outage, price change or withdrawal that actually harms audits; or Track TD needs live shadow data. That would be a new plan with its own owner approval and review, written against Track TD's shared table.
- **Do nothing or inconclusive:** close the plan. Delete `scratch/decision-replay/`.

## 7. Cost, rollback, what the owner does

Cost: no subscription. Under 100 Gemini calls. About 30 staging audits use the hosted scrape and model keys as normal audits do.

Rollback: nothing ships. Remove `scripts/decision-probe.mjs` and `tests/decisionProbe.test.ts` if the plan is closed.

The owner:
1. Approves the site list and decision 1.
2. Signs in on the staging site in the browser pane if asked.
3. Runs two commands in their own terminal. An agent never types the keys. In PowerShell, pasting the key in place of the placeholder (leave out the `$env:` part if the key is already set in that terminal):
   - Probe: `$env:GEMINI_API_KEY = "<Gemini key>"; node scripts/decision-probe.mjs probe`
   - Replay: `$env:GEMINI_API_KEY = "<Gemini key>"; node scripts/decision-probe.mjs replay`
   - Only if GD-2a showed staging returns no Jev answers: add `$env:TYPESAFE_API_KEY = "<TypeSafe key>";` in front of the replay command. If the owner has no TypeSafe key to hand, those requests stay "no Jev answer", and the result is inconclusive when fewer than 20 pairs remain.
4. Marks under 40 rows, then runs `node scripts/decision-probe.mjs decide` (no key needed).

Note: on the owner's Windows machine, `GEMINI_API_KEY` and `TYPESAFE_API_KEY` were found already set in the environment that agent shells inherit (2026-11-15). Any agent running this script there uses them without being given them.

## 8. Owner decisions needed

1. Approve sending excerpts of the listed public sites, and our audit's findings about them, to Google for this test. Say whether the Gemini key used is on a paid or free Google project; for public content either is acceptable, but record which.
2. Approve the split with Track TD: this plan creates no table and no provider interface.
3. Optional: add one line to `specs/0019` saying the hosted audit second opinion is an advisory exception to "no TypeSafe dependency". It removes a standing contradiction between the spec and the code.

## 9. Review record

**Round 0 (2026-11-15).** Audits: backend (relay, verifier, tests, privacy) and deploy plus evaluation data, both read-only. Findings that shaped the first draft: the verifier runs in the browser; the relay's Gemini gate blocks the Decisions path; there is no labelled audit data.

**Round 1 (2026-11-15).** CEO verdict: NO-GO as written; GO for a probe plus offline replay. Verifier verdict: GO WITH FIXES (three line numbers wrong in `worker/index.ts`, migration 0052 already claimed, relay hook missed the network-failure path, an IP address could reach the table).
Applied:
- Replaced the relay shadow, table, flag and labelling pipeline with a probe and an offline replay.
- Stated the user benefit honestly in section 0.
- Rewrote the decision rules as counts, fixed in advance, with a "do nothing" outcome and probe stop rules.
- Settled the Track TD overlap: no table here.
- Cut the owner's work to one approval, two commands and under 40 rows.
- Named the checkout the citations refer to at the top of the plan.

**Round 2 (2026-11-15).** CEO verdict: GO WITH CHANGES. Verifier verdict: GO WITH FIXES (0 wrong citations of about 45).
Applied:
- Jev's answers are now captured in the browser with the request, so the replay needs only a Gemini key; a TypeSafe key is an optional fallback, with a stated outcome if the owner has none.
- Capture copies the JSON body and response only, by a fetch wrapper, not the network log.
- Section 5 defines R, P, Q, D, M, J, G, "wrong", a valid call, and an inconclusive outcome; says the rules apply to the sample when rows are sampled; and marks `site_type` and `brand_pick` as information only.
- The marking file carries a row id and the key file maps it back to request and question.
- Marking uses only the evidence shown.
- Plain explanation of 0.6 added to section 1; time estimates raised; exact commands added to section 7.
- The appendix was cut to a short list of traps with no table and no SQL.
Not applied as written: the CEO asked that fewer than 8 marked rows always be inconclusive. The plan lets a result with very few disagreements across at least 100 compared questions go on to rule 3, because near-total agreement with Jev is the property a stand-in needs. Below 100 questions it is inconclusive.

**Round 3 (2026-11-15).** CEO verdict: GO WITH CHANGES, two blocking.
Applied:
- Section 5 is now three ordered steps. Availability and speed are judged first on all calls, so two failed Gemini calls mean "do nothing" even when few pairs remain.
- With fewer than 8 marked rows, rule 3 still applies to the marks that exist, and disagreements must be at most 10% of the questions compared. A run where Gemini is wrong on every marked row can no longer pass.
Verifier verdict: GO WITH FIXES (0 wrong citations of 41; no service worker; the page's own fetch patch passes calls through, so the capture wrapper sees the Jev call).
Applied: keep the last entry when a 401 retry produces two; a capture with no response counts as "no Jev answer"; the marked CSV keeps a mark column, the row id and the cannot-tell rows.

**Final check (2026-11-15).** CEO verdict: GO, no remaining blocker. It walked seven cases through section 5 (too few pairs; no disagreements; few questions; heavy cannot-tell; two failed Gemini calls; Gemini wrong on every marked row; a handful of even disagreements) and each has one defined outcome. The verifier's three wording fixes from round 3 were applied after its last read and were not re-read by it.

## 10. Execution log

**2026-11-15. Script built (owner approved building it).** `scripts/decision-probe.mjs` with five modes: `snippet`, `save`, `probe`, `replay`, `decide`. The GD-1b checks are the exported `validAnswers`, which Track TD reuses. `replay` refuses to run while a `to-mark.csv` exists, so a re-run cannot overwrite marks. `tests/decisionProbe.test.ts` covers the checks, the capture wrapper in a fake page, saving, the section 5 outcomes, replay with a fake network, and the missing-key message; no test calls Google or TypeSafe. Full gates passed. One unplanned live call is recorded in section 1. Not done: the probe (GD-1c), the site list, the staging audits, the replay and the marking.

**2026-11-15. Probe run (GD-1c), at the owner's request, by the agent with the key already in the shell environment.** Passed. Three tries: HTTP 200 in 723, 440 and 291 ms, all valid. The yes/no, pick-one and rubric answers all match section 1. The rubric answer also carries `legend` and `probabilities`; the pick-one answer carries `probabilities`. Each call used 312 input tokens and 0 output tokens. The three answers were identical. No `model` field in the response, so `model_returned` will be null for Gemini. Stop rules not triggered.

**2026-11-15. Site list drafted (section 11).** Awaiting the owner's approval, which is owner decision 1.

**2026-11-15. Site list approved (23 sites); collection moved to production.** Staging could not produce the request: its signed-out free check calls `/api/visibility/probe-crawl` and never Jev, and the full audit needs a sign-in that staging's web app does not support. The owner approved running the audits on production, signed in as the owner.

**2026-11-15. First audit captured (barryplant.com.au).** The capture wrapper worked: one Jev request, HTTP 200, `model: "jev-1.14.0"`, 4 pages and 5 files in `state`, about 1,500 input tokens. Two findings from it:
- Jev's yes/no answers have no `confidence` field (`{ type: "noul", noul: 0.65 }`). GD-1b required one, so every Jev call would have been invalid. Fixed: `confidence` is now required only on a pick, which is the only place `services/audit/jevVerifier.ts` reads it. A test covers the Jev shape.
- The audit asked Jev about **one** finding. If that is typical, 23 audits give Q of about 23 to 50, under the 100 that section 5 step 2 needs when fewer than 8 rows are marked. A run where Gemini mostly agrees with Jev would then end **inconclusive**.
- The owner's account allows 3 audits a day, so 23 audits take about 8 days.

## 11. Site list (draft, not approved)

Public sites only. Checked 2026-11-15 with a plain HTTPS request. A 403 or 429 means the site turned that request away; our audit's own fetcher may still get through. No answer means the address may be wrong.

Real-estate agencies, large to mid-size (18: 12 answered, 6 turned the request away):
`ljhooker.com.au`, `barryplant.com.au`, `jelliscraig.com.au`, `marshallwhite.com.au`, `nelsonalexander.com.au`, `bigginscott.com.au`, `century21.com.au`, `prd.com.au`, `knightfrank.com.au`, `fletchers.net.au`, `buxton.com.au`, `kayburton.com.au`, plus 403/429: `raywhite.com`, `mcgrath.com.au`, `belleproperty.com`, `harcourts.com.au`, `firstnational.com.au`, `raineandhorne.com.au`.

Other kinds, for `site_type: other` (5): `mirvac.com` and `stockland.com.au` (developers), `bakersdelight.com.au`, plus 403: `jimsmowing.com.au`, `pacificsmilesdental.com.au`.

That is 23 sites. Missing: small independent agencies. The plan asks for mixed sizes. The owner adds about 5 they know, or approves the 23 as they are.

Dropped, no answer: `richardsonandwrench.com.au`, `place.com.au`, `laingsimmons.com.au`, `doneganrealestate.com.au`.

## Appendix: traps found while checking the relay shadow idea

Not a design and not approved. For whoever writes a later plan, most likely Track TD. All against `origin/staging`.

- The relay's `gemini` entry only allows `generateContent`-style paths (`worker/security.ts:192-194`, `worker/providerRelay.ts:399-401`). A direct Worker fetch avoids loosening it.
- Background work is available inside the relay through `scheduleWaitUntil` (`worker/welcomeEmail.ts:26-43`), because requests run inside `runWithWaitUntil` (`worker/index.ts:2503`, `handleApi` at `:346`, relay call at `:1025`).
- A Jev network failure or timeout returns through `networkFailure` (`worker/providerRelay.ts:669-677`), before the pass-through at `:725`. A hook only at `:725` misses the "Jev too slow" case.
- The 401/403 branch reads the response body (`worker/providerRelay.ts:786`), so clone the response before anything reads it.
- The parsed `body` may be an object or a raw string (`worker/providerRelay.ts:562-566`).
- For anonymous callers `fallbackAccountId` is `anon:<ip>` (`worker/providerRelay.ts:449`). Never store it.
- `fetchWithTimeout` (`worker/workerUtils.ts:308`) stops timing once headers arrive. Bound the body read separately.
- `allowDailyCap` (`worker/isolateDailyCap.ts:20`) is per isolate. It is not a bound on total spend.
- Runtime flags are compared with `=== 'true'`; the production guard in `worker/preprodFlags.ts:29` is deliberately broader and also rejects `TRUE`, `1`, `on`.
- Migration number 0052 is absent on staging but claimed by `docs/plans/nod-patterns-additive-plan.md`.
- `wrangler d1 execute` has no parameter binding.
- The browser gives up at 3 s and the relay's Jev call also runs to 3 s (`worker/providerRelay.ts:665-666`), so a fallback that starts after a Jev timeout cannot answer in time.
