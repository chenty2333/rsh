# RouteCheck

> Before you spend three days on a proof route, determine whether it has already died—and exactly what must differ for your version to survive.

RouteCheck is a clean-room, local-first prototype for **research static analysis**. It compiles a proposed mathematical route into a typed representation and compares the logic—not merely the prose—against a graph of prior attempts, barriers, counterexamples, preserved theorems, and open gaps.

## What this MVP demonstrates

- Typed research graph with branch history and provenance fields.
- Route compilation into targets, mechanisms, assumptions, exclusions, quantifiers, and parameter regimes.
- Six pre-flight outcomes: `EXACT_DUPLICATE`, `DOMINATED_DEADEND`, `COUNTEREXAMPLE_APPLIES`, `PARTIAL_COLLISION`, `GENUINE_FORK`, and `CLEAR`.
- Assumption and parameter diff.
- Conservative escape logic: unrelated assumptions do not bypass a counterexample.
- Minimal recorded escape condition and new frontier.
- Branch preservation: a failed child route does not retroactively invalidate ancestor theorems.
- Structured research-state commit export.

## Important scope

This is a **vertical-slice prototype**, not yet the full Research Git vision. The compiler is currently a deterministic benchmark-oriented rule layer and the research graph is seeded with the Gabidulin exploration. It does not yet ingest arbitrary research traces, perform theorem-level formalization, or maintain real multi-user versioned research repositories.

The intended product is broader: a private-first research compiler + static analyzer + Git-like exploration graph that can ingest conversations, notebooks, proof assistants, papers, and Git history; compile proposed routes into canonical mathematical claims; and decide whether prior attempts logically refute, subsume, or genuinely differ from the new route.

See `docs/PRODUCT.md` and `docs/SCHEMA.md`.

## Status

Private alpha. Rule output is an evidence-linked research aid, not a formal proof checker.
