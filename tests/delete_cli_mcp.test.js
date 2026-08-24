import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { checkpoint } from "../src/core/record.js";
import { cli, inputDocument, runCli, tempWorkspace } from "./helpers.js";

const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "delete-test", version: "1" } } };

function rpc(root, requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "mcp"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    const output = [];
    const expected = requests.filter((request) => request.id !== undefined).length;
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      output.push(JSON.parse(line));
      if (output.length === expected) child.stdin.end();
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new Error(stderr || `MCP exited ${code}`)));
    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
  });
}

test("CLI delete supports one recursive command and a non-mutating dry run", () => {
  const root = tempWorkspace("delete-cli");
  const target = checkpoint(root, inputDocument({ kind: "result" }, "# Target\n\nEvidence.\n"), { isText: true }).id;
  const dependent = checkpoint(root, inputDocument({ kind: "result", relations: [{ type: "rsh:depends_on", target }] }, "# Dependent\n\nUses target.\n"), { isText: true }).id;

  const preview = runCli(root, ["delete", target, "--dry-run"]).stdout;
  assert.match(preview, new RegExp(target));
  assert.match(preview, new RegExp(dependent));
  assert.equal(fs.existsSync(`${root}/.rsh/records/${target}.md`), true);
  assert.equal(fs.existsSync(`${root}/.rsh/records/${dependent}.md`), true);

  const deleted = runCli(root, ["delete", target]).stdout;
  assert.match(deleted, new RegExp(target));
  assert.match(deleted, new RegExp(dependent));
  assert.equal(fs.existsSync(`${root}/.rsh/records/${target}.md`), false);
  assert.equal(fs.existsSync(`${root}/.rsh/records/${dependent}.md`), false);
  const restored = runCli(root, ["undo"]).stdout;
  assert.match(restored, new RegExp(target));
  assert.match(restored, new RegExp(dependent));
  assert.equal(fs.existsSync(`${root}/.rsh/records/${target}.md`), true);
  assert.equal(fs.existsSync(`${root}/.rsh/records/${dependent}.md`), true);
  assert.match(runCli(root, ["delete", "R-abcd"], { success: false }).stderr, /3 or 5 lowercase base36/);
  assert.match(runCli(root, ["status", "--dry-run"], { success: false }).stderr, /Unknown flag --dry-run/);
});

test("MCP rsh_delete previews with links and deletes without dangling links", async () => {
  const root = tempWorkspace("delete-mcp");
  const target = checkpoint(root, inputDocument({ kind: "result" }, "# Disposable\n\nEvidence.\n"), { isText: true }).id;
  const previewResponses = await rpc(root, [init, { jsonrpc: "2.0", method: "notifications/initialized" }, {
    jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "rsh_delete", arguments: { record_id: target, dry_run: true } }
  }]);
  const preview = previewResponses.find((response) => response.id === 2).result;
  assert.deepEqual(preview.structuredContent.would_delete_ids, [target]);
  assert.ok(preview.content.some((item) => item.type === "resource_link" && item.name === target));
  assert.equal(fs.existsSync(`${root}/.rsh/records/${target}.md`), true);

  const deleteResponses = await rpc(root, [init, { jsonrpc: "2.0", method: "notifications/initialized" }, {
    jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "rsh_delete", arguments: { record_id: target } }
  }]);
  const deleted = deleteResponses.find((response) => response.id === 3).result;
  assert.deepEqual(deleted.structuredContent.deleted_ids, [target]);
  assert.equal(deleted.content.some((item) => item.type === "resource_link"), false);
  assert.equal(fs.existsSync(`${root}/.rsh/records/${target}.md`), false);

  const undoResponses = await rpc(root, [init, { jsonrpc: "2.0", method: "notifications/initialized" }, {
    jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "rsh_undo", arguments: {} }
  }]);
  const restored = undoResponses.find((response) => response.id === 4).result;
  assert.deepEqual(restored.structuredContent.restored_ids, [target]);
  assert.ok(restored.content.some((item) => item.type === "resource_link" && item.name === target));
  assert.equal(fs.existsSync(`${root}/.rsh/records/${target}.md`), true);
});
