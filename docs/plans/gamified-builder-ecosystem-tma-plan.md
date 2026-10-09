# Gamified Builder Ecosystem & TMA Growth Engine

**Date:** 2026-10-10  
**Status:** Architecture & Implementation Plan  
**Owner:** Product, Growth, Full-Stack  
**Companions:** [`docs/plans/virality-activation-loops.md`](./virality-activation-loops.md), [`docs/plans/investor-marketable-10x-ship.md`](./investor-marketable-10x-ship.md), [`docs/plans/lora-jetton-production-ship.md`](./lora-jetton-production-ship.md), [`specs/0015-smb-launchpad.md`](../specs/0015-smb-launchpad.md)

---

## 1. Executive Summary & Philosophy

This plan translates the psychological retention mechanics of auto-compounding rebase protocols (Titano, Safuu) into an ethical, highly engaging, self-funding growth engine for Luminara Suite inside Telegram and the Telegram Mini App (TMA).

### 1.1 The Post-Mortem: Mechanics vs. Toxic Math

Titano and Safuu collapsed because their financial model relied on hyper-inflationary supply expansion (0.023% to 0.039% every 15-30 minutes, or 100,000% to 380,000% APY) funded purely by buy/sell taxes on new entrants. When incoming speculative capital plateaued, exponential dilution caused unit prices to drop faster than balances grew ($P \times Q \to 0$). Furthermore, guaranteed APY promises face fatal regulatory classification as unregistered investment contracts.

**What we discard:**
- Algorithmic supply rebasing of speculative tokens.
- Unsustainable fixed percentage yield promises.
- Transfer taxes that punish real-world utility.

**What we extract (The Gamification & Retention Superpower):**
- **The Compounding Dopamine Loop:** Watching an authoritative asset tick upward continuously.
- **The Loss-Aversion Daily Ritual:** Preserving daily streaks, tier multipliers, and status.
- **Social Flex & Proof-of-Yield:** Showing verifiable improvements in real AI visibility.
- **Self-Sustaining Community Treasury:** Community reward pools funded by real commercial activity (audit lead fees, partner listings, bounty platform fees), not inflation.

---

## 2. Core Architecture: "Proof of Improvement" (PoI)

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Luminara Suite TMA Engine                       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
        ┌───────────────────────────┼───────────────────────────┐
        ▼                           ▼                           ▼
┌───────────────┐           ┌───────────────┐           ┌───────────────┐
│ Metric Rebase │           │ Off-Chain     │           │ TMA Stars     │
│ (Visibility   │           │ "Lumens"      │           │ Bounties &    │
│  Velocity)    │           │ (Compute Gas) │           │ Escrow        │
└───────┬───────┘           └───────┬───────┘           └───────┬───────┘
        │                           │                           │
        ▼                           ▼                           ▼
Weekly AI Citations         Earned by Shipping          Apple/Google Compliant
Score & Perplexity          Schema, Audits, Ideas       Peer Tasks & Services
Velocity Tick               (Zero Howey Risk)           5-10% Protocol Cut
        │                           │                           │
        └───────────────────────────┼───────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ TON Soulbound Badges (SBT)    │
                    │ Linked to Ed25519 Trust       │
                    │ Receipts (CitationRegistry)   │
                    └───────────────────────────────┘
```

### 2.1 The Metric Rebase: Visibility Velocity
Instead of printing inflationary tokens, the number compounding every epoch is the founder's **AI Visibility Index**:
- **Continuous Compounding:** Measured weekly against Perplexity, ChatGPT Search, Claude, and Gemini across verified queries.
- **Real-Time Velocity Feedback:** Visual gauges show the compounding lift from shipped fixes ("+8.4% AI Citation Velocity this epoch").
- **Loss Aversion:** Stale domains that ignore crawler blocks or broken schema experience "visibility decay", prompting return visits.

### 2.2 Off-Chain Utility Points: "Lumens"
- **Nature:** Non-transferable platform energy credits. Zero secondary-market cash value. Immune to SEC securities scrutiny.
- **Proof of Work Earning:**
  - Run initial Instant Audit: +50 Lumens.
  - Publish Idea Scout Card: +25 Lumens.
  - Ship verified robots.txt/schema fix: +100 Lumens.
  - Peer-review another founder's site in TMA: +30 Lumens.
  - 7-Day Active Streak: +200 Lumens bonus.
- **Utility:**
  - Burned to unlock deep competitor research, priority crawler runs, and multi-model AI synthesis without paying cash.

### 2.3 Soulbound On-Chain Badges (SBTs on TON)
- **Non-transferable:** Soulbound NFTs minted to the user's TON wallet linked to their Telegram ID. Cannot be dumped or traded.
- **Anchored to Cryptographic Truth:**
  - Badges link to cryptographic Ed25519 `trustReceipts` in `worker/trustReceipts.ts`.
  - Stored in `CitationRegistry.tolk` on TON.
- **Badge Milestones:**
  - *Genesis Builder:* Shipped first verified audit.
  - *Perplexity Cited:* Verified AI citation in real search results.
  - *30-Day Velocity:* Completed 4 consecutive weekly mission cycles.
  - *LLM Shielded:* Zero crawler errors across GPTBot, ClaudeBot, and PerplexityBot.

### 2.4 Telegram Stars Micro-Escrow Bounties
- **In-App Currency:** 100% compliant with Apple App Store, Google Play, and Telegram TOS.
- **Peer-to-Peer Bounties:**
  - Founders post tasks: "Fix my JSON-LD Schema" (250 Stars) or "Audit my mobile CWV" (500 Stars).
  - Builders submit pull requests or live URLs.
  - Escrow releases on founder approval or automated verification.
  - Luminara protocol collects a 5-10% facilitation fee.

---

## 3. The TMA Builder Community & Virality Engine

### 3.1 The "Build in Public" TMA Feed
1. **Idea Scout Integration:** Founders use `worker/ideaScout.ts` to generate hypothesis cards for unlaunched projects and tap "Share to Community Feed".
2. **Community Validation:** Other builders upvote, stake Lumens, or comment with actionable tips.
3. **Signal over Noise:** Upvote weight scales with the voter's own `VisibilityLevel` (Scout, Builder, Operator from `services/referrals/rules.ts`).

### 3.2 High-Contrast Dynamic Share Cards
- Instant Audits and milestone badges generate dynamic visual summary cards tailored for Telegram chats and Telegram Stories.
- Each card embeds a Telegram Deep Link: `https://t.me/LuminaraSuiteBot/app?startapp=ref_<code>`.
- **Two-Sided Incentive:** The referee unlocks 2 free hosted scout credits; the referrer earns +100 Lumens and streak preservation.

### 3.3 Automated Telegram Bot Loops (`worker/telegramBot.ts`)
- **Daily 10:00 UTC Standup:** "What did you ship today? Drop your live link or commit."
- **Sunday 20:00 UTC Decision Lock:** Reminder to commit the single Weekly Decision Card (`weeklyDecisionService.ts`).
- **Builder of the Week:** Automated pinned summary showcasing the highest verified Visibility Velocity delta.

### 3.4 Founder & Collaborator Matching
- Builders tag themselves by skill (Frontend, Backend, Growth, SEO, Copy).
- The engine matches founders whose Idea Scout cards indicate unmet technical or distribution needs with relevant builders in the group.

### 3.5 Monthly Demo Days
- Hosted monthly in a Telegram Voice Chat / Video Stage.
- Top 5 builders on the Season Leaderboard pitch their product.
- Community votes live using Telegram Stars; pool is distributed to winners.

---

## 4. The Self-Sustaining Economic Model

```
┌─────────────────────────────────────────────────────────────────┐
│                     Revenue Streams Inflow                      │
└────────────────────────────────┬────────────────────────────────┘
                                 │
     ┌───────────────────────────┼───────────────────────────┐
     ▼                           ▼                           ▼
Agency Lead Fees            Stars Bounty Take           Sponsorship Pools
(Agencies pay to claim      (5-10% on peer task         (DevTool/Web3 sponsors
 audit action items)         escrow volume)              fund Demo Day prizes)
     │                           │                           │
     └───────────────────────────┼───────────────────────────┘
                                 │
                                 ▼
                 ┌───────────────────────────────┐
                 │ Community Treasury & Escrow   │
                 │ - Stars prize payouts         │
                 │ - Free Growth tier months     │
                 │ - Core platform compute burn  │
                 └───────────────────────────────┘
```

1. **Agency Lead Marketplace:**
   - When an Instant Audit reveals severe issues (e.g. CSR rendering hydration failure, missing entity graphs), founders can tap "Request Agency Fix".
   - Vetted agency partners pay a fee in Stars or fiat to bid on qualified client requests.
2. **Bounty Protocol Fee:**
   - 5-10% platform take-rate on all Telegram Stars micro-bounties.
3. **SaaS Conversion Pipeline:**
   - Free users who climb streaks and accumulate Lumens experience Growth-tier features (MCP server integration, live AI crawler logs), converting to paid recurring subscribers as their startup scales.

---

## 5. Implementation Roadmap (Phased Delivery)

| Phase | Milestone | Scope | Dependencies |
|---|---|---|---|
| **Phase 1** | **Streaks, Lumens & Daily Check-in** | Pure web & TMA gamification. Daily streak counters, Lumens credit balance, mission completions. Zero crypto. | `services/referrals/rules.ts`, D1 `referral_progress` |
| **Phase 2** | **Viral Share Cards & TMA Feed** | Dynamic Telegram story/chat share cards with deep links, Idea Scout public feed, bot standup triggers. | `worker/ideaScout.ts`, `worker/telegramBot.ts` |
| **Phase 3** | **Telegram Stars Bounties** | In-app bounty board, Stars escrow checkout, payout webhook, platform fee deduction. | Telegram Bot Payments API, D1 `bounties` |
| **Phase 4** | **TON Soulbound Badges** | SBT contract minting on TON anchored to Ed25519 `trustReceipts` and `CitationRegistry.tolk`. | `@ton/core`, `contracts/ton` |

---

## 6. Technical Safeguards & Product Invariants

1. **No Invented Metrics:** Visibility metrics must always reflect honest statuses (`measured`, `estimated`, or `not_measured`). Never generate fake percentage gains to induce false dopamine.
2. **Non-Custodial Escrow:** Stars escrow uses official Telegram Stars payment APIs. TON transactions use direct client-side wallet signatures via TON Connect. The Worker never holds private keys.
3. **Anti-Sybil Defense:** Lumens and streak credit require proof of work (valid domain ownership, signed HTTP headers, or verified GitHub commits) to prevent bot farming.
