# Decision checks (Allora fix retest): runbook

Plan: `docs/plans/allora-concepts-implementation-plan.md` (sections 2.1, 3.6). Code: `worker/decisionCheckFlags.ts`.

## What turns it on

Two vars in all three `wrangler.jsonc` blocks, `"false"` by default:

| Var | Phase | On means |
|---|---|---|
| `DECISION_CHECKS_ENABLED` | 1 | A committed weekly decision gets check rows and a baseline fetch |
| `DECISION_RETEST_ENABLED` | 2 | The daily job and manual retest may fetch |

A feature is on only when its var is exactly `"true"` **and** the KV off-switch below does not disable it. Turning a var on is its own PR that changes the top-level and production blocks together.

## Check the state

```bash
curl -s https://staging.luminarasuite.com/api/health | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).decisionChecks))'
```

`decisionChecks` reports `checksVar`, `retestVar` (the vars), `checksOn`, `retestOn` (the effective state after the switch) and `lastRunAt` (the retest job's last run, epoch ms, or `null`). For production, use `https://luminarasuite.com/api/health`.

## Pause without a deploy

The switch is the KV key `decision_checks:off` in the `LUMINARA_KV` namespace of each environment.

| Value | Disables |
|---|---|
| `checks` | Phase 1: no new check rows, no baseline fetch |
| `retest` | Phase 2: the job claims nothing and fetches nothing; manual retest returns 503 |
| `all` | Both |
| key missing | Nothing |
| any other value, a failed read, or no KV binding | Both (fails closed) |

Pausing never blocks a weekly decision from saving. KV is eventually consistent: allow about 60 seconds, then read `/api/health` to confirm `checksOn` / `retestOn` are `false`.

### Staging

Pause everything:

```bash
npx wrangler kv key put decision_checks:off all --binding LUMINARA_KV --env staging --remote
```

Pause only the retest:

```bash
npx wrangler kv key put decision_checks:off retest --binding LUMINARA_KV --env staging --remote
```

Resume:

```bash
npx wrangler kv key delete decision_checks:off --binding LUMINARA_KV --env staging --remote
```

### Production

Pause everything:

```bash
npx wrangler kv key put decision_checks:off all --binding LUMINARA_KV --env production --remote
```

Pause only the retest:

```bash
npx wrangler kv key put decision_checks:off retest --binding LUMINARA_KV --env production --remote
```

Resume:

```bash
npx wrangler kv key delete decision_checks:off --binding LUMINARA_KV --env production --remote
```

Each command is run once on staging before Phase 1 is promoted (plan 2.1).

## After a rollback

A Worker version carries its own vars, so `wrangler rollback` can turn a flag back on. Read `/api/health` after any rollback. The KV switch still applies to every version.

## Later sections

Clearing stuck leases, purging one account's rows and reading the backlog are added with the retest job (Allora CL2-5).
