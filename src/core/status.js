import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { buildGraph } from "./graph.js";

function git(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

export function workspaceStatus(store) {
  const findings = store.listFindings();
  const facts = store.listFacts({ includeRevoked: true });
  const revocations = store.revocations();
  const states = {};
  for (const item of findings) states[item.metadata.state] = (states[item.metadata.state] ?? 0) + 1;
  return {
    workspace: store.workspace,
    git: {
      branch: git(["branch", "--show-current"], store.root),
      head: git(["rev-parse", "--short", "HEAD"], store.root),
      dirty: Boolean(git(["status", "--porcelain"], store.root))
    },
    findings: { total: findings.length, by_state: states },
    facts: { total: facts.length, active: store.listFacts().length, revoked: revocations.length },
    edges: store.edges().length,
    evidence: store.listEvidence().length,
    index: { exists: fs.existsSync(store.paths.index), path: store.paths.index }
  };
}

export function graphLog(store) {
  const graph = buildGraph(store);
  const roots = [...graph.nodes.values()].filter((node) => (graph.incoming.get(node.id ?? node.fact_id) ?? []).length === 0);
  const lines = [];
  const seen = new Set();
  const visit = (node, prefix = "", connector = "") => {
    const id = node.id ?? node.fact_id;
    lines.push(`${prefix}${connector}${id} [${node.layer}/${node.kind}] ${node.title ?? ""}${node.state ? ` (${node.state})` : ""}`);
    if (seen.has(id)) return;
    seen.add(id);
    const children = (graph.out.get(id) ?? []).map((edge) => ({ edge, node: graph.nodes.get(edge.to) })).filter((item) => item.node);
    children.forEach((item, index) => {
      const last = index === children.length - 1;
      lines.push(`${prefix}${connector ? "   " : ""}${last ? "└─" : "├─"}${item.edge.type}→`);
      visit(item.node, `${prefix}${connector ? "   " : ""}${last ? "   " : "│  "}`, "");
    });
  };
  for (const root of roots) visit(root);
  for (const node of graph.nodes.values()) if (!seen.has(node.id ?? node.fact_id)) visit(node);
  return lines.join("\n");
}
