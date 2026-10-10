# Founder Swarm and Business Brain: owner brief and decisions (Track SW)

**Part of:** Track SW v0.4. The plan is [`founder-swarm-business-brain-additive-plan.md`](./founder-swarm-business-brain-additive-plan.md); its first page lists every file.  
**Date:** 2026-10-10  
**This file holds:** the Owner brief, and section 20 (every owner decision).  
**Section numbers** are the plan's own, so they do not start at 1 here.

---

## Owner brief (read this first)

**What this plan is.** One program that turns Luminara into the place where a founder signs in and agents do the work: audit the site with the app closed, draft the fix, re-check what shipped, say what to do next, and keep the business's knowledge and numbers in one place. Later it adds fixed-price jobs that refund themselves when the check fails, and a builders community entered by doing real work.

**What is true today.**

1. **No agent does work on the server yet.** The audit "crew" is four fixed rules running in the browser tab. Close the tab and it stops (section 0.1).
2. **Money defects are on `main`.** The Jetton payment check looks for the wrong message code while its switch is on; a paid Stars update can be lost with no refund; a one-day purchase can relabel a subscriber's plan downward; the paywall advertises a burn that never happens (section 1.2, hazards 10 to 15).
3. **Production is offering a USDT checkout it cannot credit, since 2026-10-10.** During this review another session made a large commit (`e25e525`) and thirteen more, and pushed them to `staging`. One change in it puts the payment fields back on the public health route while the Jetton switch is still on. Production now answers `{"ok":true,"ton":true,"jettonCheckout":true,"stripeCheckout":false}`, so the paywall shows the TON tab and the USDT selector again, inside Telegram as well, for a payment the Worker cannot match to an order (hazard 21). `origin/main` has not moved and the release workflow's production job was skipped, so production was deployed some other way; how is not yet known. The same commits add a card rail through Stripe (switched off), two migrations, a second store for business memories, and a streak card that shows a points total and calls the daily check-in when it opens.
4. **Code went to production on 2026-10-10 with no pull request, no staging pass and no flag.** Commit `42880f5` added a points total ("Lumens"), a daily check-in, a community idea feed and a Workers AI fallback as API routes. No screen calls them yet, so no founder sees a total or a feed today; anyone signed in can still call the routes, and the feed route returns account ids and lets one account publish another's idea card (hazard 9).
5. **Several screens can show a number or a claim nobody checked** (hazard 17), and the "1-Click CMS & GitHub Autonomous Deployment" screen reports a WordPress deploy as done on any HTTP 200 (hazard 20).
6. **Most of what the brief asks for already has an approved design in five other plans that was never built.** Section 3 lists each one and where it stands. This plan sequences them, does the ones on the shortest path itself, and specifies only what is missing.
7. **Scale is tiny.** Production had 5 user rows on 2026-10-01 (not re-counted since). Community features have a trigger, not a date.

**What needs you first.** None of these waits on the rest of the plan.

1. Today: stop the USDT checkout in production (SW0a-0). Start the Jetton task chip, which is SW0a-1, or roll production back to the version before; the choice is yours and either needs your yes. On the same day, switch on "Do not allow bypassing the above settings" for `main` (decision 27). Nothing goes from `staging` to `main` until SW0a-1 and SW0a-6 are on `staging`.
2. Say "yes, fix it" to SW0a (section 5.1, decision 25). Five task chips already exist; three cover SW0a's first tasks (Jetton checkout and burn copy; lost Stars payments; the community feed) and two cover hazards 1 to 3. **Order matters:** the Jetton chip and the Stars-only rule (SW0a-1, SW0a-6) go in before the chip that restores the public health fields, or the TON rail and the USDT selector come back.
3. In your own wallet app, confirm the TON merchant address in `wrangler.jsonc` is yours (decision 26). Until then TON checkout stays hidden.
4. In GitHub, turn on "Do not allow bypassing the above settings" for `main`, and protect `staging` (decision 27). Today an administrator can push straight to `main`, which is how `42880f5` reached production. The checkout switch arrived another way, inside pull request #54 in a commit titled "feat(ml)", which is why the plan also pins it with a test.
5. Sign in on the production web app with email and say whether it works (hazard 1).
6. Create a separate test bot for staging (SW0a-14). The Stars payment fix is not released until it has taken a real test payment there.
7. Answer the launch decisions in the table below. The first server audit needs no model, so it needs only your yes to run audits on the server and a daily run limit (decisions 3 and 7).
8. Start three long leads if you want them: Google verification (decision 4), a code-signing certificate for the desktop installer (decision 30), and counsel on bounties and third-party sellers (decision 13).

**The launch cut.** "MVP launch with an ecosystem people can join" means one chain a founder can walk end to end, and one room:

- **Auditor** audits the site on the server with the app closed, using a larger rule set than today's four (SW1a, SW1-14), and tells the founder when it is done (SW1-12).
- **Fixer** drafts the fix for each finding it has a template for, checked by code, saved as a draft (SW1-15, SW1-16).
- The founder ships it, and a **server re-check** says whether the issue is still in the page source (the Allora retest, decision 28). The server recorded the "before" itself, during the audit, so the founder has nothing to do first and any finding that has a check can be re-checked.
- **Coach** proposes the one thing to do next from the open findings (SW1-18).
- The Fix Board and Ship Log are where this is worked (SW3-0 to SW3-4); the Auditor comes back on the plan's schedule (decision 22); the first quests and one builders chat give a reason to return and a place to join (section 14, decisions 9 and 19).

No model writes anything in that chain at launch; every step is code over fetched evidence, which is why it can be promised. The model-written summary and suggestions (SW1b), the roster with limits (SW2), connectors (SW4) and jobs (SW6) follow in that order. Until Fixer drafts and the re-check are live, product copy says "audits while you are away", not "agents do the work".

**How big it is.** The launch cut is about 90 tasks, counted in section 19: 19 in SW0a, 10 in SW0, 28 that other plans own and this team does under their ids (section 3), and 31 here. Between 26 and 30 September this repository merged 13 reviewed pull requests (Zoro plan, section 0.1). At that rate the cut is roughly seven weeks of merge capacity. Seven weeks is a floor taken from one ungated week, not a forecast: the tasks are uneven (SW1-0 is six spikes; SW0-8 lands a 23-commit branch), and that week ran none of this plan's gates. After SW0a's first ten releases under these rules, the rate is measured and the estimate restated. It also excludes the waits that are yours (the staging bot, the decisions below, the soaks) and one that is Allora's (decision 28).

**What you are asked to decide.** Section 20 has every decision with a default. Four are needed now; eight more are needed for launch.

| When | Decisions | What they are |
|---|---|---|
| Now | 25, 26, 27, 31 | Fix what is broken; confirm the wallet; protect the branches; the upgrade rule |
| For launch | 3 with 7; 28; 9; 19; 20; 22; 24 with 8 | Run audits on the server and the daily limits; the server re-check; the points that shipped; the builders chat and who looks after it; when the bot may message a founder; scheduled audits; what is promised publicly and the names |
| When its phase starts | 18 (SW2); 4, 6, 29 (SW4); 1, 16, 23, 32 (SW6); 15 (Leads); 10 (SW7); 12, 30 (SW8); 5 (SW5); 13, 14, 21 (SW10) | Each is asked at that phase's re-baseline, with what was learned by then |
| Engineering calls, recorded | 2, 17, the model in 3 | Made here; say so if you disagree |
| For information | 11 | Telegram's rule, applied in SW0a-6 under decision 25 |

**What this plan will not do.** Hold or release money between two users. Sell anything inside Telegram for anything but Stars. Let anything be bought that looks like progress: no quest, level, vote or chat entry is earned by paying. Show a number that no measurement produced. Message a founder who did not opt in. Send any transaction or hold any key.

**How to read the rest.** This brief and the decisions (section 20) are one file, and they are the only part written for you. The plan itself holds the argument (0), the baseline (1), the rules (2), what other plans owe (3), the design (4) and the phases in the launch cut (5, 6, 8, 14). The phases after launch (7 and 9 to 13, and 15) are in a second file. The threat model, the edits to other plans and the review records (17, 24) are an appendix. Section numbers are the same everywhere, and the plan's first page lists which file holds which.

---

## 20. Owner decisions

Thirty-two numbered rows is too many to answer in one sitting, and most do not need an answer now. They are grouped by when they are needed. Numbers are kept from earlier versions so that references still work; 28 to 32 are new in v0.3.

**Needed now.** None of these waits on anything else.

| # | Decision | Blocks | Default if no answer |
|---|---|---|---|
| 25 | Approve SW0a (section 5.1): a plain "yes, fix it". It is independent of every other decision here | SW0a | None; needs a yes. Five task chips already exist; three cover its first tasks |
| 26 | In your own wallet app, confirm that `TON_RECEIVING_ADDRESS` in `wrangler.jsonc` is your address (LORA plan open action O1, open since 2026-10-08) | Any TON rail on web or desktop | TON checkout stays hidden everywhere |
| 27 | Do the first of these today. In GitHub: include administrators in `main`'s protection, protect `staging` the same way, require a reviewer on the `production` environment, and give AI sessions an identity that can open pull requests and cannot merge to `main` | Rule 2.16; every production step | None. Until it is done nothing in this plan can promise that staging comes first |
| 31 | When a subscriber buys a higher plan. Today the days left become days of the higher plan: a 3-day Growth pass redeemed with 25 Starter days left gives 28 days of Growth. The Zoro plan's rule would start the new term at the purchase and drop the days left. Keep today's behaviour, or take Zoro's rule with one addition: a higher plan that would end before the current one is refused before payment | SW0a-4's upgrade path | Today's behaviour stays, so no buyer loses days. A lower plan is refused and the same plan extends, either way |

**Needed for launch.**

| # | Decision | Blocks | Default if no answer |
|---|---|---|---|
| 3 | Run audits on the server (V decision 5). At launch that is a yes to the Worker fetching a founder's pages while they are away, with no model call and no hosted key. Later, for SW1b, it also means paying for one hosted model call per run; which model is an engineering call, taken from the rate card after the gate in SW1-13 | SW1a; SW1b | None. SW1a does not start without the yes |
| 7 | Allowance per plan (open runs, runs per day). For SW1b only: the two daily spend pools, the total and the part Free may use, proposed from the cost SW1-11 measures | SW1a production; SW1b | Free: 1 open, 2 a day. Paid: 3 open, 20 a day. The pools have no default: unset keeps every model call off |
| 28 | Build the server re-check now. It is the Allora plan's phases 0 to 2, awaiting your go, with that plan's decisions 2, 3 and 5 as it wrote them: Free gets the result chip and a manual retest on one site, automatic retests start at Starter; its result strings; its privacy sentence and 180-day retention. Two changes ride with it, both listed in section 19.1: a check may belong to a finding, written by the server audit, retested only by hand; and the privacy sentence says so. One more choice inside it: Allora holds its retest until fourteen days after its first phase is live. Keep that (launch moves about two weeks), or waive it for launch and read the coverage report afterwards | SW1-16, SW1-18; the launch chain | None. Without it the chain stops at a draft, and copy stays "audits while you are away" |
| 9 | A points total, ranks and a daily check-in shipped on 2026-10-10 against spec 0009, as API routes with no screen. Choose option A (counts and levels; the shipped points are removed), option B (display-only points under the rules of section 14.4, the check-in kept as a streak count worth nothing, one ladder), or option C (as shipped). This plan recommends B | SW9 | None. Until answered, SW0a-10 holds: the routes are off and nothing is removed |
| 19 | Open one builders chat at launch, earlier than TN decision D6 allows, with the entry rule "signed in through Telegram and one completed server audit". With it: the rules to pin, and the name of the person who looks after the chat and reads the moderation queue, and for how many hours a week | Section 14.3 (SW9-7 to SW9-9); section 14.6. SW9-6 ships regardless | Parked. The launch cut then has no room to join |
| 20 | The send policy of section 6.5: consent asked in the app, seven categories that are all about the founder's own work, at most 5 a day, no message that only asks a founder to come back | SW1-12; SW2-14; job, retest and scheduled-audit notices | No messages except replies to commands and payment messages. A founder then learns a run finished only by opening the app |
| 22 | Let the read-only Auditor run on the schedule each plan already promises, before Ops Phase 2 exits (section 13). Also: should Free get one scheduled audit a month | The Auditor-only slice of SW8 | No, and Free stays without a schedule. Scheduled runs wait for Ops Phase 2 with every other Watch |
| 24 | What is promised publicly at launch, and the names. The README says hosted use is "unlimited on a paid plan"; server runs are capped by plan. Until Fixer drafts and the re-check are live, copy says "audits while you are away" and not "agents do the work". The names: "Business Brain", and the roster (decision 8 is merged here): Auditor, Fixer, Analyst, Coach, Prospector | Launch copy; README (SW1-8) | The README line is corrected to say runs are capped. No new name is used in copy until approved |

**Asked when its phase starts.** Each is put to you at that phase's re-baseline, with what was learned by then. Nothing here needs an answer today, except that decisions 4 and 30 have long lead times you may want to start.

| # | Decision | Asked at | Default if no answer |
|---|---|---|---|
| 18 | The app already has a screen where you apply a fix with one click, from your own browser. May an agent start that for you, on the server, after one approval? Options: nowhere yet (agents prepare, you ship); a pull request that adds new files to a connected GitHub repository; later, a folder on your desktop (decision 12) | SW2-0 | Nowhere yet. Agents prepare; the founder ships |
| 4 | Create the Google Cloud project and consent screen under Luminara Digital and submit it for verification | SW4-0 (verification can take weeks; starting early costs nothing) | None. An operator step only the owner can do |
| 6 | May summaries of connector data be sent to the model provider that writes the digest, as disclosed at consent | SW4-7 | No. The digest is the code-computed table until answered |
| 29 | If Google's verification is still pending when connectors are ready: ship them anyway, behind Google's unverified-app screen and its user cap, or wait | SW4 promotion | Wait |
| 1 | Build first-party Jobs, setting aside the virality plan's "no marketplace" line for this one shape | SW6-0 | Yes: TN section 0.2 approved the shape on 2026-10-07 |
| 16 | Job prices (from measured cost), the human-fulfilment commitment, whether a plan includes job credits, and how long charge records are kept | SW6-0 | No plan credits in the first release. Human fulfilment only for SKUs the owner names. Records kept until an accountant says otherwise |
| 23 | People and paperwork for selling: who answers payment support requests and disputes, and for how many hours a week; an accountant's answer on GST for jobs sold to Australian and New Zealand buyers; the refund rule added to the Terms | SW6 production | None. Jobs stay on staging until a person is named |
| 32 | Sell jobs only inside Telegram at first, with web and desktop handing off to it. And approve, per job, the sentence that says what it adds over the free drafts | SW6-0 | Yes, Telegram only. A job with no such sentence is not sold |
| 15 | Leads store other people's contact details. Agency plan only; 12-month retention; privacy policy change | When Leads is next in line (SW3-5) | Build with those limits after counsel reads the form text |
| 10 | Allow team invites, scoped to live rooms and run approvals, setting aside the virality plan's non-goal | SW7-0 | Yes, with the narrow scope in section 12 |
| 12 | Extend the desktop bridge with notify, badge and save-file. Separately: the folder bridge | SW8-0 | Yes to the three calls. No to the folder bridge |
| 30 | Buy a code-signing certificate for the Windows installer. Without one, Windows shows a warning the first time the installer runs. Getting one involves an identity check that takes time | SW8-0 (or earlier, for the lead time) | Not bought. The installer shows the warning and the download page says so |
| 5 | Add a receive-only USDC rail for pay-per-audit, setting aside spec 0016's "rejected for now" and the "no new chain" line for this one use. It needs your explicit yes that taking USDC on Base sits beside the rule that LORA is the one token; the receiving address; the choice of facilitator; counsel's and an accountant's answers on taking stablecoin revenue and keeping its records; the price | SW5's trigger | Not built beyond the spike. No mainnet without all of those |
| 13 | Bounties between founders and third-party sellers. Recommended: commission counsel in Australia and New Zealand, with a date for an answer, on the direct-pay design, third-party sellers and (if decision 9 is option B or C) points; and in the meantime build the no-fee builders directory of section 15 once SW9-10 exists | SW10 | Defer, as TN decisions D4 and D5 recommend. No counsel is engaged and no directory is built until the owner says so |
| 14 | On-chain soulbound badges, and which of the two designs in section 15 | SW10 | Defer. Badges are signed receipts |
| 21 | Wallet link by `ton_proof` to an existing account (section 15). Also: do you want a wallet to be a way to sign in at all? This plan recommends no, because free wallets would farm invite credits | SW10 | Not built. No wallet sign-in |

**Engineering calls, recorded so you can overrule them.**

| # | Call | Made as |
|---|---|---|
| 2 | TN decision D2: one Agent Passport table set, with the Ops plan's Agent Seats folded in (section 7) | Yes, TN's own recommendation |
| 17 | Release path: a pull request from `staging` to `main` with a merge commit (V decision 8) | Yes. Rule 2.16 and SW0a-12 enforce it |
| 3, in part | Which provider and model write the SW1b summary | Chosen from the rate card after SW1-13's gate, and recorded in section 23 |
| 8 | Roster names | Merged into decision 24 |

**For information.**

| # | Fact | What follows |
|---|---|---|
| 11 | Telegram requires digital goods and services inside a bot or Mini App to be sold for Stars. Today a TON tab can appear there | SW0a-6 removes it from every Telegram surface. It ships under decision 25, not under a separate answer, and removes nothing that works today. Say otherwise only on advice from Telegram or counsel |

Also needed from other plans' lists, because this plan waits on them: V decisions 1, 8 and 9; Ops decisions 4, 7, 8 and 9; Zoro decision 9 (hosted keys on staging, for SW1b); TN decisions D2 and D7. Allora's decisions 2, 3 and 5 are answered through decision 28 here, and its decision 4 through decision 20.
