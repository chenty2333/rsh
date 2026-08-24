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
`.rsh/sequence.toml` is the durable ID high-water mark, while `.rsh/locks/` and
the three-operation `.rsh/trash/` undo buffer are local-only.

## Research frontier

`RESEARCH.md` is normal Markdown. Its managed open tree looks like this:

```markdown
## Open

- [Q-00000] Prove the degenerate upper bound
  - [D-00001] Try a direct spectral estimate
```

`Q-` identifies a question, `D-` a direction, and `R-` a Record. New IDs use
five lowercase base36 digits (`0-9a-z`) allocated from one monotonically
increasing workspace-wide sequence. Legacy three-digit IDs remain readable.
Only open frontier items appear here; Git and stored frontier actions preserve
history.

## Checkpoints and Records

A checkpoint is TOML frontmatter followed by non-empty Markdown:

```markdown
+++
kind = "result"
state = "unchecked"

[[relations]]
type = "rsh:about"
target = "D-00001"

[[relations]]
type = "rsh:depends_on"
target = "R-00002"

[[relations]]
type = "rsh:derived_from"
target = "R-00003"

[assertion]
subject = "R-00002"
predicate = "math:generalizes"
object = "R-00003"

[[frontier]]
action = "close"
id = "D-00001"
outcome = "resolved"
+++

# A uniform estimate follows from the reusable bound

## Conclusion

State one main conclusion completely.

## Argument

Give the evidence or proof, citing `R-00002` where it is actually used.

## Scope

Record assumptions, limitations, and exceptions.

## Reuse

Optionally explain how to apply the conclusion elsewhere.
```

Apply it with `rsh checkpoint note.md`. RSH validates the record and frontier
transaction before publishing it under a generated five-digit Record ID.
Each successful frontier `open` action also stores an automatic `rsh:about`
relation from that Record to the newly generated Q/D item, so the originating
Record appears immediately in the new item's resume summary.
Successful checkpoints return the new `id`, a SHA-256 digest of the exact
Markdown body as `body_sha256`, and a short `body_preview`. RSH rejects C0
control characters in bodies except tabs and line breaks.

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
- `rsh:supersedes` targets a Record replaced by this Record. It is reserved for
  `replace`; one successor may merge multiple predecessors, while each old
  Record can have at most one direct successor.

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
rsh replace RECORD_ID FILE.md
rsh get ID
rsh delete RECORD_ID [--dry-run]
rsh undo [--dry-run]
rsh mark RECORD_ID unchecked|checked|withdrawn
rsh status
rsh doctor
rsh mcp
```

`rsh replace R-00002 FILE.md` atomically creates a corrected successor, adds
`rsh:supersedes` pointing to `R-00002`, and withdraws `R-00002`.
The successor inherits the predecessor's `rsh:about` relations. If the old body
contains a prohibited control character, replacement renders it visibly as a
literal `\\uXXXX` token while preserving the old Record as withdrawn history.
To merge several incomplete Records, add `rsh:supersedes` relations for the
additional predecessors to the replacement input; all predecessors are
withdrawn in the same transaction.
`rsh resume` groups Records through `rsh:about`, prefers the latest active replacement,
and flags withdrawn dependencies. `rsh get R-00002` prints the raw Record followed
by replacement history, derived backlinks, and dependency reminders. `rsh find
<ID>` uses `rg` to find relations, assertion endpoints, and Markdown references.
Other searches are fixed-string smart-case unless `--regex` is supplied; kind,
state, and limit filters still apply. Compact results prefer active replacement
heads; withdrawn versions remain available explicitly. There is no index or cache.

`rsh delete R-00002 --dry-run` previews the complete deletion set without
changing the undo stack, including the frontier before/after projection when it
would change. Without `--dry-run`, `delete` atomically moves the
target and every current-workspace Record that references anything being
deleted through a relation, assertion, or exact ID in its Markdown body into
`.rsh/trash`. Deleting a Record that opened a Q/D also removes that frontier
object, its descendants, lifecycle, and reverse references. Deleting a Record
that only revised, closed, or reopened an item preserves the item, removes later
dependent lifecycle events, and replays the preceding frontier state. The latest
three delete operations are retained; a fourth prunes
the oldest. `rsh undo --dry-run` previews restoration, while `rsh undo` restores
the latest deletion in LIFO order and refuses to overwrite conflicting current
files. The workspace sequence keeps a high-water mark, so deleted IDs are never
reused. Local trash is a short undo facility, not recovery of Git history or
copies in other workspaces, exported documents, transcripts, or logs.
Interrupted delete/undo journals are recovered by the next real delete or undo;
dry-runs stay read-only and ask for that recovery instead of changing state.

## MCP

The MCP server exposes `rsh_resume`, `rsh_find`, `rsh_get`, `rsh_checkpoint`,
`rsh_replace`, `rsh_delete`, `rsh_undo`, `rsh_mark`, `rsh_status`, and
`rsh_doctor`, plus `rsh://state` and `rsh://record/{id}`. `rsh_delete` takes a
`record_id` and optional `dry_run`; `rsh_undo` takes optional `dry_run`.
`rsh_checkpoint` accepts structured fields rather than a TOML document string:

```json
{
  "kind": "result",
  "body": "# Conclusion\n\nA complete conclusion.\n",
  "relations": [
    { "type": "rsh:depends_on", "target": "R-00002" }
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

`rsh_replace` takes `record_id` plus the same structured checkpoint fields.
Both write tools return `id`, `body_sha256`, and `body_preview`; replacement
also returns `replaced_id`, `replaced_ids`, and
`predecessor_controls_sanitized`. For batches, invoke the structured MCP tool once per
Record and verify those fields after every write. Never generate JavaScript or
shell command strings containing Markdown or LaTeX: escaping can silently
consume backslashes before RSH receives the body.

## Development

```bash
npm test
npm run check
npm run pack:dry
```

See `docs/CLI.md`, `docs/DATA_MODEL.md`, `docs/ARCHITECTURE.md`, and
`docs/SECURITY.md`.
