# Data model

## IDs and frontier

New question, direction, and Record IDs use `Q-`, `D-`, and `R-` followed by
five lowercase base36 digits (`[0-9a-z]{5}`). All three kinds share one
workspace-global, monotonically increasing sequence. Its persisted high-water
mark prevents reuse after deletion. Legacy three-digit IDs remain readable and
may still be referenced.

`RESEARCH.md` contains exactly one `## Open` section. Managed entries use two
spaces per tree level:

```markdown
- [Q-00000] An open question
  - [D-00001] A possible direction
```

Only open entries occur there. Closing a parent requires every open child to be
closed or moved in the same checkpoint. Children do not close their parent.

## Records

A Record is a complete document: TOML frontmatter delimited by `+++`, followed
by non-empty Markdown. Kinds are `result`, `dead_end`, and `experience`; states
are `unchecked`, `checked`, and `withdrawn`. State is a local workflow marker,
not mathematical truth, and never propagates through relations.
Bodies must not contain C0 control characters other than tabs and line breaks.

A `result` contains one main conclusion, its complete argument or evidence, and
the applicable scope, assumptions, limitations, and exceptions. Reusable
intermediate conclusions become separate Records; ordinary supporting steps
remain in the body. `Conclusion`, `Argument`, `Scope`, and optional `Reuse`
headings are recommended but not required. Cite another Record where it is used.

A `dead_end` preserves the attempted goal, failure mechanism, supporting
evidence, applicability scope, and `retry_if` conditions. An `experience`
preserves the observation, applicable context, reusable method, and misuse
boundary. Records do not store ordinary step-by-step thought, reverse links,
derived confidence, dependency-state copies, or search caches.

## Relations

Each outbound relation is an array-of-tables entry:

```toml
[[relations]]
type = "rsh:depends_on"
target = "R-00002"
```

Relation types match a lowercase namespace form such as
`namespace:predicate_name`. Entries have only `type` and `target`; explanations
belong in Markdown. Duplicate relations are invalid.

- `rsh:about` targets an existing or historical `Q-`/`D-` and associates the
  Record with a frontier item for resume. Opening a new Q/D in a checkpoint
  automatically stores this relation on the originating Record.
- `rsh:depends_on` targets an existing `R-` and creates reminders only.
- `rsh:derived_from` targets an existing `R-` and records provenance.
- `rsh:supersedes` targets the predecessor of a replacement. It is created only
  by the atomic replace operation, never by an ordinary checkpoint. Each
  predecessor has at most one direct successor; one complete successor may
  supersede several incomplete predecessors, and replacement withdraws them all.
  A superseded predecessor cannot later be marked active again.
- Custom namespaces such as `math:*`, `alice:*`, and `lean:*` are preserved and
  searchable but have no automatic inference, withdrawal, or scheduling effect.

Backlinks are derived at read time; they are never stored.

Replacement creates a complete new Record instead of mutating a body, preserves
the predecessor as withdrawn history, and connects the two with
`rsh:supersedes`. It inherits `rsh:about` relations. If a predecessor already
contains prohibited control characters, replacement renders them as visible
literal `\\uXXXX` tokens so both versions remain parseable. Readers prefer the
latest active chain head by default.

Deleting a Record computes the transitive current-workspace reverse-reference
closure: any Record whose relation, assertion endpoint, or exact Markdown-body
ID references an item being deleted is included. Dry-run computes the same
closure without changing the undo stack. A real deletion moves the closure into
an operation snapshot under `.rsh/trash`; only the latest three snapshots are
retained. Undo restores the newest snapshot in LIFO order and refuses conflicts
with current files. The ID sequence high-water mark survives delete and undo.
Local trash is not Git or external-history recovery.

Frontier effects follow action history. Removing an `open` action removes that
Q/D object, its current or historical descendants, its lifecycle, and reverse
references. Removing only a `revise`, `close`, or `reopen` action preserves the
object, removes later events that depend on that action, and replays the retained
history. Interrupted delete/undo journals recover on the next real delete or
undo; dry-run never performs recovery writes.

## Relational assertions

When a result's main conclusion is a relation, it may include one projection:

```toml
[assertion]
subject = "R-00003"
predicate = "math:generalizes"
object = "R-00004"
```

Subject and object resolve to a current or historical local `Q-`, `D-`, or `R-`;
the predicate follows the same namespace format. An assertion supplements, and
never replaces, the conclusion and argument. Ordinary results omit it. Readers
derive mathematical inverse relations instead of storing both directions.

## Frontier actions

Frontier actions are `open`, `close`, `revise`, and `reopen`. Stored actions
contain the generated ID and the before/after snapshot needed to inspect or
reopen state without parsing Git history.
