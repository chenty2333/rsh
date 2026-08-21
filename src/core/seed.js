import fs from "node:fs";
import path from "node:path";
import { SCHEMAS } from "./constants.js";
import { applyProposal } from "./record.js";
import { writeJsonAtomic } from "./fs.js";

export function seedGabidulin(store) {
  const at = new Date().toISOString();
  const findings = [
    {
      id: "P001", kind: "problem", title: "Efficient complete beyond-unique decoding", state: "open", verifiable: false,
      claim: "Recover every nearby ordinary Gabidulin codeword in polynomial time.", problem_id: "gabidulin"
    },
    {
      id: "T020", kind: "proof_attempt", title: "Rank-2 exterior decoder", state: "supported", verifiable: true,
      claim: "[n,n-3,4], radius 2 fixed-r branch ancestor.", evidence: "Internal argument and computations; not promoted to workspace truth by this seed.", problem_id: "gabidulin"
    },
    {
      id: "T030", kind: "proof_attempt", title: "Rank-3 LLD decoder", state: "supported", verifiable: true,
      claim: "Controls a genuine alternating/LLD degeneration.", evidence: "Internal argument and binary checks; not promoted to truth by this seed.", problem_id: "gabidulin"
    },
    {
      id: "T040", kind: "proof_attempt", title: "Fixed-r exterior/LLD hierarchy", state: "supported", verifiable: true,
      claim: "One-step-beyond-unique hierarchy for every fixed r.", evidence: "Provisional research state.", problem_id: "gabidulin"
    },
    {
      id: "A174", kind: "attempt", title: "Uniform slice regularity", state: "refuted", verifiable: false,
      claim: "Every genuine hard pencil admits a polynomially enumerable good slice.", problem_id: "gabidulin",
      route: {
        targets: ["constant-exterior-kernel", "poly-m-one-step"],
        mechanisms: ["adaptive-slicing", "exterior-linearization"],
        assumptions: ["ordinary-gabidulin", "actual-hard-pencil", "right-coprime", "polynomial-extension", "m=n^2"],
        exclusions: [], implicit_claims: [], quantifiers: { scope: "universal", witness: "existential" },
        parameters: { extension_degree: { relation: "eq", value: "n^2" } }
      },
      failure: {
        counterexample_ref: "C175",
        bad_traits: ["subfield-trapped-determinant-image"],
        escape_conditions: ["evaluation-space-exterior-expansion"],
        frontier: "Prove exterior expansion for a restricted evaluation-space family."
      },
      preserves: ["T020", "T030", "T040"]
    },
    {
      id: "C175", kind: "counterexample", title: "Subfield-trapped actual hard pencil", state: "supported", verifiable: true,
      claim: "A genuine coprime hard pencil with m=n² has Ω(n²)-dimensional exterior kernel on every legal slice.",
      evidence: "Symbolic family plus dimension lower bound.", problem_id: "gabidulin",
      route: {
        targets: [], mechanisms: [],
        assumptions: ["ordinary-gabidulin", "actual-hard-pencil", "right-coprime", "polynomial-extension", "m=n^2", "characteristic-two"],
        exclusions: [], implicit_claims: [], quantifiers: { scope: "existential", witness: "witness" },
        parameters: { extension_degree: { relation: "eq", value: "n^2" } }
      },
      traits: ["subfield-trapped-determinant-image"]
    },
    {
      id: "G176", kind: "open_gap", title: "Evaluation-space exterior expansion", state: "open", verifiable: false,
      claim: "Construct non-subfield-type evaluation spaces with aggregate exterior-list-MRD.", problem_id: "gabidulin"
    },
    {
      id: "A180", kind: "attempt", title: "Width-one semilinear state compression", state: "refuted", verifiable: false,
      claim: "Reduce the one-parameter Ore pencil to one Frobenius eigenproblem.", problem_id: "gabidulin",
      route: {
        targets: ["candidate-extraction", "poly-m-one-step"], mechanisms: ["semilinear-width-one", "marked-factor"],
        assumptions: ["ordinary-gabidulin", "actual-hard-pencil", "polynomial-extension"], exclusions: [], implicit_claims: [],
        quantifiers: { scope: "universal", witness: "existential" }, parameters: { extension_degree: { relation: "class", value: "poly(n)" } }
      },
      failure: {
        counterexample_ref: "B181", bad_traits: ["frobenius-support-growth"], escape_conditions: ["bounded-frobenius-width"],
        frontier: "Identify a bounded-Frobenius-width stratum or use marked-factor algebra."
      }, preserves: ["T020", "T030", "T040"]
    },
    {
      id: "B181", kind: "barrier", title: "Frobenius-support growth", state: "supported", verifiable: false,
      claim: "Skew division generates mixed Frobenius monomials; K-linear conjugacy cannot collapse generic support to width one.",
      problem_id: "gabidulin", traits: ["frobenius-support-growth"],
      route: { targets: [], mechanisms: [], assumptions: ["ordinary-gabidulin", "actual-hard-pencil", "polynomial-extension"], exclusions: [], implicit_claims: [], quantifiers: { scope: "existential", witness: "witness" }, parameters: {} }
    },
    {
      id: "A190", kind: "attempt", title: "Small list implies thin near-heavy spectrum", state: "refuted", verifiable: false,
      claim: "Infer an FPT near-heavy tail from at most two maximum-heavy points.", problem_id: "gabidulin",
      route: { targets: ["thin-near-heavy-spectrum", "candidate-extraction"], mechanisms: ["near-heavy-filtering", "random-slicing"], assumptions: ["small-final-list"], exclusions: [], implicit_claims: [], quantifiers: { scope: "universal", witness: "unspecified" }, parameters: {} },
      failure: { counterexample_ref: "C191", bad_traits: ["generic-linear-set-counterexamples"], escape_conditions: ["moore-specific-spectrum"], frontier: "Prove a Moore-specific projective near-kernel spectrum theorem." },
      preserves: ["T020", "T030", "T040"]
    },
    {
      id: "C191", kind: "counterexample", title: "Two max-heavy points with an exponential near-heavy layer", state: "supported", verifiable: true,
      claim: "Generic linear-set constructions separate a small final list from a thin deficit-one spectrum.", evidence: "Explicit finite-geometric family.", problem_id: "gabidulin",
      route: { targets: [], mechanisms: [], assumptions: ["small-final-list"], exclusions: [], implicit_claims: [], quantifiers: { scope: "existential", witness: "witness" }, parameters: {} },
      traits: ["generic-linear-set-counterexamples"]
    },
    {
      id: "G200", kind: "open_gap", title: "Marked-factor heavy-point extraction", state: "open", verifiable: false,
      claim: "Find heavy parameters in a code-derived two-generator rank-metric pencil in poly(n,m).", problem_id: "gabidulin"
    }
  ];
  const edges = [
    ["P001", "PRODUCED", "T020"], ["T020", "GENERALIZES", "T030"], ["T030", "GENERALIZES", "T040"],
    ["P001", "ATTEMPTS", "A174"], ["C175", "REFUTES", "A174"], ["A174", "REVEALS_GAP", "G176"],
    ["A174", "PRESERVES", "T020"], ["A174", "PRESERVES", "T030"], ["A174", "PRESERVES", "T040"],
    ["evaluation-space-exterior-expansion", "EXCLUDES_TRAIT", "subfield-trapped-determinant-image"],
    ["B181", "BLOCKS", "A180"], ["A180", "REVEALS_GAP", "G200"], ["C191", "REFUTES", "A190"], ["A190", "REVEALS_GAP", "G200"]
  ];
  // Assumption and trait nodes make the analyzer's logic explicit and inspectable.
  findings.push(
    { id: "evaluation-space-exterior-expansion", kind: "conjecture", title: "Evaluation-space exterior expansion", state: "open", verifiable: false, claim: "An assumption intended to exclude subfield-trapped determinant images.", problem_id: "gabidulin" },
    { id: "subfield-trapped-determinant-image", kind: "obstacle", title: "Subfield-trapped determinant image", state: "supported", verifiable: false, claim: "The determinant image remains in a low-dimensional subfield.", problem_id: "gabidulin" }
  );
  const proposal = {
    message: "Seed the Gabidulin preflight benchmark",
    author: "rsh-seed",
    problem_id: "gabidulin",
    findings,
    edges: edges.map(([from, type, to]) => ({ from, type, to, at }))
  };
  const result = applyProposal(store, proposal);
  writeJsonAtomic(path.join(store.paths.examples, "blocked-route.json"), {
    schema: SCHEMAS.route,
    title: "Blocked universal slice route",
    targets: ["constant-exterior-kernel", "poly-m-one-step"],
    mechanisms: ["adaptive-slicing", "exterior-linearization"],
    assumptions: ["ordinary-gabidulin", "actual-hard-pencil", "right-coprime", "polynomial-extension", "m=n^2"],
    exclusions: [], implicit_claims: [], quantifiers: { scope: "universal", witness: "existential" },
    parameters: { extension_degree: { relation: "eq", value: "n^2" } }
  });
  writeJsonAtomic(path.join(store.paths.examples, "fork-route.json"), {
    schema: SCHEMAS.route,
    title: "Genuine exterior-expansion fork",
    targets: ["constant-exterior-kernel", "poly-m-one-step"], mechanisms: ["adaptive-slicing", "exterior-linearization"],
    assumptions: ["ordinary-gabidulin", "actual-hard-pencil", "right-coprime", "polynomial-extension", "m=n^2", "evaluation-space-exterior-expansion"],
    exclusions: ["subfield-trapped-determinant-image"], implicit_claims: [], quantifiers: { scope: "universal", witness: "existential" },
    parameters: { extension_degree: { relation: "eq", value: "n^2" } }
  });
  writeJsonAtomic(path.join(store.paths.examples, "existential-route.json"), {
    schema: SCHEMAS.route,
    title: "Existential construction route",
    targets: ["constant-exterior-kernel", "poly-m-one-step"], mechanisms: ["adaptive-slicing"],
    assumptions: ["ordinary-gabidulin", "polynomial-extension"], exclusions: [], implicit_claims: [], quantifiers: { scope: "existential", witness: "existential" }, parameters: { extension_degree: { relation: "class", value: "poly(n)" } }
  });
  return result;
}
