# Mission Framework — Complete Replication of Droid Mission Mode

This is a complete, self-contained replication of the Droid mission framework. It captures every ceremony, every validation pass, every quality gate, and every procedure that Droid uses when running in mission mode.

## How to Use

Load these documents as context for Claude Opus (or any capable LLM). The documents are numbered in the order they should be read, but the master orchestrator (01) references the others.

### For a New Mission

1. Load `01-mission-orchestrator.md` as your primary instruction set
2. Follow Phase 1 (Planning) through Phase 12 (End-of-Mission Gate)
3. Reference the detailed ceremony documents (02-07) when you reach each phase

### For Ongoing Work

If you're picking up a mission that already has artifacts:
1. Read `features.json` to see what's done and what's pending
2. Read `validation-state.json` to see what's verified
3. Continue with the next pending feature using `04-feature-execution.md`
4. After completing a milestone, run `05-scrutiny-validation.md` then `06-user-testing-validation.md`

## Document Map

| # | Document | What It Covers | When to Use |
|---|----------|---------------|-------------|
| 01 | `01-mission-orchestrator.md` | **Master document.** Full lifecycle from planning through completion. Philosophy, phases, file structures, checklists. | Always — this is the entry point |
| 02 | `02-validation-contract.md` | How to create exhaustive behavioral assertions. Assertion format, creation procedure, adversarial review passes, maintenance. | Phase 4: After planning, before features |
| 03 | `03-feature-decomposition.md` | How to translate assertions into features. features.json schema, decomposition procedure, coverage verification, ordering. | Phase 6: After validation contract |
| 04 | `04-feature-execution.md` | How to implement a single feature. TDD procedure, test writing, implementation, manual verification, commits. | Phase 7: For each feature |
| 05 | `05-scrutiny-validation.md` | Code review and automated quality checks. Test suite, typecheck, lint, per-feature review, shared state updates. | Phase 8: After all milestone features |
| 06 | `06-user-testing-validation.md` | E2E behavioral testing through real user surface. Service setup, assertion testing, evidence collection, failure handling. | Phase 9: After scrutiny passes |
| 07 | `07-issue-tracking-handoffs.md` | How to handle discovered issues, failures, incomplete work, mid-mission changes. Issue tracking, fix features, milestone sealing. | Always — whenever issues arise |

## Key Concepts

### Validation Contract = Definition of Done
The validation contract (`validation-contract.md`) is a finite list of behavioral assertions. Each assertion has a clear pass/fail condition. The mission is not done until ALL assertions pass.

### Mission-Level TDD
Write the validation contract BEFORE features. Write features BEFORE code. This ensures you're building the right thing before building the thing right.

### Every Assertion Has an Owner
Each assertion ID appears in exactly one feature's `fulfills` array. This guarantees 100% coverage — every behavioral requirement is someone's responsibility.

### Milestones Are Vertical Slices
Each milestone delivers testable, coherent functionality. After implementation, it goes through scrutiny (code review + automated checks) and user testing (behavioral verification). Once both pass, the milestone is sealed and immutable.

### Nothing Is Silently Dropped
Discovered issues become features. Incomplete work is documented. Failed features are retried. The only way to "skip" something is to explicitly cancel it with justification.

## What This Framework Does That You'd Otherwise Skip

1. **Validation contract with review passes** — Forces you to think about ALL user interactions, edge cases, error states, and boundary conditions BEFORE writing code. The adversarial review passes catch gaps you'd miss.

2. **100% assertion coverage verification** — Mathematically proves that every behavioral requirement maps to an implementable feature. No orphaned requirements.

3. **TDD for every feature** — Write tests first, watch them fail, then implement. Not "write tests after" or "skip tests for simple features."

4. **Manual verification for every feature** — Unit tests don't catch integration bugs. Manual verification through the real user surface catches what tests miss.

5. **Scrutiny validation** — Code review with a checklist covering correctness, security, code quality, consistency, and testing. Not a quick glance — a systematic review.

6. **User testing validation** — Black-box testing of every behavioral assertion with evidence collection. Screenshots, console errors, network calls. Provable verification.

7. **Issue tracking with zero tolerance** — Every discovered issue gets tracked. Every piece of incomplete work gets a follow-up feature. Nothing falls through the cracks.

8. **Sealed milestones** — Once validated, a milestone is immutable. New work always goes through its own validation cycle. This prevents "quick fixes" that bypass quality gates.

## Adapting for Solo Execution

In Droid, the orchestrator, workers, and validators are separate agents with separate sessions. When running as a single Claude instance:

- **You are the orchestrator** during planning and decomposition
- **You are the worker** during feature implementation
- **You are the scrutiny reviewer** during code review
- **You are the user tester** during behavioral verification

The key discipline: **do not skip phases because you "already know" the code works.** The ceremony exists because the phase separation forces you to verify from a different perspective each time. When you review your own code, pretend you're seeing it for the first time.

## Token Cost Awareness

This framework is comprehensive and consumes significant tokens. The most expensive phases:

1. **Validation contract creation** (~15-25% of total) — worth it, prevents costly rework
2. **Feature execution** (~40-50% of total) — the actual building
3. **Scrutiny validation** (~10-15% of total) — catches bugs before user testing
4. **User testing validation** (~10-15% of total) — final quality gate

If you need to reduce cost, the LAST thing to cut is the validation contract. The contract prevents the most expensive problem: building the wrong thing.
