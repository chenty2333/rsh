import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tempWorkspace } from "./helpers.js";
import { runImporter } from "../src/importers/index.js";

function writeFact(file, lines) {
  fs.writeFileSync(file, lines.join("\n") + "\n");
}

function makeSource() {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "danus-contract-"));
  const facts = path.join(source, "fact_graph", "facts");
  fs.mkdirSync(path.join(source, "global_memory"), { recursive: true });
  fs.mkdirSync(facts, { recursive: true });
  fs.writeFileSync(path.join(source, "global_memory", "direction.jsonl"), JSON.stringify({ id: "memory-1", kind: "direction", claim: "Try induction", evidence: "A route", verifiable: true }) + "\n");
  fs.writeFileSync(path.join(source, "global_memory", "_status.jsonl"), [
    JSON.stringify({ timestamp_utc: "2026-08-23T00:00:00Z", id: "memory-1", status: "challenged", fact_id: null }),
    JSON.stringify({ timestamp_utc: "2026-08-24T00:00:00Z", id: "memory-1", status: "refuted", fact_id: "source-fact" }),
    JSON.stringify({ timestamp_utc: "2026-08-24T00:00:01Z", id: "must-not-import", status: "verified", fact_id: "orphan" })
  ].join("\n") + "\n");
  writeFact(path.join(facts, "root.md"), [
    "---", "fact_id: root", "problem_id: triangular-sum", "author: verifier-worker", "predecessors: []", "glossary_introduces:",
    "  T(n): the sum of the first n positive integers", 'external_refs: [{"key":"REF-1","authors":["Ada","Babbage"],"year":2026,"cited_for":"background"}]',
    "---", "", "## statement", "Root lemma", "", "## proof", "Root proof"
  ]);
  writeFact(path.join(facts, "middle.md"), [
    "---", "fact_id: middle", "problem_id: triangular-sum", "author: verifier-worker", "predecessors: [root]", "glossary_introduces: {}", "external_refs: []",
    "---", "", "## statement", "Middle lemma", "", "## proof", "Uses root"
  ]);
  writeFact(path.join(facts, "leaf.md"), [
    "---", "fact_id: leaf", "problem_id: triangular-sum", "author: verifier-worker", "predecessors: [root, middle]", "glossary_introduces: {}", "external_refs: []",
    "---", "", "## statement", "Leaf theorem", "", "## proof", "Uses middle"
  ]);
  writeFact(path.join(facts, "missing.md"), [
    "---", "fact_id: missing", "problem_id: triangular-sum", "author: verifier-worker", "predecessors: [outside-graph]", "glossary_introduces: {}", "external_refs: []",
    "---", "", "## statement", "Missing dependency", "", "## proof", "This must remain pending by default."
  ]);
  return source;
}

function findingByStatement(store, statement) {
  return store.listFindings().find((item) => item.sections.Statement === statement);
}

test("Danus default import preserves official format as llm-audited awareness and reports missing dependencies", () => {
  const { store } = tempWorkspace("danus-default-contract");
  store.workspace.truth_policy.accepted_methods.push("llm_audit");
  const result = runImporter("danus", store, makeSource());

  assert.equal(result.facts.length, 0);
  assert.equal(result.pending_facts, 1);
  assert.deepEqual(result.pending[0].missing_predecessors, ["outside-graph"]);
  assert.equal(store.readFinding("danus-must-not-import"), null);
  const memory = store.readFinding("danus-memory-1");
  assert.equal(memory.metadata.state, "refuted", "the latest Danus status receipt must be folded into global memory");
  assert.equal(memory.metadata.provenance.status_receipt.fact_id, "source-fact");

  const root = findingByStatement(store, "Root lemma");
  const middle = findingByStatement(store, "Middle lemma");
  const leaf = findingByStatement(store, "Leaf theorem");
  assert.ok(root && middle && leaf);
  assert.deepEqual(middle.metadata.predecessors, [root.metadata.id]);
  assert.deepEqual(leaf.metadata.predecessors, [root.metadata.id, middle.metadata.id]);
  assert.deepEqual(root.metadata.provenance.frontmatter.glossary_introduces, { "T(n)": "the sum of the first n positive integers" });
  assert.deepEqual(root.metadata.external_refs, [{ key: "REF-1", authors: ["Ada", "Babbage"], year: 2026, cited_for: "background" }]);
  assert.equal(root.metadata.source_verification.method, "llm_audit");
  assert.equal(root.metadata.evidence_grade, "llm_audited");
  assert.equal(root.metadata.provenance.truth_import, "blocked_by_truth_policy");
  assert.match(root.metadata.provenance.source_sha256, /^[0-9a-f]{64}$/);
  assert.equal(root.metadata.provenance.source_relative_path, "fact_graph/facts/root.md");
  assert.ok(store.edges().some((edge) => edge.from === leaf.metadata.id && edge.to === root.metadata.id && edge.type === "DEPENDS_ON"));
  assert.ok(store.edges().some((edge) => edge.from === leaf.metadata.id && edge.to === middle.metadata.id && edge.type === "DEPENDS_ON"));
});

test("Danus allows a missing predecessor only with explicit provenance", () => {
  const { store } = tempWorkspace("danus-missing-contract");
  const result = runImporter("danus", store, makeSource(), { allowMissingPredecessors: true });

  assert.equal(result.pending_facts, 0);
  const missing = findingByStatement(store, "Missing dependency");
  assert.ok(missing);
  assert.deepEqual(missing.metadata.predecessors, []);
  assert.deepEqual(missing.metadata.provenance.external_predecessors, ["outside-graph"]);
  assert.deepEqual(missing.metadata.provenance.unresolved_predecessors, ["outside-graph"]);
});

test("Danus imports truth only when llm audit is explicitly allowed, with accurate provenance", () => {
  const { store } = tempWorkspace("danus-allowed-contract");
  store.workspace.truth_policy.allow_llm_audit_as_truth = true;
  const result = runImporter("danus", store, makeSource());

  assert.equal(result.facts.length, 3);
  const facts = store.listFacts();
  const root = facts.find((item) => item.sections.Statement === "Root lemma");
  const middle = facts.find((item) => item.sections.Statement === "Middle lemma");
  const leaf = facts.find((item) => item.sections.Statement === "Leaf theorem");
  assert.ok(root && middle && leaf);
  assert.equal(root.metadata.verification.method, "llm_audit");
  assert.equal(root.metadata.evidence_grade, "llm_audited");
  assert.equal(root.metadata.verification.authority, "Danus verifier (LLM audit)");
  assert.deepEqual(middle.metadata.predecessors, [root.metadata.fact_id]);
  assert.deepEqual(leaf.metadata.predecessors, [root.metadata.fact_id, middle.metadata.fact_id]);
  assert.deepEqual(root.metadata.glossary, { "T(n)": "the sum of the first n positive integers" });
  assert.deepEqual(root.metadata.external_refs, [{ key: "REF-1", authors: ["Ada", "Babbage"], year: 2026, cited_for: "background" }]);
});

test("Danus revoked facts and their active dependents remain audit findings, never active truth", () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "danus-revoked-contract-"));
  const facts = path.join(source, "fact_graph", "facts");
  const revoked = path.join(source, "fact_graph", "_revoked", "2026-08-24");
  fs.mkdirSync(facts, { recursive: true });
  fs.mkdirSync(revoked, { recursive: true });
  writeFact(path.join(revoked, "root.md"), [
    "---", "fact_id: revoked-root", "problem_id: p", "author: verifier-worker", "predecessors: []", "glossary_introduces: {}", "external_refs: []",
    "---", "", "## statement", "Revoked root", "", "## proof", "The old proof."
  ]);
  writeFact(path.join(facts, "child.md"), [
    "---", "fact_id: active-child", "problem_id: p", "author: verifier-worker", "predecessors: [revoked-root]", "glossary_introduces: {}", "external_refs: []",
    "---", "", "## statement", "Child of revoked root", "", "## proof", "Depends on the revoked root."
  ]);
  fs.writeFileSync(path.join(source, "fact_graph", "revocation_log.jsonl"), JSON.stringify({ timestamp_utc: "2026-08-24T00:00:00Z", fact_id: "revoked-root", reason: "counterexample", revoked_as_dependent_of: null }) + "\n");

  const { store } = tempWorkspace("danus-revoked-contract");
  store.workspace.truth_policy.allow_llm_audit_as_truth = true;
  const result = runImporter("danus", store, source);

  assert.equal(result.facts.length, 0);
  assert.equal(store.listFacts().length, 0);
  const root = findingByStatement(store, "Revoked root");
  const child = findingByStatement(store, "Child of revoked root");
  assert.ok(root && child);
  assert.equal(root.metadata.state, "refuted");
  assert.equal(root.metadata.provenance.truth_import, "blocked_by_revocation");
  assert.equal(root.metadata.provenance.revocation.reason, "counterexample");
  assert.equal(child.metadata.provenance.truth_import, "blocked_by_nontruth_predecessor");
  assert.deepEqual(child.metadata.predecessors, [root.metadata.id]);
});

test("Danus malformed verified files never bypass truth-content validation", () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "danus-malformed-contract-"));
  const facts = path.join(source, "fact_graph", "facts");
  fs.mkdirSync(facts, { recursive: true });
  writeFact(path.join(facts, "empty-proof.md"), [
    "---", "fact_id: empty-proof", "problem_id: p", "author: verifier-worker", "predecessors: []", "glossary_introduces: {}", "external_refs: []",
    "---", "", "## statement", "A claim without a proof", "", "## proof", ""
  ]);
  writeFact(path.join(facts, "bad-glossary.md"), [
    "---", "fact_id: bad-glossary", "problem_id: p", "author: verifier-worker", "predecessors: []", "glossary_introduces: [not-a-mapping]", "external_refs: []",
    "---", "", "## statement", "A claim", "", "## proof", "A proof"
  ]);

  const { store } = tempWorkspace("danus-malformed-contract");
  store.workspace.truth_policy.allow_llm_audit_as_truth = true;
  const result = runImporter("danus", store, source);

  assert.equal(result.facts.length, 0);
  assert.equal(store.listFacts().length, 0);
  assert.equal(findingByStatement(store, "A claim without a proof").metadata.provenance.truth_import, "blocked_by_missing_proof");
  assert.equal(findingByStatement(store, "A claim").metadata.provenance.truth_import, "blocked_by_invalid_glossary");
});
