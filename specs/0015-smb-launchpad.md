# 0015: SMB Launchpad (loyalty vouchers and milestone pre-orders)

Status: testnet preview behind `LAUNCHPAD_ENABLED`. Mainnet behind `LAUNCHPAD_MAINNET_ENABLED`, off until an external contract audit and written legal sign-off.

## What

Software for Australian and New Zealand small businesses to:

1. Issue **closed-loop loyalty vouchers**: tokens redeemable only for the issuing business's goods or services, not transferable between customers, never redeemable for cash.
2. Run **milestone pre-orders**: customers pledge to an escrow contract deployed by the business. Funds release per delivery milestone after a backer challenge window. If the soft cap is missed, backers object by majority, or the delivery deadline passes, backers get pro-rata refunds of the undisbursed balance.
3. Redeem vouchers at the counter by code.

The Worker stores campaign copy, the contract address the merchant registers after deploying, milestone definitions, and voucher redemption records. It never stores keys, never holds funds, and never records "amount raised" (that is read on-chain or shown as not measured).

## Why this shape

The goal is to keep the product outside financial services licensing without paying for an AFSL. That depends on facts, not labels, so the design hard-codes the facts:

| Control | Where enforced | Reason |
| --- | --- | --- |
| Non-custodial: merchant deploys from own wallet, Luminara never holds keys or funds, never swaps or transfers on anyone's behalf | Architecture; no signing code in Worker | Load-bearing for AUSTRAC (2024 AML/CTF amendments, commenced 31 Mar 2026, cover custody and transfers for others) and the Digital Assets Framework Act 2026 (platforms holding assets for others, commences 9 Apr 2027) |
| Vouchers transfer-restricted, no cash redemption, no listing | `LoyaltyVoucherToken` (factory always deploys restricted); copy screen blocks "cash out" and "exchange listing" | ASIC non-cash payment relief for loyalty and gift facilities assumes spending on the issuer's goods. Tradeable, cash-redeemable tokens risk recharacterisation |
| No investment marketing (returns, dividends, yield, price rises) | `services/launchpad/compliance.ts`, server-side gate (422) and live UI check | Investment expectation is what turns a pre-order into a managed investment scheme (Corporations Act s9) |
| Pre-order consideration is goods or services; backer challenge window; refunds on failure | `MilestonePreorderEscrow` | Removes the "benefit from others' efforts with no control" shape and protects consumers |
| Paid vouchers expire no sooner than 3 years, or never | Worker validation (`voucherExpiryMonths` null or >= 36) | Australian Consumer Law gift card rules (since 1 Nov 2019) |
| Fiat on-ramps only through a registered third party | Not built; documented requirement | Exchanging fiat for crypto is a regulated virtual asset service |

The copy screen is rule-based on purpose: deterministic, testable, cheap, and honest about what it is. It is a guardrail, not a legal determination, and the UI says so.

## Revenue

Flat deployment fee and a capped platform fee on escrow milestone payouts (contract hard cap 5%, default 2.5%), accrued for pull withdrawal. Counsel must sign off on the payout fee before mainnet, because transaction-linked fees strengthen an "arranging" argument if the escrow interest were ever a financial product.

## Alternatives considered

- **Fork a generic presale launchpad (for example xdc.sale).** Rejected. Generic presales sell speculative tokens with liquidity pools, which is the investment shape this design avoids. We also must never point our UI at third-party factory contracts.
- **Custodial escrow held by Luminara.** Rejected. Custody triggers AUSTRAC and the Digital Assets Framework, and creates key-management risk.
- **Model-based compliance review.** Deferred. A model can add advisory notes later, but the blocking gate stays deterministic.
- **Transferable loyalty tokens.** Rejected for now. Secondary trading undermines the loyalty-scheme characterisation.

## Open questions (need counsel, not code)

- Exact provisions of the ASIC non-cash payment facilities instrument now in force (reported remade as 2026/167) and whether token vouchers fit the loyalty or gift facility relief.
- Whether the payout-linked platform fee is acceptable or should become a flat fee only.
- New Zealand: no equivalent relief assumed. Needs review under the Financial Markets Conduct Act 2013 and Fair Trading Act 1986 before NZ mainnet.
- Whether promotional or loyalty-bonus vouchers (exempt from gift card expiry rules) should be allowed shorter expiry.

## Launch gates

1. External smart contract audit of `contracts/`, findings resolved.
2. Written legal sign-off covering the open questions above.
3. Factory deployed with `contracts/scripts/deploy.ts`; address added to `services/launchpad/contracts.ts` (never a third-party address).
4. Apply D1 migration `0018_smb_launchpad_loyalty.sql` to staging, then production.
5. `LAUNCHPAD_ENABLED=true` on staging, end-to-end test on testnet, then production. `LAUNCHPAD_MAINNET_ENABLED=true` last.

## Deployment verification and wallet flows

Listing is gated on proof, not on a pasted address. The merchant deploys from their own wallet through our factory; the Worker then checks the transaction receipt over JSON-RPC (success, sent to our factory, matching deployment event for that address) before a campaign goes public. Live figures (pledged, state, deadlines) are read from the chain on request and never stored, so the app cannot show a number the chain does not hold. Alternative rejected: trusting a pasted address, which would let anyone list a look-alike contract. Residual: public RPC fallbacks can be rate limited, so production should set LAUNCHPAD_RPC_*; 
ot_measured is returned when the RPC fails. Browser wallet flows (deploy, pledge, object, release, refund, withdraw) use viem with the user's injected wallet and are lazy-loaded.

