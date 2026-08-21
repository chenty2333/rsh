import {
  EDGE_TYPES,
  EVIDENCE_GRADES,
  FACT_KINDS,
  FINDING_KINDS,
  FINDING_STATES,
  SCHEMAS,
  VERIFICATION_METHODS
} from "./constants.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function validateRoute(route = {}, label = "route") {
  assert(route && typeof route === "object", `${label} must be an object`);
  for (const key of ["targets", "mechanisms", "assumptions", "exclusions", "implicit_claims"]) {
    if (route[key] !== undefined) assert(isStringArray(route[key]), `${label}.${key} must be an array of strings`);
  }
  if (route.quantifiers !== undefined) {
    assert(route.quantifiers && typeof route.quantifiers === "object", `${label}.quantifiers must be an object`);
    for (const value of Object.values(route.quantifiers)) {
      assert(typeof value === "string", `${label}.quantifiers values must be strings`);
    }
  }
  if (route.parameters !== undefined) assert(route.parameters && typeof route.parameters === "object", `${label}.parameters must be an object`);
  return route;
}

export function validateFinding(record) {
  assert(record && typeof record === "object", "finding must be an object");
  assert(record.schema === SCHEMAS.finding, `finding.schema must be ${SCHEMAS.finding}`);
  assert(typeof record.id === "string" && record.id.length > 0, "finding.id is required");
  assert(FINDING_KINDS.has(record.kind), `Unsupported finding kind: ${record.kind}`);
  assert(typeof record.title === "string" && record.title.length > 0, "finding.title is required");
  assert(FINDING_STATES.has(record.state), `Unsupported finding state: ${record.state}`);
  assert(record.trust === "finding", "finding.trust must be finding");
  if (record.route) validateRoute(record.route, "finding.route");
  if (record.evidence_refs !== undefined) assert(isStringArray(record.evidence_refs), "finding.evidence_refs must be an array of strings");
  return record;
}

export function validateFact(record) {
  assert(record && typeof record === "object", "fact must be an object");
  assert(record.schema === SCHEMAS.fact, `fact.schema must be ${SCHEMAS.fact}`);
  assert(typeof record.fact_id === "string" && record.fact_id.length >= 12, "fact.fact_id is required");
  assert(FACT_KINDS.has(record.kind), `Unsupported fact kind: ${record.kind}`);
  assert(typeof record.title === "string" && record.title.length > 0, "fact.title is required");
  assert(isStringArray(record.predecessors ?? []), "fact.predecessors must be an array of strings");
  assert(record.verification && typeof record.verification === "object", "fact.verification is required");
  assert(VERIFICATION_METHODS.has(record.verification.method), `Unsupported verification method: ${record.verification.method}`);
  assert(EVIDENCE_GRADES.has(record.evidence_grade), `Unsupported evidence grade: ${record.evidence_grade}`);
  return record;
}

export function validateEvidence(record) {
  assert(record && typeof record === "object", "evidence must be an object");
  assert(record.schema === SCHEMAS.evidence, `evidence.schema must be ${SCHEMAS.evidence}`);
  assert(typeof record.id === "string" && record.id.length > 0, "evidence.id is required");
  assert(typeof record.kind === "string" && record.kind.length > 0, "evidence.kind is required");
  assert(EVIDENCE_GRADES.has(record.grade), `Unsupported evidence grade: ${record.grade}`);
  return record;
}

export function validateEdge(record) {
  assert(record && typeof record === "object", "edge must be an object");
  assert(record.schema === SCHEMAS.edge, `edge.schema must be ${SCHEMAS.edge}`);
  assert(typeof record.from === "string" && record.from.length > 0, "edge.from is required");
  assert(typeof record.to === "string" && record.to.length > 0, "edge.to is required");
  assert(EDGE_TYPES.has(record.type), `Unsupported edge type: ${record.type}`);
  return record;
}

export function validateVerification(record) {
  assert(record && typeof record === "object", "verification must be an object");
  assert(record.schema === SCHEMAS.verification, `verification.schema must be ${SCHEMAS.verification}`);
  assert(typeof record.finding_id === "string", "verification.finding_id is required");
  assert(["accepted", "rejected", "inconclusive"].includes(record.verdict), "verification.verdict is invalid");
  assert(VERIFICATION_METHODS.has(record.method), `Unsupported verification method: ${record.method}`);
  assert(typeof record.authority === "string" && record.authority.length > 0, "verification.authority is required");
  return record;
}

export function validateRouteIR(record) {
  assert(record && typeof record === "object", "route IR must be an object");
  if (record.schema !== undefined) assert(record.schema === SCHEMAS.route, `route.schema must be ${SCHEMAS.route}`);
  validateRoute(record);
  return record;
}
