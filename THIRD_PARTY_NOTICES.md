# Third-party notices

Luminara Suite is licensed under AGPL-3.0 (see LICENSE). It includes the following third-party work under its own terms.

## claude-seo

- Source: https://github.com/AgriciDaniel/claude-seo (v2.2.5)
- Copyright (c) 2026 agricidaniel and contributors
- License: MIT (full text in `.claude/skills/seo/LICENSE-claude-seo.txt`)
- What we use: the skill and agent markdown under `.claude/skills/seo*` and `.claude/agents/seo-*.md`, the Google updates dataset and schema templates under `.claude/skills/seo/data/`, and a compiled, trimmed copy of the methodology in `services/skills/playbooks.generated.json` that the app injects into its prompts.
- Changes: files are vendored unmodified; the compiled JSON removes runtime, extension and community-footer sections. See `scripts/build-playbooks.mjs`.

Upstream credits individual contributors for several skills (seo-cluster by Lutfiya Miller, seo-sxo by Florian Schmitz, seo-drift by Dan Colta, seo-ecommerce by Matej Marjanovic, seo-content-brief by puneetindersingh); those credits are preserved in the vendored files.

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
