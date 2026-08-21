export const researchGraph = {
  workspace: {
    id: "WS-GAB",
    title: "Efficient beyond-unique decoding of ordinary Gabidulin codes",
    visibility: "private",
    provenance: "Conversation-derived benchmark; clean-room normalized records"
  },
  nodes: [
    {
      id: "P001",
      type: "problem",
      title: "Efficient complete beyond-unique decoding",
      status: "open",
      summary: "Recover every nearby ordinary Gabidulin codeword in polynomial time."
    },
    {
      id: "T020",
      type: "theorem",
      title: "Rank-2 exterior decoder",
      status: "provisional-theorem",
      summary: "[n,n-3,4], radius 2; fixed-r branch ancestor.",
      evidence: "argument + computation + internal audit"
    },
    {
      id: "T030",
      type: "theorem",
      title: "Rank-3 LLD decoder",
      status: "provisional-theorem",
      summary: "Controls genuine alternating/LLD degeneration.",
      evidence: "argument + exhaustive binary checks"
    },
    {
      id: "T040",
      type: "theorem",
      title: "Fixed-r exterior/LLD hierarchy",
      status: "provisional-theorem",
      summary: "One-step-beyond-unique hierarchy for every fixed r."
    },
    {
      id: "A174",
      type: "attempt",
      title: "Uniform slice regularity",
      status: "refuted",
      target: ["constant-exterior-kernel", "poly-m-one-step"],
      mechanisms: ["adaptive-slicing", "exterior-linearization"],
      assumptions: ["ordinary-gabidulin", "actual-hard-pencil", "right-coprime", "polynomial-extension", "m=n^2"],
      quantifiers: { scope: "universal", witness: "existential-witness" },
      summary: "Claimed every genuine hard pencil admits a good polynomially enumerable slice.",
      failure: {
        counterexampleId: "C175",
        requiredPlanTags: ["actual-hard-pencil", "polynomial-extension"],
        badTraits: ["subfield-trapped-determinant-image"],
        escapeAssumptions: ["evaluation-space-exterior-expansion"],
        frontier: "Prove exterior expansion for a restricted evaluation-space family."
      },
      preserves: ["T020", "T030", "T040"]
    },
    {
      id: "C175",
      type: "counterexample",
      title: "Subfield-trapped actual hard pencil",
      status: "verified-counterexample",
      assumptions: ["ordinary-gabidulin", "actual-hard-pencil", "right-coprime", "m=n^2"],
      traits: ["subfield-trapped-determinant-image"],
      summary: "A genuine coprime hard pencil with m=n² for which every legal slice has Ω(n²) exterior kernel.",
      evidence: "symbolic family + dimension lower bound"
    },
    {
      id: "G176",
      type: "open-gap",
      title: "Evaluation-space exterior expansion",
      status: "open",
      summary: "Construct non-subfield-type evaluation spaces with aggregate exterior-list-MRD."
    },
    {
      id: "A180",
      type: "attempt",
      title: "Width-one semilinear state compression",
      status: "refuted",
      target: ["candidate-extraction", "poly-m-one-step"],
      mechanisms: ["semilinear-width-one", "marked-factor"],
      assumptions: ["ordinary-gabidulin", "actual-hard-pencil", "polynomial-extension"],
      summary: "Tried to turn the one-parameter Ore pencil into one Frobenius eigenproblem.",
      failure: {
        counterexampleId: "B181",
        requiredPlanTags: ["semilinear-width-one"],
        badTraits: ["frobenius-support-growth"],
        escapeAssumptions: ["bounded-frobenius-width"],
        frontier: "Identify a code-derived stratum with bounded Frobenius support, or use marked-factor algebra instead."
      },
      preserves: ["T020", "T030", "T040"]
    },
    {
      id: "B181",
      type: "barrier",
      title: "Frobenius-support growth",
      status: "proved-barrier",
      traits: ["frobenius-support-growth"],
      summary: "Skew division generates mixed Frobenius monomials; K-linear conjugacy cannot collapse generic support to width one."
    },
    {
      id: "A190",
      type: "attempt",
      title: "Small list implies thin near-heavy spectrum",
      status: "refuted-generically",
      target: ["thin-near-heavy-spectrum", "candidate-extraction"],
      mechanisms: ["near-heavy-filtering", "random-slicing"],
      assumptions: ["small-final-list"],
      summary: "Tried to infer an FPT tail bound from at most two maximum-heavy points.",
      failure: {
        counterexampleId: "C191",
        requiredPlanTags: ["thin-near-heavy-spectrum"],
        badTraits: ["generic-linear-set-counterexamples"],
        escapeAssumptions: ["moore-specific-spectrum"],
        frontier: "Prove a Moore-specific projective near-kernel spectrum theorem."
      },
      preserves: ["T020", "T030", "T040"]
    },
    {
      id: "C191",
      type: "counterexample",
      title: "Two max-heavy points with an exponential near-heavy layer",
      status: "verified-generic-counterexample",
      traits: ["generic-linear-set-counterexamples"],
      summary: "Generic linear-set constructions separate a small final list from a thin deficit-one spectrum."
    },
    {
      id: "G200",
      type: "open-gap",
      title: "Marked-factor heavy-point extraction",
      status: "open",
      summary: "Find heavy parameters in a code-derived two-generator rank-metric pencil in poly(n,m)."
    }
  ],
  edges: [
    ["P001", "T020", "partial-solution"],
    ["T020", "T030", "generalizes"],
    ["T030", "T040", "generalizes"],
    ["P001", "A174", "attempts"],
    ["C175", "A174", "refutes"],
    ["A174", "G176", "reveals-gap"],
    ["P001", "A180", "attempts"],
    ["B181", "A180", "blocks"],
    ["A180", "G200", "reveals-gap"],
    ["P001", "A190", "attempts"],
    ["C191", "A190", "refutes"],
    ["A190", "G200", "reveals-gap"]
  ]
};

export function getNode(graph, id) {
  return graph.nodes.find((node) => node.id === id);
}
