import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tempWorkspace } from "./helpers.js";
import { runImporter } from "../src/importers/index.js";

test("Danus importer keeps global memory unverified and preserves verified fact DAG", () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "danus-fixture-"));
  fs.mkdirSync(path.join(source, "global_memory"), { recursive: true });
  fs.mkdirSync(path.join(source, "fact_graph", "facts"), { recursive: true });
  fs.writeFileSync(path.join(source, "global_memory", "dead_end.jsonl"), `${JSON.stringify({ id: "d1", kind: "dead_end", claim: "route failed", evidence: "reason", verifiable: false, status: "open", author: "w1" })}\n`);
  fs.writeFileSync(path.join(source, "fact_graph", "facts", "f1.md"), `---\nfact_id: f1\nproblem_id: p\nauthor: w1\npredecessors: []\n---\n\n## statement\nRoot lemma\n\n## proof\nRoot proof\n`);
  fs.writeFileSync(path.join(source, "fact_graph", "facts", "f2.md"), `---\nfact_id: f2\nproblem_id: p\nauthor: w2\npredecessors:\n  - f1\n---\n\n## statement\nChild lemma\n\n## proof\nUses root\n`);
  const { store } = tempWorkspace("danus");
  const result = runImporter("danus", store, source);
  assert.equal(result.findings.length, 1);
  assert.equal(store.readFinding("danus-d1").metadata.trust, "finding");
  assert.equal(result.facts.length, 2);
  const facts = store.listFacts();
  const child = facts.find((item) => item.sections.Statement === "Child lemma");
  assert.equal(child.metadata.predecessors.length, 1);
  assert.ok(store.hasFact(child.metadata.predecessors[0]));
});

test("Jupyter and chat importers write traces, not findings", () => {
  const { store } = tempWorkspace("traces");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trace-fixture-"));
  const notebook = path.join(dir, "n.ipynb");
  fs.writeFileSync(notebook, JSON.stringify({ cells: [{ cell_type: "markdown", source: ["idea"], outputs: [], metadata: {} }] }));
  runImporter("jupyter", store, notebook);
  const chat = path.join(dir, "chat.json");
  fs.writeFileSync(chat, JSON.stringify([{ role: "user", content: "try X" }]));
  runImporter("chat", store, chat);
  assert.equal(store.listFindings().length, 0);
  assert.ok(fs.readdirSync(store.paths.traces).length >= 2);
});
