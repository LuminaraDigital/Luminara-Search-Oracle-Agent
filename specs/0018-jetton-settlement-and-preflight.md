# 0018: Jetton settlement verifier and payment pre-flight

Status: implemented (verifier and pre-flight). Jetton checkout stays off until the integration step below lands.

## What

Three additive modules, adapted from patterns in Trust Wallet Core (`trustwallet/wallet-core`):

| Module | Pattern | Purpose |
|---|---|---|
| `services/chain/chainRegistry.ts` | `registry.json` | Typed, frozen chain metadata (TON, XDC): decimals, SLIP-44, explorer URL templates, TonConnect and EVM chain ids, and exact decimal/elementary unit conversion. |
| `services/ton/transactionPlan.ts` | `AnySigner.plan()` before `sign()` | Offline pre-flight before the TonConnect prompt. Checks the wallet network against the invoice network, the recipient checksum and network flag, the amount, that the asset is native TON, and that the memo is exactly `LUM:<orderId>:...`. |
| `worker/jettonSettlement.ts` | `tw_ton` deterministic cell layouts | Proves a TEP-74 jetton payment reached the merchant, so USDT and $LORA checkout can be credited safely. |

## Why

- **Jetton checkout was blocked on proof.** A memo inside a plain TON comment can be spoofed. `JETTON_CHECKOUT_LIVE` stays false until a verifier proves the transfer came from the merchant's canonical jetton wallet and that the decoded amount covers the price.
- **Wrong-network payments.** Before this change, a user whose wallet was on testnet could approve a payment against a mainnet invoice (or the reverse). The server could never credit it. Now the planner stops it before the wallet opens, with a message that says nothing was sent.

## Credit rules (jetton)

A jetton payment is credited only when all four hold:

1. The inbound message source equals the merchant's jetton wallet. That wallet is derived by running `get_wallet_address(owner)` on the configured master contract: Toncenter v3 `runGetMethod`, with TonAPI as the fallback. If both providers answer, they must agree. The result is cached in KV for 24 h.
2. The body decodes as `transfer_notification` (`0x7362d096`), and its amount in elementary units is at least the price.
3. The forward-payload text comment equals the order memo exactly (after trimming).
4. The inbound message is not a bounce, and the transaction has a hash.

Rule 1 matters because only the contract the master deployed can send from that address. Indexer wallet listings (`/jetton/wallets`) are never used for this. They read `owner` and `jetton` from each contract's own `get_wallet_data`, so a fake contract can claim `owner=merchant`. Rule 3 is exact so that one comment holding several memos cannot shadow a victim's real payment. Double-credit protection is unchanged: the D1 ledger claims each transaction hash once. Any decode, config, or provider inconsistency fails closed.

## Integration (owner: TON payments)

The integration lives in `worker/tonPayment.ts`, which was being edited in parallel when this change landed, so it is left to that file's owner:

1. Price per asset. Compute jetton units with `jettonPriceUnits(asset, JETTON_PRICING[plan].amount)`; do not reuse the shared `units` strings. Those strings are 6-decimal, and LORA has 9, so reusing them would undercharge LORA 1000x. A test guards this.
2. In `verifyTonPayment`, when `order.asset !== 'TON'`, call `findMatchingJettonPayment` and skip `findMatchingTonPayment`. Pass `{ ...order, amountUnits: order.amountNano }` and `expectedMaster: JETTON_MASTERS[network][order.asset]`. The rest of the flow (ledger claim, subscription write, proof anchor, audit log) stays as it is.
3. Refuse jetton invoices when the configured master for that asset and network is empty (today: `LORA` everywhere, and `USDT` on testnet).
4. Flip `JETTON_CHECKOUT_LIVE` only after step 2 has tests, and after one real testnet USDT transfer has been credited end to end on staging.

Related hardening for the same owner:

- The native TON matcher uses `comment.includes(memo)` and returns the first match. The jetton matcher used to have the same griefing issue, which rule 3 fixes. Apply the same exact match there.
- `services/ton/jettonService.ts` falls back to the merchant's TON wallet when the user's jetton wallet is unknown. That burns the attached TON and moves no tokens. It should fail instead.

## Alternatives considered

- **Bundle the wallet-core WASM.** Rejected: multi-MB binary, no server-side need for key management, and `@ton/core` already covers cell encoding and decoding.
- **Trust an indexer for jetton wallet ownership.** Rejected after review: indexers report what each contract says about itself, so a contract can claim any owner.
- **Trust the indexer's decoded `jetton/transfers` feed.** Rejected for the same reason. We decode raw bodies ourselves.
