---
name: rsh-workspace
description: Use automatically injected RSH durable memory during long-running work without turning it into planning, progress, or session state.
---

# RSH workspace memory

At a root session's start, clear, or compaction boundary, RSH may inject one
bounded Brief containing the user-owned Intent and up to five relevant Memory
cards. Treat that Brief as context already supplied. Do not call `rsh brief`
again and do not inspect `.rsh` to reconstruct history.

Work on the proof, implementation, experiment, or review first. The host agent
chooses and manages the work; RSH does not choose tasks, measure progress, or
decide completion.

Use `rsh search QUERY` only when a specific missing conclusion may already be
known. Read at most the exact result needed with `rsh read MEMORY_ID`. Do not
browse Memory merely to feel oriented.

After substantive work, use `rsh remember` only for a durable semantic delta:
a reusable finding, decision, genuinely closed question, dead end with evidence,
or hazard. Never record progress, current status, attempts, plans, next steps,
session summaries, tool activity, or private reasoning. Zero RSH writes is the
normal result when no reusable conclusion changed.

Use `rsh correct` only when an existing Memory is materially wrong; correction
replaces that same ID in place. Change Intent only with explicit user
authorization.
