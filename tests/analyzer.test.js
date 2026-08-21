import test from "node:test";
import assert from "node:assert/strict";
import { tempWorkspace } from "./helpers.js";
import { seedGabidulin } from "../src/core/seed.js";
import { heuristicCompile, loadRouteIR } from "../src/core/route.js";
import { analyzeRoute } from "../src/core/analyzer.js";

test("heuristic compiler recognizes intervening adjectives in actual hard pencil", () => {
  const route = heuristicCompile("For every actual right-coprime ordinary Gabidulin hard pencil with m=n^2, use adaptive slicing to make the exterior kernel constant dimensional.");
  assert.ok(route.assumptions.includes("actual-hard-pencil"));
  assert.ok(route.assumptions.includes("right-coprime"));
  assert.equal(route.quantifiers.scope, "universal");
});

test("actual hard-pencil counterexample blocks matching universal route", () => {
  const { store } = tempWorkspace("blocked");
  seedGabidulin(store);
  const route = loadRouteIR(store.paths.examples + "/blocked-route.json");
  const result = analyzeRoute(store, route);
  assert.equal(result.status, "BLOCKED");
  assert.ok(result.blockers.some((item) => item.counterexample?.id === "C175"));
  assert.deepEqual(result.preserved.map((item) => item.id).sort(), ["T020", "T030", "T040"]);
});

test("explicit obstruction exclusion creates genuine fork", () => {
  const { store } = tempWorkspace("fork");
  seedGabidulin(store);
  const route = loadRouteIR(store.paths.examples + "/fork-route.json");
  const result = analyzeRoute(store, route);
  assert.equal(result.status, "GENUINE_FORK");
  assert.ok(result.forks.some((item) => item.bypassedTraits.includes("subfield-trapped-determinant-image")));
});

test("existential construction is not killed by an existential counterexample to universal claim", () => {
  const { store } = tempWorkspace("existential");
  seedGabidulin(store);
  const route = loadRouteIR(store.paths.examples + "/existential-route.json");
  const result = analyzeRoute(store, route);
  assert.notEqual(result.status, "BLOCKED");
});
