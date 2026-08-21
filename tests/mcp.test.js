import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { tempWorkspace, cli } from "./helpers.js";

function rpc(root, role, requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "mcp", "--role", role], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    const lines = [];
    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      lines.push(JSON.parse(line));
      if (lines.length === requests.filter((item) => item.id !== undefined).length) child.stdin.end();
    });
    child.stderr.on("data", (data) => reject(new Error(data.toString())));
    child.on("close", () => resolve(lines));
    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
  });
}

test("MCP roles expose different write surfaces", async () => {
  const { root } = tempWorkspace("mcp");
  const base = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" }
  ];
  const agent = await rpc(root, "agent", base);
  const verifier = await rpc(root, "verifier", base);
  const agentTools = agent.find((item) => item.id === 2).result.tools.map((tool) => tool.name);
  const verifierTools = verifier.find((item) => item.id === 2).result.tools.map((tool) => tool.name);
  assert.ok(agentTools.includes("rsh_propose_finding"));
  assert.ok(!agentTools.includes("rsh_submit_verdict"));
  assert.ok(verifierTools.includes("rsh_submit_verdict"));
  assert.ok(!verifierTools.includes("rsh_propose_finding"));
});
