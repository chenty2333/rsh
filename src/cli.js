import fs from "node:fs";
import path from "node:path";
import { initializeWorkspace } from "./core/workspace.js";
import { requireWorkspace } from "./core/paths.js";
import { Store } from "./core/store.js";
import { buildIndex } from "./core/indexer.js";
import { orient } from "./core/orient.js";
import { heuristicCompile, compileWithCommand, loadRouteIR } from "./core/route.js";
import { analyzeRoute } from "./core/analyzer.js";
import { applyProposal } from "./core/record.js";
import { submitVerification, cascadeRevoke } from "./core/facts.js";
import { workspaceStatus, graphLog } from "./core/status.js";
import { semanticDiff } from "./core/diff.js";
import { doctor } from "./core/doctor.js";
import { seedGabidulin } from "./core/seed.js";
import { listImporters, runImporter } from "./importers/index.js";
import { runMcp } from "./core/mcp.js";

const VERSION = "0.1.0";

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) { positional.push(token); continue; }
    const [name, inline] = token.slice(2).split("=", 2);
    if (inline !== undefined) flags[name] = inline;
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[name] = argv[++i];
    else flags[name] = true;
  }
  return { positional, flags };
}

function jsonOrPretty(value, flags, formatter = null) {
  if (flags.json) console.log(JSON.stringify(value, null, 2));
  else if (formatter) console.log(formatter(value));
  else console.log(JSON.stringify(value, null, 2));
}

function readInput(file) {
  if (!file || file === "-") return fs.readFileSync(0, "utf8");
  return fs.readFileSync(file, "utf8");
}

function formatStatus(status) {
  return [
    `Workspace: ${status.workspace.name} (${status.workspace.workspace_id})`,
    `Git: ${status.git.branch ?? "detached"}@${status.git.head ?? "unborn"}${status.git.dirty ? " dirty" : " clean"}`,
    `Exploration: ${status.findings.total} findings ${JSON.stringify(status.findings.by_state)}`,
    `Truth: ${status.facts.active} active / ${status.facts.total} total / ${status.facts.revoked} revoked`,
    `Graph: ${status.edges} edges · ${status.evidence} evidence records`,
    `Index: ${status.index.exists ? "ready" : "missing (run rsh index)"}`
  ].join("\n");
}

function formatOrient(packet) {
  const lines = [`Research orientation for: ${packet.query || "<workspace>"}`];
  for (const hit of packet.primary) lines.push(`  ${hit.id} [${hit.layer}/${hit.kind}] ${hit.title}  score=${hit.score.toFixed(3)}`);
  if (packet.graph_context.length) {
    lines.push("Graph context:");
    for (const item of packet.graph_context) lines.push(`  ${item.id} [${item.layer}/${item.kind}] ${item.title}`);
  }
  if (packet.edges.length) {
    lines.push("Relevant relations:");
    for (const edge of packet.edges) lines.push(`  ${edge.from} --${edge.type}--> ${edge.to}`);
  }
  return lines.join("\n");
}

function formatAnalysis(result) {
  const lines = [`${result.status}`];
  for (const item of result.findings.slice(0, 12)) {
    lines.push(`\n${item.type} · ${item.attempt.id} — ${item.attempt.title}`);
    lines.push(`  ${item.summary}`);
    if (item.counterexample) lines.push(`  Evidence: ${item.counterexample.id} — ${item.counterexample.title}`);
    if (item.proofTrace) lines.push(`  Trace: ${JSON.stringify(item.proofTrace)}`);
    if (item.escapeConditions?.length) lines.push(`  Escape conditions: ${item.escapeConditions.join(", ")}`);
    if (item.frontier) lines.push(`  Frontier: ${item.frontier}`);
  }
  if (result.preserved.length) {
    lines.push("\nPreserved research state:");
    for (const node of result.preserved) lines.push(`  ${node.id ?? node.fact_id} — ${node.title}`);
  }
  return lines.join("\n");
}

function help() {
  return `RSH ${VERSION} — private-first Research Git\n\nUsage:\n  rsh init [--name NAME]\n  rsh status [--json]\n  rsh orient [QUERY] [--json]\n  rsh compile <PLAN|--file FILE> [--json]\n  rsh check <PLAN> [--ir FILE] [--json]\n  rsh record --file PROPOSAL.json [--replace]\n  rsh verify FINDING --verdict accepted|rejected|inconclusive --method METHOD --authority NAME [--payload FILE]\n  rsh revoke FACT --reason TEXT [--authority NAME]\n  rsh get ID [--json]\n  rsh relations [ID] [--json]\n  rsh log [--graph]\n  rsh diff [FROM] [TO] [--json]\n  rsh index [--embedding-command CMD]\n  rsh import list\n  rsh import ADAPTER SOURCE [--traces]\n  rsh seed gabidulin\n  rsh doctor [--json]\n  rsh mcp [--role agent|verifier|operator]\n\nCore workflow:\n  orient → check → research → record → verify\n`;
}

export async function main(argv) {
  const { positional, flags } = parseArgs(argv);
  const command = positional.shift();
  if (!command || flags.help || command === "help") { console.log(help()); return; }
  if (flags.version || command === "--version" || command === "version") { console.log(VERSION); return; }

  if (command === "init") {
    const result = initializeWorkspace(process.cwd(), { name: flags.name, force: Boolean(flags.force) });
    console.log(`Initialized RSH workspace at ${result.root}\nNext: rsh index · rsh orient · rsh check`);
    return;
  }

  const root = requireWorkspace();
  const store = new Store(root);

  if (command === "status") {
    jsonOrPretty(workspaceStatus(store), flags, formatStatus);
    return;
  }
  if (command === "index") {
    const index = buildIndex(store, { embeddingCommand: flags["embedding-command"] });
    console.log(`Indexed ${index.documents.length} compiled research objects.`);
    return;
  }
  if (command === "orient") {
    const query = positional.join(" ");
    jsonOrPretty(orient(store, query, { limit: flags.limit ? Number(flags.limit) : undefined }), flags, formatOrient);
    return;
  }
  if (command === "compile") {
    const raw = flags.file ? fs.readFileSync(flags.file, "utf8") : positional.join(" ") || readInput("-");
    const compilerCommand = flags.command ?? store.workspace.compiler?.command;
    const ir = compilerCommand ? compileWithCommand(compilerCommand, raw, root) : heuristicCompile(raw);
    jsonOrPretty(ir, flags);
    return;
  }
  if (command === "check") {
    let ir;
    if (flags.ir) ir = loadRouteIR(flags.ir);
    else {
      const raw = flags.file ? fs.readFileSync(flags.file, "utf8") : positional.join(" ") || readInput("-");
      const compilerCommand = flags.command ?? store.workspace.compiler?.command;
      ir = compilerCommand ? compileWithCommand(compilerCommand, raw, root) : heuristicCompile(raw);
    }
    const result = analyzeRoute(store, ir);
    jsonOrPretty({ route: ir, analysis: result }, flags, (value) => `${value.route.compiler?.warnings?.join("\n") ?? ""}${value.route.compiler?.warnings?.length ? "\n\n" : ""}${formatAnalysis(value.analysis)}`);
    if (result.status === "BLOCKED" && flags.strict) process.exitCode = 2;
    return;
  }
  if (command === "record") {
    const file = flags.file ?? positional[0];
    if (!file) throw new Error("rsh record requires --file PROPOSAL.json");
    const proposal = JSON.parse(readInput(file));
    jsonOrPretty(applyProposal(store, proposal, { replace: Boolean(flags.replace) }), flags);
    return;
  }
  if (command === "verify") {
    const finding_id = positional[0];
    if (!finding_id) throw new Error("rsh verify requires a finding id");
    const payload = flags.payload ? JSON.parse(readInput(flags.payload)) : {};
    const result = submitVerification(store, {
      ...payload,
      finding_id,
      verdict: flags.verdict ?? payload.verdict,
      method: flags.method ?? payload.method,
      authority: flags.authority ?? payload.authority,
      force: Boolean(flags.force)
    });
    jsonOrPretty(result, flags);
    return;
  }
  if (command === "revoke") {
    const fact = positional[0];
    if (!fact || !flags.reason) throw new Error("rsh revoke requires FACT --reason TEXT");
    jsonOrPretty({ revoked: cascadeRevoke(store, fact, flags.reason, flags.authority ?? "operator") }, flags);
    return;
  }
  if (command === "get") {
    const value = store.get(positional[0]);
    if (!value) throw new Error(`Object ${positional[0]} not found`);
    jsonOrPretty(value, flags);
    return;
  }
  if (command === "relations") {
    const id = positional[0];
    const edges = id ? store.edges().filter((edge) => edge.from === id || edge.to === id) : store.edges();
    jsonOrPretty(edges, flags);
    return;
  }
  if (command === "log") {
    console.log(graphLog(store));
    return;
  }
  if (command === "diff") {
    const from = positional[0];
    const to = positional[1] ?? "HEAD";
    jsonOrPretty(semanticDiff(root, from, to), flags);
    return;
  }
  if (command === "import") {
    const adapter = positional.shift();
    if (!adapter || adapter === "list") { console.log(listImporters().join("\n")); return; }
    const source = path.resolve(positional.shift() ?? ".");
    jsonOrPretty(runImporter(adapter, store, source, { traces: Boolean(flags.traces), allowMissingPredecessors: Boolean(flags["allow-missing-predecessors"]), limit: flags.limit ? Number(flags.limit) : undefined }), flags);
    return;
  }
  if (command === "seed") {
    if (positional[0] !== "gabidulin") throw new Error("Available seed: gabidulin");
    jsonOrPretty(seedGabidulin(store), flags);
    return;
  }
  if (command === "doctor") {
    const report = doctor(store);
    jsonOrPretty(report, flags, (value) => value.checks.map((item) => `${item.ok ? "✓" : "✗"} ${item.name}: ${item.detail}`).join("\n"));
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (command === "mcp") {
    await runMcp({ role: flags.role ?? process.env.RSH_ROLE ?? "agent", root });
    return;
  }
  throw new Error(`Unknown command ${command}. Run \`rsh help\`.`);
}
