import test from "node:test";
import assert from "node:assert/strict";
import { tempWorkspace } from "./helpers.js";
import { applyProposal } from "../src/core/record.js";
import { cascadeRevoke, submitVerification } from "../src/core/facts.js";
import { validateEdge, validateObjectId } from "../src/core/schema.js";
import { SCHEMAS } from "../src/core/constants.js";

function addFinding(store, id, overrides = {}) {
  applyProposal(store, {
    findings: [{
      id,
      kind: "proof_attempt",
      title: `Finding ${id}`,
      claim: `Statement ${id}`,
      evidence: `Proof ${id}`,
      ...overrides
    }]
  });
}

function mutationCounts(store) {
  return {
    findings: store.listFindings().length,
    evidence: store.listEvidence().length,
    facts: store.listFacts({ includeRevoked: true }).length,
    edges: store.edges().length,
    verifications: store.verifications().length,
    events: store.events().length
  };
}

test("object IDs are safe single path segments while existing ID styles remain valid", () => {
  for (const id of ["P001", "PA1", "danus-d1", "evaluation-space-exterior-expansion", "E-0123456789ab", "0123456789abcdef0123"]) {
    assert.equal(validateObjectId(id), id);
  }
  for (const id of ["../escape", "nested/id", "nested\\id", "two..dots", ".hidden", "bad id", "bad\0id", "a".repeat(129)]) {
    assert.throws(() => validateObjectId(id), /unsafe path sequence|must start|at most 128/);
  }
  assert.throws(() => validateEdge({ schema: SCHEMAS.edge, from: "../escape", type: "PRODUCED", to: "P001" }), /edge\.from/);
  assert.throws(() => validateEdge({ schema: SCHEMAS.edge, from: "P001", type: "PRODUCED", to: "nested\\id" }), /edge\.to/);
});

test("applyProposal validates the whole batch before any write", () => {
  const { store } = tempWorkspace("proposal-preflight");
  addFinding(store, "EXISTING", { title: "Original" });
  const before = mutationCounts(store);

  assert.throws(() => applyProposal(store, {
    evidence: [{ id: "E-new", kind: "note", grade: "self_reported" }],
    findings: [{ id: "NEW", kind: "attempt", title: "New finding" }],
    edges: [{ from: "NEW", type: "PRODUCED", to: "MISSING" }]
  }), /Edge target MISSING does not exist/);

  assert.deepEqual(mutationCounts(store), before);
  assert.equal(store.readEvidence("E-new"), null);
  assert.equal(store.readFinding("NEW"), null);

  assert.throws(() => applyProposal(store, {
    evidence: [{ id: "E-other", kind: "note", grade: "self_reported" }],
    findings: [{ id: "EXISTING", kind: "attempt", title: "Replacement" }]
  }), /Finding EXISTING already exists/);
  assert.deepEqual(mutationCounts(store), before);
  assert.equal(store.readFinding("EXISTING").metadata.title, "Original");
});

test("applyProposal preflights duplicate IDs, cross-layer conflicts, and evidence references", () => {
  const { store } = tempWorkspace("proposal-conflicts");
  const before = mutationCounts(store);

  assert.throws(() => applyProposal(store, {
    findings: [
      { id: "DUP", kind: "attempt", title: "First" },
      { id: "DUP", kind: "attempt", title: "Second" }
    ]
  }), /Duplicate finding DUP/);
  assert.deepEqual(mutationCounts(store), before);

  assert.throws(() => applyProposal(store, {
    evidence: [{ id: "SHARED", kind: "note", grade: "self_reported" }],
    findings: [{ id: "SHARED", kind: "attempt", title: "Conflict" }]
  }), /used by both finding and evidence/);
  assert.deepEqual(mutationCounts(store), before);

  assert.throws(() => applyProposal(store, {
    evidence: [{ id: "E-valid", kind: "note", grade: "self_reported" }],
    findings: [{ id: "REF", kind: "attempt", title: "Reference", evidence_refs: ["E-missing"] }]
  }), /references missing evidence E-missing/);
  assert.deepEqual(mutationCounts(store), before);

  addFinding(store, "STORE-LAYER");
  const beforeStoreConflict = mutationCounts(store);
  assert.throws(() => store.writeEvidence({
    schema: SCHEMAS.evidence,
    id: "STORE-LAYER",
    kind: "note",
    grade: "self_reported"
  }), /conflicts with existing finding/);
  assert.deepEqual(mutationCounts(store), beforeStoreConflict);

  const cyclicSource = {};
  cyclicSource.self = cyclicSource;
  assert.throws(() => applyProposal(store, {
    evidence: [
      { id: "E-first", kind: "note", grade: "self_reported" },
      { id: "E-cycle", kind: "note", grade: "self_reported", source: cyclicSource }
    ]
  }), /evidence must be JSON-serializable/);
  assert.deepEqual(mutationCounts(store), beforeStoreConflict);
});

test("promotable accepted verification failures do not append receipts", () => {
  const cyclicExternalRefs = [];
  cyclicExternalRefs.push(cyclicExternalRefs);
  const cases = [
    {
      name: "kind",
      finding: { kind: "attempt" },
      input: {},
      error: /not directly promotable/
    },
    {
      name: "predecessor",
      finding: {},
      input: { predecessors: ["missing-fact"] },
      error: /Missing predecessor fact/
    },
    {
      name: "body",
      finding: {},
      input: { proof: "   " },
      error: /requires a statement and proof/
    },
    {
      name: "fact-kind",
      finding: {},
      input: { fact_kind: "unsupported" },
      error: /Unsupported fact kind/
    },
    {
      name: "verification-id",
      finding: {},
      input: { verification_id: "../invalid" },
      error: /verification\.verification_id/
    },
    {
      name: "evidence-reference",
      finding: {},
      input: { evidence_refs: ["E-missing"] },
      error: /Missing verification evidence/
    },
    {
      name: "serialization",
      finding: {},
      input: { external_refs: cyclicExternalRefs },
      error: /fact must be JSON-serializable/
    }
  ];

  for (const item of cases) {
    const { store } = tempWorkspace(`verification-${item.name}`);
    addFinding(store, "CHECK", item.finding);
    const before = mutationCounts(store);
    const state = store.readFinding("CHECK").metadata.state;
    assert.throws(() => submitVerification(store, {
      finding_id: "CHECK",
      verdict: "accepted",
      method: "human_review",
      authority: "Alice",
      ...item.input
    }), item.error);
    assert.deepEqual(mutationCounts(store), before, item.name);
    assert.equal(store.readFinding("CHECK").metadata.state, state, item.name);
  }
});

test("duplicate promotion is rejected before another verification receipt", () => {
  const { store } = tempWorkspace("duplicate-fact");
  addFinding(store, "FIRST");
  const common = { verdict: "accepted", method: "human_review", authority: "Alice", statement: "Same statement", proof: "Same proof" };
  const first = submitVerification(store, { finding_id: "FIRST", ...common });
  assert.equal(first.promoted, true);

  addFinding(store, "SECOND");
  const before = mutationCounts(store);
  const state = store.readFinding("SECOND").metadata.state;
  assert.throws(() => submitVerification(store, { finding_id: "SECOND", ...common }), /already exists/);
  assert.deepEqual(mutationCounts(store), before);
  assert.equal(store.readFinding("SECOND").metadata.state, state);
});

test("non-truth LLM audit still records support without promotion", () => {
  const { store } = tempWorkspace("llm-support-receipt");
  addFinding(store, "LLM-CHECK");
  const result = submitVerification(store, {
    finding_id: "LLM-CHECK",
    verdict: "accepted",
    method: "llm_audit",
    authority: "model"
  });
  assert.equal(result.promoted, false);
  assert.equal(store.verifications().length, 1);
  assert.equal(store.readFinding("LLM-CHECK").metadata.state, "supported");
  assert.equal(store.listFacts().length, 0);
});

test("cascade revocation ignores exploration nodes that use DEPENDS_ON edges", () => {
  const { store } = tempWorkspace("exploration-dependency");
  addFinding(store, "ROOT");
  const promoted = submitVerification(store, {
    finding_id: "ROOT",
    verdict: "accepted",
    method: "human_review",
    authority: "Alice"
  });
  applyProposal(store, {
    findings: [{ id: "EXPLORATION", kind: "attempt", title: "Exploration child" }],
    edges: [{ from: "EXPLORATION", type: "DEPENDS_ON", to: promoted.fact.fact_id }]
  });

  const affected = cascadeRevoke(store, promoted.fact.fact_id, "invalid proof", "Alice");
  assert.deepEqual(affected, [promoted.fact.fact_id]);
  assert.equal(store.revocations().length, 1);
  assert.ok(store.readFinding("EXPLORATION"));
});
