# Import adapters

Importers are optional adapters. The core model does not depend on any research runtime or external database.

## Built-ins

### Danus

```bash
rsh import danus /path/to/danus/project
rsh import danus /path/to/danus/project --traces
```

- global memory becomes RSH findings;
- verified fact files become truth facts;
- predecessor DAGs are mapped to RSH content IDs;
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
