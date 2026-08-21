# RSH data model

## Finding document

Stored as `.rsh/findings/<id>.md` with JSON frontmatter and Markdown sections.

Required metadata:

```json
{
  "schema": "rsh.finding.v1",
  "id": "A174",
  "kind": "attempt",
  "title": "Uniform slice regularity",
  "state": "refuted",
  "trust": "finding",
  "verifiable": false
}
```

Optional route fields:

```json
{
  "route": {
    "targets": [],
    "mechanisms": [],
    "assumptions": [],
    "exclusions": [],
    "implicit_claims": [],
    "quantifiers": {
      "scope": "universal",
      "witness": "existential"
    },
    "parameters": {}
  }
}
```

A failure is not a Boolean. It may record:

- the claim killed;
- counterexample or barrier reference;
- applicable scope;
- bad traits;
- preserved results;
- minimum escape conditions;
- newly revealed gap.

## Fact document

Stored as `.rsh/facts/<fact-id>.md`.

```json
{
  "schema": "rsh.fact.v1",
  "fact_id": "content-addressed-id",
  "problem_id": "...",
  "kind": "lemma",
  "predecessors": [],
  "verification": {
    "state": "accepted",
    "method": "human_review",
    "authority": "...",
    "verification_id": "..."
  },
  "evidence_grade": "independently_reviewed",
  "resolution": "proved"
}
```

Verification state, evidence grade, and mathematical resolution are intentionally separate.

## Evidence record

Stored as `.rsh/evidence/<id>.json`.

Evidence may reference a conversation span, Git commit and line range, notebook cell, executable artifact, PDF page, formal theorem, or external research object. It includes a content hash where available.

## Edge record

Append-only JSONL in `.rsh/graph/edges.jsonl`.

```json
{"schema":"rsh.edge.v1","from":"C175","type":"REFUTES","to":"A174","at":"..."}
```

## Events and receipts

- `.rsh/events.jsonl`: workspace state transitions;
- `.rsh/verifications.jsonl`: verifier receipts, including rejected or inconclusive checks;
- `.rsh/revocations.jsonl`: append-only cascade-revocation records.

## Cache

`.rsh/cache/` is gitignored and reconstructible. It may contain lexical indexes, graph indexes, source offsets, and embeddings.
