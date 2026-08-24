import path from "node:path";
import { createRequire } from "node:module";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { findRecords, formatFindMarkdown, formatStatusMarkdown, getItem, resumeResearch, statusWorkspace } from "./query.js";
import { checkpoint, markRecord, serializeCheckpointDocument } from "./record.js";
import { doctor, formatDoctorMarkdown } from "./doctor.js";

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../../package.json");
const ID = z.string().regex(/^[QDR]-[0-9a-z]{3}$/,
  "id must be Q-, D-, or R- followed by exactly 3 lowercase base36 characters");
const RECORD_ID = z.string().regex(/^R-[0-9a-z]{3}$/,
  "record id must be R- followed by exactly 3 lowercase base36 characters");
const FRONTIER_ID = z.string().regex(/^[QD]-[0-9a-z]{3}$/,
  "frontier id must be Q- or D- followed by exactly 3 lowercase base36 characters");
const PREDICATE = z.string().regex(/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/,
  "relation type must use lowercase namespace:predicate_name format");
function nonEmptyString(description) {
  return z.string().min(1, "value must be non-empty")
    .refine((value) => Boolean(value.trim()), "value must be non-empty")
    .describe(description);
}
const BODY = nonEmptyString("Complete non-empty Markdown body; authoritative conclusion, evidence, and scope.");
const RETRY_CONDITION = nonEmptyString("One non-empty condition under which the Record should be retried.");
const FRONTIER_TEXT = z.string().min(1, "frontier text must be non-empty")
  .refine((value) => Boolean(value.trim()), "frontier text must be non-empty")
  .refine((value) => !/[\r\n]/.test(value), "frontier text must stay on one line")
  .describe("Non-empty single-line question or direction text.");
const PARENT_ID = z.union([FRONTIER_ID, z.literal("")]);
const RELATION = z.object({
  type: PREDICATE.describe("Lowercase namespace:predicate_name relation type."),
  target: ID.describe("Existing local Q-, D-, or R- target ID.")
}).strict();
const ASSERTION = z.object({
  subject: ID.describe("Existing local Q-, D-, or R- subject ID."),
  predicate: PREDICATE.describe("Lowercase namespace:predicate_name projected predicate."),
  object: ID.describe("Existing local Q-, D-, or R- object ID.")
}).strict();
const FRONTIER_ACTION = z.union([
  z.object({ action: z.literal("open"), kind: z.enum(["question", "direction"]), text: FRONTIER_TEXT, parent: PARENT_ID.optional() }).strict(),
  z.object({ action: z.literal("close"), id: FRONTIER_ID, outcome: z.enum(["resolved", "exhausted", "abandoned", "superseded"]) }).strict(),
  z.object({ action: z.literal("revise"), id: FRONTIER_ID, text: FRONTIER_TEXT.optional(), parent: PARENT_ID.optional() }).strict()
    .refine((value) => value.text !== undefined || value.parent !== undefined, "revise requires text or parent")
    .describe("Revise an open frontier item; provide at least text or parent."),
  z.object({ action: z.literal("reopen"), id: FRONTIER_ID, parent: PARENT_ID.optional() }).strict()
]);
const CHECKPOINT_INPUT = z.object({
  kind: z.enum(["result", "dead_end", "experience"]).describe("Record kind."),
  body: BODY,
  state: z.enum(["unchecked", "checked", "withdrawn"]).optional().describe("Local workflow state; defaults to unchecked."),
  scope: z.string().optional().describe("Applicability scope; required and non-empty for dead_end Records."),
  retry_if: z.array(RETRY_CONDITION).optional().describe("Conditions under which a dead end should be retried."),
  relations: z.array(RELATION).optional().describe("Outbound structured relations; defaults to an empty list."),
  assertion: ASSERTION.optional().describe("Optional machine-readable projection, allowed only for result Records."),
  frontier: z.array(FRONTIER_ACTION).optional().describe("Atomic frontier open, close, revise, or reopen actions; defaults to an empty list.")
}).strict();

const TOOLS = {
  rsh_resume: { description: "Resume research from durable RSH state.", inputSchema: { all: z.boolean().optional() } },
  rsh_find: { description: "Find research records matching a query and optional filters.", inputSchema: {
    query: z.string(), regex: z.boolean().optional(), kind: z.enum(["result", "dead_end", "experience"]).optional(),
    state: z.enum(["unchecked", "checked", "withdrawn"]).optional(), limit: z.number().int().positive().optional()
  } },
  rsh_get: { description: "Get one research item by ID.", inputSchema: { id: ID } },
  rsh_checkpoint: { description: "Checkpoint one structured research Record. Kind and non-empty Markdown body are required; relations, assertion, and frontier changes are optional.", inputSchema: CHECKPOINT_INPUT },
  rsh_mark: { description: "Set the state of an existing research record.", inputSchema: { record_id: RECORD_ID, state: z.enum(["unchecked", "checked", "withdrawn"]) } },
  rsh_status: { description: "Show the current RSH workspace status.", inputSchema: {} },
  rsh_doctor: { description: "Audit the RSH workspace and report actionable findings.", inputSchema: {} }
};

function portable(value, root, key = "") {
  if (Array.isArray(value)) return value.map((item) => portable(item, root));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([name, item]) => !((name === "file" || name.endsWith("_path")) && typeof item === "string" && path.isAbsolute(item)))
    .map(([name, item]) => [name, portable(item, root, name)]));
  if (typeof value !== "string" || !path.isAbsolute(value)) return value;
  const relative = path.relative(root, value);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative.split(path.sep).join("/") : key ? `[${key} omitted]` : "[absolute path omitted]";
}

function display(value) {
  if (value === null) return "null";
  if (["string", "boolean", "number"].includes(typeof value)) return String(value);
  return JSON.stringify(value);
}

function markdown(value, heading = "RSH result") {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return `# ${heading}\n\nNo result.`;
  if (Array.isArray(value)) return `# ${heading}\n\n${value.length
    ? value.map((item) => `- ${display(item)}`).join("\n") : "No records found."}`;
  const lines = [`# ${heading}`, ""];
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) lines.push(`## ${key}`, "", item.length ? item.map((entry) => `- ${display(entry)}`).join("\n") : "None.", "");
    else if (item && typeof item === "object") lines.push(`## ${key}`, "", ...Object.entries(item).map(([name, entry]) => `- **${name}:** ${display(entry)}`), "");
    else lines.push(`- **${key}:** ${display(item)}`, "");
  }
  return lines.join("\n").trim();
}

function recordDocument(value) {
  if (typeof value === "string") return value;
  for (const key of ["document", "text", "content", "markdown"]) if (typeof value?.[key] === "string") return value[key];
  return markdown(value, "Research record");
}

function resultId(value, fallback) {
  return value?.id ?? value?.record_id ?? value?.record?.id ?? value?.metadata?.id ?? fallback ?? null;
}

function writeMarkdown(heading, id, state) {
  return [`# ${heading}`, "", id ? `- **Record:** ${id}` : "- Record saved.", ...(state ? [`- **State:** ${state}`] : [])].join("\n");
}

function links(id) {
  return id ? [{ type: "resource_link", uri: `rsh://record/${encodeURIComponent(id)}`, name: id,
    description: `RSH research record ${id}`, mimeType: "text/markdown" }] : [];
}

function recordLinks(ids) {
  return [...new Set(ids.filter((id) => /^R-[0-9a-z]{3}$/.test(id)))].flatMap((id) => links(id));
}

function response(text, result, extra = []) {
  const structuredContent = result && typeof result === "object" && !Array.isArray(result) ? result : undefined;
  return { content: [{ type: "text", text }, ...extra], ...(structuredContent ? { structuredContent } : {}), isError: false };
}

function safeError(error, root) {
  let message = error instanceof Error ? error.message : String(error);
  message = message.split(path.resolve(root)).join(".");
  message = message.replace(/(^|[\s'"])(\/(?:[^\s'"]+\/?)+)/g, "$1[absolute path omitted]");
  return message;
}

async function callTool(root, name, args) {
  switch (name) {
    case "rsh_resume": { const result = portable(await resumeResearch(root, { all: args.all }), root); return response(markdown(result, "Research state"), result); }
    case "rsh_find": { const { query = "", ...options } = args; const result = portable(await findRecords(root, query, options), root); return response(formatFindMarkdown(result), result, recordLinks(result.map((item) => item.id))); }
    case "rsh_get": { const result = portable(await getItem(root, args.id), root); return response(recordDocument(result), result, recordLinks([args.id])); }
    case "rsh_checkpoint": { const document = serializeCheckpointDocument(args); const result = portable(await checkpoint(root, document, { isText: true }), root); const id = resultId(result); return response(writeMarkdown("Checkpoint saved", id), result, links(id)); }
    case "rsh_mark": { const result = portable(await markRecord(root, args.record_id, args.state), root); const id = resultId(result, args.record_id); return response(writeMarkdown("Record state updated", id, args.state), result, links(id)); }
    case "rsh_status": { const result = portable(await statusWorkspace(root), root); return response(formatStatusMarkdown(result), result); }
    case "rsh_doctor": { const result = portable(await doctor(root), root); return response(formatDoctorMarkdown(result), result); }
    default: throw new Error(`Unknown tool ${name}`);
  }
}

function registerResources(server, root) {
  server.registerResource("state", "rsh://state", { description: "Current resumable RSH research state", mimeType: "text/markdown" }, async (uri) => {
    try {
      const result = portable(await resumeResearch(root, {}), root);
      return { contents: [{ uri: uri.toString(), mimeType: "text/markdown", text: markdown(result, "Research state") }] };
    } catch (error) { throw new McpError(ErrorCode.InvalidParams, safeError(error, root)); }
  });
  server.registerResource("record", new ResourceTemplate("rsh://record/{id}", { list: undefined }),
    { description: "One complete RSH record", mimeType: "text/markdown" }, async (uri, { id }) => {
      try {
        const result = portable(await getItem(root, RECORD_ID.parse(id)), root);
        return { contents: [{ uri: uri.toString(), mimeType: "text/markdown", text: recordDocument(result) }] };
      } catch (error) { throw new McpError(ErrorCode.InvalidParams, safeError(error, root)); }
    });
}

export async function startMcpServer({ root = process.cwd(), transport } = {}) {
  const server = new McpServer({ name: "rsh", version: VERSION });
  registerResources(server, root);
  for (const [name, definition] of Object.entries(TOOLS)) server.registerTool(name, definition, async (args) => {
    try { return await callTool(root, name, args); }
    catch (error) { throw new Error(safeError(error, root)); }
  });
  const capabilities = server.server.getCapabilities();
  if (capabilities.resources) delete capabilities.resources.listChanged;
  if (capabilities.tools) delete capabilities.tools.listChanged;
  await server.connect(transport ?? new StdioServerTransport());
  return server;
}

export async function runMcp(options = {}) {
  return startMcpServer(options);
}
