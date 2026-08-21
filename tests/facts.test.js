import test from "node:test";
import assert from "node:assert/strict";
import { tempWorkspace } from "./helpers.js";
import { applyProposal } from "../src/core/record.js";
import { computeFactId, submitVerification, cascadeRevoke } from "../src/core/facts.js";

function addProofFinding(store, id, predecessors = []) {
  applyProposal(store, {
    author: "alice",
    findings: [{
      id,
      kind: "proof_attempt",
      title: `Lemma ${id}`,
      verifiable: true,
      predecessors,
      claim: `Statement ${id}`,
      evidence: `Proof ${id}`
    }]
  });
}

test("fact id is stable under cosmetic whitespace", () => {
  const a = computeFactId({ problem_id: "p", predecessors: [], glossary: {}, statement: "A   B", proof: "x\n y" });
  const b = computeFactId({ problem_id: "p", predecessors: [], glossary: {}, statement: "A B", proof: "x y" });
  assert.equal(a, b);
});

test("LLM audit records support but does not enter truth by default", () => {
  const { store } = tempWorkspace("llm-audit");
  addProofFinding(store, "PA1");
  const result = submitVerification(store, { finding_id: "PA1", verdict: "accepted", method: "llm_audit", authority: "model", statement: "S", proof: "P" });
  assert.equal(result.promoted, false);
  assert.equal(store.listFacts().length, 0);
});

test("accepted human review promotes content-addressed fact and enforces predecessors", () => {
  const { store } = tempWorkspace("promote");
  addProofFinding(store, "PA1");
  const first = submitVerification(store, { finding_id: "PA1", verdict: "accepted", method: "human_review", authority: "Alice", statement: "First", proof: "Proof first" });
  assert.equal(first.promoted, true);
  addProofFinding(store, "PA2", [first.fact.fact_id]);
  const second = submitVerification(store, { finding_id: "PA2", verdict: "accepted", method: "human_review", authority: "Bob", statement: "Second", proof: "Uses first", predecessors: [first.fact.fact_id] });
  assert.equal(second.promoted, true);
  assert.ok(store.edges().some((edge) => edge.from === second.fact.fact_id && edge.type === "DEPENDS_ON" && edge.to === first.fact.fact_id));
});

test("revocation cascades through truth descendants while preserving findings", () => {
  const { store } = tempWorkspace("revoke");
  addProofFinding(store, "PA1");
  const first = submitVerification(store, { finding_id: "PA1", verdict: "accepted", method: "human_review", authority: "Alice", statement: "First", proof: "P1" });
  addProofFinding(store, "PA2", [first.fact.fact_id]);
  const second = submitVerification(store, { finding_id: "PA2", verdict: "accepted", method: "human_review", authority: "Alice", statement: "Second", proof: "P2", predecessors: [first.fact.fact_id] });
  const affected = cascadeRevoke(store, first.fact.fact_id, "audit failure", "Alice");
  assert.deepEqual(new Set(affected), new Set([first.fact.fact_id, second.fact.fact_id]));
  assert.ok(store.readFinding("PA1"));
  assert.equal(store.listFacts().length, 0);
});
