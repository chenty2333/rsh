import { SCHEMAS } from "./constants.js";
import { shortHash } from "./canonical.js";
import { serializeDocument } from "./doc.js";
import { validateEdge, validateEvidence, validateFinding, validateJsonSerializable } from "./schema.js";

function now() {
  return new Date().toISOString();
}

function generateId(kind, title) {
  const prefix = {
    problem: "P",
    plan: "PL",
    attempt: "A",
    conjecture: "CJ",
    proof_attempt: "PA",
    counterexample: "C",
    dead_end: "D",
    barrier: "B",
    obstacle: "O",
    direction: "DR",
    open_gap: "G",
    experiment: "X",
    computation: "CP",
    elaboration: "EL",
    guidance: "GD"
  }[kind] ?? "R";
  return `${prefix}-${shortHash(`${title}:${Date.now()}:${Math.random()}`, 10)}`;
}

function objectLayers(store, id) {
  const layers = [];
  if (store.hasFinding(id)) layers.push("finding");
  if (store.hasFact(id)) layers.push("fact");
  if (store.readEvidence(id)) layers.push("evidence");
  return layers;
}

function assertObjectCanBeWritten(store, id, layer, replace) {
  const existing = objectLayers(store, id);
  const conflicts = existing.filter((item) => item !== layer);
  if (conflicts.length > 0) throw new Error(`${layer} ${id} conflicts with existing ${conflicts.join(" and ")}`);
  if (existing.includes(layer) && !replace) throw new Error(`${layer[0].toUpperCase()}${layer.slice(1)} ${id} already exists`);
}

export function applyProposal(store, proposal, options = {}) {
  if (!proposal || typeof proposal !== "object") throw new Error("Proposal must be an object");
  const evidence = (proposal.evidence ?? []).map((item) => validateEvidence({
      schema: SCHEMAS.evidence,
      id: item.id ?? `E-${shortHash(JSON.stringify(item), 12)}`,
      kind: item.kind ?? "note",
      grade: item.grade ?? "self_reported",
      source: item.source ?? {},
      content_hash: item.content_hash ?? null,
      created_at: item.created_at ?? now(),
      ...item
    }));
  const findings = (proposal.findings ?? proposal.objects ?? []).map((item) => {
    if (item.trust === "fact" || item.schema === SCHEMAS.fact) throw new Error("`rsh record` cannot create facts. Use the verification gate.");
    const id = item.id ?? generateId(item.kind, item.title ?? item.claim ?? "finding");
    const record = validateFinding({
      schema: SCHEMAS.finding,
      id,
      kind: item.kind,
      title: item.title ?? item.claim ?? id,
      state: item.state ?? (item.verifiable ? "unverified" : "open"),
      trust: "finding",
      verifiable: item.verifiable ?? ["proof_attempt", "counterexample", "computation"].includes(item.kind),
      author: item.author ?? proposal.author ?? "unknown",
      problem_id: item.problem_id ?? proposal.problem_id ?? "workspace",
      route: item.route ?? null,
      failure: item.failure ?? null,
      outcome: item.outcome ?? null,
      traits: item.traits ?? [],
      preserves: item.preserves ?? [],
      predecessors: item.predecessors ?? [],
      evidence_refs: item.evidence_refs ?? [],
      glossary: item.glossary ?? {},
      external_refs: item.external_refs ?? [],
      created_at: item.created_at ?? now(),
      updated_at: item.updated_at ?? now()
    });
    const sections = item.sections ?? {
      Claim: item.claim ?? item.statement ?? "",
      Evidence: item.evidence ?? "",
      "Failure boundary": item.failure_boundary ?? "",
      "What survives": Array.isArray(item.preserves) ? item.preserves.join("\n") : item.survives ?? "",
      Notes: item.notes ?? ""
    };
    serializeDocument(record, sections);
    return { record, sections };
  });
  const edges = (proposal.edges ?? proposal.relations ?? []).map((item) => validateEdge({
      schema: SCHEMAS.edge,
      from: item.from,
      type: item.type,
      to: item.to,
      at: item.at ?? now(),
      author: item.author ?? proposal.author ?? "unknown",
      provenance: item.provenance ?? null
    }));

  const evidenceIds = new Set();
  for (const record of evidence) {
    if (evidenceIds.has(record.id)) throw new Error(`Duplicate evidence ${record.id} in proposal`);
    evidenceIds.add(record.id);
  }
  const findingIds = new Set();
  for (const { record } of findings) {
    if (findingIds.has(record.id)) throw new Error(`Duplicate finding ${record.id} in proposal`);
    if (evidenceIds.has(record.id)) throw new Error(`Object ID ${record.id} is used by both finding and evidence in proposal`);
    findingIds.add(record.id);
  }

  for (const record of evidence) assertObjectCanBeWritten(store, record.id, "evidence", Boolean(options.replace));
  for (const { record } of findings) assertObjectCanBeWritten(store, record.id, "finding", Boolean(options.replace));

  for (const { record } of findings) {
    for (const evidenceId of record.evidence_refs ?? []) {
      if (!evidenceIds.has(evidenceId) && !store.readEvidence(evidenceId)) {
        throw new Error(`Finding ${record.id} references missing evidence ${evidenceId}`);
      }
    }
    for (const predecessor of record.predecessors ?? []) {
      if (!store.hasFact(predecessor)) throw new Error(`Finding ${record.id} references missing predecessor fact ${predecessor}`);
    }
  }

  const plannedIds = new Set([...evidenceIds, ...findingIds]);
  const existingEdgeKeys = new Set(store.edges().map((edge) => `${edge.from}\t${edge.type}\t${edge.to}`));
  const proposalEdgeKeys = new Set();
  const edgesToWrite = [];
  for (const edge of edges) {
    if (!plannedIds.has(edge.from) && !store.get(edge.from)) throw new Error(`Edge source ${edge.from} does not exist`);
    if (!plannedIds.has(edge.to) && !store.get(edge.to)) throw new Error(`Edge target ${edge.to} does not exist`);
    const key = `${edge.from}\t${edge.type}\t${edge.to}`;
    if (proposalEdgeKeys.has(key)) throw new Error(`Duplicate edge ${edge.from}:${edge.type}:${edge.to} in proposal`);
    proposalEdgeKeys.add(key);
    if (!existingEdgeKeys.has(key)) edgesToWrite.push(edge);
  }

  const written = { findings: [], evidence: [], edges: [] };
  validateJsonSerializable({
    message: proposal.message ?? null,
    findings: findings.map(({ record }) => record.id),
    evidence: evidence.map((record) => record.id),
    edges: edgesToWrite.map((edge) => `${edge.from}:${edge.type}:${edge.to}`)
  }, "proposal event");
  for (const record of evidence) {
    store.writeEvidence(record, { replace: options.replace });
    written.evidence.push(record.id);
  }
  for (const { record, sections } of findings) {
    store.writeFinding(record, sections, { replace: options.replace });
    written.findings.push(record.id);
  }
  for (const edge of edgesToWrite) {
    store.addEdge(edge);
    written.edges.push(`${edge.from}:${edge.type}:${edge.to}`);
  }
  store.event("PROPOSAL_APPLIED", { message: proposal.message ?? null, ...written });
  return written;
}
