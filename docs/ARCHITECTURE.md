# Architecture

RSH is a local document store for bounded durable memory. The host agent owns
exploration, task choice, planning, verification, and completion.

## Canonical state

RSH manages only:

```text
RSH.md                     # user-owned Intent
.rsh/manifest.toml         # format = "rsh/0.1.5"
.rsh/records/R-00000.md    # durable Memory
```

Each new Memory receives the five-character base36 ID after the greatest ID
present. `correct` validates an existing ID and rewrites that one document.

## Bounded injection

`brief` is derived on demand and never persisted. It contains the complete
Intent, up to five relevant cards, and a short usage boundary. Each card has
only ID, kind, title, summary, and scope. A body appears only after one explicit
`read`.

The complete Brief is limited to 8,192 UTF-8 bytes and 1,600 conservative
estimated tokens. Intent is limited to 4,096 bytes and 800 estimated tokens.
Selection uses the entire Intent as a BM25 query with field weights title 4,
summary 3, scope 2, and body 0.25. Hazards receive a 0.25 ranking boost and dead
ends 0.15; ties prefer the greater ID.

The Codex plugin runs `brief` at root-session startup, after clear, and after
compaction. It stays silent outside a 0.1.5 workspace or if the command cannot
produce a Brief. Resume and subagent starts do not trigger it.

## Host boundary

CLI and MCP expose the same memory operations. Intent replacement is CLI-only
because it changes the user-owned endpoint. RSH exposes no work lifecycle or
task-management operations.
