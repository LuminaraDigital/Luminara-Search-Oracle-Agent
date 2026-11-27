# Learning log: Agentic Oracle (REA)

Repeated mistakes, owner preferences and possible improvements. One correction alone never changes the plan.

## Owner preferences (2026-11-06)

- Wants the result "truly agentic", built from real patterns, not renamed fixed pipelines.
- Chose: approve outside changes; Oracle chat on web first; all four jobs in the first build.
- Standing preferences carried from earlier work: plans get specialist audits, a CEO gate and a citation/SQL verifier, re-reviewed until go; unready work stays a draft PR because the owner merges every non-draft PR in waves.

## Mistakes to avoid

- A whole-repository recursive grep from the main checkout timed out (huge folders). Scope searches to `worker`, `services`, `components`, `crawler`.
- I told the owner the browser loop and RLM were unused because my search matched only `services/browserAction` import paths and missed relative imports (`../browserAction`). Before calling code dead, search for the module's exported names, not its path.
- Two agent master plans once collided on table names (Track BB). Build on Track SW names; never define rival tables.
- Python on Windows writes CRLF by default; the repo is LF (`.gitattributes`). Open files with `newline=''` when editing by script.
- A migration number that is free on `staging` can be taken on another branch (0047 was). Prefer no migration; otherwise scan every remote ref at PR time.
- The end-to-end test, not the unit test, showed the honesty filter only covers figures about the user or a named site. Test the real chat path, not only the parts.

## Owner preferences learned during the build

- Owner chose: build slice 1 as designed (2026-11-06), all plans with caps, crawler checked (none hosted).
