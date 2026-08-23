import { canonicalJson, normalizeWhitespace, shortHash } from "./canonical.js";
import { SCHEMAS, VERIFIABLE_FINDING_KINDS } from "./constants.js";
import { validateEdge, validateFact, validateFinding, validateObjectId, validateVerification } from "./schema.js";
import { buildGraph } from "./graph.js";
import { serializeDocument } from "./doc.js";

export function computeFactId({ problem_id, predecessors = [], glossary = {}, statement, proof }) {
  return shortHash(canonicalJson({
    problem_id,
    predecessors: [...predecessors].sort(),
    glossary: Object.fromEntries(Object.entries(glossary).sort(([a], [b]) => a.localeCompare(b))),
    statement: normalizeWhitespace(statement),
    proof: normalizeWhitespace(proof)
  }), 20);
}

export function submitVerification(store, input) {
  const findingId = validateObjectId(input.finding_id, "verification.finding_id");
  const finding = store.readFinding(findingId);
  if (!finding) throw new Error(`Finding ${findingId} not found`);
  validateFinding(finding.metadata);
  const record = validateVerification({
    schema: SCHEMAS.verification,
    verification_id: input.verification_id ?? `V-${Date.now()}`,
    finding_id: input.finding_id,
    verdict: input.verdict,
    method: input.method,
    authority: input.authority,
    at: new Date().toISOString(),
    report: input.report ?? "",
    repair_hints: input.repair_hints ?? [],
    evidence_refs: input.evidence_refs ?? []
  });

  if (record.verdict !== "accepted") {
    const metadata = { ...finding.metadata, state: record.verdict === "rejected" ? "refuted" : "challenged", updated_at: record.at };
    validateFinding(metadata);
    store.verification(record);
    store.writeFinding(metadata, finding.sections, { replace: true });
    return { verification: record, fact: null, promoted: false };
  }

  const accepted = new Set(store.workspace.truth_policy?.accepted_methods ?? []);
  if (record.method === "llm_audit" && store.workspace.truth_policy?.allow_llm_audit_as_truth) accepted.add("llm_audit");
  if (!accepted.has(record.method)) {
    const metadata = { ...finding.metadata, state: "supported", updated_at: record.at };
    validateFinding(metadata);
    store.verification(record);
    store.writeFinding(metadata, finding.sections, { replace: true });
    return { verification: record, fact: null, promoted: false, reason: `Verification method ${record.method} is not accepted by workspace truth policy` };
  }

  if (!VERIFIABLE_FINDING_KINDS.has(finding.metadata.kind) && !input.force) {
    throw new Error(`Finding kind ${finding.metadata.kind} is not directly promotable. Use --force only after an explicit human decision.`);
  }

  const predecessors = input.predecessors ?? finding.metadata.predecessors ?? [];
  if (!Array.isArray(predecessors)) throw new Error("Accepted fact predecessors must be an array");
  for (const id of predecessors) validateObjectId(id, "fact.predecessors entry");
  const revoked = new Set(store.revocations().map((item) => item.fact_id));
  for (const id of predecessors) {
    if (!store.hasFact(id)) throw new Error(`Missing predecessor fact ${id}`);
    if (revoked.has(id)) throw new Error(`Predecessor fact ${id} is revoked`);
  }
  const statement = input.statement ?? finding.sections.Statement ?? finding.sections.Claim;
  const proof = input.proof ?? finding.sections.Proof ?? finding.sections.Evidence;
  if (!normalizeWhitespace(statement) || !normalizeWhitespace(proof)) throw new Error("Accepted fact requires a statement and proof/evidence body");
  const problem_id = input.problem_id ?? finding.metadata.problem_id ?? "workspace";
  const glossary = input.glossary ?? finding.metadata.glossary ?? {};
  if (!glossary || typeof glossary !== "object" || Array.isArray(glossary)) throw new Error("Accepted fact glossary must be an object");
  const evidenceRefs = [...new Set([...(finding.metadata.evidence_refs ?? []), ...(record.evidence_refs ?? [])])];
  for (const evidenceId of evidenceRefs) {
    if (!store.readEvidence(evidenceId)) throw new Error(`Missing verification evidence ${evidenceId}`);
  }
  const fact_id = computeFactId({ problem_id, predecessors, glossary, statement, proof });
  const factRecord = validateFact({
    schema: SCHEMAS.fact,
    fact_id,
    problem_id,
    kind: input.fact_kind ?? (finding.metadata.kind === "counterexample" ? "counterexample" : finding.metadata.kind === "computation" ? "verified_computation" : "lemma"),
    title: input.title ?? finding.metadata.title,
    author: input.author ?? finding.metadata.author ?? record.authority,
    predecessors,
    glossary,
    verification: {
      state: "accepted",
      method: record.method,
      authority: record.authority,
      verification_id: record.verification_id,
      at: record.at
    },
    evidence_grade: input.evidence_grade ?? (record.method === "formal" ? "formal" : record.method === "reproduced" ? "reproduced" : "independently_reviewed"),
    resolution: input.resolution ?? "proved",
    provenance: {
      finding_id: finding.metadata.id,
      evidence_refs: evidenceRefs
    },
    external_refs: input.external_refs ?? finding.metadata.external_refs ?? [],
    created_at: record.at
  });
  if (store.hasFact(fact_id)) throw new Error(`Fact ${fact_id} already exists`);
  if (store.hasFinding(fact_id) || store.readEvidence(fact_id)) throw new Error(`Fact ${fact_id} conflicts with an existing object`);
  const producedEdge = validateEdge({ schema: SCHEMAS.edge, from: finding.metadata.id, type: "PRODUCED", to: fact_id, at: record.at });
  const predecessorEdges = predecessors.map((predecessor) => validateEdge({ schema: SCHEMAS.edge, from: fact_id, type: "DEPENDS_ON", to: predecessor, at: record.at }));
  const updatedFinding = validateFinding({ ...finding.metadata, state: "supported", fact_id, updated_at: record.at });
  const factSections = { Statement: statement, Proof: proof, Intuition: input.intuition ?? finding.sections.Intuition ?? "" };
  serializeDocument(factRecord, factSections);
  serializeDocument(updatedFinding, finding.sections);
  store.edges();

  store.verification(record);
  store.writeFact(factRecord, factSections);
  store.addEdge(producedEdge);
  for (const edge of predecessorEdges) store.addEdge(edge);
  store.writeFinding(updatedFinding, finding.sections, { replace: true });
  return { verification: record, fact: factRecord, promoted: true };
}

export function cascadeRevoke(store, factId, reason, authority) {
  if (!store.hasFact(factId)) throw new Error(`Fact ${factId} not found`);
  const graph = buildGraph(store);
  const reverseDependencies = new Map();
  for (const edge of graph.edges) {
    if (edge.type !== "DEPENDS_ON") continue;
    if (!store.hasFact(edge.from)) continue;
    if (!reverseDependencies.has(edge.to)) reverseDependencies.set(edge.to, []);
    reverseDependencies.get(edge.to).push(edge.from);
  }
  const affected = new Set([factId]);
  const queue = [factId];
  while (queue.length) {
    const current = queue.shift();
    for (const child of reverseDependencies.get(current) ?? []) {
      if (affected.has(child)) continue;
      affected.add(child);
      queue.push(child);
    }
  }
  const at = new Date().toISOString();
  const already = new Set(store.revocations().map((item) => item.fact_id));
  for (const id of affected) {
    if (already.has(id)) continue;
    store.revoke({ at, fact_id: id, root_fact_id: factId, reason, authority });
  }
  return [...affected];
}
