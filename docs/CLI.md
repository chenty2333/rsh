# CLI reference

```text
rsh init
rsh resume [--all]
rsh find QUERY [--regex] [--kind KIND] [--state STATE] [--limit N]
rsh checkpoint FILE.md
rsh replace RECORD_ID FILE.md
rsh get ID
rsh mark RECORD_ID unchecked|checked|withdrawn
rsh status
rsh doctor
rsh mcp
```

All IDs have a `Q-`, `D-`, or `R-` prefix followed by exactly three lowercase
base36 characters.

`resume` prints the open frontier and groups Records connected by `rsh:about`.
It also calls out relevant withdrawn `rsh:depends_on` targets. `--all` includes
all matching history instead of the compact view.

`find` requires `QUERY`. Searches are fixed-string and smart-case unless
`--regex` is present. When `QUERY` is an ID, `rg` finds Records whose relations,
assertion subject/object, or Markdown body mention it. Kind, state, and limit
filters inspect metadata after `rg` identifies candidates.

`get R-xxx` includes the original complete Record, then backlinks from relations
or assertions involving that ID, followed by withdrawn or missing dependency
reminders. Relations and an optional assertion already appear in the raw TOML
and are not rendered a second time. `get Q-xxx` and `get D-xxx` show the frontier
item and related Records.

`checkpoint -` reads a complete checkpoint document from standard input.
Checkpoint documents use `[[relations]]`; legacy top-level relationship fields
are rejected. Every successful frontier `open` action automatically adds an
`rsh:about` relation from the saved Record to the generated Q/D item. Commands
reject unknown flags and extra positional arguments.

`replace R-a9z FILE.md` validates a complete replacement document, then
atomically creates its new Record with `rsh:supersedes` targeting `R-a9z` and
marks `R-a9z` withdrawn. A predecessor may have only one direct successor, and
ordinary checkpoint input cannot create the reserved relation. A superseded
predecessor cannot be marked active again. `replace R-a9z -` reads the document
from standard input. Replacement inherits the predecessor's `rsh:about`
relations. It renders prohibited controls already present in the old body as
visible literal `\\uXXXX` tokens so corrupted history can be repaired without
blocking the operation. A replacement input may contain `rsh:supersedes`
relations for additional predecessors; this merges split Records and withdraws
all predecessors in the same transaction.

`doctor` checks IDs, relation namespaces and endpoints, core-relation target
kinds, duplicate relations, assertion cardinality, replacement uniqueness and
state, non-empty Record bodies, illegal C0 control characters (tabs and line
breaks are allowed), workspace layout, and frontier invariants.

The MCP `rsh_checkpoint` tool does not accept a serialized `document`. It takes
required `kind` and Markdown `body` fields, plus optional `state`, `scope`,
`retry_if`, `relations`, `assertion`, and `frontier`. RSH serializes these fields
to the canonical checkpoint document before running the same core validation and
atomic write path used by the CLI.
The MCP `rsh_replace` tool takes required `record_id`, `kind`, and `body` fields
plus the same optional structured fields. Successful checkpoints return `id`,
`body_sha256`, and `body_preview`; replacements additionally return
`replaced_id`, `replaced_ids`, and `predecessor_controls_sanitized`.

`resume`, `find`, and `get` expose replacement chains. Compact `resume`/`find`
views prefer the latest active successor, while explicit withdrawn-state
queries and `--all` retain access to history.
