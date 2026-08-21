# RouteCheck product brief

## Category

**Research compiler + static analyzer + Git.**

Theorem databases answer: “Has a related route been recorded?” RouteCheck answers: “Does the recorded result logically kill, subsume, or genuinely differentiate this proposed route?”

## MVP job

Before a researcher or agent spends days on a route:

1. Compile the plan into a canonical route representation.
2. Compare targets, mechanisms, assumptions, exclusions, quantifiers, and parameter regimes.
3. Detect exact replays, dominated dead ends, applicable counterexamples, partial collisions, and genuine forks.
4. Explain the minimum semantic change needed to escape a barrier.
5. Preserve unaffected ancestor theorems when a child branch fails.
6. Produce a structured research-state commit.

## Initial wedge

The first benchmark is the Gabidulin decoding exploration graph because it contains every difficult case the product must handle:

- a branch failure that must not roll back ancestor theorems;
- a counterexample under a stronger, genuine hard-pencil scope;
- irrelevant extra assumptions that do not create novelty;
- an explicit assumption that really excludes the obstruction;
- semantically related but not logically subsumed routes.

## Deliberate omissions

The MVP does not yet claim automated theorem proving, full natural-language formalization, or authoritative verification. Rule output is evidence-linked and conservative. External sources such as TheoremDB, Failure Atlas, papers, Lean artifacts, notebooks, and conversations are future importers into the same typed graph.

## Private-first workflow

Research state remains local/private by default. A later release workflow can publish selected verified barriers and attempts after arXiv submission, an embargo, or explicit approval.
