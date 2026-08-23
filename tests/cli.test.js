import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { runCli } from "./helpers.js";

const require = createRequire(import.meta.url);
const packageJson = require("../package.json");

test("global version comes from package metadata", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsh-version-"));
  const result = runCli(root, ["--version"]);
  assert.equal(result.stdout.trim(), packageJson.version);
});

test("boolean strict does not consume the following plan", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsh-strict-"));
  runCli(root, ["init"]);
  const result = runCli(root, ["check", "--strict", "novel approach", "--json"]);
  assert.equal(JSON.parse(result.stdout).route.raw_text, "novel approach");

  const literal = runCli(root, ["compile", "--json", "--", "--literal-plan"]);
  assert.equal(JSON.parse(literal.stdout).raw_text, "--literal-plan");
});

test("inline false disables strict and force", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsh-false-"));
  runCli(root, ["init", "--name", "original"]);
  const workspaceFile = path.join(root, ".rsh", "workspace.json");
  const workspaceId = JSON.parse(fs.readFileSync(workspaceFile, "utf8")).workspace_id;

  runCli(root, ["init", "--name", "replacement", "--force=false"]);
  const unchangedWorkspace = JSON.parse(fs.readFileSync(workspaceFile, "utf8"));
  assert.equal(unchangedWorkspace.workspace_id, workspaceId);
  assert.equal(unchangedWorkspace.name, "original");

  runCli(root, ["seed", "gabidulin"]);
  const result = runCli(root, ["check", "--strict=false", "--ir", ".rsh/examples/blocked-route.json", "--json"]);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).analysis.status, "BLOCKED");
});

test("flags are validated for each command", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsh-command-flag-"));
  runCli(root, ["init"]);
  const result = runCli(root, ["status", "--strict"], { expectSuccess: false });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown flag --strict for command status/);
});

test("unknown commands fail before workspace lookup", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsh-unknown-"));
  const result = runCli(root, ["unknown"], { expectSuccess: false });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command unknown/);
  assert.doesNotMatch(result.stderr, /No RSH workspace found/);
});

test("bounded commands reject extra positional arguments", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsh-extra-positional-"));
  runCli(root, ["init"]);
  const result = runCli(root, ["status", "typo"], { expectSuccess: false });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Command status accepts at most 0 positional arguments/);

  const conflicting = runCli(root, ["record", "typo.json", "--file", "proposal.json"], { expectSuccess: false });
  assert.equal(conflicting.status, 1);
  assert.match(conflicting.stderr, /either --file or a positional file, not both/);

  const importList = runCli(root, ["import", "list", "typo"], { expectSuccess: false });
  assert.equal(importList.status, 1);
  assert.match(importList.stderr, /import list does not accept additional positional arguments/);
});

test("value flags report a missing value", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsh-missing-value-"));
  const result = runCli(root, ["init", "--name"], { expectSuccess: false });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Flag --name requires a value/);
});

test("CLI black-box lifecycle", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsh-cli-"));
  const init = runCli(root, ["init", "--name=cli-test"]);
  assert.match(init.stdout, /Initialized RSH workspace/);
  runCli(root, ["seed", "gabidulin"]);
  runCli(root, ["index"]);
  const result = runCli(root, ["check", "--ir", ".rsh/examples/blocked-route.json", "--json"]);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.analysis.status, "BLOCKED");
  const doctor = runCli(root, ["doctor", "--json"]);
  assert.equal(JSON.parse(doctor.stdout).ok, true);
});
