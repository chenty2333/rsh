# CLI reference

## Workspace

- `rsh init [--name NAME]`
- `rsh status`
- `rsh doctor`
- `rsh index [--embedding-command CMD]`

## Research navigation and preflight

- `rsh orient [QUERY]`
- `rsh compile <PLAN>`
- `rsh check <PLAN>`
- `rsh check --ir route.json`

## State changes

- `rsh record --file proposal.json`
- `rsh verify FINDING --verdict ... --method ... --authority ...`
- `rsh revoke FACT --reason ...`

## Inspection

- `rsh get ID`
- `rsh relations [ID]`
- `rsh log --graph`
- `rsh diff [FROM] [TO]`

## Integration

- `rsh import list`
- `rsh import ADAPTER SOURCE`
- `rsh mcp --role agent|verifier|operator`
