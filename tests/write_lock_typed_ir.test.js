import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { tempWorkspace, runCli, cli } from "./helpers.js";
import { loadRouteIR } from "../src/core/route.js";
import { withWorkspaceWriteLock } from "../src/core/write-lock.js";

const writeLockModule = new URL("../src/core/write-lock.js", import.meta.url).href;
const storeModule = new URL("../src/core/store.js", import.meta.url).href;

function validRoute(overrides = {}) {
  return {
    schema: "rsh.route.v1",
    targets: [],
    mechanisms: [],
    assumptions: [],
    exclusions: [],
    implicit_claims: [],
    ...overrides
  };
}

function runWorker(root, trace, name) {
  const script = `
    import fs from "node:fs";
    import { Store } from ${JSON.stringify(storeModule)};
    import { withWorkspaceWriteLock } from ${JSON.stringify(writeLockModule)};
    const store = new Store(${JSON.stringify(root)});
    withWorkspaceWriteLock(store.root, () => {
      fs.appendFileSync(${JSON.stringify(trace)}, "start ${name}\\n");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      fs.appendFileSync(${JSON.stringify(trace)}, "end ${name}\\n");
    }, { timeoutMs: 5_000 });
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", script], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`worker ${name} exited ${code}`)));
  });
}

function mcpRequest(root, request) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "mcp", "--role", "agent"], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { errors += data; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code !== 0) reject(new Error(errors || `MCP exited ${code}`));
      else resolve(JSON.parse(output.trim()));
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

test("workspace write lock serializes two Store-owning processes", async () => {
  const { root } = tempWorkspace("write-lock-race");
  const trace = path.join(os.tmpdir(), `rsh-lock-trace-${process.pid}-${Date.now()}.log`);
  await Promise.all([runWorker(root, trace, "one"), runWorker(root, trace, "two")]);
  const lines = fs.readFileSync(trace, "utf8").trim().split("\n");
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^start (one|two)$/);
  assert.equal(lines[1], `end ${lines[0].slice("start ".length)}`);
  assert.match(lines[2], /^start (one|two)$/);
  assert.notEqual(lines[0], lines[2]);
  assert.equal(lines[3], `end ${lines[2].slice("start ".length)}`);
});

test("workspace write lock releases after exceptions, holds across async work, and reclaims proven dead same-host holders", async () => {
  const { root } = tempWorkspace("write-lock-release");
  const lockPath = path.join(root, ".rsh", "locks", "write.lock");
  assert.throws(() => withWorkspaceWriteLock(root, () => { throw new Error("expected failure"); }), /expected failure/);
  assert.ok(!fs.existsSync(lockPath));

  let finishAsync;
  const asyncWork = withWorkspaceWriteLock(root, () => new Promise((resolve) => { finishAsync = resolve; }));
  assert.ok(fs.existsSync(lockPath));
  assert.throws(() => withWorkspaceWriteLock(root, () => null, { timeoutMs: 0 }), /already held by this process/);
  finishAsync("done");
  assert.equal(await asyncWork, "done");
  assert.ok(!fs.existsSync(lockPath));

  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({
    token: "dead-holder",
    pid: 999_999_999,
    hostname: os.hostname(),
    acquired_at: "2000-01-01T00:00:00.000Z"
  }));
  let ran = false;
  withWorkspaceWriteLock(root, () => { ran = true; });
  assert.equal(ran, true);
  assert.ok(!fs.existsSync(lockPath));
});

test("formal CLI and MCP checks require complete typed rsh.route.v1 IR", async () => {
  const { root } = tempWorkspace("typed-ir");
  const naturalLanguage = runCli(root, ["check", "try a natural-language route"], { expectSuccess: false });
  assert.match(naturalLanguage.stderr, /requires typed IR/);

  const heuristic = runCli(root, ["check", "--heuristic", "try a natural-language route", "--json"]);
  assert.equal(JSON.parse(heuristic.stdout).route.compiler.mode, "heuristic");

  const invalid = path.join(root, "invalid-route.json");
  fs.writeFileSync(invalid, JSON.stringify({ targets: [] }));
  assert.throws(() => loadRouteIR(invalid), /route\.schema must be rsh\.route\.v1/);
  fs.writeFileSync(invalid, JSON.stringify(validRoute({ unknown: true })));
  assert.throws(() => loadRouteIR(invalid), /unsupported field: unknown/);
  fs.writeFileSync(invalid, JSON.stringify(validRoute({ mechanisms: undefined })));
  assert.throws(() => loadRouteIR(invalid), /mechanisms is required/);
  fs.writeFileSync(invalid, JSON.stringify(validRoute({ quantifiers: [] })));
  assert.throws(() => loadRouteIR(invalid), /quantifiers must be an object/);

  const compiler = path.join(root, "route-compiler.mjs");
  fs.writeFileSync(compiler, `console.log(${JSON.stringify(JSON.stringify(validRoute()))});\n`);
  const compiled = runCli(root, ["check", "--command", `${process.execPath} ${compiler}`, "natural language", "--json"]);
  assert.equal(JSON.parse(compiled.stdout).route.compiler.mode, "external_command");
  fs.writeFileSync(compiler, "console.log(JSON.stringify({ targets: [] }));\n");
  const malformedCompiler = runCli(root, ["check", "--command", `${process.execPath} ${compiler}`, "natural language"], { expectSuccess: false });
  assert.match(malformedCompiler.stderr, /route\.schema must be rsh\.route\.v1/);

  const missingIr = await mcpRequest(root, { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "rsh_check", arguments: { text: "route" } } });
  assert.match(missingIr.error.message, /requires an ir object/);
  const malformedIr = await mcpRequest(root, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "rsh_check", arguments: { ir: {} } } });
  assert.match(malformedIr.error.message, /route\.schema must be rsh\.route\.v1/);
  const typedIr = await mcpRequest(root, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "rsh_check", arguments: { ir: validRoute() } } });
  assert.equal(typedIr.result.isError, false);
});
