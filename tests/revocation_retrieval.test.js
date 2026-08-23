import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { tempWorkspace } from "./helpers.js";
import { applyProposal } from "../src/core/record.js";
import { cascadeRevoke, submitVerification } from "../src/core/facts.js";
import { buildGraph } from "../src/core/graph.js";
import { buildIndex, searchIndex } from "../src/core/indexer.js";
import { orient } from "../src/core/orient.js";
import { graphLog, workspaceStatus } from "../src/core/status.js";
import { doctor } from "../src/core/doctor.js";
import { SCHEMAS } from "../src/core/constants.js";

function promoteFact(store, findingId, statement, predecessors = []) {
  applyProposal(store, {
    author: "alice",
    findings: [{
      id: findingId,
      kind: "proof_attempt",
      title: `Lemma ${findingId}`,
      verifiable: true,
      predecessors,
      claim: statement,
      evidence: `Proof of ${statement}`
    }]
  });
  return submitVerification(store, {
    finding_id: findingId,
    verdict: "accepted",
    method: "human_review",
    authority: "Alice",
    statement,
    proof: `Verified proof of ${statement}`,
    predecessors
  }).fact;
}

test("revoked truth remains auditable but is excluded from default retrieval", () => {
  const { store } = tempWorkspace("revocation-retrieval");
  const root = promoteFact(store, "PA-ROOT", "Quasar root lemma");
  const descendant = promoteFact(store, "PA-CHILD", "Quasar descendant theorem", [root.fact_id]);
  const active = promoteFact(store, "PA-ACTIVE", "Pulsar independent lemma");
  store.addEdge({ schema: SCHEMAS.edge, from: root.fact_id, type: "IMPLIES", to: active.fact_id, at: new Date().toISOString() });

  const before = buildIndex(store);
  assert.ok(before.documents.some((item) => item.id === root.fact_id));
  assert.ok(before.documents.some((item) => item.id === descendant.fact_id));
  assert.equal(store.readFact(active.fact_id).truth_status, "active");

  const affected = cascadeRevoke(store, root.fact_id, "audit failure", "Alice");
  assert.deepEqual(new Set(affected), new Set([root.fact_id, descendant.fact_id]));
  assert.equal(fs.existsSync(store.paths.index), false);

  const rootRead = store.readFact(root.fact_id);
  assert.equal(rootRead.truth_status, "revoked");
  assert.equal(rootRead.revocation.fact_id, root.fact_id);
  assert.equal(rootRead.revocation.root_fact_id, root.fact_id);
  assert.equal(rootRead.revocation.reason, "audit failure");
  assert.equal(store.get(root.fact_id).truth_status, "revoked");

  const childRead = store.readFact(descendant.fact_id);
  assert.equal(childRead.truth_status, "revoked");
  assert.equal(childRead.revocation.root_fact_id, root.fact_id);
  assert.equal(store.readFact(active.fact_id).truth_status, "active");
  assert.equal(store.readFact(active.fact_id).revocation, null);

  applyProposal(store, {
    author: "alice",
    findings: [{
      id: "PA-ROOT",
      kind: "proof_attempt",
      title: "Rewritten source finding",
      verifiable: true,
      claim: "Quasar root lemma",
      evidence: "Rewritten exploration record"
    }]
  }, { replace: true });
  assert.equal(store.readFinding("PA-ROOT").metadata.fact_id, undefined);

  const graph = buildGraph(store);
  assert.equal(graph.nodes.get(root.fact_id).truth_status, "revoked");
  assert.equal(graph.nodes.get(descendant.fact_id).revocation.root_fact_id, root.fact_id);
  assert.equal(graph.nodes.get(active.fact_id).truth_status, "active");
  assert.equal(graph.nodes.get("PA-ROOT").promoted_truth_status, "revoked");
  assert.deepEqual(graph.nodes.get("PA-ROOT").promoted_fact_ids, [root.fact_id]);
  assert.equal(graph.nodes.get("PA-ACTIVE").promoted_truth_status, "active");
  assert.ok(graph.edges.some((edge) => edge.from === descendant.fact_id && edge.to === root.fact_id));
  const activeGraph = buildGraph(store, { includeRevoked: false });
  assert.equal(activeGraph.nodes.has(root.fact_id), false);
  assert.equal(activeGraph.nodes.has(descendant.fact_id), false);
  assert.equal(activeGraph.nodes.has(active.fact_id), true);
  assert.equal(activeGraph.nodes.get("PA-ROOT").promoted_truth_status, "revoked");
  assert.ok(activeGraph.edges.every((edge) => activeGraph.nodes.has(edge.from) && activeGraph.nodes.has(edge.to)));

  fs.writeFileSync(store.paths.index, `${JSON.stringify(before, null, 2)}\n`, "utf8");
  const staleSafeHits = searchIndex(store, "Quasar", { limit: 20 });
  assert.ok(staleSafeHits.every((item) => item.id !== root.fact_id && item.id !== descendant.fact_id));
  assert.equal(staleSafeHits.find((item) => item.id === "PA-ROOT").promoted_truth_status, "revoked");
  const rebuiltAfterStale = JSON.parse(fs.readFileSync(store.paths.index, "utf8"));
  assert.ok(rebuiltAfterStale.documents.every((item) => item.id !== root.fact_id && item.id !== descendant.fact_id));
  assert.deepEqual(rebuiltAfterStale.revoked_fact_ids, [root.fact_id, descendant.fact_id].sort());

  const index = buildIndex(store);
  const indexedIds = new Set(index.documents.map((item) => item.id));
  assert.equal(indexedIds.has(root.fact_id), false);
  assert.equal(indexedIds.has(descendant.fact_id), false);
  assert.equal(indexedIds.has(active.fact_id), true);
  assert.deepEqual(index.revoked_fact_ids, [root.fact_id, descendant.fact_id].sort());
  assert.equal(index.documents.find((item) => item.id === "PA-ROOT").promoted_truth_status, "revoked");
  assert.equal(index.documents.find((item) => item.id === "PA-ACTIVE").promoted_truth_status, "active");
  assert.ok(index.edges.every((edge) => edge.from !== root.fact_id && edge.to !== root.fact_id));
  assert.ok(index.edges.every((edge) => edge.from !== descendant.fact_id && edge.to !== descendant.fact_id));

  const hits = searchIndex(store, "Quasar", { limit: 20 });
  assert.ok(hits.every((item) => item.id !== root.fact_id && item.id !== descendant.fact_id));
  assert.equal(hits.find((item) => item.id === "PA-ROOT").promoted_truth_status, "revoked");
  const packet = orient(store, "Quasar", { limit: 20, hops: 2 });
  assert.ok(packet.primary.every((item) => item.id !== root.fact_id && item.id !== descendant.fact_id));
  assert.equal(packet.primary.find((item) => item.id === "PA-ROOT").promoted_truth_status, "revoked");
  assert.equal(packet.primary.find((item) => item.id === "PA-ROOT").node.promoted_truth_status, "revoked");
  assert.ok(packet.graph_context.every((item) => item.id !== root.fact_id && item.id !== descendant.fact_id));
  assert.ok(packet.graph_context.every((item) => item.id !== active.fact_id), "orient must not traverse through a revoked fact to active context");
  assert.ok(packet.edges.every((edge) => ![root.fact_id, descendant.fact_id].includes(edge.from) && ![root.fact_id, descendant.fact_id].includes(edge.to)));

  const status = workspaceStatus(store);
  assert.deepEqual(status.facts, { total: 3, active: 1, revoked: 2, revocation_receipts: 2 });
  const log = graphLog(store);
  assert.doesNotMatch(log, new RegExp(root.fact_id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(log, new RegExp(descendant.fact_id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(log, /PA-ROOT .*\(unverified; promoted truth revoked\)/);
  assert.match(log, new RegExp(`${active.fact_id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\[truth/lemma\\].*\\(active\\)`));
  assert.equal(doctor(store).ok, true);
});

test("Store path construction rejects traversal identifiers", () => {
  const { store } = tempWorkspace("store-path-safety");
  for (const operation of [
    () => store.readFinding("../../escaped"),
    () => store.readFact("../../escaped"),
    () => store.readEvidence("../../escaped"),
    () => store.get("../../escaped"),
    () => store.revoke({ fact_id: "../../escaped", root_fact_id: "../../escaped", reason: "bad", authority: "test" })
  ]) assert.throws(operation, /unsafe path sequence/);
});

test("Store rejects incomplete or orphaned revocation receipts before mutation", () => {
  const { store } = tempWorkspace("revocation-receipt-integrity");
  const fact = promoteFact(store, "PA-RECEIPT", "Receipt integrity lemma");
  const validBase = {
    at: new Date().toISOString(),
    fact_id: fact.fact_id,
    root_fact_id: fact.fact_id,
    reason: "audit failure",
    authority: "Alice"
  };
  const before = { revocations: store.revocations().length, events: store.events().length };

  assert.throws(() => store.revoke(null), /plain object/);
  for (const field of ["at", "reason", "authority"]) {
    const receipt = { ...validBase, [field]: " " };
    assert.throws(() => store.revoke(receipt), new RegExp(`revocation\\.${field} is required`));
  }
  assert.throws(() => store.revoke({ ...validBase, fact_id: "missing-fact" }), /Revoked fact missing-fact not found/);
  assert.throws(() => store.revoke({ ...validBase, root_fact_id: "missing-root" }), /Revocation root fact missing-root not found/);
  assert.throws(() => store.revoke(Object.assign([], validBase)), /plain object/);
  assert.throws(() => store.revoke({ ...validBase, toJSON() { return []; } }), /must not define toJSON/);
  const cyclic = { ...validBase };
  cyclic.self = cyclic;
  assert.throws(() => store.revoke(cyclic), /must be JSON-serializable/);
  assert.deepEqual({ revocations: store.revocations().length, events: store.events().length }, before);
  assert.equal(store.readFact(fact.fact_id).truth_status, "active");
});
