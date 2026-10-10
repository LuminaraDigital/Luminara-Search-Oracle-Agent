---
name: pstack
description: poteto's agent style for rigorous engineering, writing less but higher quality code, deep-before-fast analysis, anti-abstraction, boundary discipline, and fearless parallelism. Use whenever writing clean, unbloated, robust code or when the user invokes /pstack, pstack, or poteto-mode.
disable-model-invocation: true
---

# pstack: Rigorous Engineering & High-Quality Code

Based on poteto's [pstack](https://github.com/cursor/plugins/tree/main/pstack).
The goal is not to maximize lines of code - it is the opposite: write less, but higher quality, durable, and verifiable code.

## Core Directives

1. **Go Deep First**:
   - Understand the problem, trace the data flow, and read all touched code before proposing or writing changes.
   - Do not write slop or create superficial wrappers.

2. **Fearless Parallelism & Verification**:
   - Write verifiable code backed by tests or runtime evidence.
   - Sequence work into atomic, verifiable units (`principle-sequence-verifiable-units`).

3. **Core Principles**:
   - **Laziness Protocol (`principle-laziness-protocol`)**: Refactoring, sizing a diff, or tempted to add abstractions/layers? Bias to deletion and the smallest change that solves the problem.
   - **Subtract Before You Add (`principle-subtract-before-you-add`)**: Remove dead weight first, then build on the simpler base.
   - **Minimize Reader Load (`principle-minimize-reader-load`)**: Collapse one-caller wrappers, count layers and hidden state, shrink mutable scope.
   - **Boundary Discipline (`principle-boundary-discipline`)**: Validate strictly at system/API boundaries; trust internal types; keep business logic pure.
   - **Type System Discipline (`principle-type-system-discipline`)**: Make illegal states unrepresentable. Brand primitives. Parse external data at boundaries.
   - **Test Behavior Not Implementation (`principle-test-behavior-not-implementation`)**: Unit tests verify observable contracts, not internal plumbing.
   - **Model the Domain (`principle-model-the-domain`)**: Encode domain invariants into typed structures or state machines instead of scattered conditionals.

4. **Modes & Playbooks**:
   - For complex, multi-step tasks or rigorous deep dives, invoke `/poteto-mode` with the appropriate playbook (`feature`, `bug-fix`, `refactoring`, `investigation`, etc.).
