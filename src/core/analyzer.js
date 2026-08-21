import { COLLISION_TYPES } from "./constants.js";
import { buildGraph, relationClosure } from "./graph.js";

function set(values = []) {
  return new Set(values);
}

function intersection(a, b) {
  const right = set(b);
  return [...set(a)].filter((value) => right.has(value));
}

function difference(a, b) {
  const right = set(b);
  return [...set(a)].filter((value) => !right.has(value));
}

function jaccard(a, b) {
  const left = set(a);
  const right = set(b);
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  return intersection([...left], [...right]).length / union.size;
}

function assumptionClosure(graph, assumptions) {
  return relationClosure(graph, assumptions, new Set(["IMPLIES_ASSUMPTION"]));
}

function explicitExclusions(graph, plan) {
  const exclusions = new Set(plan.exclusions ?? []);
  const assumptions = new Set(plan.assumptions ?? []);
  for (const edge of graph.edges) {
    if (edge.type === "EXCLUDES_TRAIT" && assumptions.has(edge.from)) exclusions.add(edge.to);
    if (edge.type === "INCOMPATIBLE_WITH" && assumptions.has(edge.from)) exclusions.add(edge.to);
  }
  return exclusions;
}

function parameterContains(planValue, exampleValue) {
  if (planValue === undefined) return true;
  if (exampleValue === undefined) return false;
  if (typeof planValue !== "object" || typeof exampleValue !== "object") return JSON.stringify(planValue) === JSON.stringify(exampleValue);
  if (planValue.relation === "eq") return exampleValue.relation === "eq" && String(planValue.value) === String(exampleValue.value);
  if (planValue.relation === "class" && planValue.value === "poly(n)") {
    return exampleValue.value === "poly(n)" || /^n(?:\^\d+)?$/.test(String(exampleValue.value));
  }
  return JSON.stringify(planValue) === JSON.stringify(exampleValue);
}

function quantifierApplicability(plan, counterexample) {
  const scope = plan.quantifiers?.scope ?? "unspecified";
  const ceScope = counterexample.route?.quantifiers?.scope ?? counterexample.quantifiers?.scope ?? "existential";
  if (scope === "universal" && ["existential", "witness", "unspecified"].includes(ceScope)) return "refutes";
  if (scope === "existential") return "does_not_refute";
  return "unknown";
}

function routeSimilarity(plan, attempt) {
  return Number((0.42 * jaccard(plan.targets, attempt.route?.targets) + 0.42 * jaccard(plan.mechanisms, attempt.route?.mechanisms) + 0.16 * jaccard(plan.assumptions, attempt.route?.assumptions)).toFixed(3));
}

function exactRoute(plan, attempt) {
  for (const key of ["targets", "mechanisms", "assumptions", "exclusions"]) {
    const a = [...set(plan[key])].sort();
    const b = [...set(attempt.route?.[key])].sort();
    if (JSON.stringify(a) !== JSON.stringify(b)) return false;
  }
  return true;
}

function getFailure(attempt, graph) {
  const outcome = attempt.failure ?? attempt.outcome;
  const ref = outcome?.counterexample_ref ?? outcome?.ref ?? attempt.counterexample_ref;
  if (ref) return { counterexample: graph.nodes.get(ref), outcome };
  const incoming = graph.incoming.get(attempt.id) ?? [];
  const edge = incoming.find((item) => ["REFUTES", "COUNTEREXAMPLE_TO", "BLOCKS"].includes(item.type));
  return edge ? { counterexample: graph.nodes.get(edge.from), outcome: { ref: edge.from } } : { counterexample: null, outcome };
}

function preservedNodes(attempt, graph) {
  const ids = new Set(attempt.preserves ?? []);
  for (const edge of graph.out.get(attempt.id) ?? []) if (edge.type === "PRESERVES") ids.add(edge.to);
  return [...ids].map((id) => graph.nodes.get(id)).filter(Boolean);
}

function compareAttempt(plan, attempt, graph) {
  const sharedTargets = intersection(plan.targets, attempt.route?.targets);
  const sharedMechanisms = intersection(plan.mechanisms, attempt.route?.mechanisms);
  if (sharedTargets.length === 0 && sharedMechanisms.length === 0) return null;
  const similarity = routeSimilarity(plan, attempt);
  const { counterexample, outcome } = getFailure(attempt, graph);
  const preserved = preservedNodes(attempt, graph);
  if (!counterexample || !["refuted", "blocked", "refuted_generically"].includes(attempt.state)) {
    return {
      type: COLLISION_TYPES.RELATED,
      severity: "info",
      similarity,
      attempt,
      summary: "A related route exists, but no recorded blocking result currently subsumes this plan.",
      preserved
    };
  }

  const planAssumptions = assumptionClosure(graph, plan.assumptions ?? []);
  const ceTraits = assumptionClosure(graph, [...(counterexample.route?.assumptions ?? []), ...(counterexample.traits ?? [])]);
  const exclusions = explicitExclusions(graph, plan);
  const missingOnCounterexample = [...planAssumptions].filter((item) => !ceTraits.has(item));
  const blockedTraits = counterexample.traits ?? outcome?.bad_traits ?? [];
  const bypassedTraits = blockedTraits.filter((trait) => exclusions.has(trait));
  const allParametersApply = Object.entries(plan.parameters ?? {}).every(([key, value]) => parameterContains(value, counterexample.route?.parameters?.[key] ?? counterexample.parameters?.[key]));
  const quantifier = quantifierApplicability(plan, counterexample);
  const applicable = missingOnCounterexample.length === 0 && bypassedTraits.length === 0 && allParametersApply && quantifier === "refutes";
  const bypassed = bypassedTraits.length > 0;
  const escapeConditions = outcome?.escape_conditions ?? attempt.failure?.escapeAssumptions ?? [];
  const frontier = outcome?.frontier ?? attempt.failure?.frontier ?? null;

  if (bypassed) {
    return {
      type: COLLISION_TYPES.GENUINE_FORK,
      severity: "frontier",
      similarity,
      attempt,
      counterexample,
      summary: "The plan explicitly excludes a recorded obstruction. This is a genuine fork with a new proof obligation.",
      bypassedTraits,
      escapeConditions,
      frontier,
      preserved,
      proofTrace: { quantifier, missingOnCounterexample, bypassedTraits, allParametersApply }
    };
  }

  if (applicable) {
    const addedAssumptions = difference(plan.assumptions, attempt.route?.assumptions);
    const type = exactRoute(plan, attempt)
      ? COLLISION_TYPES.EXACT_DUPLICATE
      : addedAssumptions.length > 0
        ? COLLISION_TYPES.DOMINATED_DEADEND
        : COLLISION_TYPES.COUNTEREXAMPLE_APPLIES;
    return {
      type,
      severity: "blocker",
      similarity,
      attempt,
      counterexample,
      summary: "A recorded counterexample lies inside the proposed route's operative scope and blocks its universal claim.",
      escapeConditions,
      frontier,
      preserved,
      proofTrace: { quantifier, matchedAssumptions: [...planAssumptions], missingOnCounterexample, blockedTraits, allParametersApply }
    };
  }

  return {
    type: COLLISION_TYPES.PARTIAL_COLLISION,
    severity: "warning",
    similarity,
    attempt,
    counterexample,
    summary: quantifier === "does_not_refute"
      ? "The old counterexample refutes a universal claim, but the new plan is existential."
      : missingOnCounterexample.length
        ? "The route adds assumptions whose applicability to the old counterexample is not recorded. This is not yet a genuine fork."
        : "The old no-go is related, but its parameter or quantifier scope does not currently subsume the new plan.",
    escapeConditions,
    frontier,
    preserved,
    proofTrace: { quantifier, missingOnCounterexample, bypassedTraits, allParametersApply }
  };
}

export function analyzeRoute(store, plan) {
  const graph = buildGraph(store);
  const attempts = [...graph.nodes.values()].filter((node) => node.layer === "exploration" && ["attempt", "plan", "proof_attempt"].includes(node.kind));
  const findings = attempts.map((attempt) => compareAttempt(plan, attempt, graph)).filter(Boolean).sort((a, b) => {
    const order = { blocker: 4, frontier: 3, warning: 2, info: 1 };
    return order[b.severity] - order[a.severity] || b.similarity - a.similarity;
  });
  const blockers = findings.filter((item) => [COLLISION_TYPES.EXACT_DUPLICATE, COLLISION_TYPES.DOMINATED_DEADEND, COLLISION_TYPES.COUNTEREXAMPLE_APPLIES].includes(item.type));
  const forks = findings.filter((item) => item.type === COLLISION_TYPES.GENUINE_FORK);
  const warnings = findings.filter((item) => item.type === COLLISION_TYPES.PARTIAL_COLLISION);
  const preserved = new Map();
  for (const item of findings) for (const node of item.preserved ?? []) preserved.set(node.id ?? node.fact_id, node);
  let status = "CLEAR";
  if (blockers.length) status = "BLOCKED";
  else if (forks.length) status = "GENUINE_FORK";
  else if (warnings.length) status = "CAUTION";
  else if (findings.length) status = "RELATED";
  return {
    status,
    findings,
    blockers,
    forks,
    warnings,
    preserved: [...preserved.values()],
    escape_conditions: [...new Set(blockers.flatMap((item) => item.escapeConditions ?? []))],
    generated_at: new Date().toISOString()
  };
}
