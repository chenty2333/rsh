# RSH

> Git remembers what changed. RSH remembers what was tried, what failed, what is trusted, and whether the next research route is already dead.

RSH is a **private-first, Git-native compiler and static analyzer for persistent research state**. It turns raw research traces into two connected graphs:

- an **Exploration Graph** of plans, attempts, barriers, counterexamples, dead ends, and open gaps;
- a **Truth Graph** of workspace-accepted facts and their proof dependencies.

The primary workflow is:

```text
orient → check → research → record → verify
```

RSH is not an autonomous theorem prover, a replacement for Git, or a central knowledge database. Humans and agents work normally in a Git repository; RSH adds typed research state, graph-first retrieval, auditable preflight analysis, and a verifier-gated truth layer.

## Install

From this checkout:

```bash
npm install
npm link
```

After publication to npm:

```bash
npm install -g rsh-research
```

## Quick start

```bash
mkdir my-project && cd my-project
rsh init --name "My research project"

# Optional benchmark data
rsh seed gabidulin
rsh index

rsh orient "polynomial-extension Gabidulin decoding"
rsh check --ir .rsh/examples/blocked-route.json
rsh log --graph
```

`rsh init` initializes Git when necessary, locates the repository's Git root, and creates the workspace there:

```text
.rsh/
├── workspace.json
├── findings/        # Exploration Graph source objects
├── facts/           # Truth Graph, content-addressed Markdown facts
├── graph/edges.jsonl
├── evidence/
├── traces/
├── events.jsonl
├── verifications.jsonl
├── revocations.jsonl
└── cache/           # derived and gitignored
```

It also updates `.gitignore`, `AGENTS.md`, and `CLAUDE.md`, installs project-local Codex and Claude Code skills under `.agents/skills/rsh/` and `.claude/skills/rsh/`, and writes `.mcp.json`. Existing skill files are preserved during a normal repeated init. Use `--force` deliberately: it rebuilds the workspace identity and configuration and overwrites the generated skill and MCP integration files.

## Core commands

```bash
rsh init
rsh status
rsh orient [query]
rsh compile <plan>
rsh check <plan>
rsh check --ir route.json
rsh record --file proposal.json
rsh verify FINDING --verdict accepted --method human_review --authority Alice --payload fact.json
rsh revoke FACT --reason "audit failure"
rsh get ID
rsh relations [ID]
rsh log --graph
rsh diff HEAD~2 HEAD
rsh index
rsh import list
rsh import danus /path/to/project
rsh import jupyter notebook.ipynb
rsh import chat transcript.json
rsh import git .
rsh doctor
rsh mcp --role agent
```

## Research compiler

Natural-language research plans require model intelligence. RSH therefore treats the model as a **semantic compiler**, not as the authority:

```text
natural language
    ↓ model / agent
Research IR
    ↓ schema validation
static analyzer
    ↓ explicit proof trace
collision report
```

For serious use, an agent should produce typed IR and call:

```bash
rsh check --ir route.json
```

The built-in heuristic compiler is deliberately conservative and emits a low-confidence warning.

## Preflight outcomes

- `EXACT_DUPLICATE`
- `DOMINATED_DEADEND`
- `COUNTEREXAMPLE_APPLIES`
- `PARTIAL_COLLISION`
- `GENUINE_FORK`
- `RELATED`
- `CLEAR`

The analyzer compares targets, mechanisms, assumptions, exclusions, quantifiers, parameter regimes, explicit implication relations, and counterexample traits. An extra assumption is not considered a genuine fork unless the graph records that it excludes the old obstruction.

## Trust model

Findings are awareness, not truth. A finding enters the Truth Graph only through a verification receipt accepted by the workspace policy. Verification method, authority, evidence grade, mathematical resolution, and provenance remain distinct fields.

By default, accepted truth methods are:

- human review;
- reproduced computation;
- formal verification;
- import from a verified external fact graph.

An LLM audit is recorded, but it is not accepted as truth unless the workspace explicitly opts in.

Revoking a fact cascades through all truth-graph descendants. Exploration history is preserved.

## MCP and agent skills

`rsh init` installs:

```text
.agents/skills/rsh/SKILL.md
.claude/skills/rsh/SKILL.md
.mcp.json
```

MCP roles are enforced by the exposed tool surface:

- `agent`: orient, check, read, and propose findings;
- `verifier`: read and submit verdicts, but cannot propose findings;
- `operator`: full workspace controls, including revocation and diff.

## Importers

Import is an adapter interface, not a core dependency. Built-ins currently include:

- `danus`: global memory → findings; verified fact graph → facts; optional worker local memory → traces;
- `jupyter`: cells and outputs → trace layer;
- `chat`: JSON/JSONL conversations → trace layer;
- `git`: commit history → trace layer.

Danus can be a research runtime. RSH is the repository and static analyzer it writes into.

## Storage principle

**Files and Git are authoritative. Indexes are disposable.**

`rsh index` builds a local BM25-style lexical index and graph lookup cache. An optional external embedding command can add semantic reranking, but embeddings never become a correctness source.

## Development

```bash
npm test
npm run check
npm pack --dry-run
```

See `docs/ARCHITECTURE.md`, `docs/DATA_MODEL.md`, `docs/SECURITY.md`, `docs/PRIOR_ART.md`, and `docs/ADAPTERS.md`.
