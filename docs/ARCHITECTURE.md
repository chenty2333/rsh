# RSH architecture

## Product boundary

RSH is **version control and static analysis for research**, not a proof-search runtime.

```text
Human / Codex / Claude / Danus / other runtimes
                     │
                  CLI + MCP
                     │
       Research compiler + static analyzer
                     │
          compiled persistent research state
              ┌──────┴──────┐
      Exploration Graph   Truth Graph
              └──────┬──────┘
                   Git repo
```

Git owns branches, commits, remotes, authentication, pull requests, and team collaboration. RSH owns the semantics of research state.

## Data layers

### Trace layer

Raw conversations, notebooks, runtime logs, source spans, computations, and Git history. Traces provide provenance but are never facts.

### Exploration Graph

Plans, attempts, conjectures, proof attempts, barriers, counterexamples, dead ends, obstacles, directions, and open gaps. It answers: **where have we searched?**

### Truth Graph

Workspace-accepted facts and their `DEPENDS_ON` DAG. It answers: **what may downstream reasoning use as a correctness dependency?**

## Compiler and analyzer

The semantic compiler is model-powered. It extracts targets, mechanisms, assumptions, exclusions, quantifiers, parameters, and implicit claims into complete `rsh.route.v1` IR. Formal CLI checks accept an IR file or an explicitly named external compiler command, then validate the exact schema before analysis. MCP `rsh_check` requires the IR object directly. The natural-language heuristic is available only through the explicit experimental `--heuristic` CLI mode and is not a formal fallback.

The static analyzer is deterministic where possible. It performs:

- relation-aware assumption closure;
- explicit obstruction exclusion;
- universal/existential quantifier checks;
- parameter containment;
- counterexample applicability;
- branch preservation;
- auditable proof traces.

Model suggestions do not mutate truth directly.

## Retrieval

Retrieval is graph-first:

1. lexical/entity search over compiled objects;
2. typed graph-neighborhood expansion;
3. optional semantic reranking;
4. raw evidence only when necessary.

The derived index is not authoritative.

## Local writer boundary

Workspace initialization, product write entrances, and derived-index rebuilds take a workspace-exclusive lock in `.rsh/locks` around the full compound operation. This supplies single-writer serialization on one host, including safe reclamation only for a proven dead same-host owner. It is deliberately not a cross-file transaction: a process crash can leave a partially completed compound operation, and the internal `Store` methods are not exposed as a concurrent transaction API. Cached read paths remain unlocked when no rebuild is needed.

Revoked truth facts remain in the historical graph for audit and cascade analysis, but active retrieval views exclude them. Findings that produced a revoked fact remain visible as exploration history and carry an explicit promoted-truth status.

## Role boundary

MCP roles determine available tools in code, not by prompt convention.

- agents may propose findings but cannot submit verification verdicts;
- verifiers may submit verdicts but cannot propose findings;
- operators may perform both and revoke facts.

## Facts

A fact ID is a hash of normalized mathematical content:

```text
problem_id + sorted predecessors + glossary + statement + proof
```

Mutable bibliography and provenance are excluded from the identity. This allows citation repair without invalidating the DAG.

## Revocation

Truth is revocable; history is not rewritten. Revoking a fact cascades through all truth descendants. Attempts, dead ends, counterexamples, and route history remain in the Exploration Graph.

## Import boundary

Importers produce proposed deltas into the same model. Importing a source never silently upgrades unverified memory to truth. In particular, Danus facts are `llm_audited` awareness by default; only the explicit workspace LLM-truth override permits them to enter Truth with that exact method and evidence grade.
