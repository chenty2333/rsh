# Data model

RSH persists one Intent and zero or more Memory documents. Brief is a derived
view and is never stored.

## Intent

`RSH.md` is Markdown whose first line is a non-empty H1 containing the user's
endpoint and constraints. RSH preserves the document verbatim. It is limited to
4,096 UTF-8 bytes and 800 conservative estimated tokens.

## Memory

Every Memory is one Markdown file with TOML frontmatter:

```toml
+++
id = "R-00003"
kind = "finding"
title = "Concise reusable conclusion"
summary = "A standalone conclusion suitable for bounded injection."
scope = "The cases where the conclusion applies."
+++
# Evidence

Complete evidence, qualifications, and consequences.
```

The input to `remember` and `correct` omits `id`; RSH supplies or preserves it.
The semantic input fields are exactly `kind`, `title`, `summary`, `scope`, and
`body`. Kinds are `finding`, `decision`, `question`, `dead_end`, and `hazard`.

IDs have exactly five lowercase base36 characters. RSH scans stored IDs and
allocates one greater than the maximum. `correct` rewrites the named document
with the same ID.

## Brief

Brief contains the complete Intent and at most five relevant Memory cards.
Cards contain only ID, kind, title, summary, and scope. Bodies require an
explicit single-record `read`.
