import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { rememberMemory, correctMemory, readMemory } from "./memory.js";
import { buildBrief, searchMemories } from "./query.js";

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../../package.json");
const memoryId = z.string().regex(/^R-[0-9a-z]{5}$/, "id must be an R- ID with 5 lowercase base36 characters");
const nonEmpty = (description) => z.string().trim().min(1).describe(description);
const kind = z.enum(["finding", "decision", "question", "dead_end", "hazard"]);
const memoryFields = {
  kind,
  title: nonEmpty("Concise reusable title."),
  summary: nonEmpty("Standalone reusable conclusion."),
  scope: nonEmpty("Where the conclusion applies and stops."),
  body: nonEmpty("Complete durable Markdown evidence or reasoning.")
};

const TOOLS = {
  rsh_brief: {
    description: "Return the bounded Intent-relevant context brief. Normally injected automatically; do not call it again.",
    inputSchema: z.object({}).strict()
  },
  rsh_search: {
    description: "Search durable Memory cards for one exact missing conclusion.",
    inputSchema: z.object({ query: nonEmpty("Exact semantic gap to search for.") }).strict()
  },
  rsh_read: {
    description: "Read one Memory, including its complete Markdown body.",
    inputSchema: z.object({ id: memoryId }).strict()
  },
  rsh_remember: {
    description: "Save one durable semantic conclusion after substantive work; never save progress or session state.",
    inputSchema: z.object(memoryFields).strict()
  },
  rsh_correct: {
    description: "Replace one incorrect durable Memory in place.",
    inputSchema: z.object({ id: memoryId, ...memoryFields }).strict()
  }
};

function response(text) {
  return { content: [{ type: "text", text }] };
}

async function callTool(root, name, args) {
  if (name === "rsh_brief") return response(buildBrief(root));
  if (name === "rsh_search") return response(JSON.stringify(searchMemories(root, args.query), null, 2));
  if (name === "rsh_read") {
    const memory = readMemory(root, args.id);
    if (!memory) throw new Error(`Memory ${args.id} does not exist`);
    return response(memory.document);
  }
  if (name === "rsh_remember") {
    const { body, ...card } = args;
    return response(rememberMemory(root, { card, body }).id);
  }
  if (name === "rsh_correct") {
    const { id, body, ...card } = args;
    return response(correctMemory(root, id, { card, body }).id);
  }
  throw new Error(`Unknown tool ${name}`);
}

export async function startMcpServer({ root = process.cwd(), transport } = {}) {
  const server = new McpServer({ name: "rsh", version: VERSION });
  for (const [name, definition] of Object.entries(TOOLS)) {
    server.registerTool(name, definition, async (args) => callTool(root, name, args));
  }
  await server.connect(transport ?? new StdioServerTransport());
  return server;
}

export async function runMcp(options = {}) {
  return startMcpServer(options);
}
