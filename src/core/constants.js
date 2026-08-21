export const SCHEMAS = Object.freeze({
  workspace: "rsh.workspace.v1",
  finding: "rsh.finding.v1",
  fact: "rsh.fact.v1",
  evidence: "rsh.evidence.v1",
  edge: "rsh.edge.v1",
  verification: "rsh.verification.v1",
  route: "rsh.route.v1"
});

export const FINDING_KINDS = new Set([
  "problem",
  "plan",
  "attempt",
  "conjecture",
  "proof_attempt",
  "counterexample",
  "dead_end",
  "barrier",
  "obstacle",
  "direction",
  "open_gap",
  "experiment",
  "computation",
  "elaboration",
  "guidance"
]);

export const VERIFIABLE_FINDING_KINDS = new Set([
  "proof_attempt",
  "counterexample",
  "computation"
]);

export const FACT_KINDS = new Set([
  "lemma",
  "theorem",
  "counterexample",
  "verified_computation",
  "definition",
  "proposition",
  "corollary"
]);

export const EDGE_TYPES = new Set([
  "DEPENDS_ON",
  "IMPLIES",
  "PRODUCED",
  "ATTEMPTS",
  "REFUTES",
  "COUNTEREXAMPLE_TO",
  "BLOCKS",
  "BYPASSES",
  "PRESERVES",
  "SUPERSEDES",
  "GENERALIZES",
  "SPECIALIZES",
  "SAME_ROUTE_AS",
  "REVEALS_GAP",
  "REQUIRES_ASSUMPTION",
  "EXCLUDES_TRAIT",
  "IMPLIES_ASSUMPTION",
  "INCOMPATIBLE_WITH",
  "SUPPORTED_BY",
  "EVIDENCE_FOR",
  "CHALLENGES"
]);

export const FINDING_STATES = new Set([
  "open",
  "unverified",
  "verifying",
  "supported",
  "challenged",
  "refuted",
  "superseded",
  "closed"
]);

export const EVIDENCE_GRADES = new Set([
  "self_reported",
  "argument",
  "executable",
  "reproduced",
  "independently_reviewed",
  "formal"
]);

export const VERIFICATION_METHODS = new Set([
  "human_review",
  "llm_audit",
  "reproduced",
  "formal",
  "imported_verified"
]);

export const COLLISION_TYPES = Object.freeze({
  EXACT_DUPLICATE: "EXACT_DUPLICATE",
  DOMINATED_DEADEND: "DOMINATED_DEADEND",
  COUNTEREXAMPLE_APPLIES: "COUNTEREXAMPLE_APPLIES",
  PARTIAL_COLLISION: "PARTIAL_COLLISION",
  GENUINE_FORK: "GENUINE_FORK",
  RELATED: "RELATED",
  CLEAR: "CLEAR",
  UNKNOWN: "UNKNOWN"
});
