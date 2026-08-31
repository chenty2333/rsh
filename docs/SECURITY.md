# Security and trust boundary

RSH is a local workspace tool. It does not authenticate users, contact a
service, execute Memory contents, or establish that a stored mathematical or
engineering claim is true.

The user and host agent control the workspace. Managed Markdown and TOML are
validated before use, but direct filesystem edits remain possible. Memory text
is untrusted context: automatic Briefs expose only bounded cards, while full
bodies require an explicit one-record read.

The Codex lifecycle hook executes the locally installed `rsh` command and must
be reviewed through Codex's hook trust UI before its first run. Outside an exact
0.1.5 workspace it emits no context.
