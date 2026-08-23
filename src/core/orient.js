import { buildGraph, neighbors } from "./graph.js";
import { searchIndex } from "./indexer.js";

export function orient(store, query = "", options = {}) {
  const graph = buildGraph(store, { includeRevoked: false });
  const hits = searchIndex(store, query, { limit: options.limit ?? 12 })
    .filter((item) => graph.nodes.get(item.id)?.truth_status !== "revoked");
  const expanded = neighbors(graph, hits.map((item) => item.id), options.hops ?? store.workspace.retrieval?.graph_hops ?? 1);
  const visible = expanded.filter((node) => node.truth_status !== "revoked");
  const byId = new Map(visible.map((item) => [item.id ?? item.fact_id, item]));
  const result = hits.map((hit) => ({ ...hit, node: byId.get(hit.id) ?? graph.nodes.get(hit.id) }));
  const extra = visible
    .filter((node) => !hits.some((hit) => hit.id === (node.id ?? node.fact_id)))
    .map((node) => ({ id: node.id ?? node.fact_id, title: node.title, layer: node.layer, kind: node.kind, promoted_fact_ids: node.promoted_fact_ids ?? [], promoted_truth_status: node.promoted_truth_status ?? null, graph_expansion: true, node }));
  const relevantEdges = graph.edges.filter((edge) => byId.has(edge.from) && byId.has(edge.to));
  return {
    query,
    generated_at: new Date().toISOString(),
    primary: result,
    graph_context: extra,
    edges: relevantEdges,
    guidance: [
      "Revoked truth facts are excluded; returned truth facts were active when this packet was generated.",
      "Exploration findings are awareness and search history, not correctness sources.",
      "Inspect raw evidence only when the compiled node does not carry enough detail."
    ]
  };
}
