# TON CitationRegistry Contract

Self-contained Acton + Tolk 1.0 smart contract suite for The Open Network (TON).

| Contract | Role |
| --- | --- |
| `contracts/CitationRegistry.tolk` | Verifiable citation registry storing tamper-evident SHA-256 evidence digests of AEO/SEO audit runs. |

## Invariants

1. **Replay Protection**: External messages strictly check `seqno == storage.seqno` and `validUntil > blockchain.now()`, incrementing `seqno` atomically.
2. **Designated Minter**: Only the authorized `minterPublicKey` (Luminara operations hot wallet) can write audit proofs or toggle pause state.
3. **Fail-Closed & Emergency Pause**: If `isPaused` is true, all incoming anchor requests revert with error code `105`.
4. **Gasless Sponsored Anchoring**: Internal messages use opcode `0x736e6368` ('snch') with signed payloads, enabling Luminara relayers to sponsor gas fees for users.
5. **Deterministic Evidence Verification**: Every record stores a composite hash `domainHash ^ auditIdHash` with `evidenceHash`, `healthScore`, `citationRate`, `findingsCount`, and `anchoredAt`.

## Build and Test with Acton

Prerequisites: [Acton](https://ton-blockchain.github.io/acton/) installed (`curl -LsSf https://github.com/ton-blockchain/acton/releases/latest/download/acton-installer.sh | sh` or via WSL/Linux).

```bash
cd contracts/ton
acton build
acton test
```

## Testnet Deployment

```bash
acton script scripts/deploy.tolk --net testnet
```
