import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { checkpoint, markRecord } from "../src/core/record.js";
import { doctor } from "../src/core/doctor.js";
import { findRecords, getItem, resumeResearch } from "../src/core/query.js";
import { inputDocument, Q1, relation, setOpen, tempWorkspace } from "./helpers.js";

const metadata = (extra = {}) => ({ kind: "result", relations: [], retry_if: [], frontier: [], ...extra });

function seedRelations(root) {
  const opened = checkpoint(root, inputDocument(metadata({
    frontier: [
      { action: "open", kind: "question", text: "Primary question" },
      { action: "open", kind: "question", text: "Secondary question" }
    ]
  }), "# Questions\n\nOpen the primary and secondary questions.\n"), { isText: true });
  const [primaryQuestion, secondaryQuestion] = opened.frontier_actions.map((action) => action.id);
  const premise = checkpoint(root, inputDocument(metadata(), "# Premise\n\nReusable premise.\n"), { isText: true });
  markRecord(root, premise.id, "withdrawn");
  const conclusion = checkpoint(root, inputDocument(metadata({
    relations: [relation("rsh:about", primaryQuestion), relation("rsh:depends_on", premise.id)],
    assertion: { subject: premise.id, predicate: "math:generalizes", object: secondaryQuestion }
  }), `# Conclusion\n\nUses ${premise.id} explicitly.\n`), { isText: true });
  const assertionOnly = checkpoint(root, inputDocument(metadata({
    assertion: { subject: secondaryQuestion, predicate: "math:refines", object: conclusion.id }
  }), "# Assertion-only backlink\n\nThe complete relational argument is here.\n"), { isText: true });
  const bodyReference = checkpoint(root, inputDocument(metadata(), `# Body reference\n\nCompare with ${premise.id}.\n`), { isText: true });
  const lifecycleOnly = checkpoint(root, inputDocument(metadata({
    frontier: [{ action: "revise", id: primaryQuestion, text: "Primary question (revised)" }]
  }), "# Lifecycle only\n\nNo semantic reference is made here.\n"), { isText: true });
  const substringOnly = checkpoint(root, inputDocument(metadata(),
    `# Substrings only\n\nNeither X${primaryQuestion} nor ${primaryQuestion}x is an exact ID reference.\n`), { isText: true });
  return { premise, conclusion, assertionOnly, bodyReference, lifecycleOnly, substringOnly, primaryQuestion, secondaryQuestion };
}

test("get, find, and resume derive relation and assertion views", () => {
  const root = tempWorkspace("query-relations");
  const { premise, conclusion, assertionOnly, bodyReference, lifecycleOnly, substringOnly, primaryQuestion, secondaryQuestion } = seedRelations(root);

  const detail = getItem(root, conclusion.id);
  assert.match(detail, /type = "rsh:depends_on"/);
  assert.match(detail, /\[assertion\]/);
  assert.match(detail, /predicate = "math:generalizes"/);
  assert.doesNotMatch(detail, /^## Outbound relations$/m);
  assert.doesNotMatch(detail, /^## Assertion$/m);
  assert.match(detail, new RegExp(`${premise.id}: withdrawn.*WITHDRAWN`));

  const premiseDetail = getItem(root, premise.id);
  assert.match(premiseDetail, new RegExp(conclusion.id));
  assert.match(getItem(root, conclusion.id), new RegExp(assertionOnly.id), "assertion object creates a backlink");
  const found = new Set(findRecords(root, premise.id).map((item) => item.id));
  assert.ok(found.has(conclusion.id), "relation/assertion reference is found");
  assert.ok(found.has(bodyReference.id), "Markdown body reference is found");
  assert.ok(findRecords(root, secondaryQuestion).some((item) => item.id === assertionOnly.id), "assertion subject is found");
  const questionHits = new Set(findRecords(root, primaryQuestion).map((item) => item.id));
  assert.ok(!questionHits.has(lifecycleOnly.id),
    "frontier action metadata alone is not an ID-search hit");
  assert.ok(!questionHits.has(substringOnly.id), "embedded or longer ID-like substrings are not hits");
  assert.match(resumeResearch(root), new RegExp(conclusion.id));
  assert.equal(doctor(root).ok, true);
});

test("get reports missing depends_on targets from an externally damaged workspace", () => {
  const root = tempWorkspace("query-missing-dependency");
  const { conclusion } = seedRelations(root);
  const file = path.join(root, ".rsh", "records", `${conclusion.id}.md`);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/target = "R-[0-9a-z]{3}"/, 'target = "R-zzz"'));
  assert.match(getItem(root, conclusion.id), /R-zzz: \*\*MISSING\*\*/);
  const report = doctor(root);
  assert.equal(report.ok, false);
  assert.match(report.errors.map((error) => error.detail).join("\n"), /references missing record R-zzz/);
});

test("doctor rejects legacy fields, malformed relations, duplicate relations, and empty bodies", () => {
  const cases = [
    ["legacy", 'about = ["Q-111"]\n', /unknown field about|legacy/],
    ["namespace", 'relations = [{ type = "Bad", target = "Q-111" }]\n', /namespace:predicate_name|relation type/],
    ["duplicate", 'relations = [{ type = "rsh:about", target = "Q-111" }, { type = "rsh:about", target = "Q-111" }]\n', /duplicate relation/],
    ["empty", "relations = []\n", /non-empty Markdown/]
  ];
  for (const [name, extra, expected] of cases) {
    const root = tempWorkspace(`doctor-${name}`);
    setOpen(root, [`- ${Q1} Question`]);
    const body = name === "empty" ? "" : "# Body\n";
    fs.writeFileSync(path.join(root, ".rsh", "records", "R-abc.md"), `+++\nid = "R-abc"\nkind = "result"\nstate = "unchecked"\nretry_if = []\nfrontier = []\ncreated_at = "2026-01-01T00:00:00.000Z"\n${extra}+++\n${body}`);
    const report = doctor(root);
    assert.equal(report.ok, false, name);
    assert.match(report.errors.map((error) => error.detail).join("\n"), expected, name);
  }
});

test("doctor rejects tampered frontier history and legacy workspace entries", () => {
  const root = tempWorkspace("doctor-history");
  const opened = checkpoint(root, inputDocument(metadata({
    frontier: [{ action: "open", kind: "question", text: "original" }]
  })), { isText: true });
  const question = opened.frontier_actions[0].id;
  const research = path.join(root, "RESEARCH.md");
  fs.writeFileSync(research, fs.readFileSync(research, "utf8").replace("original", "forged"));
  let report = doctor(root);
  assert.equal(report.ok, false);
  assert.match(report.errors.map((error) => error.detail).join("\n"), /history does not match/);

  fs.writeFileSync(research, fs.readFileSync(research, "utf8").replace("forged", "original"));
  fs.writeFileSync(path.join(root, ".rsh", "workspace.json"), "{}\n");
  report = doctor(root);
  assert.equal(report.ok, false);
  assert.match(report.errors.map((error) => error.detail).join("\n"), /unexpected legacy or unmanaged entries: workspace.json/);
  assert.match(question, /^Q-[0-9a-z]{3}$/);
});

test("doctor rejects close and revise actions whose open history is missing", () => {
  for (const action of ["close", "revise"]) {
    const root = tempWorkspace(`doctor-orphan-${action}`);
    const opened = checkpoint(root, inputDocument(metadata({
      frontier: [{ action: "open", kind: "question", text: "original" }]
    })), { isText: true });
    const question = opened.frontier_actions[0].id;
    const next = action === "close"
      ? { action, id: question, outcome: "resolved" }
      : { action, id: question, text: "revised" };
    checkpoint(root, inputDocument(metadata({ frontier: [next] })), { isText: true });
    fs.unlinkSync(path.join(root, ".rsh", "records", `${opened.id}.md`));

    const report = doctor(root);
    assert.equal(report.ok, false, action);
    assert.match(report.errors.map((error) => error.detail).join("\n"), new RegExp(`${action} snapshot contradicts prior history`));
  }
});
