import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { response, rpc, workspace } from "./helpers.js";

const toolNames = ["rsh_brief", "rsh_correct", "rsh_read", "rsh_remember", "rsh_search"];

function failed(result) {
  return Boolean(result?.error || result?.result?.isError);
}

test("MCP exposes exactly five strict tools and no resources", async () => {
  const root = workspace("mcp-surface");
  const responses = await rpc(root, [
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "resources/list" },
    { jsonrpc: "2.0", id: 4, method: "resources/templates/list" }
  ]);
  const tools = response(responses, 2).result.tools;
  assert.deepEqual(tools.map((tool) => tool.name).sort(), toolNames);
  assert.deepEqual(Object.keys(tools.find((tool) => tool.name === "rsh_brief").inputSchema.properties), []);
  assert.deepEqual(Object.keys(tools.find((tool) => tool.name === "rsh_search").inputSchema.properties), ["query"]);
  assert.deepEqual(Object.keys(tools.find((tool) => tool.name === "rsh_read").inputSchema.properties), ["id"]);
  assert.deepEqual(
    Object.keys(tools.find((tool) => tool.name === "rsh_remember").inputSchema.properties).sort(),
    ["body", "kind", "scope", "summary", "title"]
  );
  assert.deepEqual(
    Object.keys(tools.find((tool) => tool.name === "rsh_correct").inputSchema.properties).sort(),
    ["body", "id", "kind", "scope", "summary", "title"]
  );
  for (const tool of tools) assert.equal(tool.inputSchema.additionalProperties, false);
  assert.ok(response(responses, 3).error);
  assert.ok(response(responses, 4).error);
});

test("MCP remember and in-place correct return one short ID", async () => {
  const root = workspace("mcp-write");
  const create = await rpc(root, [{
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "rsh_remember",
      arguments: {
        kind: "finding",
        title: "MCP conclusion",
        summary: "A bounded reusable conclusion.",
        scope: "MCP contract tests",
        body: "# Evidence\n\nMCP-PRIVATE-BODY\n"
      }
    }
  }]);
  const id = response(create, 2).result.content[0].text;
  assert.match(id, /^R-[0-9a-z]{5}$/);
  assert.equal(response(create, 2).result.content[0].text.includes("MCP-PRIVATE-BODY"), false);

  const corrected = await rpc(root, [
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "rsh_correct",
        arguments: {
          id,
          kind: "decision",
          title: "Corrected MCP conclusion",
          summary: "The replacement is the durable conclusion.",
          scope: "MCP contract tests",
          body: "# Replacement\n\nMCP-REPLACEMENT-BODY\n"
        }
      }
    }
  ]);
  assert.equal(response(corrected, 3).result.content[0].text, id);

  const followup = await rpc(root, [
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "rsh_read", arguments: { id } } },
    {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "rsh_remember",
        arguments: {
          kind: "finding",
          title: "Invalid",
          summary: "Contains an extra field.",
          scope: "tests",
          topics: ["invalid"],
          body: "# Invalid"
        }
      }
    }
  ]);
  assert.match(response(followup, 4).result.content[0].text, /MCP-REPLACEMENT-BODY/);
  assert.equal(fs.readdirSync(path.join(root, ".rsh", "records")).length, 1);
  assert.ok(failed(response(followup, 5)));
});

test("MCP Brief and search stay summary-only", async () => {
  const root = workspace("mcp-query", "# Intent\n\nProve the spectral bridge.\n");
  await rpc(root, [{
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: {
      name: "rsh_remember",
      arguments: {
        kind: "hazard",
        title: "Spectral bridge hazard",
        summary: "The bridge fails outside the promised chart.",
        scope: "spectral bridge proof",
        body: "# Evidence\n\nMCP-HIDDEN-EVIDENCE\n"
      }
    }
  }]);
  const results = await rpc(root, [
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "rsh_brief", arguments: {} } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "rsh_search", arguments: { query: "spectral bridge" } } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "rsh_search", arguments: { query: "spectral", limit: 1 } } },
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "rsh_status", arguments: {} } }
  ]);
  const brief = response(results, 3).result.content[0].text;
  const search = response(results, 4).result.content[0].text;
  assert.match(brief, /Spectral bridge hazard/);
  assert.equal(brief.includes("MCP-HIDDEN-EVIDENCE"), false);
  assert.equal(search.includes("MCP-HIDDEN-EVIDENCE"), false);
  assert.ok(failed(response(results, 5)));
  assert.ok(failed(response(results, 6)));
});
