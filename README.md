# RSH

RSH 0.1.5 is a deliberately small durable-memory layer for long-running agent
work. It stores one user-owned Intent and a sparse set of reusable conclusions.
It does not plan work, track progress, choose tasks, or decide completion.

## Install

```bash
npm install -g rsh-research
rsh version
```

RSH requires Node.js 20 or newer. The bundled Codex plugin supplies a
`SessionStart` hook and a workspace-memory skill. Enable the plugin and review
its hook once in `/hooks`; Codex can then inject one bounded Brief at session
startup, after `/clear`, and after compaction.

## Start a workspace

Create an Intent document whose first line is a non-empty H1, then initialize:

```bash
rsh init INTENT.md
```

The complete managed layout is:

```text
RSH.md
.rsh/manifest.toml
.rsh/records/R-00000.md
```

Memory IDs are five lowercase base36 characters allocated in workspace order.

## Agent workflow

The normal Codex path needs no startup command: the plugin injects the complete
Intent and at most five relevant Memory cards. Memory bodies are not injected.
If one exact conclusion is missing, query it narrowly:

```bash
rsh search "exact semantic gap"
rsh read R-00003
```

After substantive work, save only a reusable semantic delta:

```bash
rsh remember MEMORY.md
rsh correct R-00003 MEMORY.md
```

`correct` replaces that Memory in place. Ordinary progress, attempts, plans,
next steps, and session summaries do not belong in RSH. A productive work
interval commonly produces no write.

## Public commands

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

See [CLI](docs/CLI.md), [data model](docs/DATA_MODEL.md), and
[architecture](docs/ARCHITECTURE.md) for the exact contracts.

Workspace format `rsh/0.1.5` is intentionally standalone. RSH has no format
conversion command.

## Development

```bash
npm run check
npm run pack:dry
```

License: MIT.
