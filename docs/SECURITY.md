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
