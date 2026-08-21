import { SCHEMAS } from "./constants.js";
import { shortHash } from "./canonical.js";
import { validateEdge, validateEvidence, validateFinding } from "./schema.js";

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

export function applyProposal(store, proposal, options = {}) {
  if (!proposal || typeof proposal !== "object") throw new Error("Proposal must be an object");
  const written = { findings: [], evidence: [], edges: [] };
  for (const item of proposal.evidence ?? []) {
    const record = validateEvidence({
      schema: SCHEMAS.evidence,
      id: item.id ?? `E-${shortHash(JSON.stringify(item), 12)}`,
      kind: item.kind ?? "note",
      grade: item.grade ?? "self_reported",
      source: item.source ?? {},
      content_hash: item.content_hash ?? null,
      created_at: item.created_at ?? now(),
      ...item
    });
    store.writeEvidence(record, { replace: options.replace });
    written.evidence.push(record.id);
  }
  for (const item of proposal.findings ?? proposal.objects ?? []) {
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
    store.writeFinding(record, sections, { replace: options.replace });
    written.findings.push(id);
  }
  for (const item of proposal.edges ?? proposal.relations ?? []) {
    const edge = validateEdge({
      schema: SCHEMAS.edge,
      from: item.from,
      type: item.type,
      to: item.to,
      at: item.at ?? now(),
      author: item.author ?? proposal.author ?? "unknown",
      provenance: item.provenance ?? null
    });
    if (!store.get(edge.from) && !written.findings.includes(edge.from)) throw new Error(`Edge source ${edge.from} does not exist`);
    if (!store.get(edge.to) && !written.findings.includes(edge.to)) throw new Error(`Edge target ${edge.to} does not exist`);
    if (store.addEdge(edge)) written.edges.push(`${edge.from}:${edge.type}:${edge.to}`);
  }
  store.event("PROPOSAL_APPLIED", { message: proposal.message ?? null, ...written });
  return written;
}
