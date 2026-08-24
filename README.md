# RSH

RSH is a small, local, Git-native research state tool. It keeps `RESEARCH.md`,
complete knowledge documents in `.rsh/records/*.md`, and `rg`-based search over
those Markdown files. Relations are structured links between documents, not a
separate graph or inference system. RSH does not decide mathematical truth.

## Requirements and install

- Node.js 20 or newer
- [ripgrep (`rg`)](https://github.com/BurntSushi/ripgrep)

```bash
npm install
npm link
```

## Quick start

```bash
mkdir my-research && cd my-research
git init
rsh init
rsh resume
```

Initialization creates `RESEARCH.md` and matching resume/checkpoint skills under
`.agents/skills/` and `.claude/skills/`. `.rsh/records/` is the record store;
`.rsh/locks/` is only for local write locking.

## Research frontier

`RESEARCH.md` is normal Markdown. Its managed open tree looks like this:

```markdown
## Open

- [Q-a13] Prove the degenerate upper bound
  - [D-4z1] Try a direct spectral estimate
```

`Q-` identifies a question, `D-` a direction, and `R-` a Record. Every ID has
exactly three lowercase base36 characters (`0-9a-z`). Only open frontier items
appear here; Git and stored frontier actions preserve history.

## Checkpoints and Records

A checkpoint is TOML frontmatter followed by non-empty Markdown:

```markdown
+++
kind = "result"
state = "unchecked"

[[relations]]
type = "rsh:about"
target = "D-4z1"

[[relations]]
type = "rsh:depends_on"
target = "R-a9z"

[[relations]]
type = "rsh:derived_from"
target = "R-b2c"

[assertion]
subject = "R-a9z"
predicate = "math:generalizes"
object = "R-b2c"

[[frontier]]
action = "close"
id = "D-4z1"
outcome = "resolved"
+++

# A uniform estimate follows from the reusable bound

## Conclusion

State one main conclusion completely.

## Argument

Give the evidence or proof, citing `R-a9z` where it is actually used.

## Scope

Record assumptions, limitations, and exceptions.

## Reuse

Optionally explain how to apply the conclusion elsewhere.
```

Apply it with `rsh checkpoint note.md`. RSH validates the record and frontier
transaction before publishing it under a generated `R-xxx` ID.
Each successful frontier `open` action also stores an automatic `rsh:about`
relation from that Record to the newly generated Q/D item, so the originating
Record appears immediately in the new item's resume summary.

Each `result` holds one main conclusion with its complete argument and scope.
Auxiliary proof steps stay in the body; split out only an independently reusable
intermediate result. The headings above are recommended, not required. A
`dead_end` records the attempted goal, failure mechanism, evidence, scope, and
`retry_if` conditions. An `experience` records an observation, its context, a
reusable method, and its misuse boundary.

Relations use lowercase `namespace:predicate_name` names:

- `rsh:about` targets an existing or historical `Q-`/`D-` and groups Records
  with the frontier during resume.
- `rsh:depends_on` targets an existing `R-` and produces reminders.
- `rsh:derived_from` targets an existing `R-` and records provenance.

Custom relations such as `math:generalizes`, `alice:refines`, and
`lean:formalizes` are stored and searchable without automatic reasoning,
withdrawal, or scheduling semantics. Explanations belong in the body, not in
relation labels or notes.

A `result` whose main conclusion is itself a relation may have one `[assertion]`
as a machine-readable projection. Its subject and object must resolve to local
`Q-`, `D-`, or `R-` IDs. It never replaces the body, and ordinary results need
no assertion. Readers can derive mathematical inverse relations when needed.

States are `unchecked`, `checked`, and `withdrawn`. They are local workflow
markers, not truth values. State does not propagate through relations, and
closing a frontier item does not require a checked Record.

## Commands

```text
rsh init
rsh resume [--all]
rsh find QUERY [--regex] [--kind KIND] [--state STATE] [--limit N]
rsh checkpoint FILE.md
rsh get ID
rsh mark RECORD_ID unchecked|checked|withdrawn
rsh status
rsh doctor
rsh mcp
```

`rsh resume` groups Records through `rsh:about` and flags withdrawn
dependencies. `rsh get R-xxx` prints the raw Record followed by derived
backlinks and missing or withdrawn dependency reminders. `rsh find
<ID>` uses `rg` to find relations, assertion endpoints, and Markdown references.
Other searches are fixed-string smart-case unless `--regex` is supplied; kind,
state, and limit filters still apply. There is no index or cache.

## MCP

The MCP server exposes `rsh_resume`, `rsh_find`, `rsh_get`, `rsh_checkpoint`,
`rsh_mark`, `rsh_status`, and `rsh_doctor`, plus `rsh://state` and
`rsh://record/{id}`. `rsh_checkpoint` accepts structured fields rather than a
TOML document string:

```json
{
  "kind": "result",
  "body": "# Conclusion\n\nA complete conclusion.\n",
  "relations": [
    { "type": "rsh:depends_on", "target": "R-a9z" }
  ],
  "frontier": [
    { "action": "open", "kind": "question", "text": "What remains open?" }
  ]
}
```

`kind` and a non-empty Markdown `body` are required. `state`, `scope`,
`retry_if`, `relations`, `assertion`, and `frontier` are optional. The tool
constructs the canonical TOML document internally and uses the same validation,
locking, and atomic write path as the CLI.

## Development

```bash
npm test
npm run check
npm run pack:dry
```

See `docs/CLI.md`, `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`, and
`docs/SECURITY.md`.
