# 0031: Lumen ledger

Status: foundation. Not enforced as a paywall. No chain receipt. No stake pools.

## What

Lumen is the signed-in balance of prepaid AI work. A purchase on Stripe, Telegram Stars, or TON adds one grant to the same D1 ledger. A metered audit, a completed Oracle turn, or a successful paid MCP call uses 1 when the balance covers it. Lumen is not a coin. The balance screen does not show an address or a connect button.

## Ledger

`migrations/0044_lumen_ledger.sql`

- `lumen_entries` is append-only. `idempotency_key` is unique. A replayed payment or job does not move the balance twice.
- `direction` is `mint`, `burn`, or `void`. A `void` row has amount 0. It marks a refund that had nothing left to take back, so a later purchase is not clawed.
- `lumen_balances` is the cache, updated in the same batch as the mint or burn.
- The grant for a plan equals that plan's Stars price (`PLANS` in `worker/telegramBot.ts`), on every rail. It is not a market rate and not a currency conversion. `lumenGrantFor` is the map. A test fails if the two numbers diverge.
- Keys: `stripe:<session>`, `stars:<charge>`, `ton:<tx hash>`, `audit:<token>`, `agent:<run>`, `mcp:<run>`, `void:<rail>:<id>`, `audit-return:<token>`.
- Stars calls the mint again when the receipt already exists, so a crash after the grant still heals. A Stripe delivery that was already claimed returns before the mint. Replaying `mintLumen` with `stripe:<sessionId>` repairs that one case. The key makes the replay safe.

## Access

A short balance does not fail the job and does not go negative. The free check and the plan allowance still decide access. Turning a zero balance into a block is a later owner decision.

Refunds on Stripe and Stars claw back only the unspent remainder. TON has no refund path in the payment code, so a TON grant is not clawed here. An audit run that cannot be stored, or that is refunded, returns the 1 it used.

`LUMEN_ROUTES_ENABLED` is false. There is no routes table, no stake pool, and no on-chain meter. `tonMirror` on `GET /api/lumen` is false. No TON receipt is written.

## Surfaces

- `GET /api/lumen` for the signed-in account (session, Firebase, or Telegram init data). The body is the balance, up to 8 labels, and the note. It does not include a wallet or a price.
- Web Settings (`AccountPanel`) and the Telegram account panel show the balance and refresh it while open.
- Android native does not show Lumen in this release. The Play listing says the app has no financial features, and this change does not add a balance screen to that binary. A WebView that loads the site uses the web Settings panel.

Account deletion removes `lumen_entries` and `lumen_balances` for that account. The payment claim tables stay. The export includes the balance view.

## Owner

Apply migration `0044` on staging, then production, with the normal D1 migrate. No new secret.

## Alternatives

- Blocking at zero now. Rejected: it would turn the free allowance into a paywall before enforcement is priced.
- Pricing Lumen from a live TON or AUD rate. Rejected: that invents a conversion. The grant is the Stars catalogue number.
- Reusing `referral_rewards`. Rejected: those rows are scout credits, not purchase grants.
