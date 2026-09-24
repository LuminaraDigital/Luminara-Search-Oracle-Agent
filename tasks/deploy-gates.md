# Deploy gates (AI Functions)

Operator approval required before production `npm run deploy` or remote D1 migrate on production.

## Phase checklist (repeat each ship)

1. Local / CI tests green (`npm test` covering `apsMcp`, `w0Foundations`, tool-loop, oracle, audit).
2. Staging D1 migrate (if new SQL): `npm run db:migrate:staging`
3. Staging deploy: `npx wrangler deploy --env staging`
4. Smoke staging:
   - `GET /api/mcp` with Growth+ API key lists free tools
   - Paid tool with Agency or BYOK returns measured or honest `not_measured`
   - Growth without BYOK → `PAID_TOOL_FORBIDDEN`
   - If `ORACLE_SERVER_ENABLED=true`: Agency SSE chat returns tokens
   - If `AUDIT_QUEUE_ENABLED=true`: Agency can enqueue and poll audit
5. Observability: no credentials in logs; tool name + creditClass + measurementStatus present
6. Soak staging (minimum: smoke + one paid DFS call if secrets set)
7. Operator approval → production D1 migrate → production deploy
8. Feature flags: enable Oracle/audit only after soak (`ORACLE_SERVER_ENABLED`, `AUDIT_QUEUE_ENABLED`)

## Migration commands

```bash
# Staging (luminara-users-staging)
npm run db:migrate:staging

# Production (luminara-users) - operator only
npm run db:migrate
```

## Rollback

- Set `ORACLE_SERVER_ENABLED=false` and `AUDIT_QUEUE_ENABLED=false` → Agency Oracle/audit return 501 again
- MCP free tools remain; paid tools can stay live (independent of flags)
- Do not reverse D1 migrations in place; ship forward-fix migrations if needed

## Secrets (never commit)

Hosted Agency DFS: `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` via `wrangler secret put`.  
BYOK uses `x-provider-key: login:password` and does not require hosted secrets.
