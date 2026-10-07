# Launchpad contracts

Self-contained Hardhat project (Solidity 0.8.24, optimizer on, 200 runs). It is excluded from the root `tsconfig.json` and `eslint.config.js` and has its own `package.json`. Nothing here is imported by the app at build time.

| Contract | Role |
| --- | --- |
| `src/LoyaltyVoucherToken.sol` | Closed-loop ERC-20 loyalty / voucher points. Merchant mints up to `maxSupply`, customers burn with `redeem`. |
| `src/MilestonePreorderEscrow.sol` | Pre-order escrow. Funds release per milestone after a backer challenge window. Pro-rata refunds on failure. |
| `src/MerchantLaunchFactory.sol` | Deploys both for a merchant, collects a flat deployment fee, sets the escrow platform fee. |
| `src/test/TestHelpers.sol` | Test-only attacker / reverting receiver. Excluded from coverage. Never deploy. |

## Invariants

### LoyaltyVoucherToken

- `totalSupply <= maxSupply` always. `mint` checks `amount > maxSupply - totalSupply`, so huge amounts revert with `ExceedsMaxSupply` instead of overflowing. Redeemed (burned) tokens free headroom for re-minting.
- Only the merchant can `mint`. Anyone can `redeem` (burn) their own balance.
- `transferable` is set once at construction. When `false`, every `transfer` / `transferFrom` must have the merchant as sender or recipient. Customer-to-customer transfers revert with `TransferRestricted`.
- **Factory-deployed tokens are always transfer-restricted** (`transferable = false` is hard-coded; there is no parameter). This keeps vouchers non-tradeable, closed-loop instruments.
- **No function in any contract redeems tokens for native currency or cash.** `redeem` only burns and emits `VoucherRedeemed` for off-chain fulfilment of goods or services.
- `approve(address(0), ...)` reverts. `type(uint256).max` allowance is infinite and not decremented.

### MilestonePreorderEscrow

States: `Funding -> Active -> Completed`, or `Funding | Active -> Failed`. `Completed` and `Failed` are terminal.

Who can move funds, and when:

| Action | Who | When |
| --- | --- | --- |
| `pledge()` | Anyone except the merchant | `Funding`, `block.timestamp < fundingDeadline`, total stays `<= hardCap`. Reaching `hardCap` activates immediately. |
| `finalizeFunding()` | Anyone | `Funding`, `block.timestamp >= fundingDeadline`. `Active` if `totalPledged >= softCap`, else `Failed`. |
| `submitMilestoneProof(i, uri, hash)` | Merchant | `Active`, `i == currentMilestone`, not yet submitted, `block.timestamp <= deliveryDeadline`. Opens a `challengeWindow`. One submission per milestone. |
| `object(i)` | Backers | During the window for the current milestone. Once per backer per milestone, weight = pledge. |
| `disburseMilestone(i)` | Anyone | Current milestone submitted and its challenge window has closed (objection weight stayed `<= 50%`). No early release. Credits balances only. |
| `markFailed()` | Anyone | `Active`, `block.timestamp > deliveryDeadline`, and the current milestone has no submitted proof pending. |
| `withdraw()` | Merchant, fee recipient | Any time they have a credited balance. Pull payment, `nonReentrant`. |
| `claimRefund()` | Backers | `Failed`, once per backer. `nonReentrant`, checks-effects-interactions. |

Rules:

- Milestones are strictly sequential. Only one challenge window is ever open.
- Objection weight `> 50%` of `totalPledged` (strictly greater) during the window fails the campaign at once. Exactly 50% does not.
- The merchant can never self-approve: every disbursement waits for the full challenge window. There is no approval vote and no early release.
- Milestone payout: `gross = totalPledged * payoutBps / 10000`, the last milestone takes `totalPledged - totalDisbursed` so no dust is stranded. `fee = gross * platformFeeBps / 10000`, merchant gets `gross - fee`.
- A proof submitted before `deliveryDeadline` protects the merchant until its window resolves. After that, no new proofs are accepted and anyone can fail the campaign.
- Constructor bounds: `platformFeeBps <= 500`, `0 < softCap <= hardCap`, `fundingDuration > 0`, `deliveryDeadline > fundingDeadline`, `1 day <= challengeWindow <= 30 days`, 1 to 10 milestones, each `> 0`, summing to 10000.

Refund formula (on entering `Failed`, the undisbursed pool is snapshotted):

```
remainingPoolAtFailure = totalPledged - totalDisbursed
refund(backer)         = pledges[backer] * remainingPoolAtFailure / totalPledged   (rounded down)
```

Sum of refunds `<= remainingPoolAtFailure`; at most one wei per backer stays as dust. Amounts already credited to merchant / fee recipient before failure stay withdrawable by them.

### MerchantLaunchFactory

- `MAX_PLATFORM_FEE_BPS = 500` (5%). `setDefaultPlatformFeeBps` cannot exceed it, and every escrow re-checks it in its constructor.
- Deployment fee must be paid exactly (`msg.value == deploymentFee`), otherwise `IncorrectFee`. No refunds needed.
- Fees accrue in the factory (`accruedFees`) and anyone can call `withdrawFees()` to send them to `platformFeeRecipient`. A reverting recipient can only block its own withdrawal, never deployments. The owner can rotate the recipient.
- Ownership is two-step: `transferOwnership(newOwner)` then `acceptOwnership()` from `newOwner`. `transferOwnership(address(0))` cancels a pending transfer.
- Escrow inputs validated: `fundingDuration > 0`, `deliveryDeadline > block.timestamp + fundingDuration`, `1 day <= challengeWindow <= 30 days`, 1 to 10 milestones.
- Each escrow stores the fee recipient at deployment. Rotating the factory recipient does not affect existing escrows.

## Test

```bash
cd contracts
npm install
npx hardhat test
npx hardhat coverage
npm run lint:sol
```

## Deploy

Secrets come only from env vars. Never commit keys.

```bash
cd contracts
export DEPLOYER_PRIVATE_KEY=0x...            # PowerShell: $env:DEPLOYER_PRIVATE_KEY="0x..."
export PLATFORM_FEE_RECIPIENT=0x...
export DEPLOYMENT_FEE_WEI=0                   # optional
# optional RPC overrides: XDC_APOTHEM_RPC_URL, XDC_RPC_URL, POLYGON_AMOY_RPC_URL, POLYGON_RPC_URL

npx hardhat run scripts/deploy.ts --network xdcApothem    # chainId 51
npx hardhat run scripts/deploy.ts --network xdc           # chainId 50
npx hardhat run scripts/deploy.ts --network polygonAmoy   # chainId 80002
npx hardhat run scripts/deploy.ts --network polygon       # chainId 137
```

The script prints the `MerchantLaunchFactory` address. Merchants then deploy tokens and escrows through the factory.

## Residual risks

- Unaudited. Get an external audit before mainnet funds.
- Sybil dilution: the merchant cannot pledge from its own address, but could pledge from other addresses. Those pledges never object, so they raise the objection threshold. A merchant holding `>= 50%` of `totalPledged` this way makes objections impossible. That costs real capital, which is refunded pro-rata only on failure.
- Backer apathy: if backers do not object within the window, funds release. The window is the protection; the app should notify backers when a proof is submitted.
- Proof content is off-chain (`proofUri`, `proofHash`). The contract does not judge proof quality.
- Native currency only. No ERC-20 pledges.
