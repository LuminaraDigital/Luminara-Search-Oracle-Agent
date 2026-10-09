# Legacy: LUMI v1 (do not deploy)

`lumi-v1/` is the first Jetton written for this project. It is kept only as a
record, because none of it was ever committed and it may match what was sent
to a testnet address. It is not built, tested or imported by anything.

It was replaced by the contract in `../contracts` for these reasons:

1. The advertised 3% transfer tax was never implemented. Wallets credited the
   full amount; the tax settings were stored and never read.
2. Deploying did not mint. The supply only existed after a second message
   (`MintInitialSupply`), and the contract reported a 100M supply before that.
3. A bounced transfer destroyed the sender's tokens: the bounce handler
   skipped 32 bits that the compiler had already skipped, so the refund never
   matched.
4. The metadata lived at a GitHub URL that returned 404 and could not be
   changed after deployment. The image was the TON logo.
5. The tests exercised JavaScript helpers and inline mocks, not the contract.
6. The deployment link relied on an `init` parameter that the TON and
   Tonkeeper deep-link documentation does not list.

The old README inside `lumi-v1/` describes tokenomics (tax, staking yield)
that the code never had. Do not treat it as documentation of anything.
