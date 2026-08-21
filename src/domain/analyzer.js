import { difference, isSubset, jaccard, overlap } from "./normalize.js";
import { getNode } from "../data/gabidulin.js";

export const CollisionType = Object.freeze({
  EXACT_DUPLICATE: "EXACT_DUPLICATE",
  DOMINATED_DEADEND: "DOMINATED_DEADEND",
  COUNTEREXAMPLE_APPLIES: "COUNTEREXAMPLE_APPLIES",
  PARTIAL_COLLISION: "PARTIAL_COLLISION",
  GENUINE_FORK: "GENUINE_FORK",
  CLEAR: "CLEAR"
});

const HARD_TYPES = new Set([
  CollisionType.EXACT_DUPLICATE,
  CollisionType.DOMINATED_DEADEND,
  CollisionType.COUNTEREXAMPLE_APPLIES
]);

function routeSimilarity(plan, attempt) {
  const target = jaccard(plan.targets, attempt.target ?? []);
  const mechanism = jaccard(plan.mechanisms, attempt.mechanisms ?? []);
  const assumption = jaccard(plan.assumptions, attempt.assumptions ?? []);
  return Number((0.45 * target + 0.4 * mechanism + 0.15 * assumption).toFixed(3));
}

function exactRoute(plan, attempt) {
  return (
    isSubset(plan.targets, attempt.target ?? []) &&
    isSubset(attempt.target ?? [], plan.targets) &&
    isSubset(plan.mechanisms, attempt.mechanisms ?? []) &&
    isSubset(attempt.mechanisms ?? [], plan.mechanisms) &&
    isSubset(plan.assumptions, attempt.assumptions ?? []) &&
    isSubset(attempt.assumptions ?? [], plan.assumptions)
  );
}

function matchesRequiredTags(plan, failure) {
  return (failure.requiredPlanTags ?? []).every(
    (tag) => plan.assumptions.includes(tag) || plan.mechanisms.includes(tag) || plan.targets.includes(tag)
  );
}

function bypassesFailure(plan, failure) {
  const traitBypass = overlap(plan.exclusions, failure.badTraits ?? []).length > 0;
  const assumptionBypass = overlap(plan.assumptions, failure.escapeAssumptions ?? []).length > 0;
  return traitBypass || assumptionBypass;
}

function compareAttempt(plan, attempt, graph) {
  const similarity = routeSimilarity(plan, attempt);
  const sharedTargets = overlap(plan.targets, attempt.target ?? []);
  const sharedMechanisms = overlap(plan.mechanisms, attempt.mechanisms ?? []);
  if (sharedTargets.length === 0 && sharedMechanisms.length === 0) return null;

  const failure = attempt.failure;
  const addedAssumptions = difference(plan.assumptions, attempt.assumptions ?? []);
  const missingAssumptions = difference(attempt.assumptions ?? [], plan.assumptions);
  const preserved = (attempt.preserves ?? []).map((id) => getNode(graph, id)).filter(Boolean);

  if (!failure) {
    return {
      type: CollisionType.PARTIAL_COLLISION,
      severity: "info",
      similarity,
      attempt,
      summary: "A related route exists, but no recorded blocking result subsumes this plan.",
      addedAssumptions,
      missingAssumptions,
      preserved
    };
  }

  const requiredMatch = matchesRequiredTags(plan, failure);
  const bypassed = bypassesFailure(plan, failure);
  const counterexample = getNode(graph, failure.counterexampleId);

  if (requiredMatch && bypassed) {
    return {
      type: CollisionType.GENUINE_FORK,
      severity: "frontier",
      similarity,
      attempt,
      counterexample,
      summary: "The new route explicitly excludes the recorded obstruction. This is a genuine fork, not a replay.",
      addedAssumptions,
      missingAssumptions,
      escapeUsed: overlap(plan.assumptions, failure.escapeAssumptions ?? []).concat(overlap(plan.exclusions, failure.badTraits ?? [])),
      frontier: failure.frontier,
      preserved
    };
  }

  if (requiredMatch && !bypassed) {
    const exact = exactRoute(plan, attempt);
    const hasOnlyExtraAssumptions = missingAssumptions.length === 0 && addedAssumptions.length > 0;
    let type = CollisionType.COUNTEREXAMPLE_APPLIES;
    if (exact) type = CollisionType.EXACT_DUPLICATE;
    else if (hasOnlyExtraAssumptions) type = CollisionType.DOMINATED_DEADEND;

    return {
      type,
      severity: "blocker",
      similarity,
      attempt,
      counterexample,
      summary: hasOnlyExtraAssumptions
        ? "The prior counterexample still applies. Extra assumptions do not help unless they exclude its bad trait."
        : "A recorded counterexample satisfies the route's operative scope and blocks the plan as stated.",
      addedAssumptions,
      missingAssumptions,
      escapeConditions: failure.escapeAssumptions ?? [],
      blockedTraits: failure.badTraits ?? [],
      frontier: failure.frontier,
      preserved
    };
  }

  return {
    type: CollisionType.PARTIAL_COLLISION,
    severity: "warning",
    similarity,
    attempt,
    counterexample,
    summary: "The route shares a target or mechanism with a failed attempt, but the recorded no-go does not currently subsume its scope.",
    addedAssumptions,
    missingAssumptions,
    preserved
  };
}

export function analyzePlan(plan, graph) {
  const attempts = graph.nodes.filter((node) => node.type === "attempt");
  const findings = attempts
    .map((attempt) => compareAttempt(plan, attempt, graph))
    .filter(Boolean)
    .sort((a, b) => {
      const severityRank = { blocker: 3, frontier: 2, warning: 1, info: 0 };
      return severityRank[b.severity] - severityRank[a.severity] || b.similarity - a.similarity;
    });

  const blockers = findings.filter((finding) => HARD_TYPES.has(finding.type));
  const forks = findings.filter((finding) => finding.type === CollisionType.GENUINE_FORK);
  const warnings = findings.filter((finding) => finding.type === CollisionType.PARTIAL_COLLISION);
  let status = "CLEAR";
  if (blockers.length > 0) status = "BLOCKED";
  else if (forks.length > 0) status = "CLEAR_WITH_FRONTIER";
  else if (warnings.length > 0) status = "CAUTION";

  const preservedMap = new Map();
  for (const finding of findings) {
    for (const node of finding.preserved ?? []) preservedMap.set(node.id, node);
  }

  return {
    status,
    findings,
    blockers,
    forks,
    warnings,
    preservedClaims: [...preservedMap.values()],
    escapeConditions: [...new Set(blockers.flatMap((finding) => finding.escapeConditions ?? []))],
    generatedAt: new Date().toISOString()
  };
}

export function commitProposal(plan, analysis) {
  return {
    type: "PLAN_CHECK",
    title: plan.title,
    route: {
      target: plan.targets,
      mechanisms: plan.mechanisms,
      assumptions: plan.assumptions,
      exclusions: plan.exclusions,
      quantifiers: plan.quantifiers,
      parameters: plan.parameters
    },
    outcome: analysis.status,
    collisions: analysis.findings.map((finding) => ({
      type: finding.type,
      attempt: finding.attempt.id,
      counterexample: finding.counterexample?.id ?? null,
      frontier: finding.frontier ?? null
    })),
    preserves: analysis.preservedClaims.map((node) => node.id),
    evidence: "routecheck-rule-engine-v0.1"
  };
}
