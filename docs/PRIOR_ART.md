# Prior-art synthesis

RSH combines established ideas but has a different product boundary.

## Danus

Borrowed:

- local/shared/verified memory separation;
- one correctness boundary;
- content-addressed fact DAG;
- cascade revocation;
- role-gated tool surfaces;
- persistent compiled state for long-running agents.

Not copied into RSH core:

- strategy orchestration;
- worker swarm;
- autonomous scheduling;
- proof-search loop;
- paper-generation runtime.

Danus can run research. RSH stores, versions, retrieves, and statically analyzes the research state it produces.

## Rethlas

Borrowed the generation/verification separation and the direction of replayable computational evidence. RSH remains runtime-agnostic.

## TheoremDB

Borrowed typed research objects, evidence grades, provenance, and typed relations. The distinction is that RSH's authoritative state is the current private Git working tree and its key operation is logical plan diff/preflight.

A future TheoremDB integration should be a public remote or publication adapter, not the local source of truth.

## Failure Atlas

Borrowed the view that failed routes need structured boundaries: scope, obstruction, evidence, surviving claims, and escape conditions. `failed: true` is not a sufficient research record.

## AutoSci / OmegaWiki-style systems

Borrowed local files, skills, durable structured memory, and wiki/graph-first organization. RSH adds content identities, verifier-gated truth, research-route static analysis, and Git semantic diff.

## RSH's distinct layer

RSH focuses on the relation between prior research state and a proposed next route:

- does an old counterexample satisfy the new assumptions?
- does a new assumption explicitly exclude the obstruction?
- is a route a duplicate, dominated dead end, partial collision, or genuine fork?
- which ancestor results survive a failed child branch?
