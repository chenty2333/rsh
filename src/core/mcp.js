import readline from "node:readline";
import { createRequire } from "node:module";
import { Store } from "./store.js";
import { workspaceStatus, graphLog } from "./status.js";
import { orient } from "./orient.js";
import { analyzeRoute } from "./analyzer.js";
import { heuristicCompile } from "./route.js";
import { applyProposal } from "./record.js";
import { submitVerification, cascadeRevoke } from "./facts.js";
import { semanticDiff } from "./diff.js";
import { doctor } from "./doctor.js";

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../../package.json");

const ROLE_TOOLS = {
  agent: ["rsh_status", "rsh_orient", "rsh_check", "rsh_get", "rsh_relations", "rsh_propose_finding", "rsh_log"],
  verifier: ["rsh_status", "rsh_orient", "rsh_get", "rsh_relations", "rsh_submit_verdict", "rsh_log"],
  operator: ["rsh_status", "rsh_orient", "rsh_check", "rsh_get", "rsh_relations", "rsh_propose_finding", "rsh_submit_verdict", "rsh_revoke", "rsh_diff", "rsh_log", "rsh_doctor"]
};

const TOOL_SCHEMAS = {
  rsh_status: ["Read workspace status.", {}],
  rsh_orient: ["Retrieve a graph-first research packet for a goal.", { query: { type: "string" }, limit: { type: "number" } }],
  rsh_check: ["Run preflight static analysis on typed route IR or fallback text.", { ir: { type: "object" }, text: { type: "string" } }],
  rsh_get: ["Read one research object by id.", { id: { type: "string" } }],
  rsh_relations: ["List typed research relations, optionally touching one id.", { id: { type: "string" } }],
  rsh_propose_finding: ["Write unverified findings/evidence/relations into the exploration graph.", { proposal: { type: "object" } }],
  rsh_submit_verdict: ["Verifier-only write gate: accept, reject, or challenge one finding.", { verdict: { type: "object" } }],
  rsh_revoke: ["Operator-only cascade revocation of a truth-graph fact.", { fact_id: { type: "string" }, reason: { type: "string" }, authority: { type: "string" } }],
  rsh_diff: ["Explain semantic research-state changes across Git refs.", { from: { type: "string" }, to: { type: "string" } }],
  rsh_log: ["Render the dual research graph as text.", {}],
  rsh_doctor: ["Audit workspace schemas, graph integrity, skills, and indexes.", {}]
};

function toolsFor(role) {
  return (ROLE_TOOLS[role] ?? ROLE_TOOLS.agent).map((name) => {
    const [description, properties] = TOOL_SCHEMAS[name];
    return { name, description, inputSchema: { type: "object", properties, additionalProperties: true } };
  });
}

function callTool(store, role, name, args = {}) {
  if (!(ROLE_TOOLS[role] ?? []).includes(name)) throw new Error(`Role ${role} cannot call ${name}`);
  switch (name) {
    case "rsh_status": return workspaceStatus(store);
    case "rsh_orient": return orient(store, args.query ?? "", { limit: args.limit });
    case "rsh_check": return analyzeRoute(store, args.ir ?? heuristicCompile(args.text ?? ""));
    case "rsh_get": return store.get(args.id);
    case "rsh_relations": return args.id ? store.edges().filter((edge) => edge.from === args.id || edge.to === args.id) : store.edges();
    case "rsh_propose_finding": return applyProposal(store, args.proposal ?? args);
    case "rsh_submit_verdict": return submitVerification(store, args.verdict ?? args);
    case "rsh_revoke": return cascadeRevoke(store, args.fact_id, args.reason, args.authority ?? "operator");
    case "rsh_diff": return semanticDiff(store.root, args.from, args.to ?? "HEAD");
    case "rsh_log": return { graph: graphLog(store) };
    case "rsh_doctor": return doctor(store);
    default: throw new Error(`Unknown tool ${name}`);
  }
}

function response(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(id, error) {
  return { jsonrpc: "2.0", id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) } };
}

export async function runMcp({ role = process.env.RSH_ROLE ?? "agent", root } = {}) {
  const store = new Store(root);
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let request;
    try { request = JSON.parse(line); }
    catch (error) { process.stdout.write(`${JSON.stringify(errorResponse(null, new Error(`Invalid JSON: ${error.message}`)))}\n`); continue; }
    try {
      let result;
      if (request.method === "initialize") {
        result = { protocolVersion: request.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "rsh", version: VERSION } };
      } else if (request.method === "notifications/initialized") {
        continue;
      } else if (request.method === "ping") {
        result = {};
      } else if (request.method === "tools/list") {
        result = { tools: toolsFor(role) };
      } else if (request.method === "tools/call") {
        const data = callTool(store, role, request.params?.name, request.params?.arguments ?? {});
        result = { content: [{ type: "text", text: JSON.stringify(data, null, 2) }], structuredContent: data, isError: false };
      } else {
        throw new Error(`Unsupported MCP method ${request.method}`);
      }
      if (request.id !== undefined) process.stdout.write(`${JSON.stringify(response(request.id, result))}\n`);
    } catch (error) {
      if (request.id !== undefined) process.stdout.write(`${JSON.stringify(errorResponse(request.id, error))}\n`);
    }
  }
}
