import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { emptyDir, projectRoot, workspace } from "./helpers.js";

const hookFile = path.join(projectRoot, "hooks", "session-start.mjs");

function runHook(cwd, payload = { hook_event_name: "SessionStart", source: "startup", cwd }) {
  return spawnSync(process.execPath, [hookFile], {
    cwd,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, PATH: `${path.join(projectRoot, "bin")}:${process.env.PATH ?? ""}` }
  });
}

test("plugin hook is limited to root startup, clear, and compact events", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, ".codex-plugin", "plugin.json"), "utf8"));
  assert.equal(manifest.hooks, "./hooks/hooks.json");
  const hooks = JSON.parse(fs.readFileSync(path.join(projectRoot, "hooks", "hooks.json"), "utf8"));
  const group = hooks.hooks.SessionStart;
  assert.equal(group.length, 1);
  assert.equal(group[0].matcher, "^(startup|clear|compact)$");
  assert.equal(group[0].matcher.includes("resume"), false);
  assert.equal(group[0].hooks[0].additionalContextLimit, 8192);
  assert.equal(group[0].hooks[0].statusMessage, undefined);
});

test("hook emits one Brief from an exact 0.1.5 ancestor", () => {
  const root = workspace("hook", "# Hook Intent\n\nProve the injected result.\n");
  const nested = path.join(root, "a", "b");
  fs.mkdirSync(nested, { recursive: true });
  const result = runHook(nested);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal((result.stdout.match(/^# Hook Intent$/gm) ?? []).length, 1);
  assert.match(result.stdout, /RSH boundary/);
});

test("hook is silent outside the current format and on malformed input", () => {
  const empty = emptyDir("hook-empty");
  let result = runHook(empty);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");

  const old = workspace("hook-old");
  fs.writeFileSync(path.join(old, ".rsh", "manifest.toml"), 'format = "rsh/0.1.4"\n');
  result = runHook(old);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");

  const outer = workspace("hook-nearest");
  const nestedOld = path.join(outer, "nested-old");
  fs.mkdirSync(path.join(nestedOld, ".rsh"), { recursive: true });
  fs.writeFileSync(path.join(nestedOld, ".rsh", "manifest.toml"), 'format = "rsh/0.1.4"\n');
  result = runHook(nestedOld);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");

  result = spawnSync(process.execPath, [hookFile], { cwd: empty, input: "not json", encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
