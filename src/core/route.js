import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { SCHEMAS } from "./constants.js";
import { normalizeWhitespace } from "./canonical.js";
import { validateRouteIR } from "./schema.js";

const DETECTORS = {
  targets: [
    ["constant-exterior-kernel", /constant(?:[- ]dimensional)?[^.\n]{0,45}exterior kernel|exterior kernel[^.\n]{0,45}constant/i],
    ["poly-m-one-step", /poly(?:nomial)?[- ]?m|polynomial extension|m\s*=\s*n\s*(?:\^\s*2|²)|one[- ]step|\+1/i],
    ["candidate-extraction", /candidate extraction|recover all (?:parameters|candidates)|heavy parameter|marked factor/i],
    ["thin-near-heavy-spectrum", /near[- ]heavy|heavy spectrum|deficit[- ]one|thin spectrum/i],
    ["fixed-r-hierarchy", /fixed[- ]r|hierarchy|all fixed r/i]
  ],
  mechanisms: [
    ["adaptive-slicing", /adaptive[^.\n]{0,20}slice|slice family|slicing|restriction family/i],
    ["random-slicing", /random[^.\n]{0,20}(?:slice|restriction)/i],
    ["exterior-linearization", /exterior|pl[uü]cker|grassmannian/i],
    ["semilinear-width-one", /single semilinear|width[- ]one|semilinear eigen|frobenius norm/i],
    ["marked-factor", /marked[- ]factor|ore factor|right divisib|skew factor/i],
    ["near-heavy-filtering", /near[- ]heavy|deficit|heavy points?/i]
  ],
  assumptions: [
    ["ordinary-gabidulin", /ordinary[^.\n]{0,30}gabidulin|unmodified[^.\n]{0,30}gabidulin/i],
    ["actual-hard-pencil", /actual[^.\n]{0,80}hard pencil|genuine[^.\n]{0,80}hard pencil/i],
    ["right-coprime", /right[- ]coprime|coprime/i],
    ["polynomial-extension", /polynomial extension|poly(?:nomial)?[- ]?m|m\s*=\s*n\s*(?:\^\s*2|²)/i],
    ["m=n^2", /m\s*=\s*(?:theta\s*\()?n\s*(?:\^\s*2|²)|m\s*=\s*n2/i],
    ["characteristic-two", /characteristic\s*2|char(?:acteristic)?[- ]?2|q\s*=\s*2/i],
    ["evaluation-space-exterior-expansion", /evaluation[- ]space exterior expansion|aggregate exterior expansion|exterior[- ]list[- ]mrd|gael[- ]mrd/i],
    ["bounded-frobenius-width", /bounded frobenius width|width[- ]one stratum/i],
    ["moore-specific-spectrum", /moore[- ]specific spectrum|projective near[- ]kernel spectrum/i]
  ],
  exclusions: [
    ["subfield-trapped-determinant-image", /exclude(?:s|d|ing)?[^.\n]{0,20}subfield[- ]trapped|not[^.\n]{0,20}subfield[- ]trapped|rules? out[^.\n]{0,20}subfield[- ]trapped/i],
    ["frobenius-support-growth", /exclude(?:s|d|ing)?[^.\n]{0,20}frobenius support growth/i],
    ["generic-linear-set-counterexamples", /exclude(?:s|d|ing)?[^.\n]{0,20}generic linear sets?/i]
  ]
};

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function detect(text, rules) {
  return rules.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);
}

function parseParameters(text) {
  const parameters = {};
  if (/m\s*=\s*n\s*(?:\^\s*2|²)/i.test(text)) parameters.extension_degree = { relation: "eq", value: "n^2" };
  else if (/poly(?:nomial)?[- ]?m|polynomial extension/i.test(text)) parameters.extension_degree = { relation: "class", value: "poly(n)" };
  const fixedR = text.match(/fixed\s+r\s*=\s*(\d+)/i);
  if (fixedR) parameters.r = { relation: "eq", value: Number(fixedR[1]) };
  return parameters;
}

export function heuristicCompile(rawText, options = {}) {
  const normalized = normalizeWhitespace(rawText);
  const assumptions = detect(normalized, DETECTORS.assumptions);
  const exclusions = detect(normalized, DETECTORS.exclusions);
  if (assumptions.includes("evaluation-space-exterior-expansion")) exclusions.push("subfield-trapped-determinant-image");
  if (assumptions.includes("bounded-frobenius-width")) exclusions.push("frobenius-support-growth");
  if (assumptions.includes("moore-specific-spectrum")) exclusions.push("generic-linear-set-counterexamples");
  return validateRouteIR({
    schema: SCHEMAS.route,
    title: options.title ?? "Proposed research route",
    raw_text: rawText,
    targets: unique(detect(normalized, DETECTORS.targets)),
    mechanisms: unique(detect(normalized, DETECTORS.mechanisms)),
    assumptions: unique(assumptions),
    exclusions: unique(exclusions),
    implicit_claims: [],
    quantifiers: {
      scope: /for every|for all|all actual|uniform(?:ly)?/i.test(normalized) ? "universal" : /there exists|construct an? /i.test(normalized) ? "existential" : "unspecified",
      witness: /there exists|exists|some slice|at least one/i.test(normalized) ? "existential" : "unspecified"
    },
    parameters: parseParameters(normalized),
    compiler: {
      mode: "heuristic",
      confidence: "low",
      warnings: ["Heuristic compilation is an experimental demo. For serious preflight, supply model-compiled IR with `rsh check --ir`." ]
    }
  });
}

export function compileWithCommand(command, rawText, cwd) {
  const result = spawnSync(command, [], {
    cwd,
    shell: true,
    input: JSON.stringify({ task: "compile_research_route", text: rawText }),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(`Compiler command failed: ${result.stderr || result.stdout}`);
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Compiler command did not return JSON: ${error.message}`);
  }
  const route = validateRouteIR(parsed);
  return validateRouteIR({ ...route, compiler: { ...(route.compiler ?? {}), mode: "external_command", command } });
}

export function loadRouteIR(file) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return validateRouteIR(parsed);
}
