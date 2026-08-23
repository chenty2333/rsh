# CLI reference

Common options:

- `--help` prints command help.
- `--version` prints the package version and does not require a workspace.
- `--json` selects machine-readable output for commands that support it.
- Value options accept either `--flag VALUE` or `--flag=VALUE`. Use `--` to stop option parsing when a positional value begins with `--`.
- Boolean options can be explicitly disabled with `--flag=false`; they never consume the following positional argument.

## Workspace

- `rsh init [--name NAME]`
- `rsh status`
- `rsh doctor`
- `rsh index [--embedding-command CMD]`

## Research navigation and preflight

- `rsh orient [QUERY]`
- `rsh compile <PLAN>`
- `rsh check --ir route.json`
- `rsh check --command CMD [PLAN|--file FILE]`
- `rsh check --heuristic [PLAN|--file FILE]` (experimental/demo only; low confidence)

Formal `rsh check` accepts exactly one typed input mode: `--ir`, or `--command` whose JSON output validates as complete `rsh.route.v1` IR. It does not silently use a workspace compiler setting or natural-language heuristic. `--heuristic` is the explicit experimental opt-in for a low-confidence demo. Conflicting or missing modes are usage errors. Use `--strict` with any check mode when a blocked route must fail automation. A blocked strict check exits with status 2.

## State changes

- `rsh record --file proposal.json`
- `rsh verify FINDING --verdict ... --method ... --authority ...`
- `rsh revoke FACT --reason ...`

`--force` is intentionally high risk. On `rsh init`, it replaces the workspace configuration and MCP configuration. On `rsh verify`, it can promote a finding kind that the normal verification gate rejects; use it only after an explicit human decision and review the resulting state before committing it.

## Inspection

- `rsh get ID`
- `rsh relations [ID]`
- `rsh log --graph`
- `rsh diff [FROM] [TO]`

## Integration

- `rsh import list`
- `rsh import ADAPTER SOURCE`
- `rsh mcp --role agent|verifier|operator`

`rsh_check` in MCP likewise requires an `ir` object with schema `rsh.route.v1`; it does not accept text fallback.

`rsh diff` reports object-level finding/fact changes, promotions, active↔revoked transitions, and Truth Graph `DEPENDS_ON` additions/removals. With no refs it compares `HEAD` to the worktree; with one ref it compares that ref to `HEAD`; with two refs it reads both Git snapshots without checkout.

## Local writers

Initialization, `record`, `verify`, `revoke`, `import`, `seed`, index rebuilds, and the corresponding MCP writes serialize the entire operation with a workspace lock under `.rsh/locks`. The lock is local single-writer coordination, not a cross-file transaction or distributed lock.

## Exit status

- `0`: the command completed successfully. A non-strict `rsh check` can still report `BLOCKED` with this status.
- `1`: a usage, workspace, validation, I/O, or command error occurred; `rsh doctor` also uses this status when a check fails.
- `2`: `rsh check --strict` found a blocked route.
