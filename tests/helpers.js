import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { stringify } from "smol-toml";

export const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const cli = path.join(projectRoot, "bin", "rsh.js");

export function emptyDir(name = "test") {
  return fs.mkdtempSync(path.join(os.tmpdir(), `rsh-015-${name}-`));
}

export function write(root, name, content) {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

export function runCli(root, args, { input, success = true } = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8", input });
  if (success) {
    assert.equal(result.status, 0, `rsh ${args.join(" ")} failed:\n${result.stderr}\n${result.stdout}`);
  }
  return result;
}

export function workspace(name = "workspace", intent = "# Intent\n\nEstablish the bounded reusable result.\n") {
  const root = emptyDir(name);
  runCli(root, ["init", write(root, "INTENT.md", intent)]);
  return root;
}

export function memory({
  kind = "finding",
  title = "Reusable conclusion",
  summary = "The bounded method is applicable.",
  scope = "finite-dimensional examples",
  body = "# Evidence\n\nThe argument is reusable.\n",
  ...extra
} = {}) {
  return `+++\n${stringify({ kind, title, summary, scope, ...extra }).trimEnd()}\n+++\n${body}`;
}

export function idFrom(result) {
  const match = /\b(R-[0-9a-z]{5})\b/.exec(result.stdout);
  assert.ok(match, `result must name a five-character base36 Memory ID:\n${result.stdout}`);
  return match[1];
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "rsh-015-tests", version: "1" }
  }
};

export function rpc(root, requests) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "mcp"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    const responses = [];
    let stderr = "";
    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      if (line.trim()) responses.push(JSON.parse(line));
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0
      ? resolve(responses)
      : reject(new Error(stderr || `MCP exited ${code}`)));
    child.stdin.write(`${JSON.stringify(initialize)}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    for (const request of requests) child.stdin.write(`${JSON.stringify(request)}\n`);
    child.stdin.end();
  });
}

export function response(responses, id) {
  return responses.find((item) => item.id === id);
}
