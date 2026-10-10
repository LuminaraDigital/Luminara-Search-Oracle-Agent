# GEMINI.md - Engineering Guidelines

See [AGENTS.md](./AGENTS.md) for full engineering principles and invariants.

## Default Code Quality Directives

Always enforce these 3 defaults during code generation and reviews:
1. **Ponytail (Anti-Bloat & Minimal Diff)**: Smallest complete change. Reuse existing components before writing new code. Deletion beats addition.
2. **pstack (Engineering Rigor)**: Deep before fast. Minimize reader load. Boundary discipline. Strict types.
3. **Thermo-Nuclear Code Quality**: Ambitious simplification (code judo). Strict 1k-line file limit. Zero spaghetti condition growth.
