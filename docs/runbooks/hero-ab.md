# Homepage hero experiment

The worker sets cookie `lx_hero` on the first HTML response for `/` when `HERO_AB_ENABLED` is `true`.

- `answer`: headline "Be the answer" / "AI gives."
- `employee`: headline "An AI employee" / "for your agency."

The eyebrow and the lede stay the employee copy. The test is the headline. Assignment is 50/50. `Max-Age` is 180 days, `Path=/`, `SameSite=Lax`, `Secure`. A valid cookie is not replaced. `?hero=answer` or `?hero=employee` replaces it while the flag is on.

Staging sets `HERO_AB_ENABLED` to `true`. The top-level wrangler vars and the production block set it to `false`. When the flag is not `true`, every response uses the employee headline and the cookie is left as it is.

A request with no cookie falls back to `employee`. That includes a crawler (no cookie is set for one) and a browser that did not keep the cookie. The server hero and the React hero both read `lx_hero`. React also reads `data-hero-ab` on the document. When that attribute is not `on`, React renders `employee` even if an old cookie is present.

## Events

All three land in D1 `product_analytics_events`. This test adds no email, IP, or user id. `hero_exposed` and `signup_completed` go through `/api/analytics/events`, which already stores an account id when the caller is signed in. `instant_audit_started` is written by the worker when a scout run token is minted, with `account_id` null.

| Event | When | Payload |
| --- | --- | --- |
| `hero_exposed` | Once per browser per variant, from the homepage, and only while the flag is on | `{ "variant": "answer" or "employee" }` |
| `instant_audit_started` | A scout run token was minted, and only while the flag is on | `{ "variant": "answer" or "employee" }` |
| `signup_completed` | Existing sign-up event. `variant` is added only while the flag is on | existing fields, plus `variant` |

`variant` is the cookie, or `employee` when the flag is on and the cookie is missing.

## Readout

`signup_per_exposure` is signups divided by exposures. It is null when exposures are 0. The query does not estimate a winner.

Staging:

```bash
npx wrangler d1 execute luminara-users-staging --remote --env staging --command "<the SQL below on one line>"
```

Production, after the owner sets the flag:

```bash
npx wrangler d1 execute luminara-users --remote --env production --command "<the SQL below on one line>"
```

```sql
SELECT
  variant,
  exposures,
  audits_started,
  signups,
  CASE
    WHEN exposures = 0 THEN NULL
    ELSE ROUND(CAST(signups AS REAL) / exposures, 4)
  END AS signup_per_exposure
FROM (
  SELECT
    json_extract(payload_json, '$.variant') AS variant,
    SUM(event_type = 'hero_exposed') AS exposures,
    SUM(event_type = 'instant_audit_started') AS audits_started,
    SUM(event_type = 'signup_completed') AS signups
  FROM product_analytics_events
  WHERE event_type IN ('hero_exposed', 'instant_audit_started', 'signup_completed')
    AND json_extract(payload_json, '$.variant') IN ('answer', 'employee')
  GROUP BY variant
);
```
