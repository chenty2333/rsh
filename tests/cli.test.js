import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCli } from "./helpers.js";

test("CLI black-box lifecycle", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsh-cli-"));
  const init = runCli(root, ["init", "--name", "cli-test"]);
  assert.match(init.stdout, /Initialized RSH workspace/);
  runCli(root, ["seed", "gabidulin"]);
  runCli(root, ["index"]);
  const result = runCli(root, ["check", "--ir", ".rsh/examples/blocked-route.json", "--json"]);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.analysis.status, "BLOCKED");
  const doctor = runCli(root, ["doctor", "--json"]);
  assert.equal(JSON.parse(doctor.stdout).ok, true);
});
