# Research graph schema

## Node kinds

- `problem`
- `claim`
- `theorem`
- `attempt`
- `intermediate-lemma`
- `counterexample`
- `barrier`
- `computation`
- `evidence`
- `open-gap`

## Core route fields

```json
{
  "target": ["constant-exterior-kernel"],
  "mechanisms": ["adaptive-slicing"],
  "assumptions": ["actual-hard-pencil", "m=n^2"],
  "exclusions": ["subfield-trapped-determinant-image"],
  "quantifiers": { "scope": "universal", "witness": "existential-witness" },
  "parameters": { "extensionDegree": "n^2" }
}
```

## Edge kinds

- `DEPENDS_ON`
- `IMPLIES`
- `REFUTES`
- `COUNTEREXAMPLE_TO`
- `STRENGTHENS`
- `WEAKENS`
- `GENERALIZES`
- `SPECIALIZES`
- `SUPERSEDES`
- `SAME_ROUTE_AS`
- `BLOCKS`
- `BYPASSES`
- `REQUIRES_ASSUMPTION`
- `PRESERVES`

## Conservative bypass rule

A new assumption does **not** constitute a genuine fork merely because it is absent from the old record. A bypass is recognized only when the knowledge graph explicitly links that assumption or exclusion to the counterexample's bad trait.
