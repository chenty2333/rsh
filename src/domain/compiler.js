import { normalizeText, unique } from "./normalize.js";

const detectors = {
  targets: [
    ["constant-exterior-kernel", /constant(?:-dimensional| dimensional)?.{0,28}exterior kernel|exterior kernel.{0,28}constant/],
    ["poly-m-one-step", /poly(?:nomial)?[- ]?m|polynomial extension|m\s*=\s*n\^?2|one[- ]step|\+1/],
    ["candidate-extraction", /candidate extraction|recover all (?:parameters|candidates)|heavy parameter|marked factor/],
    ["thin-near-heavy-spectrum", /near[- ]heavy|heavy spectrum|deficit[- ]one|thin spectrum/],
    ["fixed-r-hierarchy", /fixed[- ]r|hierarchy|all fixed r/]
  ],
  mechanisms: [
    ["adaptive-slicing", /adaptive slice|slice family|slicing|restriction family/],
    ["random-slicing", /random slice|random restriction/],
    ["exterior-linearization", /exterior|pl[uü]cker|grassmannian/],
    ["semilinear-width-one", /single semilinear|width[- ]one|semilinear eigen|frobenius norm/],
    ["marked-factor", /marked[- ]factor|ore factor|right divisib|skew factor/],
    ["near-heavy-filtering", /near[- ]heavy|deficit|heavy points?/]
  ],
  assumptions: [
    ["ordinary-gabidulin", /ordinary gabidulin|unmodified gabidulin/],
    ["actual-hard-pencil", /actual (?:gabidulin )?hard pencil|genuine hard pencil/],
    ["right-coprime", /right[- ]coprime|coprime/],
    ["polynomial-extension", /polynomial extension|poly(?:nomial)?[- ]?m|m\s*=\s*n\^?2/],
    ["m=n^2", /m\s*=\s*(?:theta\s*\()?n\s*\^\s*2|m\s*=\s*n2|m\s*=\s*n²/],
    ["characteristic-two", /characteristic\s*2|char(?:acteristic)?[- ]?2|q\s*=\s*2/],
    ["evaluation-space-exterior-expansion", /evaluation[- ]space exterior expansion|aggregate exterior expansion|exterior[- ]list[- ]mrd|gael[- ]mrd/],
    ["bounded-frobenius-width", /bounded frobenius width|width[- ]one stratum/],
    ["moore-specific-spectrum", /moore[- ]specific spectrum|projective near[- ]kernel spectrum/]
  ],
  exclusions: [
    ["subfield-trapped-determinant-image", /exclude(?:s|d|ing)? subfield[- ]trapped|not subfield[- ]trapped|rules? out subfield[- ]trapped/],
    ["frobenius-support-growth", /exclude(?:s|d|ing)? frobenius support growth|bounded frobenius width/],
    ["generic-linear-set-counterexamples", /exclude(?:s|d|ing)? generic linear sets?|moore[- ]specific spectrum/]
  ]
};

function detect(text, entries) {
  return entries.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);
}

function parseCommaTags(value = "") {
  return value
    .split(/[,;\n]/)
    .map((item) => normalizeText(item).replace(/\s+/g, "-"))
    .filter(Boolean);
}

export function compilePlan(rawText, options = {}) {
  const normalized = normalizeText(rawText);
  const assumptions = unique([
    ...detect(normalized, detectors.assumptions),
    ...parseCommaTags(options.assumptions)
  ]);
  const exclusions = unique([
    ...detect(normalized, detectors.exclusions),
    ...parseCommaTags(options.exclusions)
  ]);

  if (assumptions.includes("evaluation-space-exterior-expansion")) {
    exclusions.push("subfield-trapped-determinant-image");
  }
  if (assumptions.includes("bounded-frobenius-width")) {
    exclusions.push("frobenius-support-growth");
  }
  if (assumptions.includes("moore-specific-spectrum")) {
    exclusions.push("generic-linear-set-counterexamples");
  }

  const quantifiers = {
    scope: /for every|for all|all actual|uniform(?:ly)?/.test(normalized) ? "universal" : "unspecified",
    witness: /there exists|exists|some slice|at least one slice/.test(normalized) ? "existential-witness" : "unspecified"
  };

  const parameters = {};
  if (/m\s*=\s*(?:theta\s*\()?n\s*\^\s*2|m\s*=\s*n2|m\s*=\s*n²/.test(normalized)) {
    parameters.extensionDegree = "n^2";
  } else if (/poly(?:nomial)?[- ]?m|polynomial extension/.test(normalized)) {
    parameters.extensionDegree = "poly(n)";
  }

  return {
    id: options.id ?? `PLAN-${Date.now()}`,
    title: options.title ?? "Proposed research route",
    rawText,
    normalized,
    targets: unique(detect(normalized, detectors.targets)),
    mechanisms: unique(detect(normalized, detectors.mechanisms)),
    assumptions: unique(assumptions),
    exclusions: unique(exclusions),
    quantifiers,
    parameters
  };
}
