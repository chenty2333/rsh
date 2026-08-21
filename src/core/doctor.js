import fs from "node:fs";
import path from "node:path";
import { buildGraph } from "./graph.js";
import { validateEdge, validateEvidence, validateFact, validateFinding } from "./schema.js";

export function doctor(store) {
  const checks = [];
  const add = (name, ok, detail = "") => checks.push({ name, ok, detail });
  try {
    for (const item of store.listFindings()) validateFinding(item.metadata);
    add("finding schemas", true, `${store.listFindings().length} findings`);
  } catch (error) { add("finding schemas", false, error.message); }
  try {
    for (const item of store.listFacts({ includeRevoked: true })) validateFact(item.metadata);
    add("fact schemas", true, `${store.listFacts({ includeRevoked: true }).length} facts`);
  } catch (error) { add("fact schemas", false, error.message); }
  try {
    for (const item of store.listEvidence()) validateEvidence(item);
    add("evidence schemas", true, `${store.listEvidence().length} evidence records`);
  } catch (error) { add("evidence schemas", false, error.message); }
  try {
    const graph = buildGraph(store);
    for (const edge of graph.edges) {
      validateEdge(edge);
      if (!graph.nodes.has(edge.from)) throw new Error(`Missing edge source ${edge.from}`);
      if (!graph.nodes.has(edge.to)) throw new Error(`Missing edge target ${edge.to}`);
    }
    add("graph integrity", true, `${graph.edges.length} edges`);
  } catch (error) { add("graph integrity", false, error.message); }
  try {
    const revoked = new Set(store.revocations().map((item) => item.fact_id));
    for (const fact of store.listFacts({ includeRevoked: true })) {
      for (const predecessor of fact.metadata.predecessors ?? []) {
        if (!store.hasFact(predecessor)) throw new Error(`${fact.metadata.fact_id} misses predecessor ${predecessor}`);
        if (!revoked.has(fact.metadata.fact_id) && revoked.has(predecessor)) throw new Error(`${fact.metadata.fact_id} is active but depends on revoked ${predecessor}`);
      }
    }
    add("truth DAG", true, "predecessors resolved");
  } catch (error) { add("truth DAG", false, error.message); }
  add("Codex skill", fs.existsSync(path.join(store.root, ".agents", "skills", "rsh", "SKILL.md")), ".agents/skills/rsh/SKILL.md");
  add("Claude skill", fs.existsSync(path.join(store.root, ".claude", "skills", "rsh", "SKILL.md")), ".claude/skills/rsh/SKILL.md");
  add("MCP config", fs.existsSync(path.join(store.root, ".mcp.json")), ".mcp.json");
  add("derived index", fs.existsSync(store.paths.index), store.paths.index);
  return { ok: checks.every((item) => item.ok || item.name === "derived index"), checks };
}
