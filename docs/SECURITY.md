# Security and trust

RSH provides state integrity and provenance; it does not make an LLM infallible.

## Guarantees enforced in code

- findings cannot be written as facts through `rsh record`;
- MCP agent roles cannot call the verifier verdict tool;
- MCP verifier roles cannot propose findings;
- facts require accepted verification methods under workspace policy;
- fact predecessors must exist and be active;
- fact identities are content-addressed;
- revocation cascades through fact dependencies;
- revoked facts remain auditable by ID but are excluded from default index, orientation, and graph-log views;
- object IDs are restricted to safe single path segments before reaching file storage;
- imported Danus global memory remains unverified;
- derived indexes do not mutate canonical research state.
- product-facing CLI and MCP canonical-state writes are serialized by a local workspace-exclusive lock; stale locks are reclaimed only when their same-host owner is provably dead.

## What still requires judgment

- whether a human or LLM audit is mathematically sound;
- whether natural-language Research IR is correctly compiled;
- whether a counterexample's structured traits faithfully describe the mathematics;
- whether imported external sources deserve their claimed trust level.

## Local command execution

The workspace settings `compiler.command` and `retrieval.embedding_command`, together with the corresponding CLI flags `--command` and `--embedding-command`, execute commands through the local shell. Compiler commands receive the research plan text, and embedding commands receive indexed research text, on standard input. Only use repository configuration and command values you trust; review them before running RSH in an untrusted checkout.

## Recommended policies

For serious mathematics, keep `truth_policy.allow_llm_audit_as_truth` false. Listing `llm_audit` in `accepted_methods` alone does not enable promotion. Use LLM audits to produce support and repair hints, then require independent human review, reproduction, or formal verification for Truth Graph admission.

Private research remains local by default. RSH contains no automatic upload or cloud synchronization.

## Concurrency boundary

The local lock under `.rsh/locks` prevents concurrent local product writers and index rebuilds from interleaving one compound operation. It is not a distributed lock, cross-file transaction, Git merge mechanism, or protection for callers that invoke internal `Store` methods directly. A crash during a write can still leave partial canonical state, so inspect and repair that state before relying on it.
