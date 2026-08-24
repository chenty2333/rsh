# Architecture

RSH has three canonical data surfaces:

1. `RESEARCH.md` is the complete current open frontier.
2. `.rsh/records/*.md` contains complete reusable knowledge documents.
3. Git contains the history of both, including previously used IDs.

New Q/D/R IDs come from one workspace-global, monotonically increasing
five-digit base36 sequence. Its durable high-water mark prevents reuse after
deletion. Readers continue to accept legacy three-digit IDs.

The model is document-centric. A Record is a node; its `[[relations]]` entries
and optional relational `[assertion]` are edges or projections. Markdown remains
the authoritative conclusion and argument. There is no database, index, cache,
global namespace registry, object graph, truth model, or data-migration layer.

Read commands parse Markdown and TOML directly. `rsh find` invokes installed
`rg`; `resume` derives grouping from `rsh:about`; and `get` derives backlinks,
replacement chains, and dependency reminders by scanning Records. Compact read
views prefer the active head of an `rsh:supersedes` chain and retain withdrawn
versions as history. These views are never written back into source documents.

Checkpoint processing is validate-then-commit. RSH parses the complete input,
validates references and frontier actions, takes the local workspace write
lock, re-reads current state, and publishes the new Record and updated
`RESEARCH.md` together. The batch writer rolls earlier renames back if a later
publish fails. This is local single-writer coordination; Git handles history
and collaboration.

Replacement uses the same locked validate-then-commit boundary: it creates the
successor with a reserved `rsh:supersedes` edge and withdraws the predecessor
in one file batch. Validation prevents two direct successors. Ordinary
checkpoints cannot create this core relation.

Custom relation namespaces are opaque to RSH. They support local retrieval
without automatic inference, cascading withdrawal, or a background scheduler.
MCP is a thin Markdown-oriented view over the same functions used by the CLI.
Write results include the SHA-256 of the exact body and a preview so callers can
detect transport or escaping corruption immediately.

Deletion first computes the transitive reverse-reference closure in the current
workspace. A Record joins that closure when a relation, assertion endpoint, or
exact Markdown-body ID refers to an item already in it. `--dry-run` exposes the
same set without writing or changing the undo stack. A real deletion atomically
moves the complete closure into `.rsh/trash`. RSH retains snapshots for the
latest three delete operations and prunes the oldest when a fourth is added.
Frontier actions are replayed from retained chronological history: deleting an
opener removes its Q/D subtree, whereas deleting a revise/close/reopen event
preserves the object and removes only later lifecycle events that depend on it.
Undo restores the latest snapshot in LIFO order and refuses restoration if a
current file conflicts. This local trash is not Git-history or external-copy
recovery. Intent and undo journals make interrupted operations recoverable by
the next non-dry-run delete or undo.
