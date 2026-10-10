# Founder Swarm and Business Brain: appendix (Track SW)

**Part of:** Track SW v0.4. The plan is [`founder-swarm-business-brain-additive-plan.md`](./founder-swarm-business-brain-additive-plan.md); its first page lists every file.  
**Date:** 2026-10-10  
**This file holds:** section 17 (threat model and test plan), section 19.1 (cross-plan edits), section 24 (merged from Track BB, and where every review finding landed).  
**Section numbers** are the plan's own, so they do not start at 1 here.

---

## 17. Threat model and test plan

| Threat | Control | Test |
|---|---|---|
| A crawled page tells the agent to write, spend or exfiltrate | Fencing (2.10); sealed trust; a call that leaves the account or spends needs a bound single-use approval; drafts are checked by code before they are saved; no roster agent is `destructive`; no agent before the Prospector lets a model choose a tool | Prompt-assembly tests (SW2-7); the twin-pair live gates (SW1-13, SW2-12, SW4-13, SW6-11) |
| An agent reports a number it made up | The model writes handles, not digits; the output check refuses what remains; rules compute deltas in code | SW1-7, SW4-7 fixtures; spike E's false-refusal count |
| A run spends past its limit | The whole cap is reserved in the admission insert; three limits and two global pools in micro; step and time limits; missing usage counted as full | SW1-3 concurrency test; SW2-2; SW1-4 |
| Model cost is under-counted | `cost_micro`; one usage adapter per provider; an interrupted call billed at its reservation; the ledger compared with the provider's bill for the runs' own key | SW0-6; SW1-7; the SW1b promotion check |
| A run never ends | Working-time deadline, `max_steps` CHECK, a sweeper that acts by state, alert | SW1-4, SW1-10 |
| D1 is down or slow while a run works | The object's journal decides progress; D1 is a projection written from an outbox; D1 decides control | SW1-4 |
| Many accounts aim the Auditor at one site | A per-site hourly limit and a back-off, inside the admission insert | SW1-3 |
| One account reads another's run, brain, leads or jobs | Ownership check in every loader; 404 on a foreign id | Two-account test on every new route |
| An invited member's routes act on the inviter's org | `getOrCreateUserOrg` resolves the personal org by id before any invite can be accepted | SW7-2 |
| An org member acts beyond their role | One access helper; role table in section 12; two-org matrix | SW7-2, SW7-5, SW7-6 |
| An instruction in a live room raises a cap or injects text | Instructions are typed choices; the instruction path cannot reach caps, ceilings or approvals | SW7-5 |
| A guest link leaks costs or evidence | Redacted stream; hashed, expiring tokens; routes outside the signed-in prefix that open one run only | SW7-7 snapshot |
| Google data attached to the wrong account | `state` single-use by a conditional write, PKCE, a `__Host-` cookie bound to the starting browser, and the session's account must equal the one that started; web only | SW4-3 |
| A refresh token leaks from the database | AES-GCM with a Worker secret, row-bound; tokens never logged or exported | SW4-2 |
| Spam or abuse through the public lead form | Off by default; IP limiter; per-link cap inside the insert; honeypot; uniform 200; no outbound message | SW3-6 |
| A lead message attacks an agent later | Stored text is untrusted wherever it is read | SW3-6 |
| An x402 payment is replayed, or work is taken without paying | Unique on network, asset, payer and nonce; the result stored before settle; a single-use settle transition | SW5-4 |
| An x402 payment is marked failed when it settled, or the reverse | `settle_pending`; only a chain read moves a row out of it | SW5-9 |
| The x402 route is used to scan private networks | The P17 fetch wrapper; refusal before verification | SW5-5 |
| Paying the wrong asset or network | Asset, decimals and signing domain pinned from the issuer's list, confirmed by the owner, tested against the package's table; the rail stays off unless the facilitator lists the network | SW5-0, SW5-2, SW5-3 |
| A USDC surface is reachable from Telegram | Its own hostname; a test that no Telegram-reachable surface names it | SW5-7 |
| One Stars charge pays two jobs, or a job is paid at the wrong price or by the wrong person | The charge row's primary key; a unique charge id on the job; pre-checkout binds amount and payer to the row | SW6-4 |
| A paid update is lost between Telegram and the ledger | The update is processed before the webhook answers; the first write is the charge row; a 5xx only when that write fails; a sweep settles every row by what is true; a reconciler compares Telegram's list with the table | SW0a-3; SW0a-18; SW6-6 |
| A failed job is not refunded, or is refunded twice | The job and its charge change in one batch; a leased, single-use refund; retry on the ops cron; alert | SW6-5, SW6-6 |
| A refund cannot be paid | Only the delivery check carries the automatic refund; balance alert; five attempts then an alert to a person | SW6-0 drill; SW6-6 |
| A purchase lowers a plan | Rank guard on every rail; refusal before payment where the rail can refuse | SW0a-4 |
| A Watch runs twice or runs away | Compare-and-set claim; per-run cap inside the agent cap; auto-pause | SW8-2 |
| A web page in the desktop shell calls native code | Sender checks on every handler; narrow calls; save only through the system dialog | SW8-4, SW8-6 |
| A quest or badge is farmed | Completion needs a row the server wrote; grants are idempotent; no self-reported note counts | SW9-1, SW9-2 |
| Progress is bought | No paid event completes a quest, raises a level, opens the chat or casts a vote | SW9-1; SW9-8; section 14.4 |
| A fix "held" that never was a defect | The retest reports "gone" only for an issue the server saw failing; a domain receipt is also required once TN2 is on | SW9-2; Allora 3.4 |
| A model writes a link or an image that sends data out | URLs limited to the run's evidence and first-party; images stripped; no `parse_mode` to Telegram | SW1-13; SW2-12 |
| A harmful fix draft that "parses" | Templates built by code; artefact checks per kind on every draft before it is saved | SW1-15; SW2-13 |
| An agent-opened pull request changes a workflow or an existing file | New files only, under the founder's listed paths, never `.github/`; title and body built by code | SW2-15 |
| The deploy screen says a fix is live when nothing changed | The page is read back before "deployed" is said, or the path is hidden | SW0a-17 |
| Connector data reaches a provider that trains on it | Per-account provider allow-list, failing closed, in the model client and in the relay; the snapshot block is server-only | SW4-12 |
| An account id leaks through a public list | Public responses select named columns; a test asserts no account id in any feed, board or page response | SW0a-9; section 14.5 |
| The bot answers a whole group through a model | Private-chat guard, placed after the payment branches, before the bot joins any group | SW9-6 |
| A leaked link fills the builders chat | Join requests only; no public username; members cannot invite; a daily approval cap inside the update | SW9-8, SW9-9 |
| A notice reaches someone who did not agree, or the daily cap is passed | One statement decides and records each notice, including for an account with no preferences row | SW1-12 |
| A new flag silently turns on | One vocabulary, one helper; anything but `"true"` is off; three blocks; env validation in CI | Rule 2.3; `validate-env` |
| A rollback strands a Durable Object class | The class ships alone first (2.7) | SW1-0 spike C, SW1-1 |
| A feature reaches production with no staging pass or flag | Branch protection with administrators included; staging protected; a CI check that `main`'s merge commit is the tip of `staging`; the money-invariant test; AI sessions cannot merge to `main` | SW0a-12; rule 2.16 |
| The prompt that runs is not the prompt that was tested | A run pins prompt versions by hash from a list that is a constant in the repository | Section 4.1; SW1-7 |

Coverage: each new Worker module in this plan carries a per-file floor of 90 percent lines (the Ops plan's convention); the global floors stay. D1 tests use `tests/helpers/sqliteD1.ts`, which applies the real migrations.

---

## 19. Dependency graph and sequencing (part)

The graph, the launch-cut count and the lanes are in the plan. This file holds 19.1 only.

### 19.1 Cross-plan edits

One separate docs PR carries these (SW0-0), because other sessions work in those files.

| Topic | Owner | Edit to make |
|---|---|---|
| Server-side audit execution | This plan, SW1a | V plan section 9: "V6 is specified and scheduled as Track SW phase SW1a." |
| Run ledger without V1 | V plan V2 | V plan section 10: "V2-0 to V2-3 and V2-5 may land before V1; Track SW SW1a needs them and not the identity memo." |
| Who a server run's evidence says fetched it | V plan V2-11 | V2-11: "A row may say `fetcher = 'worker'` when the run row's origin is the server. 'Verified' still needs a receipt." |
| Server-minted finding ids | V0-8; Allora CL0-1 | Both: "One fix is on `main`, chosen in Track SW SW0-8." |
| Hosted model call | Zoro P1-4 | Zoro P1-4: "The one model client is `worker/modelClient.ts` (Track SW SW1-7). `callHosted` is that function or is not built." |
| Fetch wrapper | Allora CL0-3 | None. SW1a adds fencing; page bodies are not kept (Track SW section 4.1) |
| The check registry | Allora section 3.1 | "Checks are added through this registry by Track SW SW1-14, each with a fixture per cell, and its name joins the closed list shown to users." |
| A proposed decision | Weekly decision loop | "`weekly_decisions.status` may be `proposed` (Track SW SW1-18): a row an agent suggested and the founder has not committed. It is never counted as a commitment." |
| Retest notices | Allora decision 4, CL2-7 | "Sent through Track SW's `notify_sends` under its decision 20, category `retest`." |
| Whose a check is | Allora section 3.7 and CL1-1 | "A check set may belong to a finding with no decision: a server run writes each finding's baseline rows itself (Track SW SW1-16). The manual retest limit is per finding per 24 hours. Checks taken at a decision's commit are unchanged." |
| Account link and projects | V2-1b | "The mover covers `projects` and every row keyed by a project. A `(account_id, domain, client_id)` collision keeps the surviving account's project and re-points the other's rows to it." |
| The flag helper | Ops Phase 0 item 8 | "A flag is the string `\"true\"` or `\"false\"` (Track SW rule 2.3). The three-state seat settings are parsed by their own function and are not flags." |
| Allora's waits | Allora CL1-0 (coverage rule) and its phase gates | "Done by the Track SW team under Track SW rules 2.4 and 2.18. The fourteen-day coverage read before Phase 2 is kept or waived for launch by Track SW decision 28; if waived, the report is still read at day fourteen and recorded here." |
| Purchasable credits | Zoro Phase 2 | Zoro P2-4 and P2-5: "Not taken by Track SW SW0a-4; Track SW section 0.6 forbids a purchasable credit." |
| Approvals from Telegram | Ops plan F1 | F1: "Approve and deny buttons are Track SW SW2-14 and call the same decide function. The card shows `argsSummary`." Also Ops decision 8 (argument-bound single use for standard destructive approvals) is needed before SW2-14: recommended yes |
| Push opt-in | Ops plan F2 | F2: "Consent and the daily cap live in D1 `notify_prefs` (Track SW section 6.5), not KV. Beacon's push calls the same send function with the `budget` and `drift` categories." |
| Time between flag changes | Ops plan section 6 | "Track SW rule 2.4 keeps one change per release and applies the 24 hours only where a daily cron or a day boundary is needed to see the effect." |
| Production after staging | Ops Phase 0 | "The two deploy jobs run on different pushes, so a `needs:` between them cannot work. Track SW SW0a-12 checks that `main`'s merge commit is the tip of `staging`." |
| Scheduled work | Ops plan "Parked" | "Watches: the read-only Auditor may be scheduled earlier under Track SW decision 22; every other Watch stays parked until Phase 2 exits." |
| Sentinel's messages | The plan that owns Sentinel | "Its drift alert is sent through Track SW's `notify_sends`. Its 'time for your check' message and its queue enqueue are removed by Track SW SW8-2." |
| Agent Jobs | TN plan TN6 | TN6: "Specified in Track SW section 11. Table `agent_jobs`; charges in `stars_charges` (Track SW section 5.1); priced in Stars or included in a plan only. The `ai_crawler_policy` check does not require the live site to show the rules at delivery, because the deliverable is a draft; the re-check after shipping covers it." |
| Gated groups | TN plan TN8 | TN8: "One builders chat is un-parked by Track SW decision 19 (section 14.3) with a different entry rule." |
| Marketplace lock | `docs/plans/virality-activation-loops.md:21` | "The community forum and directory parts of this lock are amended by Track SW decisions 1, 13 and 19 for first-party Jobs, a builders directory and one builders chat." |
| Points | `specs/0009` | Amended or confirmed by a new spec once decision 9 is answered (SW9-0) |
| Jetton opcode | `specs/0018` | Credit rule 2: the notification opcode is `0x7362d09c` (SW0a-1) |
| Account data lists | Zoro 2.6 and P1-1; V2-1b, V3-1b; Ops F2, F4; TN section 2; Allora CL1-1 | "Classify the new table in `worker/accountData.ts` (Track SW SW0-9) as well as editing the lists." |
| One claim checker | `docs/plans/evidence-bound-decision-100x.md` (another session's draft, uncommitted on 2026-10-10) | To agree with that session before either lands: "Track SW's output check (its section 4.3) and SW0a-8 use this plan's claim ledger where it covers the same rule. One checker is built." |

---

## 24. Merged from Track BB

On 2026-10-10 two sessions were given the same brief and each wrote a master plan. They overlapped on about four fifths of their scope and collided on names: both defined `ship_notes`, `connector_sources`, `metric_snapshots` and `agent_jobs` with different columns, the same `/ship-notes` routes, and a migration both called `brain_connectors`. Because every table is created with `IF NOT EXISTS`, whichever shipped second would have done nothing, silently. The owner chose this plan as the one to keep. This section records what Track BB contributed, so nothing it found is lost and nothing is specified twice.

### 24.1 Where Track BB's content went

| Track BB had | Here |
|---|---|
| Phase BB0: payment, honesty and release fixes | Hazards 9 to 19; SW0a (section 5.1) |
| Phase BB1: Fix list, ship notes, approvals, timeline, playbook pages | SW3 (Fix Board, Ship Log); SW2-14 (Telegram approvals); SW3-8 (playbook pages). The timeline is the Brain view of SW4 |
| Phase BB2: server-side crew on Cloudflare Workflows | SW1 and SW2. Whether the engine is this plan's object per run or Track BB's Workflow is being decided by spike A, which builds both (section 4.1) |
| Phase BB3: business brain and Google connectors | SW4. Track BB's proposal status for agent-written facts, the provider allow-list and the retrieval measurement were added (9.1, SW4-10 to SW4-12) |
| Phase BB4: agents in Telegram, jobs, scheduled runs | SW2 (roster), section 6.5 (notices), SW6 (jobs), decision 22 (scheduled Auditor). A per-founder coordinator object was not taken: this plan's one object per run does the same work with less state |
| Phase BB5: community | Sections 14.3 to 14.6 |
| Phase BB6: desktop runner, wallet link, on-chain badge pilot | SW8 (desktop), section 15 (wallet link, badges). A local runner on the desktop stays a non-goal here (section 0.6) |
| Owner decisions 1 to 20 | Section 20, decisions 18 to 27 where this plan had no equivalent. Decisions 28 to 32 came from review round 2 |
| Reference projects and licences | Section 24.2 |
| Corrections to the gamified draft | Section 24.3 |
| Review round 1 | Section 24.4 |

### 24.2 Reference projects

Each site and repository was loaded on 2026-10-10. "Pattern" means the idea is written independently. Nothing in this plan copies code from any of them. The only new dependencies it may add are the two x402 packages of section 10, and only if SW5 is built. This repository is AGPL-3.0, so MIT and Apache-2.0 code could be copied with its notice, and code under a source-available, business-source or missing licence could not.

| Project | Link | Licence, as read | What this plan takes | Use |
|---|---|---|---|---|
| Busabase | github.com/busabase/busabase | MIT; sign-in, roles and API keys are paid add-ons; created June 2026, one main contributor | Agent writes land as reviewable changes (SW4-11) | Pattern |
| Kaneo | github.com/usekaneo/kaneo | MIT | A lean board over existing records (SW3) | Pattern |
| Memos | github.com/usememos/memos | MIT; Go | One-line capture on a timeline (SW3) | Pattern |
| BookStack | codeberg.org/bookstack/bookstack (the GitHub repository is a mirror) | MIT; PHP | Public pages in a fixed hierarchy (SW3-8) | Pattern |
| Krayin, OpenCove, elizaOS | as cited in section 0.2 | MIT | Leads pipeline; a grid of live runs; roster entries as typed data | Pattern |
| LangGraph JS | github.com/langchain-ai/langgraphjs | MIT | A claim before every step and a resume after a failure (section 4.1) | Pattern |
| OpenAI Agents SDK for TypeScript | github.com/openai/openai-agents-js | MIT; Workers support is labelled experimental; traces go to OpenAI by default | The three guardrail points (section 4.3) | Pattern |
| CrewAI | github.com/crewAIInc/crewAI | MIT; Python | A reviewer that checks claims before they ship | Pattern |
| Pydantic AI | github.com/pydantic/pydantic-ai | MIT; Python | Typed outputs with one retry | Pattern |
| AutoGen paper | arxiv.org/abs/2308.08155 | n/a | Background on agents conversing; the project itself is in maintenance mode | Reading |
| Cloudflare Agents SDK | github.com/cloudflare/agents | MIT; 0.28.0, pre-1.0 | Not the run object's base class (spike B, section 4.1). Its lifecycle module is re-measured at SW7 | Not a dependency today |
| OpenMausBot | github.com/milind-soni/OpenMausBot (the site moved to mausbot.com) | Apache-2.0; its `enterprise/` directory is source-available only | An allow or deny card for each risky step (SW2-14) | Pattern |
| OpenDots, OpenBot | github.com/CopilotKit/OpenDots, github.com/CopilotKit/OpenBot | MIT templates that cannot run without CopilotKit's hosted service | Read-only steps run alone; anything else waits for approval | Pattern |
| OpenClaw | github.com/openclaw/openclaw | MIT | Telegram as the front door to an agent | Pattern |
| Hermes Agent | github.com/NousResearch/hermes-agent | MIT; Python | Memory that feeds the next run (SW4) | Pattern |
| OpenWorker | github.com/andrewyng/openworker | MIT; Python | Every task ends in a deliverable with a log; an approval ladder | Pattern |
| Zealy | zealy.io, docs.zealy.io | Closed | A quest as the next concrete step (SW9) | Pattern |
| Galxe | github.com/Galxe/protocol-whitepaper | MIT (the white paper) | Credentials that prove what someone did (badges as receipts) | Reading |
| Guild.xyz | docs.guild.xyz | The main repository has no licence file | Rule-based entry to a chat (14.3) | Pattern only; nothing may be copied |
| Devfolio | devfolio.co | Closed | The shape of a project page (14.5) | Pattern |
| Speedrun Ethereum (BuidlGuidl) | speedrunethereum.com | MIT | A graded path where each step opens the next (the ladder) | Pattern |
| Notcoin | notcoin.org (the GitBook link in the brief's notes is a different project) | n/a | The invite mechanic; a warning about what follows a payout | Reading |
| Hamster Kombat | hamsterkombat.io/docs/HK_WP_03.pdf, dated September 2024 | n/a | The same | Reading |
| TON standards | docs.ton.org; TEP-85, TEP-62, TEP-74 | n/a | `ton_proof` wallet link; the soulbound standard; the Jetton notification opcode | Standard |
| TON Society | github.com/ton-society | Repositories archived; grants paused | Nothing. Advice to "apply for ecosystem support" there is out of date | None |
| Gitcoin | gitcoin.co/mechanisms/quadratic-funding; passport.human.tech | AGPL-3.0, dormant | One person one vote as an aim | Reading |
| XMTP | docs.xmtp.org; github.com/xmtp/libxmtp | MIT; the litepaper repository is archived; no Telegram SDK | Nothing now (section 0.2) | Reading |
| Farcaster, Lens, Status, Mastodon, Bluesky | farcaster.xyz, lens.xyz, status.app, joinmastodon.org, atproto.com | Mixed | Reference designs for an open social graph. Not needed here: Telegram is the social layer | Reading |

Not to be copied in any form: AFFiNE's backend (an enterprise licence), NocoBase (custom restrictive terms), Outline (Business Source License), any `enterprise/` directory, and any repository with no licence file.

### 24.3 The gamified draft

`docs/plans/gamified-builder-ecosystem-tma-plan.md` was written on 2026-10-10 and part of it shipped the same day (hazard 9). Taken from it: weekly missions tied to real work; share cards carrying the invite link; a build-in-public feed; badges for milestones the server checked; a builders group; no rebasing or yield token. Corrected:

| The draft says | The problem | This plan |
|---|---|---|
| A "Lumens" balance, earned and burned | A spendable balance is what `specs/0009` rejects, and it may be treated as stored value. That is an engineering reading; counsel decides | Decision 9, section 14.4: counts and levels, or display-only points |
| A daily check-in and streak bonus | A reward for opening the app | A streak count worth nothing (option B), or removed (option A) |
| "AI Visibility Index", "+8.4% AI Citation Velocity this epoch", "visibility decay" | No weekly citation series is measured by the server; a decay with nothing measured is an invented metric | Statuses, dates and measured Google numbers only |
| A daily standup and a Sunday reminder sent to everyone | `specs/0009` Decision 6; a bot cannot message someone who never started it | The opt-in send policy of section 6.5 |
| Upvote weight by level; "stake Lumens" | Staking is a locked non-goal; weighted votes are not one person one vote | One account, one vote (14.5) |
| Stars "micro-escrow" with a 5 to 10 percent fee and a payout webhook | No Bot API method pays Stars to a user; Stars held in the bot's balance on someone's behalf would look like Luminara holding their money, which counsel must rule on; `specs/0015` caps any fee at 5 percent and needs counsel | First-party jobs with a full refund (SW6) |
| A Demo Day vote in Stars with a prize pool | A paid vote buys rank; a pool funded by participants may be a regulated shape, which counsel would have to answer first | Recognition only |
| An agency lead marketplace | The "no marketplace" lock; TN6 allows first-party jobs only | SW6; a no-fee directory as the interim (section 15) |
| Badges "stored in `CitationRegistry.tolk`", minted to a wallet "linked to their Telegram ID" | That contract is a digest registry with no tests, driven by a hot key, superseded by the Zoro plan; no wallet link exists; it would publish an identity link that cannot be deleted | Badges as signed receipts; the on-chain design of section 15 behind decision 14 |
| "100% compliant", "Zero Howey Risk", "Immune to SEC securities scrutiny" | Legal absolutes with no review behind them | No such claim anywhere (section 0.3, item 12) |
| A dependency on D1 `referral_progress` | No such table; the tables are `user_progression`, `user_missions`, `referral_rewards` | Cited correctly in section 1.1 |

### 24.4 Review round 1: where each finding landed

The five reviewers read Track BB v1.0. A finding marked "n/a" concerned a part of Track BB's design that this plan does not have; the reason is given once below the table it sits in. Where v0.3 moved a landing place, the row shows where it is now.

**CEO gate (verdict: no-go for the track, go for the hotfix slice)**

| Finding | Landed |
|---|---|
| CEO-1 "Agents do the work" overstated; swarm undefined; agent-native use and the market argument missing | Section 0.2 rows; decision 18 and SW2-15; section 0.8 |
| CEO-2 Money fixes tied to approving the track; TON inside Telegram | SW0a with decision 25 alone; SW0a-6; decision 26 |
| CEO-3 The cause untouched: direct pushes, no protection on the switch | Hazard 18; rules 2.16, 2.17; SW0a-12; decision 27 |
| CEO-4 Launch cut had the wrong contents; the chat had no tasks | Section 0.5 launch cut; SW1-12; decision 22; section 14.3 as a work order with a low entry bar |
| CEO-5 Unmerged V0 branch ignored | Section 1.1; section 3 note; SW0-8 |
| CEO-6 Too much before the first server run | Section 3 shortest path; SW1-0 on day one; lanes in 0.5 |
| CEO-7 Two server re-checks | n/a: this plan uses the Allora retest only (P15), wired in by SW1-16 |
| CEO-8 The brain late and thin; no idea capture | `kind` on `ship_notes`; connectors beside SW1a (section 9 Needs) |
| CEO-9 Guard false positives unmeasured; gates measure run health only | SW1-0 spike E; SW1-13; SW2-12; SW2-13 |
| CEO-10 Pushback overreached on display-only XP; no exit from deferrals; legal conclusions as fact | Section 14.4 options; decisions 9, 13, 21; section 0.3 item 12 |
| CEO-11 No argument for why this wins; no metric | Section 0.8 |
| CEO-12 "Operators do not read it" had no mechanism | Rule 2.19 |
| CEO-13 Stale and overclaimed statements; soak lengths; no end-of-track check | Section 1.1 re-baseline; rules 2.18, 2.23 |
| CEO-14 Too long to act on | The Owner brief and the decisions as their own file; the plan split in four (v0.3) |

**Full-stack (verdict: no-go as written)**

| Finding | Landed |
|---|---|
| FS-1, FS-2 A generic account-data mover would lose data; the test missed odd tables and non-D1 state | n/a for the mover (this plan keeps a named rule per table, stated under each migration). The classification test is SW0-9 |
| FS-3 The Google connect defence did not stop the attack it named | n/a for the typed-code design. This plan's cookie binding does stop it; four open points were added to 9.1 |
| FS-4 "Verified ship" forgeable | Section 14.1, "Whose site": Allora's rule kept; a domain receipt is added once TN2 is on; no self-reported note completes a quest |
| FS-5 Two plans, one set of names | This merge |
| FS-6 Telegram approval depended on a table that came later; approval was blind | Section 6.5 ships with SW1; SW2-14 shows `argsSummary` |
| FS-7 The view-table refactor was not small | n/a: this plan registers a new view at the six existing points (SW2-11) |
| FS-8 Mission completion is not one batch today | Section 8.1; SW3-3 |
| FS-9 Dossier fix too narrow; findings patch by local id | SW0a-7; P2 (V0-8) |
| FS-10 Staging web sign-in cannot work from the listed files | Hazard 19; SW0a-14 |
| FS-11 A literal `needs:` skips production; cron rollback hazard | SW0a-13; rule 2.20 |
| FS-12 The client cannot learn flag state | SW0-4: a signed-in capabilities answer that does not depend on hazard 2 |
| FS-13 A `cloudflare:` import breaks the node suites | Rule 2.21; SW1-0 spike D |
| FS-14 No sweeper; a consumer removed while still fed | Sweeper is SW1-10; Sentinel's enqueue is removed with decision 22 (section 13) |
| FS-15 Timeline paging was not a correct merge | n/a: no merged timeline endpoint here |
| FS-16 Playbook pages: not one per rule; licence gaps | SW3-8 |
| FS-17 `fetcher = 'worker'` needs a receipt; missing cross-plan edits | Changed in v0.3: a server run's row says so because the run row does, and "Verified" still needs a receipt (P14; the cross-plan edit to V2-11) |
| FS-18 A launch item with no tasks | Section 14.3 |
| FS-19 A two-week soak cannot pass with Testing-status tokens | Section 9.3 step 3 already requires a published consent screen |
| FS-20 No send log; web purchase path undefined | `notify_sends` (6.5); section 11.1 hand-off; SW6-10 |
| FS-21, FS-22 Smaller corrections | SW0a acceptance rows; section 8.2 notes; section 9.1 |

**AI and machine learning (verdict: conditional go)**

| Finding | Landed |
|---|---|
| AI-1 "Every run settles" was not true as designed | Section 4.1, "What every run ends rests on"; SW1-10 |
| AI-2 Ledger and executor can disagree; steps repeat | Section 4.1, "Steps repeat safely" |
| AI-3 A late failure lost early results | SW1 step order (persist before the model call); section 4.3 fallback |
| AI-4 The number guard could not keep its promise | Section 4.3, "The output check, precisely" |
| AI-5 A cited reference is not a supported claim | SW1a has no model text. In SW1b `oneAction` and `verdict` are per-run enums and every suggestion quotes a fetched page (section 4.3) |
| AI-6 A run could exceed its cap | Section 4.4, "Rules that keep a cap true" |
| AI-7 No ceiling on Luminara's own spend | The global daily limit, now two pools (section 4.4); admission in one statement, printed in 6.1 |
| AI-8 The promotion gate could pass with the model wrong | Rule 2.22; SW1-13; SW2-12 |
| AI-9 The prompt that runs is not the one tested | Section 4.1 |
| AI-10 Structured output has four contracts | Section 4.4 |
| AI-11 Fixer drafts had no artefact check | Section 6.1 and SW1-15 for code-built drafts; SW2-13 for model-filled fields |
| AI-12 Fencing presented as a control | Section 4.3 |
| AI-13, AI-14, AI-15 Hotfix tasks did not do what they said | SW0a-8; SW0-3; SW0a-7 |
| AI-16 A per-prompt tag does not hold | Section 9.1; SW4-12 |
| AI-17 Per-founder object semantics | n/a for a per-founder object. Its alarm lessons are in SW1-0 spike A and section 4.1 |
| AI-18 Half the roster needs no model | Section 4.2 already marks each agent `fixed` or `model` |
| AI-19 Sealed runs and writes | Rule 2.10, narrowed in v0.3 to calls that leave the account or spend |
| AI-20 Nothing measured recall | Section 9.1; SW4-10 |
| AI-21 Model retirement | Section 4.4; section 21 |

**Blockchain and payments (verdict: conditional go for the fixes; no-go for jobs and the chat as written)**

| Finding | Landed |
|---|---|
| BC-1 Stars-only rule scheduled last and client-only | SW0a-6; decision 11 |
| BC-2 A paid update can be lost | Hazard 13; SW0a-3; SW6-6 reconciler |
| BC-3 One charge per job; orphan charges had no row | `stars_charges` (section 5.1), used by plans from SW0a-3 and by jobs from SW6 |
| BC-4 The chat had no tasks; the bot would answer a group | Section 14.3; SW9-6 |
| BC-5 Jetton fix too narrow | SW0a-1 (lookback, separate LORA switch, spec 0018, a real refusal check) |
| BC-6 Public health hides payment flags | Hazard 2; SW0a-6 holds whatever health reports |
| BC-7 Downgrade fix covered Stars only | Hazard 14; SW0a-4 |
| BC-8 Burn removal not buildable as written | SW0a-2 |
| BC-9 Missing job states and guards | Section 11.2 constraints, the one-open-job index, the deletion rule, the kill-switch rule |
| BC-10 A refund days later is not guaranteed | Section 11.1; SW6-0 drill |
| BC-11 Disputes reach no person; tax | SW0a-16 (intake); SW6-10 (operator refund); decision 23 |
| BC-12 Status could be bought | Section 0.6; section 14.1; section 11.1 |
| BC-13 Points inside the credit ledger | Hazard 9; SW0a-10 |
| BC-14 Receipts could not yet back a badge; wallet-link list incomplete | Section 14.1; section 15 wallet link |
| BC-15 TON memo matched by `includes` | Hazard 15; SW0a-5 |
| BC-16, BC-17 Smaller corrections | Section 15; SW0a-15 |

**Citation and SQL verifier (52 items on Track BB v1.0)**

Its code-citation corrections were applied wherever the same citation is used here (for example `components/harness/OmnibarModal.tsx`, the working-tree line numbers in `worker/referrals.ts`, the full range of `linkTelegramAndFirebase`). Its companion-plan corrections were applied in sections 0.4, 19 and 20 (the spec 0009 wording, Ops decision 8, the marketplace lock's full text, the `fetcher = 'worker'` rule). Its SQL notes shaped section 8.2 (the NUL caveat), section 9.2 (the dedupe index ignores status) and section 11.2 (payer required; an included job cannot be refunded; status order is enforced in code). Review round 2's verifier then re-read this plan's own citations (section 22).

### 24.5 Choices Track BB made that this plan did not take

Recorded so they are not proposed again without a reason.

| Track BB chose | Why this plan differs |
|---|---|
| Cloudflare Workflows as the step runner | Not settled. v0.2 rejected it for two reasons, and spike A showed both were wrong as written: a Workflow's event stream can be relayed to watchers, and its class loads under the node test suites with two small aliases. Spike A builds the same toy both ways and the measurements decide (section 4.1) |
| One active run per account, recipe and domain, by a unique index | It blocked two different findings on one site from being re-checked at once. Admission counts per plan do the same job here |
| A crew-level re-check recipe beside the Allora retest | Two re-checks with different limits. Allora's is the only one (P15) |
| One generic mover for account data | The tables differ too much: a workspace merges, a ledger sums, a cap is a setting. A named rule per table, plus a test that every table has one (SW0-9) |
| A per-founder coordinator object for Telegram | More standing state than the work needs. Notices and approvals are rows; a run is its own object |
| A local runner on the desktop | Out of scope here (Ops section 13). The desktop gets notices, a tray count and save-to-folder (SW8) |

### 24.6 Review round 2: where each finding landed

The five reviewers read v0.2. Every finding was applied; none was ruled out. "B" marks one its reviewer called a blocker.

**CEO gate (verdict: conditional go)**

| Finding | Landed |
|---|---|
| CEO-15 (B) The launch cut had no fix made by an agent | Fixer v0 and its checks (section 6.1, SW1-15, SW1-16); rule 2.10 narrowed; the re-check in the cut (P15, decision 28); the first chain's acceptance test (0.5); the copy rule (Owner brief, decision 24) |
| CEO-16 The existing one-click deploy screen was not recorded | Section 1.1; hazard 20; SW0a-17; section 0.6; decision 18 reframed; SW2-15 moved up |
| CEO-17 No step zero for releases | SW0a-0; the order and promotion rules of 5.1; SW0a-12 (bypass hint, AI identity) |
| CEO-18 Prerequisites left to other plans | Section 3, "Who does the prerequisites"; P14 made optional for SW1; decision 28; the count in section 19 |
| CEO-19 Four rules are too few; scheduled runs would nag | SW1-14; section 13 (speaks only on a change); section 0.3 items 13 and 14 |
| CEO-20 One spend pool lets free use starve paid | Section 4.4; decision 7 |
| CEO-21 The engine was chosen without building the alternative | Spike A builds both (section 4.1, SW1-0); 24.5 |
| CEO-22 Overstatements | Owner brief item 3; hazards 9 and 18; section 0.7; decisions 8 and 17 placed |
| CEO-23 Too many decisions | Section 20 grouped by when each is needed; decisions 28 to 32; option C in decision 9; decision 23 split |
| CEO-24 Cut order; pay-per-audit too early | Section 19; section 10 moved behind Jobs, on a trigger |
| CEO-25 The chat needed less than 14.6; cron, free cadence, first run | Section 14.3; section 13; SW1-17 |
| CEO-26 Metrics | Section 0.8 |
| CEO-14, again: twice as long after the merge | Four files |
| Smaller: rules 2.2 and 2.19; rule 2.4; `/idea` and `/note`; legal points stated as fact | Rules 2.2 and 2.4; SW3-3; section 24.3 |

**AI and machine learning (verdict: conditional go)**

| Finding | Landed |
|---|---|
| AI-22 (B) Cents cannot hold a model call | Section 4.4, "The unit"; SW0-6 and `token_meter`; the runs' own key; usage adapters |
| AI-23 (B) The sweeper would end paused and waiting runs | Section 4.1: D1 decides control, the sweeper acts by state, the deadline counts working time; the clock columns in 6.2 |
| AI-24 Two stores, no rule for which wins | Section 4.1: the journal decides progress, D1 is a projection; the interrupted-step table; only `alarm()` runs a step |
| AI-25 A busy provider failed the run | Section 4.1 |
| AI-26 Reservation invisible to other runs | Section 4.4; the admission statement (6.1) |
| AI-27 Gates that could not fail | SW1-13; section 7.1; SW4-13; SW6-11 |
| AI-28 One model call was still one too many for the first release | SW1a and SW1b; the quote rule (4.3) |
| AI-29 Fixer and Coach did not need a loop | Sections 4.2 and 7.1; SW2-6 moved to SW6-11; handoff rules |
| AI-30 The pull request path was too open | Section 7.1; SW2-15 |
| AI-31 `origin_trust` named columns that do not exist | Sections 4.3 and 9.2 |
| AI-32 The Analyst's windows and movers | Section 9.1; SW4-7; the proposal rule in 9.2 |
| AI-33 The fallback fix was too narrow | SW0a-11 |
| AI-34 The snapshot block could leave through the browser | Section 4.5; SW4-12 |
| AI-35 Chat over-blocking; free-text instructions; a weak metric | SW0a-8; spike E; sections 4.3 and 12.1; section 0.8 |
| AI-36 The eval-passed list and page text had no home | Section 4.1; `prompt_pins_json` (6.2); SW1-7 |

**Blockchain and payments (verdict: conditional go for SW0a; no-go for pay-per-audit as written)**

| Finding | Landed |
|---|---|
| BC-18 (B) A settle that timed out was called failed | Sections 10.1 and 10.2; SW5-9 |
| BC-19 (B) The Stars fix had no migration name, no staging drill and too wide a 5xx | SW0a-0; SW0a-3; `stars_charges` |
| BC-20 Asset address from the wrong source; an authorisation that expires mid-audit | Section 10.1 |
| BC-21 A USDC surface near Telegram; records | SW5-7; decision 5; section 10.1 |
| BC-22 The old pay-per-call routes still answer | SW0a-2 |
| BC-23 Nobody looked for payments already lost; the TON sweep could not work on a daily cron | SW0a-18; SW0a-5 |
| BC-24 Refund worker details | Section 5.1 (grace, lease, "already refunded"); section 11.2 |
| BC-25 The group guard would have dropped payments | SW9-6 |
| BC-26 Chat entry details | Section 14.3; polls in 14.5 |
| BC-27 Points | Section 14.4; SW0a-10 |
| BC-28 Bounty fee, escrow, badges | Section 15 |
| BC-29 TON cannot be refunded; the upgrade rule; payment messages | SW0a-4; decision 31; section 6.5 |
| Leftovers from round 1 | SW0a-6; SW0a-16; the redo (section 11); the wallet link (section 15) |

**Full-stack (verdict: conditional go)**

| Finding | Landed |
|---|---|
| FS-23 (B) The group guard and two update kinds were in the wrong place | Section 14.3; SW9-6; SW9-8; SW2-14 |
| FS-24 (B) An invite would redirect six routes to the inviter's org | Section 12.1; SW7-2 |
| FS-25 (B) Staging was behind `main` | SW0a-0 |
| FS-26 Link rules missing for new tables | Stated under each migration |
| FS-27 SW1's needs were incomplete | Section 6 Needs; P5 widened; P19 |
| FS-28 Many accounts, one site | Section 4.4; the admission statement |
| FS-29 The cost unit | As AI-22 |
| FS-30 Two flag vocabularies | Rule 2.3; SW0-4 |
| FS-31 "Staging ran it" had no check | Rule 2.16; SW0a-12 |
| FS-32 Notices | Section 6.5 |
| FS-33 Google connect off the web | Section 9.1; SW4-3; section 4.6 |
| FS-34 The pull request feature | Section 7.1; SW2-15; the provider list in 9.2 |
| FS-35 Throttle and setup script | SW9-7; SW0a-3 |
| FS-36 `/idea` already exists | Sections 8.1 and 8.2; SW3-3 |
| FS-37 API-only; a third fallback site | Owner brief; hazard 9; SW0a-10; SW0a-11 |
| FS-38 The licence-key check | Rule 2.15; SW0a-12 |
| FS-39 Landing the V0 branch | SW0-8 |
| FS-40 Smaller | Section 13; section 14.1; SW3-6; SW7-7; SW2's soak |

**Citation and SQL verifier (99 items)**

Fifteen code citations (A) and seven companion-plan citations (B) were corrected in place. Twenty-one SQL and data-rule items (C) are in the statements and notes beside each migration: the notice insert is printed in full and handles an account with no preferences row; older 28-day windows are deleted; a moved session is re-pointed; the accept and the membership insert are tied; an older join request cannot reopen a decided one. Fifty-six consistency items (D) were applied where the text they named still exists, and to its replacement where v0.3 rewrote it.

**From the session that wrote v0.1**

Its 285-citation pass and its four text requests were applied: the notice insert for an account with no preferences; rule 2.6's stated exceptions; the charge transitions quoted in full; and full paths on bare file names. Its wording for decisions 11 and 18 is used.

### 24.7 Review round 3: where each finding landed

The same five reviewers read v0.3 against their own findings. Every round 2 finding was reported closed or partly closed; the partly closed ones are the new findings below. "B" marks a blocker.

| Finding | Landed |
|---|---|
| CEO-27 The re-check covered one finding a week, and only if the founder committed first | Solved at its cause by FS-42: the server run records each finding's baseline itself (section 6.1, SW1-16) |
| CEO-28 The chain's acceptance test could not pass | SW1-18 ("Next:" at read time); the test in section 0.5 |
| CEO-29 Allora's fourteen-day wait neither counted nor waived | Decision 28; section 3; section 19.1 |
| CEO-30 "Seven weeks" had a weak basis | Owner brief, "How big it is" |
| CEO-31 Counsel on bounties had no start | Owner brief, the long leads |
| CEO-32 Two statements of when handoffs arrive | Sections 0.2 and 0.3 |
| CEO-14, a third time: the working file is still long | Sections 7 and 9 moved to the later-phases file |
| AI-37 (B) Spend lost when a run is ended from outside | Section 4.1 step 1; `settled_at` (6.2); the admission statement; the sweeper settles a lost run at its cap |
| AI-38 Three clock faults | Section 4.1: the object starts the clock; a wake never cuts a wait short; `wait_until` on a provider wait |
| AI-39 A code-built draft could still be the wrong fix | Section 6.1, the three rules after the draft table |
| AI-40 The model duplicated the verdict; quotes had no minimum | Section 4.3; section 6.1 (SW1b); SW1-7 |
| AI-41 Gates compared what code decides | SW1-13; section 7.1; SW4-13; SW6-11 |
| AI-42 No rule for choosing the engine | Section 4.1, "How the engine is chosen, and by when"; SW1-4 |
| AI-43 Five details | The Binds paragraph; section 4.2 (child cap); `token_meter`; the per-site rule (4.4); Coach's insert (6.1) |
| AI-44 Old wording still allowed a number that merely matched | Rule 2.9; section 4.3; SW1-7; section 9.1; the roster |
| AI-45 Model-filled fields checked only lexically | Section 7.1 |
| BC-30 (B) A plan charge could be granted and refunded | Section 5.1, steps 2 to 6; SW0a-3 |
| BC-31 "What happens today" was wrong | SW0a-4; decision 31 |
| BC-32 (B for SW5) Money could be taken with the result withheld | Sections 10.1 and 10.2; SW5-4; SW5-9 |
| BC-33 A job could be paid on an uncredited charge | Section 11.2 |
| BC-34 The card rail as a fourth writer | SW0a-4 (the rule inside `writeSubscriptionRecord`); SW0a-6 |
| BC-35, BC-36 Smaller | Section 5.1 (manual refunds, `unknown`, the daily comparison); 11.2; 10.2; 14.1; 15 |
| FS-41 (B) Unpushed commits that must not be pushed alone | Hazard 21; SW0a-0; section 1.1; Owner brief |
| FS-42 (B) The re-check hung off the weekly decision row | Section 6.1; SW1-16; section 19.1 |
| FS-43 The sweep's test and four webhook details | Section 5.1 |
| FS-44 Details of the tasks done under other plans' ids | Section 3; section 5 (order); SW1's order |
| FS-45 Support had nobody to reach; the deploy read-back needed a route | SW0a-16; SW0a-17 |
| FS-46, FS-47 Smaller | `ton_pending_orders`; SW1-17; three migrations in place of one |
| FS-26, FS-30, FS-32, FS-33, leftovers | Section 19.1 (projects, the flag helper); 7.2; SW1-12; 9.1 |
| Verifier, 24 items | The eight SQL defects are fixed beside each statement; the two citations are corrected; the consistency items are applied in sections 0.5, 0.6, 0.7, 4.1, 6.5, 12.1 and 14.3 |
