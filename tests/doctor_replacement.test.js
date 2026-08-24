import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { doctor } from "../src/core/doctor.js";
import { checkpoint, getRecord, replaceRecord, serializeRecord } from "../src/core/record.js";
import { inputDocument, tempWorkspace } from "./helpers.js";

const metadata = (extra = {}) => ({ kind: "result", relations: [], retry_if: [], frontier: [], ...extra });

function save(root, record) {
  fs.writeFileSync(path.join(root, ".rsh", "records", `${record.id}.md`), serializeRecord(record));
}

test("doctor accepts a valid multi-level replacement chain", () => {
  const root = tempWorkspace("doctor-replacement-valid");
  const first = checkpoint(root, inputDocument(metadata(), "first\n"), { isText: true });
  const second = replaceRecord(root, first.id, inputDocument(metadata(), "second\n"), { isText: true });
  replaceRecord(root, second.id, inputDocument(metadata({ state: "checked" }), "third\n"), { isText: true });
  assert.equal(doctor(root).ok, true);
});

test("doctor rejects replacement branching and active predecessors", () => {
  const root = tempWorkspace("doctor-replacement-branch");
  const first = checkpoint(root, inputDocument(metadata(), "first\n"), { isText: true });
  replaceRecord(root, first.id, inputDocument(metadata(), "second\n"), { isText: true });
  const branch = checkpoint(root, inputDocument(metadata(), "branch\n"), { isText: true });
  const branchRecord = getRecord(root, branch.id);
  branchRecord.relations.push({ type: "rsh:supersedes", target: first.id });
  save(root, branchRecord);
  assert.match(doctor(root).errors.map((item) => item.detail).join("\n"), /multiple direct successors/);

  branchRecord.relations = [];
  save(root, branchRecord);
  const predecessor = getRecord(root, first.id);
  predecessor.state = "checked";
  save(root, predecessor);
  assert.match(doctor(root).errors.map((item) => item.detail).join("\n"), /has a successor but is not withdrawn/);
});

test("doctor rejects forged replacement shape and illegal body controls", () => {
  const root = tempWorkspace("doctor-replacement-tamper");
  const first = checkpoint(root, inputDocument(metadata(), "first\n"), { isText: true });
  const second = checkpoint(root, inputDocument(metadata(), "second\n"), { isText: true });
  const forged = getRecord(root, second.id);
  forged.relations.push({ type: "rsh:supersedes", target: second.id });
  save(root, forged);
  assert.match(doctor(root).errors.map((item) => item.detail).join("\n"), /cannot supersede itself/);

  forged.relations = [];
  save(root, forged);
  const firstPath = path.join(root, ".rsh", "records", `${first.id}.md`);
  fs.appendFileSync(firstPath, "bad\u000bbody\n");
  assert.match(doctor(root).errors.map((item) => item.detail).join("\n"), /illegal control character U\+000B/);
});
