# Thermo-Nuclear Code Quality Review Standards

Always enforce implementation quality, maintainability, abstraction quality, and codebase health:

0. **Ambitious Structural Simplification ("Code Judo")**:
   - Actively search for restructurings that preserve behavior while making the implementation dramatically simpler, smaller, and more direct.
   - Reframe changes so that entire branches, helpers, modes, or layers disappear entirely. Delete complexity rather than rearranging it.

1. **Strict 1,000-Line Limit**:
   - Never let a change push a file from under 1k lines to over 1k lines without a strong reason. Decompose into focused subcomponents or helpers.

2. **Zero Spaghetti Condition Growth**:
   - Reject ad-hoc conditionals, scattered special cases, and one-off boolean flags bolted onto existing flows.
   - Push logic into dedicated abstractions, state machines, or domain models instead of tangling existing paths.

3. **Bias Toward Clean Design**:
   - Do not accept "it works" code that leaves the codebase messier.
   - Prefer simplifications that remove moving parts altogether.

4. **Boring, Direct, Maintainable Code**:
   - Reject brittle, magical, or generic mechanisms that hide simple data shapes.
   - Eliminate thin wrappers or pass-through abstractions that add indirection without clarity.

5. **Type & Boundary Cleanliness**:
   - Eliminate unnecessary `any`, `unknown`, casts, and optionality.
   - Use explicit typed contracts. Make illegal states unrepresentable.

6. **Canonical Layer Reuse**:
   - Keep logic in its rightful architectural layer. Do not leak feature logic into shared paths.
   - Reuse existing canonical utilities; do not introduce bespoke duplicates.

7. **Atomic State & Parallelism**:
   - Parallelize independent async work. Ensure related state transitions are atomic.
