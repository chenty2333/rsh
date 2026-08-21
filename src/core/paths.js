import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function findGitRoot(start = process.cwd()) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: start,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

export function findWorkspaceRoot(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, ".rsh", "workspace.json"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function requireWorkspace(start = process.cwd()) {
  const root = findWorkspaceRoot(start);
  if (!root) throw new Error("No RSH workspace found. Run `rsh init` first.");
  return root;
}

export function workspacePaths(root) {
  const rsh = path.join(root, ".rsh");
  return {
    root,
    rsh,
    workspace: path.join(rsh, "workspace.json"),
    findings: path.join(rsh, "findings"),
    facts: path.join(rsh, "facts"),
    graph: path.join(rsh, "graph"),
    edges: path.join(rsh, "graph", "edges.jsonl"),
    evidence: path.join(rsh, "evidence"),
    traces: path.join(rsh, "traces"),
    events: path.join(rsh, "events.jsonl"),
    verifications: path.join(rsh, "verifications.jsonl"),
    revocations: path.join(rsh, "revocations.jsonl"),
    cache: path.join(rsh, "cache"),
    index: path.join(rsh, "cache", "index.json"),
    embeddings: path.join(rsh, "cache", "embeddings.json"),
    examples: path.join(rsh, "examples")
  };
}
