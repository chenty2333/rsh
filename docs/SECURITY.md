# Security and operational boundaries

RSH reads and writes only the selected local workspace. Newly allocated Record
and frontier IDs have fixed prefixes followed by five lowercase base36 digits;
legacy three-digit IDs remain readable. IDs are never used as unchecked paths. Search invokes
`rg` with an argument array, not a shell. MCP responses omit absolute local
paths and use `text/markdown` resources.

The write lock coordinates RSH processes on one machine. It is not a network
lock and does not resolve Git conflicts. Review checkpoint files before
applying them; RSH validates structure and references but does not verify the
truth of research conclusions.

Checkpoint and replacement reject C0 control characters in Markdown bodies,
except tabs and line breaks. Results include `body_sha256` and `body_preview`;
callers should compare both with intended content after each write. For batches,
call the structured MCP tool separately for each Record. Do not generate
JavaScript or shell command strings containing Markdown or LaTeX, because an
intermediate language can interpret backslashes before RSH validates the body.

Deletion is intentionally recursive within the selected workspace: Records
that refer to a deleted ID through relations, assertions, or exact Markdown
body references are included. Use `--dry-run` to inspect that set without
changing the undo stack. Real deletion moves it into `.rsh/trash`; only the
latest three operations are retained. Undo is LIFO and refuses to overwrite
conflicting current files. The retained allocation high-water mark prevents ID
reuse. Local trash does not erase or recover Git history, backups, exports,
other workspaces, agent transcripts, or logs.
Trash paths, manifests, intent journals, stored Record sets, and symlinks are
validated before recovery. A real delete/undo recovers an interrupted journal;
dry-run reports it without writing.
