import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { checkpoint } from "../src/core/record.js";
import { doctor } from "../src/core/doctor.js";
import { parseFrontier } from "../src/core/frontier.js";
import { deleteRecord, listTrashedRecordIds, undoDelete } from "../src/core/delete.js";
import { inputDocument, relation, tempWorkspace, treeSnapshot } from "./helpers.js";

const metadata = (extra = {}) => ({ kind: "result", state: "unchecked", retry_if: [], relations: [], frontier: [], ...extra });
const create = (root, extra, body) => checkpoint(root, inputDocument(metadata(extra), body), { isText: true }).id;

test("dry-run computes the recursive relation, assertion, and exact body-reference closure without writes", () => {
  const root = tempWorkspace("delete-dry-run");
  const target = create(root, {}, "target\n");
  const relationRef = create(root, { relations: [relation("rsh:depends_on", target)] }, "relation\n");
  const assertionRef = create(root, { assertion: { subject: relationRef, predicate: "math:uses", object: target } }, "assertion\n");
  const bodyRef = create(root, {}, `Uses ${assertionRef}.\n`);
  const unrelated = create(root, {}, `The longer tokens x${target}, ${target}z, ${target}-suffix, and ${target}_suffix do not count.\n`);
  const before = treeSnapshot(root);

  assert.deepEqual(deleteRecord(root, target, { dryRun: true }), {
    target_id: target,
    dry_run: true,
    would_delete_ids: [target, relationRef, assertionRef, bodyRef].sort()
  });
  assert.deepEqual(treeSnapshot(root), before);
  assert.equal(fs.existsSync(path.join(root, ".rsh", "records", `${unrelated}.md`)), true);
});

test("delete removes the complete reference closure and leaves unrelated records", () => {
  const root = tempWorkspace("delete-closure");
  const target = create(root, {}, "target\n");
  const dependent = create(root, { relations: [relation("rsh:derived_from", target)] }, "dependent\n");
  const transitive = create(root, {}, `See ${dependent}.\n`);
  const unrelated = create(root, {}, "unrelated\n");

  const deleted = deleteRecord(root, target);
  assert.equal(deleted.target_id, target);
  assert.equal(deleted.dry_run, false);
  assert.deepEqual(deleted.deleted_ids, [target, dependent, transitive].sort());
  assert.match(deleted.operation_id, /^[0-9a-z]+-[0-9a-z]+-[0-9a-z]+$/);
  assert.equal(deleted.undo_available, true);
  for (const id of [target, dependent, transitive]) {
    assert.equal(fs.existsSync(path.join(root, ".rsh", "records", `${id}.md`)), false);
  }
  assert.equal(fs.existsSync(path.join(root, ".rsh", "records", `${unrelated}.md`)), true);
});

test("undo restores the latest delete operation with the original IDs", () => {
  const root = tempWorkspace("delete-undo");
  const first = create(root, {}, "first\n");
  const second = create(root, {}, "second\n");
  const firstDelete = deleteRecord(root, first);
  const secondDelete = deleteRecord(root, second);

  const preview = undoDelete(root, { dryRun: true });
  assert.deepEqual(preview, { dry_run: true, operation_id: secondDelete.operation_id, would_restore_ids: [second] });
  const restoredSecond = undoDelete(root);
  assert.deepEqual(restoredSecond, { dry_run: false, operation_id: secondDelete.operation_id, restored_ids: [second] });
  assert.equal(fs.existsSync(path.join(root, ".rsh", "records", `${second}.md`)), true);
  assert.equal(fs.existsSync(path.join(root, ".rsh", "records", `${first}.md`)), false);

  const restoredFirst = undoDelete(root);
  assert.deepEqual(restoredFirst, { dry_run: false, operation_id: firstDelete.operation_id, restored_ids: [first] });
  assert.equal(fs.existsSync(path.join(root, ".rsh", "records", `${first}.md`)), true);
});

test("trash retains only the latest three delete operations", () => {
  const root = tempWorkspace("delete-retention");
  const ids = Array.from({ length: 4 }, (_, index) => create(root, {}, `record ${index}\n`));
  const operations = ids.map((id) => deleteRecord(root, id).operation_id);
  const trash = path.join(root, ".rsh", "trash");
  const retained = fs.readdirSync(trash, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepEqual(retained, operations.slice(1).sort());
  assert.deepEqual(undoDelete(root).restored_ids, [ids[3]]);
  assert.deepEqual(undoDelete(root).restored_ids, [ids[2]]);
  assert.deepEqual(undoDelete(root).restored_ids, [ids[1]]);
  assert.throws(() => undoDelete(root), /No deleted Record operation/);
});

test("undo refuses destination conflicts without changing the stack", () => {
  const root = tempWorkspace("delete-conflict");
  const id = create(root, {}, "original\n");
  const deleted = deleteRecord(root, id);
  const destination = path.join(root, ".rsh", "records", `${id}.md`);
  fs.writeFileSync(destination, "conflict\n");
  const before = treeSnapshot(root);
  assert.throws(() => undoDelete(root), new RegExp(`Record ${id} already exists`));
  assert.deepEqual(treeSnapshot(root), before);
  fs.rmSync(destination);
  assert.equal(undoDelete(root).operation_id, deleted.operation_id);
});

test("delete dry-run does not create or mutate the trash stack", () => {
  const root = tempWorkspace("delete-dry-trash");
  const first = create(root, {}, "first\n");
  const second = create(root, {}, "second\n");
  const operation = deleteRecord(root, first);
  const trash = path.join(root, ".rsh", "trash");
  const before = treeSnapshot(trash);
  assert.deepEqual(deleteRecord(root, second, { dryRun: true }).would_delete_ids, [second]);
  assert.deepEqual(treeSnapshot(trash), before);
  assert.equal(undoDelete(root).operation_id, operation.operation_id);
});

test("delete validates IDs and missing targets", () => {
  const root = tempWorkspace("delete-validation");
  assert.throws(() => deleteRecord(root, "R-no"), /record ID is invalid/);
  assert.throws(() => deleteRecord(root, "R-abc", { dryRun: true }), /does not exist/);
  assert.throws(() => deleteRecord(root, "R-abcde"), /does not exist/);
});

test("deleting a revise preserves the opener and about Records, and replays the prior text", () => {
  const root = tempWorkspace("delete-frontier");
  const opened = checkpoint(root, inputDocument(metadata({
    frontier: [{ action: "open", kind: "question", text: "original question" }]
  }), "opened\n"), { isText: true });
  const frontierId = opened.frontier_actions[0].id;
  const revised = checkpoint(root, inputDocument(metadata({
    frontier: [{ action: "revise", id: frontierId, text: "revised question" }]
  }), "revised\n"), { isText: true });
  const about = create(root, { relations: [relation("rsh:about", frontierId)] }, "about the question\n");
  const before = fs.readFileSync(path.join(root, "RESEARCH.md"), "utf8");
  assert.match(before, /revised question/);

  const preview = deleteRecord(root, revised.id, { dryRun: true });
  assert.deepEqual(preview.frontier_change.removed_ids, []);
  assert.match(preview.frontier_change.before[0].text, /revised question/);
  assert.match(preview.frontier_change.after[0].text, /original question/);

  const deleted = deleteRecord(root, revised.id);
  assert.deepEqual(deleted.deleted_ids, [revised.id]);
  const replayed = fs.readFileSync(path.join(root, "RESEARCH.md"), "utf8");
  assert.match(replayed, new RegExp(frontierId));
  assert.match(replayed, /original question/);
  assert.doesNotMatch(replayed, /revised question/);
  assert.deepEqual(listTrashedRecordIds(root), new Set([revised.id]));
  assert.equal(fs.existsSync(path.join(root, ".rsh", "records", `${opened.id}.md`)), true);
  assert.equal(fs.existsSync(path.join(root, ".rsh", "records", `${about}.md`)), true);
  assert.equal(doctor(root).ok, true);

  undoDelete(root);
  assert.equal(fs.readFileSync(path.join(root, "RESEARCH.md"), "utf8"), before);
  assert.equal(doctor(root).ok, true);
});

test("deleting a parent opener removes historically closed descendants and their references", () => {
  const root = tempWorkspace("delete-historical-descendant");
  const parent = checkpoint(root, inputDocument(metadata({
    frontier: [{ action: "open", kind: "question", text: "parent" }]
  }), "parent\n"), { isText: true });
  const parentId = parent.frontier_actions[0].id;
  const child = checkpoint(root, inputDocument(metadata({
    frontier: [{ action: "open", kind: "direction", text: "child", parent: parentId }]
  }), "child\n"), { isText: true });
  const childId = child.frontier_actions[0].id;
  const closed = checkpoint(root, inputDocument(metadata({
    frontier: [{ action: "close", id: childId, outcome: "resolved" }]
  }), "closed child\n"), { isText: true });
  const aboutChild = create(root, { relations: [relation("rsh:about", childId)] }, "child reference\n");

  const deleted = deleteRecord(root, parent.id);
  assert.deepEqual(deleted.deleted_ids, [parent.id, child.id, closed.id, aboutChild].sort());
  assert.doesNotMatch(fs.readFileSync(path.join(root, "RESEARCH.md"), "utf8"), new RegExp(`${parentId}|${childId}`));
  assert.equal(doctor(root).ok, true);
});

test("deleting a legacy close reopens from its before snapshot", () => {
  const root = tempWorkspace("delete-legacy-close");
  const legacyId = "Q-abc";
  fs.writeFileSync(path.join(root, "RESEARCH.md"), `# Research\n\n## Context\n\nLegacy.\n\n## Open\n- [${legacyId}] legacy question\n`);
  const closed = checkpoint(root, inputDocument(metadata({
    frontier: [{ action: "close", id: legacyId, outcome: "resolved" }]
  }), "close legacy\n"), { isText: true });
  assert.doesNotMatch(fs.readFileSync(path.join(root, "RESEARCH.md"), "utf8"), new RegExp(legacyId));

  deleteRecord(root, closed.id);
  const research = fs.readFileSync(path.join(root, "RESEARCH.md"), "utf8");
  assert.match(research, new RegExp(legacyId));
  assert.match(research, /legacy question/);
  assert.equal(doctor(root).ok, true);
});

test("deleting a child frontier lifecycle preserves its parent", () => {
  const root = tempWorkspace("delete-frontier-child");
  const parent = checkpoint(root, inputDocument(metadata({
    frontier: [{ action: "open", kind: "question", text: "parent" }]
  }), "parent\n"), { isText: true });
  const parentId = parent.frontier_actions[0].id;
  const child = checkpoint(root, inputDocument(metadata({
    frontier: [{ action: "open", kind: "direction", text: "child", parent: parentId }]
  }), "child\n"), { isText: true });
  deleteRecord(root, child.id);
  const research = fs.readFileSync(path.join(root, "RESEARCH.md"), "utf8");
  assert.match(research, new RegExp(parentId));
  assert.doesNotMatch(research, new RegExp(child.frontier_actions[0].id));
  assert.equal(fs.existsSync(path.join(root, ".rsh", "records", `${parent.id}.md`)), true);
  assert.equal(doctor(root).ok, true);
});

test("deleting a new parent removes reparent actions and replays the child's prior parent", () => {
  const root = tempWorkspace("delete-frontier-reparent");
  const firstParent = checkpoint(root, inputDocument(metadata({
    frontier: [{ action: "open", kind: "question", text: "first parent" }]
  }), "first parent\n"), { isText: true });
  const firstParentId = firstParent.frontier_actions[0].id;
  const child = checkpoint(root, inputDocument(metadata({
    frontier: [{ action: "open", kind: "direction", text: "child", parent: firstParentId }]
  }), "child\n"), { isText: true });
  const childId = child.frontier_actions[0].id;
  const secondParent = checkpoint(root, inputDocument(metadata({
    frontier: [{ action: "open", kind: "question", text: "second parent" }]
  }), "second parent\n"), { isText: true });
  const secondParentId = secondParent.frontier_actions[0].id;
  const moved = checkpoint(root, inputDocument(metadata({
    frontier: [{ action: "revise", id: childId, parent: secondParentId }]
  }), "move child\n"), { isText: true });

  const preview = deleteRecord(root, secondParent.id, { dryRun: true });
  assert.deepEqual(preview.would_delete_ids, [secondParent.id, moved.id].sort());
  assert.deepEqual(preview.frontier_change.removed_ids, [secondParentId]);
  assert.equal(preview.frontier_change.after.find((node) => node.id === childId).parent, firstParentId);
  deleteRecord(root, secondParent.id);
  const childNode = parseFrontier(fs.readFileSync(path.join(root, "RESEARCH.md"), "utf8")).find((node) => node.id === childId);
  assert.equal(childNode.parent, firstParentId);
  assert.equal(doctor(root).ok, true);
});

test("undo refuses to overwrite frontier changes made after delete", () => {
  const root = tempWorkspace("delete-frontier-conflict");
  const opened = checkpoint(root, inputDocument(metadata({
    frontier: [{ action: "open", kind: "question", text: "question" }]
  }), "opened\n"), { isText: true });
  deleteRecord(root, opened.id);
  const research = path.join(root, "RESEARCH.md");
  fs.appendFileSync(research, "\nExternal note.\n");
  const before = treeSnapshot(root);
  assert.throws(() => undoDelete(root), /RESEARCH\.md changed/);
  assert.deepEqual(treeSnapshot(root), before);
});

test("trash metadata rejects unsafe IDs and symbolic-link entries", () => {
  const root = tempWorkspace("delete-trash-validation");
  const id = create(root, {}, "record\n");
  deleteRecord(root, id);
  const trash = path.join(root, ".rsh", "trash");
  const operation = fs.readdirSync(trash, { withFileTypes: true }).find((entry) => entry.isDirectory()).name;
  const manifestFile = path.join(trash, operation, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  manifest.record_ids = ["../../escape"];
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  assert.throws(() => listTrashedRecordIds(root), /Invalid RSH trash manifest/);
  assert.equal(doctor(root).ok, false);
  assert.match(doctor(root).errors.map((error) => error.detail).join("\n"), /Invalid RSH trash/);
  fs.rmSync(path.join(trash, operation), { recursive: true });
  fs.symlinkSync(path.join(root, "RESEARCH.md"), path.join(trash, "linked"));
  assert.throws(() => listTrashedRecordIds(root), /symbolic link/);
});

test("doctor rejects an undo operation missing its frontier snapshots", () => {
  const root = tempWorkspace("delete-trash-research-snapshot");
  const opened = checkpoint(root, inputDocument(metadata({
    frontier: [{ action: "open", kind: "question", text: "question" }]
  }), "opened\n"), { isText: true });
  const deletion = deleteRecord(root, opened.id);
  fs.rmSync(path.join(root, ".rsh", "trash", deletion.operation_id, "research-before.md"));
  const report = doctor(root);
  assert.equal(report.ok, false);
  assert.match(report.errors.map((error) => error.detail).join("\n"), /missing valid RESEARCH\.md snapshots/);
});

test("a modifying delete rolls back an interrupted pending delete while dry-run stays zero-write", () => {
  const root = tempWorkspace("delete-pending-recovery");
  const interrupted = create(root, {}, "interrupted\n");
  const next = create(root, {}, "next\n");
  const deletion = deleteRecord(root, interrupted);
  const trash = path.join(root, ".rsh", "trash");
  const operation = path.join(trash, deletion.operation_id);
  const pending = path.join(trash, `.pending-${deletion.operation_id}`);
  fs.renameSync(operation, pending);
  const before = treeSnapshot(root);
  assert.throws(() => deleteRecord(root, next, { dryRun: true }), /Interrupted delete requires/);
  assert.deepEqual(treeSnapshot(root), before);

  const completed = deleteRecord(root, next);
  assert.deepEqual(completed.deleted_ids, [next]);
  assert.equal(fs.existsSync(path.join(root, ".rsh", "records", `${interrupted}.md`)), true);
  assert.equal(fs.existsSync(pending), false);
  assert.equal(doctor(root).ok, true);
});

test("undo completes an interrupted copy journal idempotently", () => {
  const root = tempWorkspace("undo-journal-recovery");
  const target = create(root, {}, "target\n");
  const dependent = create(root, { relations: [relation("rsh:depends_on", target)] }, "dependent\n");
  const deletion = deleteRecord(root, target);
  const operation = path.join(root, ".rsh", "trash", deletion.operation_id);
  fs.writeFileSync(path.join(operation, ".undoing"), "undo\n");
  fs.copyFileSync(path.join(operation, "records", `${target}.md`), path.join(root, ".rsh", "records", `${target}.md`), fs.constants.COPYFILE_EXCL);
  const beforeDryRun = treeSnapshot(root);
  assert.throws(() => undoDelete(root, { dryRun: true }), /Interrupted undo requires/);
  assert.deepEqual(treeSnapshot(root), beforeDryRun);

  assert.deepEqual(undoDelete(root), {
    dry_run: false,
    operation_id: deletion.operation_id,
    restored_ids: [target, dependent].sort()
  });
  assert.equal(fs.existsSync(operation), false);
  assert.equal(doctor(root).ok, true);
});

test("a pruning failure reports a warning after the delete has committed", () => {
  const root = tempWorkspace("delete-prune-warning");
  const ids = Array.from({ length: 4 }, (_, index) => create(root, {}, `record ${index}\n`));
  const firstOperation = deleteRecord(root, ids[0]).operation_id;
  deleteRecord(root, ids[1]);
  deleteRecord(root, ids[2]);
  const oldRm = fs.rmSync;
  fs.rmSync = (target, options) => {
    if (target === path.join(root, ".rsh", "trash", firstOperation)) throw new Error("simulated prune failure");
    return oldRm(target, options);
  };
  try {
    const result = deleteRecord(root, ids[3]);
    assert.equal(result.deleted_ids.includes(ids[3]), true);
    assert.match(result.warnings?.[0] ?? "", /Delete committed.*could not be pruned.*simulated prune failure/);
    assert.equal(fs.existsSync(path.join(root, ".rsh", "records", `${ids[3]}.md`)), false);
  } finally {
    fs.rmSync = oldRm;
  }
});
