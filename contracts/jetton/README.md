# Luminara Jetton (LORA)

The fixed-supply token of Luminara Suite on TON. A standard TEP-74 Jetton with
TEP-64 on-chain metadata and TEP-89 wallet discovery, written in Tact 1.6.13.

**Status: not deployed to any network.** Nothing in this package can deploy
it. The owner launches it by approving one transaction in their own wallet,
first on testnet, then on mainnet. The mainnet step only opens after the same
code has been launched and rehearsed on testnet. The contract has been
reviewed and tested here, but it has not been audited by an outside firm. The
ship plan is `docs/plans/lora-jetton-production-ship.md`.

## Quick start

From the repository root:

```bash
npm --prefix contracts/jetton ci --ignore-scripts
```

```bash
npm run jetton:test
```

```bash
npm run jetton:sandbox
```

`jetton:test` compiles the contracts and runs 166 tests against them in a
local TON sandbox (about 20 seconds). `jetton:sandbox` launches the token on a
fresh local blockchain, runs the payment and burn flow, and prints what
happened. Neither opens a network connection.

## The token

Everything about the token's identity lives in `token.json`:

| Field | Value |
|---|---|
| Name | Luminara Oracle Token |
| Symbol | LORA |
| Decimals | 9 |
| Supply | 100,000,000, created once |
| Image | `https://luminarasuite.com/icon-512.png` |

The metadata is stored on-chain. No hosted JSON file is involved, and the
contract refuses metadata that points to one. The image is a URL: keep that
file online.

## Life cycle

1. **Deploy.** The token contract is created holding the supply figure and
   the metadata. No tokens exist yet and it answers nothing except a launch
   from its admin and plain Toncoin top-ups.
2. **Launch.** The admin sends `Launch`, once. That creates the whole supply
   in the admin's wallet and closes minting for good. The contract must hold
   at least 1 TON at that moment; it stays there as storage rent.

The deploy page sends both in a single message, so in practice this is one
approval. They are separate steps in the contract so that the supply can only
ever go to a wallet that has just proven it can sign. If a stranger deploys
the same contract first (anyone can, the address is public), nothing is lost:
they cannot launch it, and the admin's launch still works.

## Invariants

Each line is enforced by the contract and checked by the named test file.

| Invariant | Test |
|---|---|
| Tokens are created exactly once, by `Launch`, and only the admin can send it. A second launch is rejected. | `launch.spec.ts` |
| Before launch the contract accepts nothing but the admin's launch and Toncoin top-ups. | `launch.spec.ts` |
| There is no mint message. Every known mint message is rejected, including from the admin. The list of message handlers is pinned. | `launch.spec.ts` |
| Total supply always equals the sum of all wallet balances. After launch it can only fall, and only by a holder burning their own tokens. | `invariants.spec.ts`, `burn.spec.ts` |
| A transfer delivers exactly the amount sent. No tax, fee or rounding. | `transfers.spec.ts` |
| Only the owner of a wallet can transfer or burn from it. | `transfers.spec.ts`, `burn.spec.ts` |
| A wallet only accepts credits from the master (the launch) or from a wallet of the same master. A look-alike master cannot credit it. | `launch.spec.ts`, `transfers.spec.ts` |
| A transfer or burn that fails downstream is refunded, not lost. This holds even for a wallet that owes years of storage rent. | `transfers.spec.ts`, `burn.spec.ts`, `toncoin.spec.ts` |
| A wallet refuses a transfer unless the attached Toncoin pays for the whole route, so an accepted transfer always completes. The required amount is checked to the nanoTON. | `toncoin.spec.ts` |
| No message makes the master pay out the Toncoin it holds. Toncoin parked on a wallet is not swept away by a transfer or burn. | `toncoin.spec.ts` |
| The metadata on-chain is exactly `token.json`, and the decimals can never change. | `metadata.spec.ts` |
| The code that gets deployed is the code that was reviewed. | `deployment.spec.ts` |

`invariants.spec.ts` also sends 450 random messages (transfers, burns, admin
messages, forged credits, top-ups) from three fixed seeds and re-checks the
supply and Toncoin accounting after each one.

## What the admin can and cannot do

After launch the admin can do three things:

1. Replace the metadata (`UpdateContent`): name, symbol, description, image.
   It must stay on-chain metadata and the decimals cannot change.
2. Hand the role to another address in two steps (`ChangeAdmin`, then the new
   address sends `ClaimAdmin`). A mistyped address cannot lock the role away,
   and a pending handover can be cancelled.
3. Give up the role forever (`DropAdmin`). The admin becomes the zero address,
   which explorers show as revoked ownership.

The admin cannot mint, move or burn anyone else's tokens, freeze or blacklist
a holder, charge a fee, change the code, or withdraw Toncoin from the master.
None of those messages exist. `admin.spec.ts` covers every line above.

Until the role is dropped, the admin can change the displayed name, symbol
and image. Drop it once the metadata is final.

## Pinned code

`code-hashes.json` records the hashes of the compiled master and wallet code
and the exact compiler version. It is the lockfile for contract code:

- `deployment.spec.ts` fails if a build produces different hashes;
- the deploy tool refuses to prepare a launch from different code;
- the verify script compares what is on-chain with these hashes.

So the code that was reviewed is the only code these tools will deploy. After
a deliberate contract change, run the tests and the mutation check, then:

```bash
npm --prefix contracts/jetton run pin -- --write
```

## Checking that the tests can fail

```bash
npm run jetton:test:mutation
```

This breaks the contracts on purpose, 143 ways, one at a time (lets anyone
transfer, adds a 1% tax, hides a mint inside an admin message, drops a
refund, drains the master, swaps two fields of a standard message, and so
on), and checks that a test fails for each break. A break that no test
notices fails the check. Four of the breaks change nothing a test could
observe; the script names each one and says why.

A full run takes 30 to 60 minutes on one machine. `--shard=1/4` runs a
quarter of the list, `--only=W01,M20` runs chosen breaks and `--list` only
checks that every break still applies to the source. CI runs the four shards
side by side on every pull request that touches this package.

## Local sandbox and disposable wallets

Tests and `jetton:sandbox` run inside `@ton/sandbox` 0.45, an in-memory
emulator of the TON virtual machine. Its fee and storage prices are the ones
mainnet used when that version was published, and `toncoin.spec.ts` reads them
from the emulator's network configuration instead of hard-coding them.

The wallets (`deployer`, `treasury`, `merchant`, `alice`, `bob`, `mallory`) are
sandbox treasuries: contracts that exist only in emulator memory, with made-up
Toncoin. No seed phrase or private key is generated, read or stored for them.
`jetton:sandbox` uses a new random set on every run; pass `--seed=<label>` to
reuse a set, or `--json` for machine-readable output. Addresses are printed in
their test-only form (`kQ...`).

## Launching on a real network

Nothing in this package can launch by itself. It holds no keys, never asks
for a recovery phrase, and cannot sign. The launch happens when the owner
approves a transaction in their own wallet app through TON Connect.

### 1. Testnet

Set up a testnet wallet in the wallet app (a new one is fine) and get about 2
test Toncoin from `@testgiver_ton_bot` on Telegram, then:

```bash
npm run jetton:deploy:testnet
```

Open the page it prints (`http://127.0.0.1:4780/`). On that page:

1. **Connect** the wallet that will own the token. The connected wallet
   becomes the admin and receives the whole supply. There is no option to
   name a different admin.
2. **Deploy.** The page shows the token contract address and the amount (1
   TON by default). The same message has already been run on a local sandbox.
   Compare the address and amount with what the wallet app shows, then
   approve. About 0.95 TON stays on the contract as storage rent and about
   0.04 TON comes back to the wallet.
3. **Check.** The page reads the chain and lists what it found: the code
   hash, the launch, the supply, the admin, the metadata, the admin's balance.
   When every check passes it records the address in `deployments.json`.
4. **Rehearse.** One more approval sends 1 LORA to yourself and burns 1 LORA.
   This proves a real wallet can move and burn the token.

Then look at the token in the wallet app and in the explorer: it should show
its name and logo. Commit `deployments.json`.

If the page loses contact with its own server for a moment it retries by
itself. If it ever says it could not finish checking after your wallet sent a
transaction, do not send again: press "Check again".

### 2. Mainnet

The mainnet page only starts when the testnet token qualifies. It reads
testnet and checks that the same pinned code is there, that it was launched
with the supply and metadata in `token.json`, and that the rehearsal burn is
visible in the supply:

```bash
npm run jetton:deploy:mainnet -- --confirm-mainnet
```

The testnet address comes from `deployments.json`; pass
`--testnet-master=<address>` to name it yourself. The mainnet page works the
same way, with three statements to tick before the Deploy button unlocks, and
no rehearsal. A launched mainnet Jetton cannot be changed or recalled.

### Checking a deployment at any time

```bash
npm run jetton:verify -- --network=mainnet
```

Read-only. It checks the address recorded in `deployments.json`, or the one
given with `--master=<address>`. Add `--fresh` right after a launch to also
check that the admin still holds the whole supply and that the metadata is
exactly `token.json`.

Both tools read the chain through the public Toncenter API, which allows about
one request per second without a key. Set `TONCENTER_API_KEY` to go faster.

## How an app uses it

- **Merchant address.** LORA is paid to an ordinary TON address, the same kind
  of address that receives Toncoin (in this app, `TON_RECEIVING_ADDRESS` in
  `wrangler.jsonc`). A Jetton has no separate receiving address: the
  merchant's LORA balance lives in a Jetton wallet contract that the token
  derives from that address.
- **Paying.** The customer sends a TEP-74 transfer to their own LORA wallet
  with the merchant as destination and an invoice memo such as
  `LUM:<orderId>:<planId>` as a text comment. The merchant's wallet delivers a
  transfer notification carrying the amount, the payer and the memo.
- **Finding a holder's LORA wallet.** Call `get_wallet_address(owner)` on the
  master, or use TEP-89 discovery. A transfer body sent to the payer's main
  account address does nothing.
- **Burning.** The contract does not burn on its own. A burn is a separate
  TEP-74 message from whoever holds the tokens. The total supply falls by
  exactly the amount burned.
- **Toncoin to attach.** A transfer needs the forwarded amount plus about
  0.0083 TON and returns what it does not use. Attaching the forwarded amount
  plus 0.03 TON leaves a wide margin.

`app-flow.spec.ts` runs this flow with fixed message bytes
(`tests/fixtures/app-payloads.json`) in the layout a checkout sends.

Launching the token does not switch on LORA checkout in the app. Checkout is
separate work: the app must verify real Jetton transfers on-chain before it
accepts them.

## Fees and storage rent

Measured in the sandbox at mainnet prices and re-checked on every test run
(`toncoin.spec.ts`):

| Handler | Gas used | Budget in the contract |
|---|---|---|
| Transfer, sending wallet | 9,305 | 13,000 |
| Transfer, receiving wallet | 10,939 | 13,000 |
| Burn, wallet | 7,000 | 10,000 |
| Burn, master | 7,889 | 10,000 |
| Wallet discovery | 8,223 | 10,000 |

| Request | Least Toncoin it must carry |
|---|---|
| Transfer, no notification | 0.0081 TON |
| Transfer with a 0.05 TON notification and an invoice memo | 0.0583 TON |
| Burn | 0.0015 TON |
| Wallet discovery | 0.0008 TON |

A request that carries less is refused before anything moves, and the unused
part of what it carries is returned to the response address.

Every contract on TON pays storage rent from its own Toncoin balance.

- A wallet costs about 0.0011 TON per year. It keeps a reserve worth five
  years of rent at current prices (0.0055 TON today, never more than 0.02
  TON), and each incoming transfer tops the reserve back up. A wallet left
  untouched for decades accrues a debt that the next transfer has to cover;
  tokens are not lost.
- The master costs about 0.0042 TON per year. Launched with 1 TON it keeps
  about 0.95 TON, enough for more than two hundred years at current prices.
  Anyone can top it up with a plain Toncoin transfer.

## Layout

```
token.json                    name, symbol, decimals, description, image, supply
code-hashes.json              pinned code hashes and compiler version
deployments.json              where the token has been launched and verified
contracts/messages.tact       message layouts, exit codes, fee budgets
contracts/jetton_wallet.tact
contracts/jetton_master.tact
src/token.ts                  token.json and TEP-64 encoding
src/localnet.ts               local sandbox, disposable wallets, launch, transfer, burn
src/deployment.ts             prepare a launch, verify a launched token, mainnet gate
src/deployServer.ts           the local deploy page's server
src/deployments.ts            reads and writes deployments.json
src/network.ts                read-only access to testnet and mainnet
src/args.ts                   strict command-line parsing
scripts/sandbox.ts            npm run sandbox
scripts/deploy.ts             npm run deploy:testnet / deploy:mainnet
scripts/deploy-page.html      the deploy page
scripts/deploy-page.js
scripts/verify.ts             npm run verify
scripts/pin.ts                npm run pin
scripts/mutation-check.mjs    npm run test:mutation
tests/*.spec.ts               the sandbox test suite
```

## Dependencies

The deployed contract has no dependencies: it is the compiled bytecode pinned
in `code-hashes.json`. The npm packages here are build and test tools. None is
part of the contract or ever runs with a key.

The Tact compiler pulls in `protobufjs` 6.x (through `ipfs-unixfs`), which has
open advisories and no patched 6.x release. An `overrides` entry in
`package.json` holds it at a patched 7.x. The compiler version is pinned, so
the override stays until the compiler is replaced. `deployment.spec.ts` is the
check that it does not change the build: the compiled hashes must still equal
`code-hashes.json`.

## Before mainnet

The tools enforce the first three. The rest are the owner's to decide.

1. The compiled code equals `code-hashes.json` (tests, deploy tool).
2. The same code is launched on testnet and passes verification (mainnet
   gate).
3. A real wallet has transferred and burned on testnet (mainnet gate).
4. The token shows its name and logo in a real wallet app and explorer.
5. The admin wallet's recovery phrase is stored offline. Consider moving the
   supply and the admin role to a multisig after launch.
6. `https://luminarasuite.com/icon-512.png` is the logo you want and will
   stay online.
7. Anything that describes the token as paying yield, revenue share or
   rewards has had legal review. This contract does none of those things.
8. An outside audit is the usual bar for a token that will hold real value.
   This one has had independent review and adversarial testing, not an
   outside audit.
