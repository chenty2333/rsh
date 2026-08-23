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

export function validateObjectId(id, label = "object id") {
  assert(typeof id === "string" && id.length > 0, `${label} is required`);
  assert(id.length <= 128, `${label} must be at most 128 characters`);
  assert(!id.includes("/") && !id.includes("\\") && !id.includes(".."), `${label} contains an unsafe path sequence`);
  assert(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id), `${label} must start with a letter or number and contain only letters, numbers, dot, underscore, or hyphen`);
  return id;
}

export function validateJsonSerializable(value, label = "record") {
  try {
    JSON.stringify(value);
  } catch (error) {
    throw new Error(`${label} must be JSON-serializable: ${error.message}`);
  }
  return value;
}

function validateObjectIdArray(value, label) {
  assert(isStringArray(value), `${label} must be an array of strings`);
  for (const id of value) validateObjectId(id, `${label} entry`);
}

export function validateRoute(route = {}, label = "route") {
  assert(route && typeof route === "object", `${label} must be an object`);
  for (const key of ["targets", "mechanisms", "assumptions", "exclusions", "implicit_claims"]) {
    if (route[key] !== undefined) assert(isStringArray(route[key]), `${label}.${key} must be an array of strings`);
  }
  if (route.quantifiers !== undefined) {
    assert(route.quantifiers && typeof route.quantifiers === "object" && !Array.isArray(route.quantifiers), `${label}.quantifiers must be an object`);
    for (const value of Object.values(route.quantifiers)) {
      assert(typeof value === "string", `${label}.quantifiers values must be strings`);
    }
  }
  if (route.parameters !== undefined) assert(route.parameters && typeof route.parameters === "object" && !Array.isArray(route.parameters), `${label}.parameters must be an object`);
  return route;
}

export function validateFinding(record) {
  assert(record && typeof record === "object", "finding must be an object");
  assert(record.schema === SCHEMAS.finding, `finding.schema must be ${SCHEMAS.finding}`);
  validateObjectId(record.id, "finding.id");
  assert(FINDING_KINDS.has(record.kind), `Unsupported finding kind: ${record.kind}`);
  assert(typeof record.title === "string" && record.title.length > 0, "finding.title is required");
  assert(FINDING_STATES.has(record.state), `Unsupported finding state: ${record.state}`);
  assert(record.trust === "finding", "finding.trust must be finding");
  if (record.route) validateRoute(record.route, "finding.route");
  if (record.predecessors !== undefined) validateObjectIdArray(record.predecessors, "finding.predecessors");
  if (record.evidence_refs !== undefined) validateObjectIdArray(record.evidence_refs, "finding.evidence_refs");
  validateJsonSerializable(record, "finding");
  return record;
}

export function validateFact(record) {
  assert(record && typeof record === "object", "fact must be an object");
  assert(record.schema === SCHEMAS.fact, `fact.schema must be ${SCHEMAS.fact}`);
  validateObjectId(record.fact_id, "fact.fact_id");
  assert(record.fact_id.length >= 12, "fact.fact_id is required");
  assert(FACT_KINDS.has(record.kind), `Unsupported fact kind: ${record.kind}`);
  assert(typeof record.title === "string" && record.title.length > 0, "fact.title is required");
  validateObjectIdArray(record.predecessors ?? [], "fact.predecessors");
  assert(record.verification && typeof record.verification === "object", "fact.verification is required");
  assert(VERIFICATION_METHODS.has(record.verification.method), `Unsupported verification method: ${record.verification.method}`);
  assert(EVIDENCE_GRADES.has(record.evidence_grade), `Unsupported evidence grade: ${record.evidence_grade}`);
  validateJsonSerializable(record, "fact");
  return record;
}

export function validateEvidence(record) {
  assert(record && typeof record === "object", "evidence must be an object");
  assert(record.schema === SCHEMAS.evidence, `evidence.schema must be ${SCHEMAS.evidence}`);
  validateObjectId(record.id, "evidence.id");
  assert(typeof record.kind === "string" && record.kind.length > 0, "evidence.kind is required");
  assert(EVIDENCE_GRADES.has(record.grade), `Unsupported evidence grade: ${record.grade}`);
  validateJsonSerializable(record, "evidence");
  return record;
}

export function validateEdge(record) {
  assert(record && typeof record === "object", "edge must be an object");
  assert(record.schema === SCHEMAS.edge, `edge.schema must be ${SCHEMAS.edge}`);
  validateObjectId(record.from, "edge.from");
  validateObjectId(record.to, "edge.to");
  assert(EDGE_TYPES.has(record.type), `Unsupported edge type: ${record.type}`);
  validateJsonSerializable(record, "edge");
  return record;
}

export function validateVerification(record) {
  assert(record && typeof record === "object", "verification must be an object");
  assert(record.schema === SCHEMAS.verification, `verification.schema must be ${SCHEMAS.verification}`);
  validateObjectId(record.verification_id, "verification.verification_id");
  validateObjectId(record.finding_id, "verification.finding_id");
  assert(["accepted", "rejected", "inconclusive"].includes(record.verdict), "verification.verdict is invalid");
  assert(VERIFICATION_METHODS.has(record.method), `Unsupported verification method: ${record.method}`);
  assert(typeof record.authority === "string" && record.authority.length > 0, "verification.authority is required");
  if (record.evidence_refs !== undefined) validateObjectIdArray(record.evidence_refs, "verification.evidence_refs");
  validateJsonSerializable(record, "verification");
  return record;
}

export function validateRouteIR(record) {
  assert(record && typeof record === "object" && !Array.isArray(record), "route IR must be a plain object");
  const prototype = Object.getPrototypeOf(record);
  assert(prototype === Object.prototype || prototype === null, "route IR must be a plain object");
  assert(record.schema === SCHEMAS.route, `route.schema must be ${SCHEMAS.route}`);
  const allowed = new Set([
    "schema", "title", "raw_text", "targets", "mechanisms", "assumptions", "exclusions", "implicit_claims",
    "quantifiers", "parameters", "compiler", "provenance"
  ]);
  for (const key of Object.keys(record)) assert(allowed.has(key), `route IR contains unsupported field: ${key}`);
  for (const key of ["targets", "mechanisms", "assumptions", "exclusions", "implicit_claims"]) {
    assert(Object.hasOwn(record, key), `route IR.${key} is required`);
    assert(isStringArray(record[key]), `route IR.${key} must be an array of strings`);
  }
  for (const key of ["title", "raw_text"]) {
    if (record[key] !== undefined) assert(typeof record[key] === "string", `route IR.${key} must be a string`);
  }
  for (const key of ["compiler", "provenance"]) {
    if (record[key] !== undefined) {
      assert(record[key] && typeof record[key] === "object" && !Array.isArray(record[key]), `route IR.${key} must be an object`);
    }
  }
  validateRoute(record);
  validateJsonSerializable(record, "route IR");
  return record;
}
