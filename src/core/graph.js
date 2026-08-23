export function buildGraph(store, options = {}) {
  const includeRevoked = options.includeRevoked ?? true;
  const findings = store.listFindings();
  const allFacts = store.listFacts({ includeRevoked: true });
  const facts = includeRevoked ? allFacts : allFacts.filter((doc) => doc.truth_status === "active");
  const factStatuses = new Map(allFacts.map((doc) => [doc.metadata.fact_id, doc.truth_status]));
  const evidence = store.listEvidence();
  const rawEdges = store.edges();
  const producedFacts = new Map();
  for (const edge of rawEdges) {
    if (edge.type !== "PRODUCED") continue;
    if (!producedFacts.has(edge.from)) producedFacts.set(edge.from, new Set());
    producedFacts.get(edge.from).add(edge.to);
  }
  const nodes = new Map();
  for (const doc of findings) {
    const promotedFactIds = producedFacts.get(doc.metadata.id) ?? new Set();
    if (doc.metadata.fact_id) promotedFactIds.add(doc.metadata.fact_id);
    const promotedStatuses = new Set([...promotedFactIds].map((id) => factStatuses.get(id)).filter(Boolean));
    const promotedTruthStatus = promotedStatuses.size > 1 ? "mixed" : [...promotedStatuses][0] ?? null;
    nodes.set(doc.metadata.id, {
      layer: "exploration",
      ...doc.metadata,
      sections: doc.sections,
      promoted_fact_ids: [...promotedFactIds],
      promoted_truth_status: promotedTruthStatus
    });
  }
  for (const doc of facts) {
    nodes.set(doc.metadata.fact_id, {
      layer: "truth",
      ...doc.metadata,
      sections: doc.sections,
      truth_status: doc.truth_status,
      revocation: doc.revocation
    });
  }
  for (const record of evidence) nodes.set(record.id, { layer: "evidence", ...record });
  const edges = includeRevoked
    ? rawEdges
    : rawEdges.filter((edge) => nodes.has(edge.from) && nodes.has(edge.to));
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
