import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { stringify } from "smol-toml";
import { initializeWorkspace } from "../src/core/workspace.js";
import { createFrontierId, parseFrontier } from "../src/core/frontier.js";
import { checkpoint, createRecordId, getRecord, listRecords, parseRecord, serializeRecord } from "../src/core/record.js";

const document = (metadata, body = "# Conclusion\n\nA durable conclusion.\n") =>
  `+++\n${stringify(metadata).trimEnd()}\n+++\n${body}`;
const workspace = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsh-core-model-"));
  initializeWorkspace(root);
  return root;
};
const input = (extra = {}) => ({ kind: "result", frontier: [], ...extra });

test("Q, D, and R generators use exactly five lowercase base36 characters, while readers accept legacy IDs", () => {
  assert.match(createFrontierId("question"), /^Q-[0-9a-z]{5}$/);
  assert.match(createFrontierId("direction"), /^D-[0-9a-z]{5}$/);
  assert.match(createRecordId(), /^R-[0-9a-z]{5}$/);
  assert.equal(parseRecord(document({ id: "R-abc", created_at: "2026-08-25T00:00:00.000Z", state: "unchecked", kind: "result", retry_if: [], relations: [], frontier: [] })).id, "R-abc");
  for (const invalid of ["Q-1234", "D-ABC", "R-ab-"]) {
    assert.throws(() => invalid[0] === "R"
      ? parseRecord(document({ id: invalid, created_at: "2026-08-25T00:00:00.000Z", state: "unchecked", kind: "result", retry_if: [], relations: [], frontier: [] }))
      : parseFrontier(`# Research\n\n## Open\n- [${invalid}] invalid\n`));
  }
});

test("standalone generators take their high water mark from generated five-character IDs", () => {
  assert.equal(createFrontierId("question", new Set(["Q-00000", "R-00001", "D-00002"])), "Q-00003");
  assert.equal(createRecordId(new Set(["Q-0000z", "R-abc"])), "R-00010");
});

test("relations and a result assertion round-trip with Unicode, LaTeX, and Markdown", () => {
  const record = {
    id: "R-a9z", created_at: "2026-08-25T00:00:00.000Z", kind: "result", state: "unchecked",
    retry_if: [], relations: [{ type: "rsh:about", target: "Q-abc" }, { type: "math:uses", target: "R-b2c" }],
    assertion: { subject: "R-b2c", predicate: "math:generalizes", object: "D-4z1" }, frontier: [],
    body: "# Conclusion 🧪\n\n域 Ω satisfies $\\alpha_1$.\n\n## Argument\n\n$$x_{i+1}=x_i^2$$\n"
  };
  assert.deepEqual(parseRecord(serializeRecord(record)), record);
});

test("record schema rejects legacy fields, empty bodies, malformed nested objects, and invalid namespaces", () => {
  const badMetadata = [
    input({ about: [] }), input({ depends_on: [] }),
    input({ relations: [{ type: "RSH:about", target: "Q-abc" }] }),
    input({ relations: [{ type: "rsh:about", target: "Q-abc", note: "no" }] }),
    input({ relations: [{ type: "rsh:about", target: "Q-abc" }, { type: "rsh:about", target: "Q-abc" }] }),
    { kind: "dead_end", scope: "bounded", frontier: [], assertion: { subject: "Q-abc", predicate: "math:uses", object: "R-b2c" } },
    input({ assertion: [{ subject: "Q-abc", predicate: "math:uses", object: "R-b2c" }] })
  ];
  for (const metadata of badMetadata) assert.throws(() => parseRecord(document(metadata), { input: true }));
  assert.throws(() => parseRecord(document(input(), " \n\t"), { input: true }), /non-empty Markdown/);
  assert.throws(() => parseRecord(document({
    id: "R-abc", created_at: "2026-08-25T00:00:00.000Z", kind: "result", state: "unchecked",
    retry_if: [], relations: [],
    frontier: [{ action: "open", id: "Q-abc", after: { kind: "direction", text: "contradiction", parent: "" } }]
  })), /kind contradicts Q-abc/);
  assert.equal(parseRecord(document(input(), "A complete result without prescribed headings.\n"), { input: true }).body,
    "A complete result without prescribed headings.\n");
});

test("checkpoint resolves relation and assertion endpoints, including historical frontier IDs", () => {
  const root = workspace();
  const first = checkpoint(root, document(input({ frontier: [{ action: "open", kind: "question", text: "Question" }] })), { isText: true });
  const question = first.frontier_actions[0].id;
  checkpoint(root, document(input({ relations: [{ type: "rsh:about", target: question }], frontier: [{ action: "close", id: question, outcome: "resolved" }] })), { isText: true });
  const related = checkpoint(root, document(input({
    relations: [{ type: "rsh:about", target: question }, { type: "rsh:depends_on", target: first.id }, { type: "rsh:derived_from", target: first.id }],
    assertion: { subject: question, predicate: "math:motivates", object: first.id }
  })), { isText: true });
  assert.deepEqual(getRecord(root, related.id).relations.map(({ type, target }) => [type, target]), [
    ["rsh:about", question], ["rsh:depends_on", first.id], ["rsh:derived_from", first.id]
  ]);
  assert.throws(() => checkpoint(root, document(input({ relations: [{ type: "rsh:about", target: first.id }] })), { isText: true }), /must target a Q- or D-/);
  assert.throws(() => checkpoint(root, document(input({ relations: [{ type: "rsh:depends_on", target: question }] })), { isText: true }), /must target an R-/);
  assert.throws(() => checkpoint(root, document(input({ relations: [{ type: "alice:related_to", target: "R-zzz" }] })), { isText: true }), /unknown object/);
});

test("legacy or malformed files in record history are rejected instead of ignored", () => {
  const root = workspace();
  fs.writeFileSync(path.join(root, ".rsh", "records", "R-abcd.md"), "legacy");
  assert.throws(() => listRecords(root), /Invalid RSH record filename R-abcd\.md/);
  assert.throws(() => checkpoint(root, document(input()), { isText: true }), /Invalid RSH record filename R-abcd\.md/);
});
