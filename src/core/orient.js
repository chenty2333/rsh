import { buildGraph, neighbors } from "./graph.js";
import { searchIndex } from "./indexer.js";

export function orient(store, query = "", options = {}) {
  const hits = searchIndex(store, query, { limit: options.limit ?? 12 });
  const graph = buildGraph(store);
  const expanded = neighbors(graph, hits.map((item) => item.id), options.hops ?? store.workspace.retrieval?.graph_hops ?? 1);
  const byId = new Map(expanded.map((item) => [item.id ?? item.fact_id, item]));
  const result = hits.map((hit) => ({ ...hit, node: byId.get(hit.id) ?? graph.nodes.get(hit.id) }));
  const extra = expanded
    .filter((node) => !hits.some((hit) => hit.id === (node.id ?? node.fact_id)))
    .map((node) => ({ id: node.id ?? node.fact_id, title: node.title, layer: node.layer, kind: node.kind, graph_expansion: true, node }));
  const relevantEdges = graph.edges.filter((edge) => byId.has(edge.from) && byId.has(edge.to));
  return {
    query,
    generated_at: new Date().toISOString(),
    primary: result,
    graph_context: extra,
    edges: relevantEdges,
    guidance: [
      "Truth-graph facts may be used as correctness dependencies only if they are not revoked.",
      "Exploration findings are awareness and search history, not correctness sources.",
      "Inspect raw evidence only when the compiled node does not carry enough detail."
    ]
  };
}
