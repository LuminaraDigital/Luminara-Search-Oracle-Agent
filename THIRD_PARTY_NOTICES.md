# Third-party notices

Luminara Suite is licensed under AGPL-3.0 (see LICENSE). It includes the following third-party work under its own terms.

## claude-seo

- Source: https://github.com/AgriciDaniel/claude-seo (v2.2.5)
- Copyright (c) 2026 agricidaniel and contributors
- License: MIT (full text in `.claude/skills/seo/LICENSE-claude-seo.txt`)
- What we use: the skill and agent markdown under `.claude/skills/seo*` and `.claude/agents/seo-*.md`, the Google updates dataset and schema templates under `.claude/skills/seo/data/`, and a compiled, trimmed copy of the methodology in `services/skills/playbooks.generated.json` that the app injects into its prompts.
- Changes: files are vendored unmodified; the compiled JSON removes runtime, extension and community-footer sections. See `scripts/build-playbooks.mjs`.

Upstream credits individual contributors for several skills (seo-cluster by Lutfiya Miller, seo-sxo by Florian Schmitz, seo-drift by Dan Colta, seo-ecommerce by Matej Marjanovic, seo-content-brief by puneetindersingh); those credits are preserved in the vendored files.

## npm dependencies

See `package.json`; each package carries its own license in `node_modules/<name>/LICENSE`.
