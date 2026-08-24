# Architecture

RSH has three canonical data surfaces:

1. `RESEARCH.md` is the complete current open frontier.
2. `.rsh/records/*.md` contains complete reusable knowledge documents.
3. Git contains the history of both, including previously used IDs.

The model is document-centric. A Record is a node; its `[[relations]]` entries
and optional relational `[assertion]` are edges or projections. Markdown remains
the authoritative conclusion and argument. There is no database, index, cache,
global namespace registry, object graph, truth model, or compatibility layer.

Read commands parse Markdown and TOML directly. `rsh find` invokes installed
`rg`; `resume` derives grouping from `rsh:about`; and `get` derives backlinks
and dependency reminders by scanning Records. These views are never written
back into source documents.

Checkpoint processing is validate-then-commit. RSH parses the complete input,
validates references and frontier actions, takes the local workspace write
lock, re-reads current state, and publishes the new Record and updated
`RESEARCH.md` together. The batch writer rolls earlier renames back if a later
publish fails. This is local single-writer coordination; Git handles history
and collaboration.

Custom relation namespaces are opaque to RSH. They support local retrieval
without automatic inference, cascading withdrawal, or a background scheduler.
MCP is a thin Markdown-oriented view over the same functions used by the CLI.
