# Third-party notices

Luminara Suite is licensed under AGPL-3.0 (see LICENSE). It includes the following third-party work under its own terms.

## claude-seo

- Source: https://github.com/AgriciDaniel/claude-seo (v2.2.5)
- Copyright (c) 2026 agricidaniel and contributors
- License: MIT (full text in `.claude/skills/seo/LICENSE-claude-seo.txt`)
- What we use: the skill and agent markdown under `.claude/skills/seo*` and `.claude/agents/seo-*.md`, the Google updates dataset and schema templates under `.claude/skills/seo/data/`, and a compiled, trimmed copy of the methodology in `services/skills/playbooks.generated.json` that the app injects into its prompts.
- Changes: files are vendored unmodified; the compiled JSON removes runtime, extension and community-footer sections. See `scripts/build-playbooks.mjs`.

Upstream credits individual contributors for several skills (seo-cluster by Lutfiya Miller, seo-sxo by Florian Schmitz, seo-drift by Dan Colta, seo-ecommerce by Matej Marjanovic, seo-content-brief by puneetindersingh); those credits are preserved in the vendored files.

## ponytail

- Source: https://github.com/DietrichGebert/ponytail (commit `2961b52fc1fe6a5a87c7a959a79512e5c2f3ffe5`)
- Copyright (c) 2026 DietrichGebert
- License: MIT. Full text in `.cursor/skills/ponytail/LICENSE` and in each other vendored ponytail skill directory. The same files are copied under `.claude/skills/`.
- What we use: the skill markdown from `skills/` (`ponytail`, `ponytail-audit`, `ponytail-review`, `ponytail-debt`, `ponytail-gain`, `ponytail-help`).
- Changes: skill files are unmodified. The upstream always-apply rule is not copied, because it repeats the skill body. This repo's rule points at the skill instead.

## pstack

- Source: https://github.com/cursor/plugins/tree/837067b75aa20ab58d7b2a2f6c0531e37118c596/pstack (commit `837067b75aa20ab58d7b2a2f6c0531e37118c596`)
- Copyright (c) 2026 Lauren Tan
- License: MIT. Full text in `.cursor/skills/poteto-mode/LICENSE` and in each other vendored pstack skill directory. The same files are copied under `.claude/skills/`.
- What we use: every skill directory under `pstack/skills/` at that commit, installed as sibling folders so `poteto-mode` can resolve `../<name>/SKILL.md`.
- Changes: skill files are unmodified. Plugin images, the Benny automation, and the guide docs are not vendored. `scripts/build-playbooks.mjs` compiles only its named SEO playbooks, so these skills do not enter `services/skills/playbooks.generated.json`.

## thermo-nuclear-code-quality-review

- Source: https://github.com/cursor/plugins/blob/837067b75aa20ab58d7b2a2f6c0531e37118c596/cursor-team-kit/skills/thermo-nuclear-code-quality-review/SKILL.md (commit `837067b75aa20ab58d7b2a2f6c0531e37118c596`)
- Copyright (c) 2026 Cursor
- License: MIT. Full text in `.cursor/skills/thermo-nuclear-code-quality-review/LICENSE` and the copy under `.claude/skills/thermo-nuclear-code-quality-review/LICENSE`.
- What we use: `SKILL.md` only.
- Changes: none. The skill sets `disable-model-invocation: true`. `.cursor/rules/default-code-standards.mdc` names it and requires the review before a pull request is opened.

## Outfit and Instrument Serif

- Source: https://fonts.google.com/specimen/Outfit and https://fonts.google.com/specimen/Instrument+Serif
- Copyright: Outfit by Rodrigo Fuenzalida. Instrument Serif by Rodrigo Fuenzalida, licensed under the SIL Open Font License 1.1.
- What we use: the latin woff2 files in `public/fonts/` (`outfit-latin.woff2`, `instrument-serif-latin.woff2`, `instrument-serif-italic-latin.woff2`), self-hosted so the marketing pages do not request Google Fonts CSS.
- Changes: subset files as published by Google Fonts for the latin unicode range. `font-display: swap`.

## Self-hosted helper services (not bundled; used over HTTP only)

- **LanguageTool** (https://languagetool.org, https://github.com/languagetool-org/languagetool) — LGPL-2.1. Runs as a separate container (`erikvl87/languagetool`) started by `docker-compose.yml`; the app sends text to its `/v2/check` endpoint for the "Writing check" feature. No LanguageTool code is included in this repository.
- **Umami** (https://umami.is, https://github.com/umami-software/umami) — MIT. Runs as a separate container (`ghcr.io/umami-software/umami`) started by `docker-compose.yml`; the app reads its website statistics API for the "Results tracking" feature. No Umami code is included in this repository.

## npm dependencies

See `package.json`; each package carries its own license in `node_modules/<name>/LICENSE`.

## Research inspiration (clean-room; no upstream code vendored)

The Visibility Trends, Share of Voice, Source Citation Graph, and Enterprise Trust Pack
features were designed after reviewing public MIT repositories for ideas only. No source
from those projects is copied into this tree. Concepts reviewed:

- Elmo / AiCMO style prompt-panel visibility and SoV math
- Site-graph style node/edge citation maps
- SOC2-guide style Type 1 vs observation control inventory (checklist only; not certification)
- CORE-EEAT Pass/Partial/Fail signal framing
- Awesome Public Datasets style provenance + health flags for data sources

Luminara branding, storage keys, and UI remain original to this project.

## OmniRoute

- Source: https://github.com/diegosouzapw/OmniRoute
- Copyright (c) 2026 Diego Rodrigues de Sa e Souza and OmniRoute contributors
- License: MIT
- What we adapted:
  - `services/search/freeWebSearch.ts`: Zero-key DuckDuckGo lite HTML search parser with ReDoS bounds and entity sanitization (adapted from `open-sse/services/freeWebSearch.ts`).
  - `services/resilience/failureClassification.ts`: Fine-grained HTTP and provider error classification separating transient rate limits from unretryable auth/quota errors (adapted from `src/lib/resilience/failureClassification.ts`).
  - `services/resilience/adaptiveCircuit.ts`: 3-state adaptive circuit breaker (`closed` -> `open` -> `half_open`) with probe windows (adapted from `src/lib/resilience/adaptiveCircuit.ts`).
  - `services/compression/toolResultCompressor.ts`: RTK tool result and ANSI/log/code block elision compressor (adapted from `open-sse/services/compression/toolResultCompressor.ts`).
  - `services/compression/caveman.ts` and `cavemanRules.ts`: Natural language prompt and context pruner preserving code blocks, JSON schemas, and URLs (adapted from `open-sse/services/compression/caveman.ts`).
  - `services/compression/prefixFreeze.ts`: Prompt cache prefix canonicalizer (adapted from `open-sse/services/compression/prefixFreeze.ts`).
  - `services/trust/piiSanitizer.ts`: Client-side PII and credential redaction gate for scraped website data (adapted from `src/lib/piiSanitizer.ts`).

