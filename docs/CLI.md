# CLI and MCP reference

RSH commands are local, explicit, and bounded. No command accepts flags.

## CLI

```text
rsh init INTENT.md
rsh brief
rsh search QUERY
rsh read MEMORY_ID
rsh intent replace INTENT.md
rsh remember MEMORY.md
rsh correct MEMORY_ID MEMORY.md
rsh mcp
rsh help
rsh version
```

Use `-` instead of an input filename to read from standard input. `init`
requires an Intent whose first line is a non-empty H1. Intent replacement
requires explicit user authorization.

`brief` has no durable side effect. `search` requires one non-empty query and
returns at most five cards. `read` returns one complete Memory document.
`remember` creates one Memory and returns its ID. `correct` replaces one
existing Memory under the same ID.

## MCP

The server registers exactly five tools and no resources:

```text
rsh_brief({})
rsh_search({ query })
rsh_read({ id })
rsh_remember({ kind, title, summary, scope, body })
rsh_correct({ id, kind, title, summary, scope, body })
```

Intent has no MCP mutation tool. Memory tools accept only the five semantic
fields. There are no listing, bulk-content, lifecycle, or task-management
endpoints.
