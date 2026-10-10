# pstack Engineering Standards

The goal is not to maximize lines of code - write less, but higher quality, durable, and verifiable code:

1. **Go Deep First**: Trace the real flow before picking a solution. Read the code your change touches. No guessing or superficial patches.
2. **Laziness Protocol**: The best code is the code never written. Refactoring or sizing a diff? Bias toward deletion and the smallest change that solves the problem.
3. **Subtract Before You Add**: Remove dead weight first, then build on the simpler base.
4. **Minimize Reader Load**: Collapse one-caller wrappers, count layers and hidden state, shrink mutable scope.
5. **Boundary Discipline**: Validate untrusted input at system and network boundaries. Trust internal types; keep business logic pure.
6. **Type System Discipline**: Make illegal states unrepresentable. Prefer explicit typed models over loose ad-hoc dictionaries or cast-heavy code.
7. **Test Behavior, Not Implementation**: Unit tests assert observable behavior and contracts, not internal plumbing.
