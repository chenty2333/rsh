import test from "node:test";
import assert from "node:assert/strict";
import { compilePlan } from "../src/domain/compiler.js";
import { analyzePlan, CollisionType } from "../src/domain/analyzer.js";
import { researchGraph } from "../src/data/gabidulin.js";

const blockedPlan = `Use a polynomial-size adaptive slice family to make the exterior kernel constant-dimensional for every actual right-coprime ordinary Gabidulin hard pencil when m=n^2. There exists at least one good slice.`;

test("compiles the operative route, quantifiers, and parameter regime", () => {
  const plan = compilePlan(blockedPlan);
  assert.ok(plan.targets.includes("constant-exterior-kernel"));
  assert.ok(plan.mechanisms.includes("adaptive-slicing"));
  assert.ok(plan.assumptions.includes("actual-hard-pencil"));
  assert.ok(plan.assumptions.includes("right-coprime"));
  assert.equal(plan.parameters.extensionDegree, "n^2");
  assert.equal(plan.quantifiers.scope, "universal");
});

test("blocks a plan when the actual-hard-pencil counterexample applies", () => {
  const result = analyzePlan(compilePlan(blockedPlan), researchGraph);
  assert.equal(result.status, "BLOCKED");
  const finding = result.findings.find((item) => item.attempt.id === "A174");
  assert.ok(finding);
  assert.ok([CollisionType.COUNTEREXAMPLE_APPLIES, CollisionType.DOMINATED_DEADEND, CollisionType.EXACT_DUPLICATE].includes(finding.type));
  assert.equal(finding.counterexample.id, "C175");
});

test("an unrelated added assumption does not bypass the counterexample", () => {
  const plan = compilePlan(`${blockedPlan} Assume characteristic 2.`);
  const result = analyzePlan(plan, researchGraph);
  assert.equal(result.status, "BLOCKED");
  const finding = result.findings.find((item) => item.attempt.id === "A174");
  assert.equal(finding.type, CollisionType.DOMINATED_DEADEND);
  assert.ok(finding.addedAssumptions.includes("characteristic-two"));
});

test("an explicit exterior-expansion exclusion creates a genuine fork", () => {
  const plan = compilePlan(`${blockedPlan} Assume evaluation-space exterior expansion that excludes subfield-trapped determinant images.`);
  const result = analyzePlan(plan, researchGraph);
  assert.equal(result.status, "CLEAR_WITH_FRONTIER");
  const finding = result.findings.find((item) => item.attempt.id === "A174");
  assert.equal(finding.type, CollisionType.GENUINE_FORK);
});

test("the semilinear width-one route collides with Frobenius-support growth", () => {
  const plan = compilePlan(`Recover all candidates for an actual ordinary Gabidulin hard pencil with polynomial extension degree by marked-factor right divisibility and a single width-one semilinear eigenproblem.`);
  const result = analyzePlan(plan, researchGraph);
  assert.equal(result.status, "BLOCKED");
  const finding = result.findings.find((item) => item.attempt.id === "A180");
  assert.equal(finding.counterexample.id, "B181");
});

test("a failed child branch preserves the fixed-r theorem chain", () => {
  const result = analyzePlan(compilePlan(blockedPlan), researchGraph);
  const ids = result.preservedClaims.map((node) => node.id);
  assert.deepEqual(ids.sort(), ["T020", "T030", "T040"]);
});
