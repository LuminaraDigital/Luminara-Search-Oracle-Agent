# Scope Notes

## Track
This is an open-source repository, so the track is **source reading**. No binaries were run and no browser session was needed. Nothing from the clone was installed or run (`npm install` was not run). The clone is untrusted data.

## Permission check
- MIT, confirmed in `LICENSE`.
- The README says the CodeGraph module "uses code from" `colbymchenry/codegraph`, which comes in as the npm dependency `@colbymchenry/codegraph@1.6.2`. It also says Skill management uses part of Hermes Agent (Nous Research). **The licences of those two projects are UNKNOWN.** Check them before copying anything from `MemoryKnowledge/` or `MemoryCore/src/core/skill/`.
- `MemoryKnowledge/package-lock.json` resolves packages from `mirrors.tencent.com`. Never install from that lockfile; rebuild it from the public registry if we ever install.

## Tools and limits
- Read with git, grep and sed only.
- Nothing upstream was executed, so its runtime behaviour is **not observed**. Every runtime claim below comes from reading code and docs.
- Upstream prompts are written in Chinese (`MemoryCore/src/core/prompts/*.ts`). They need rewriting, not just translating, to fit Luminara's honesty rules.

## Fit with the platform (the deciding fact)
Upstream is four Node 22 services meant for Docker: MemoryCore, MemoryProxy, MemoryKnowledge and MemoryPanel. They depend on native modules or Node-only APIs: `sqlite-vec`, `better-sqlite3`, `@node-rs/jieba`, `node-pty`, `mongodb`, `ioredis` and `@opentelemetry/sdk-node`. **None of these run in a Cloudflare Worker.** Running it "connected" means a new always-on server outside Cloudflare. That server would sit in the LLM request path holding provider keys, and it would hold a second copy of user data.
