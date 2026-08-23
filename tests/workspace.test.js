import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempWorkspace } from "./helpers.js";
import { workspaceStatus } from "../src/core/status.js";
import { doctor } from "../src/core/doctor.js";
import { buildIndex, searchIndex } from "../src/core/indexer.js";
import { seedGabidulin } from "../src/core/seed.js";
import { initializeWorkspace } from "../src/core/workspace.js";

test("rsh init creates private-first Git workspace, skills, and disposable cache", () => {
  const { root, store } = tempWorkspace("init");
  for (const file of [
    ".rsh/workspace.json",
    ".rsh/graph/edges.jsonl",
    ".agents/skills/rsh/SKILL.md",
    ".claude/skills/rsh/SKILL.md",
    ".mcp.json"
  ]) assert.ok(fs.existsSync(path.join(root, file)), file);
  const ignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  assert.match(ignore, /\.rsh\/cache\//);
  const status = workspaceStatus(store);
  assert.equal(status.findings.total, 0);
});

test("repeated init preserves customized skills unless force is explicit", () => {
  const { root } = tempWorkspace("init-skills");
  const skillFiles = [
    path.join(root, ".agents", "skills", "rsh", "SKILL.md"),
    path.join(root, ".claude", "skills", "rsh", "SKILL.md")
  ];
  const generatedSkills = skillFiles.map((file) => fs.readFileSync(file, "utf8"));

  skillFiles.forEach((file, index) => fs.writeFileSync(file, `custom skill ${index}\n`, "utf8"));
  initializeWorkspace(root);
  skillFiles.forEach((file, index) => assert.equal(fs.readFileSync(file, "utf8"), `custom skill ${index}\n`));

  initializeWorkspace(root, { force: true });
  skillFiles.forEach((file, index) => assert.equal(fs.readFileSync(file, "utf8"), generatedSkills[index]));
});

test("index is derived and graph-first search retrieves compiled state", () => {
  const { store } = tempWorkspace("index");
  seedGabidulin(store);
  const index = buildIndex(store);
  assert.ok(index.documents.length >= 10);
  const hits = searchIndex(store, "uniform slice regularity", { limit: 5 });
  assert.equal(hits[0].id, "A174");
  const report = doctor(store);
  assert.equal(report.ok, true);
});
