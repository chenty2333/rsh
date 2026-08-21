export function buildGraph(store) {
  const findings = store.listFindings();
  const facts = store.listFacts({ includeRevoked: true });
  const evidence = store.listEvidence();
  const nodes = new Map();
  for (const doc of findings) nodes.set(doc.metadata.id, { layer: "exploration", ...doc.metadata, sections: doc.sections });
  for (const doc of facts) nodes.set(doc.metadata.fact_id, { layer: "truth", ...doc.metadata, sections: doc.sections });
  for (const record of evidence) nodes.set(record.id, { layer: "evidence", ...record });
  const edges = store.edges();
  const out = new Map();
  const incoming = new Map();
  for (const edge of edges) {
    if (!out.has(edge.from)) out.set(edge.from, []);
    if (!incoming.has(edge.to)) incoming.set(edge.to, []);
    out.get(edge.from).push(edge);
    incoming.get(edge.to).push(edge);
  }
  return { nodes, edges, out, incoming };
}

export function neighbors(graph, ids, hops = 1) {
  const found = new Set(ids);
  let frontier = new Set(ids);
  for (let step = 0; step < hops; step += 1) {
    const next = new Set();
    for (const id of frontier) {
      for (const edge of graph.out.get(id) ?? []) if (!found.has(edge.to)) next.add(edge.to);
      for (const edge of graph.incoming.get(id) ?? []) if (!found.has(edge.from)) next.add(edge.from);
    }
    for (const id of next) found.add(id);
    frontier = next;
  }
  return [...found].map((id) => graph.nodes.get(id)).filter(Boolean);
}

export function relationClosure(graph, seeds, types) {
  const found = new Set(seeds);
  const queue = [...seeds];
  while (queue.length) {
    const current = queue.shift();
    for (const edge of graph.out.get(current) ?? []) {
      if (!types.has(edge.type) || found.has(edge.to)) continue;
      found.add(edge.to);
      queue.push(edge.to);
    }
  }
  return found;
}
