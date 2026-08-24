# Security and operational boundaries

RSH reads and writes only the selected local workspace. Record and frontier
IDs have fixed prefixes followed by three lowercase base36 characters and
are never used as unchecked paths. Search invokes
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
