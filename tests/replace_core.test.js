import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { doctor } from "../src/core/doctor.js";
import { checkpoint, getRecord, markRecord, parseRecord, replaceRecord, serializeRecord } from "../src/core/record.js";
import { inputDocument, tempWorkspace, treeSnapshot } from "./helpers.js";

const metadata = (extra = {}) => ({ kind: "result", relations: [], retry_if: [], frontier: [], ...extra });

test("replace atomically creates a successor and withdraws its predecessor", () => {
  const root = tempWorkspace("replace-core");
  const first = checkpoint(root, inputDocument(metadata(), "old body\n"), { isText: true });
  const body = "new body with $\\wedge$\n";
  const replacement = replaceRecord(root, first.id, inputDocument(metadata(), body), { isText: true });
  assert.match(replacement.id, /^R-[0-9a-z]{5}$/);
  assert.notEqual(replacement.id, first.id);
  assert.equal(replacement.replaced_id, first.id);
  assert.equal(replacement.body_sha256, crypto.createHash("sha256").update(body).digest("hex"));
  assert.equal(replacement.body_preview, "new body with $\\wedge$");
  assert.equal(getRecord(root, first.id).state, "withdrawn");
  assert.deepEqual(getRecord(root, replacement.id).relations, [{ type: "rsh:supersedes", target: first.id }]);
  assert.throws(() => markRecord(root, first.id, "checked"), /must remain withdrawn/);
  assert.throws(() => replaceRecord(root, first.id, inputDocument(metadata(), "branch\n"), { isText: true }), /already has a successor/);
  assert.throws(() => replaceRecord(root, replacement.id, inputDocument(metadata({ state: "withdrawn" }), "inactive successor\n"), { isText: true }), /cannot start withdrawn/);
});

test("checkpoint returns a body receipt and cannot forge supersedes", () => {
  const root = tempWorkspace("receipt"); const body = "# Durable\n\nproof\n";
  const first = checkpoint(root, inputDocument(metadata(), body), { isText: true });
  assert.equal(first.body_sha256, crypto.createHash("sha256").update(body).digest("hex"));
  assert.equal(first.body_preview, "# Durable proof");
  const before = treeSnapshot(root);
  assert.throws(() => checkpoint(root, inputDocument(metadata({ relations: [{ type: "rsh:supersedes", target: first.id }] }), "forged\n"), { isText: true }), /only be created by replaceRecord/);
  assert.deepEqual(treeSnapshot(root), before);
});

test("record bodies reject illegal C0 controls but permit tab CR and LF", () => {
  const root = tempWorkspace("controls"); const legal = "line\twith tab\r\nnext\n";
  const saved = checkpoint(root, inputDocument(metadata(), legal), { isText: true });
  assert.equal(getRecord(root, saved.id).body, legal);
  for (const code of [0x00, 0x08, 0x0b, 0x0c, 0x0e, 0x1f, 0x7f]) {
    const bad = `safe${String.fromCharCode(code)}unsafe\n`;
    assert.throws(() => checkpoint(root, inputDocument(metadata(), bad), { isText: true }), /illegal control character/);
    assert.throws(() => parseRecord(inputDocument({ ...metadata(), id: "R-aaa", created_at: "2026-08-25T00:00:00.000Z", state: "unchecked" }, bad)), /illegal control character/);
    assert.throws(() => serializeRecord({ ...metadata(), id: "R-aaa", created_at: "2026-08-25T00:00:00.000Z", state: "unchecked", body: bad }), /illegal control character/);
  }
});

test("replacement validation failure leaves old record and frontier untouched", () => {
  const root = tempWorkspace("replace-atomic");
  const first = checkpoint(root, inputDocument(metadata(), "old\n"), { isText: true });
  const before = treeSnapshot(root);
  assert.throws(() => replaceRecord(root, first.id, inputDocument(metadata({ frontier: [{ action: "close", id: "Q-zzz", outcome: "resolved" }] }), "new\n"), { isText: true }), /not open/);
  assert.deepEqual(treeSnapshot(root), before);
  assert.equal(fs.existsSync(path.join(root, ".rsh", "records", `${first.id}.md`)), true);
});

test("replace can repair a workspace containing illegal predecessor controls", () => {
  const root = tempWorkspace("replace-corrupt-history");
  const first = checkpoint(root, inputDocument(metadata(), "first\n"), { isText: true });
  const second = checkpoint(root, inputDocument(metadata(), "second\n"), { isText: true });
  for (const id of [first.id, second.id]) {
    fs.appendFileSync(path.join(root, ".rsh", "records", `${id}.md`), `bad${String.fromCharCode(0x0b)}body\n`);
  }
  assert.throws(() => checkpoint(root, inputDocument(metadata(), "blocked\n"), { isText: true }), /illegal control character/);

  const repairedFirst = replaceRecord(root, first.id, inputDocument(metadata(), "clean first\n"), { isText: true });
  assert.equal(repairedFirst.predecessor_controls_sanitized, 1);
  assert.match(getRecord(root, first.id).body, /bad\\u000Bbody/);
  assert.equal(doctor(root).ok, false);

  const repairedSecond = replaceRecord(root, second.id, inputDocument(metadata(), "clean second\n"), { isText: true });
  assert.equal(repairedSecond.predecessor_controls_sanitized, 1);
  assert.equal(doctor(root).ok, true);
});

test("one replacement can atomically merge multiple incomplete predecessors", () => {
  const root = tempWorkspace("replace-merge");
  const first = checkpoint(root, inputDocument(metadata(), "first fragment\n"), { isText: true });
  const second = checkpoint(root, inputDocument(metadata(), "second fragment\n"), { isText: true });
  const merged = replaceRecord(root, first.id, inputDocument(metadata({
    relations: [{ type: "rsh:supersedes", target: second.id }]
  }), "complete theorem\n"), { isText: true });
  assert.deepEqual(merged.replaced_ids, [first.id, second.id]);
  assert.equal(getRecord(root, first.id).state, "withdrawn");
  assert.equal(getRecord(root, second.id).state, "withdrawn");
  assert.deepEqual(getRecord(root, merged.id).relations, [
    { type: "rsh:supersedes", target: first.id },
    { type: "rsh:supersedes", target: second.id }
  ]);
  assert.equal(doctor(root).ok, true);
});
