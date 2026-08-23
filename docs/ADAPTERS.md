# Import adapters

Importers are optional adapters. The core model does not depend on any research runtime or external database.

## Built-ins

### Danus

```bash
rsh import danus /path/to/danus/project
rsh import danus /path/to/danus/project --traces
```

- global memory becomes RSH findings with the latest `_status.jsonl` receipt folded in;
- Danus fact files become `llm_audited` findings by default because the Danus verifier is an LLM, not an independent human or formal checker;
- facts enter RSH Truth only when `truth_policy.allow_llm_audit_as_truth` is explicitly `true`;
- predecessor DAGs, glossary mappings, external references, revocations, source paths, and source hashes are preserved;
- malformed or dependency-incomplete source facts remain awareness/pending and never enter Truth;
- local worker memory is imported only with `--traces`.

### Jupyter

```bash
rsh import jupyter notebook.ipynb
```

Cells, source, metadata, and outputs enter the trace layer. RSH does not infer findings without a separate compiler/review step.

### Chat

```bash
rsh import chat transcript.json
```

Messages enter the trace layer.

### Git

```bash
rsh import git .
```

Commit metadata enters the trace layer for later research-state compilation.

## Adapter contract

An importer defines:

```js
{
  name,
  detect(source, options),
  import(store, source, options)
}
```

Adapters should preserve provenance and must not silently promote unverified material to truth.
