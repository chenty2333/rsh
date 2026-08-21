import { execFileSync } from "node:child_process";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function classify(file) {
  if (file.startsWith(".rsh/findings/")) return "exploration";
  if (file.startsWith(".rsh/facts/")) return "truth";
  if (file.startsWith(".rsh/evidence/")) return "evidence";
  if (file.startsWith(".rsh/traces/")) return "trace";
  if (file === ".rsh/graph/edges.jsonl") return "relations";
  if (file === ".rsh/revocations.jsonl") return "revocation";
  return "other";
}

export function semanticDiff(root, from, to = "HEAD") {
  const range = from ? `${from}..${to}` : to;
  const raw = git(["diff", "--name-status", range, "--", ".rsh"], root);
  const changes = raw ? raw.split(/\r?\n/).map((line) => {
    const [status, ...parts] = line.split("\t");
    const file = parts.at(-1);
    return { status, file, layer: classify(file) };
  }) : [];
  const summary = {};
  for (const item of changes) summary[item.layer] = (summary[item.layer] ?? 0) + 1;
  return { range, changes, summary };
}
