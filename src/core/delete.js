import fs from "node:fs";
import path from "node:path";
import { assertWorkspaceLayout, workspacePaths } from "./paths.js";
import { parseFrontier, replaceOpenSection } from "./frontier.js";
import { listRecords } from "./record.js";
import { commitFileBatch } from "./fs.js";
import { RECORD_ID_PATTERN, hasExactIdReference } from "./ids.js";
import { sequenceSnapshot } from "./sequence.js";
import { withWorkspaceWriteLock } from "./write-lock.js";

const RECORD_ID = RECORD_ID_PATTERN;
const OPERATION_ID = /^[0-9a-z]+-[0-9a-z]+-[0-9a-z]+$/;
const PENDING_OPERATION = /^\.pending-([0-9a-z]+-[0-9a-z]+-[0-9a-z]+)$/;

function bodyReferences(body, ids) {
  return [...ids].some((id) => hasExactIdReference(body, id));
}

function referencesAny(record, ids) {
  if (record.relations.some((relation) => ids.has(relation.target))) return true;
  if (record.assertion && (ids.has(record.assertion.subject) || ids.has(record.assertion.object))) return true;
  return bodyReferences(record.body, ids);
}

function readRecords(root) {
  const recordsDir = workspacePaths(root).records;
  return listRecords(root, { allowIllegalBodyControls: true })
    .map((record) => ({ record, file: path.join(recordsDir, `${record.id}.md`) }))
    .sort((left, right) => Date.parse(left.record.created_at) - Date.parse(right.record.created_at)
      || left.record.id.localeCompare(right.record.id));
}

function knownObjectIds(root, records) {
  const ids = new Set(records.map(({ record }) => record.id));
  const research = fs.readFileSync(workspacePaths(root).research, "utf8");
  for (const node of parseFrontier(research)) ids.add(node.id);
  for (const { record } of records) for (const action of record.frontier) ids.add(action.id);
  return ids;
}

function deletionClosure(records, targetId, frontier) {
  const deletedRecords = new Set([targetId]);
  const removedObjects = new Set();
  const cutoffs = new Map();
  const recordOrder = new Map(records.map(({ record }, index) => [record.id, index]));
  const openParents = new Map();
  for (const { record } of records) for (const action of record.frontier) {
    if (action.action === "open") openParents.set(action.id, action.after?.parent || null);
    else if (!openParents.has(action.id) && action.before) openParents.set(action.id, action.before.parent || null);
  }
  for (const node of frontier) if (!openParents.has(node.id)) openParents.set(node.id, node.parent || null);
  let changed = true;
  while (changed) {
    changed = false;
    for (const { record } of records) if (deletedRecords.has(record.id)) {
      const order = recordOrder.get(record.id);
      for (const action of record.frontier) {
        if (action.action === "open") {
          if (!removedObjects.has(action.id)) { removedObjects.add(action.id); changed = true; }
        } else if (!removedObjects.has(action.id) && order < (cutoffs.get(action.id) ?? Infinity)) {
          cutoffs.set(action.id, order); changed = true;
        }
      }
    }
    for (const [objectId, parent] of openParents) if (parent && removedObjects.has(parent) && !removedObjects.has(objectId)) {
      removedObjects.add(objectId); changed = true;
    }
    const deletedObjects = new Set([...deletedRecords, ...removedObjects]);
    for (const { record } of records) if (!deletedRecords.has(record.id)) {
      const order = recordOrder.get(record.id);
      const removesLifecycle = record.frontier.some((action) => removedObjects.has(action.id)
        || (cutoffs.has(action.id) && order > cutoffs.get(action.id)));
      const referencesRemovedParent = record.frontier.some((action) => [action.before?.parent, action.after?.parent]
        .some((parent) => parent && removedObjects.has(parent)));
      if (referencesAny(record, deletedObjects) || removesLifecycle || referencesRemovedParent) {
        deletedRecords.add(record.id);
        changed = true;
      }
    }
  }
  return { recordIds: [...deletedRecords].sort(), removedObjects };
}

function replayFrontier(records, deletedRecordIds, removedObjects, original) {
  const states = new Map();
  const touched = new Set();
  const seenActions = new Set();
  for (const { record } of records) for (const action of record.frontier) {
    touched.add(action.id);
    if (!seenActions.has(action.id)) {
      seenActions.add(action.id);
      if (action.action !== "open" && action.before) {
        states.set(action.id, { open: action.action !== "reopen", snapshot: action.before });
      }
    }
  }
  for (const { record } of records) if (!deletedRecordIds.has(record.id)) for (const action of record.frontier) {
    if (removedObjects.has(action.id)) continue;
    let state = states.get(action.id);
    if (!state && action.action !== "open" && action.before) state = { open: action.action !== "reopen", snapshot: action.before };
    if (action.action === "close") state = { open: false, snapshot: action.before };
    else state = { open: true, snapshot: action.after };
    states.set(action.id, state);
  }
  const nodes = [];
  const included = new Set();
  for (const node of original) if (!touched.has(node.id) && !removedObjects.has(node.id)) {
    nodes.push({ ...node }); included.add(node.id);
  }
  for (const [id, state] of states) if (state.open && state.snapshot && !removedObjects.has(id)) {
    nodes.push({ id, kind: state.snapshot.kind, text: state.snapshot.text, parent: state.snapshot.parent || null });
    included.add(id);
  }
  return nodes.filter((node) => !node.parent || included.has(node.parent));
}

function frontierProjection(nodes) {
  return nodes.map(({ id, kind, text, parent }) => ({ id, kind, text, parent: parent || "" }));
}

function operationDirectories(trashDir) {
  if (!fs.existsSync(trashDir)) return [];
  const trashStat = fs.lstatSync(trashDir);
  if (trashStat.isSymbolicLink() || !trashStat.isDirectory()) throw new Error("Invalid RSH trash directory");
  const entries = fs.readdirSync(trashDir, { withFileTypes: true });
  const ignore = entries.find((entry) => entry.name === ".gitignore");
  if (!ignore || !ignore.isFile() || fs.readFileSync(path.join(trashDir, ".gitignore"), "utf8") !== "*\n!.gitignore\n") {
    throw new Error("Invalid RSH trash .gitignore");
  }
  const symlink = entries.find((entry) => entry.isSymbolicLink());
  if (symlink) throw new Error(`Invalid symbolic link in RSH trash: ${symlink.name}`);
  const pending = entries.find((entry) => entry.name.startsWith(".pending-"));
  if (pending) throw new Error(`Incomplete RSH trash operation ${pending.name} requires recovery`);
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      if (!OPERATION_ID.test(entry.name)) throw new Error(`Invalid RSH trash operation ${entry.name}`);
      const directory = path.join(trashDir, entry.name);
      const manifestFile = path.join(directory, "manifest.json");
      const storedRecords = path.join(directory, "records");
      const directoryStat = fs.lstatSync(directory);
      const manifestStat = fs.lstatSync(manifestFile, { throwIfNoEntry: false });
      const recordsStat = fs.lstatSync(storedRecords, { throwIfNoEntry: false });
      if (directoryStat.isSymbolicLink() || !manifestStat || manifestStat.isSymbolicLink() || !manifestStat.isFile()
        || !recordsStat || recordsStat.isSymbolicLink() || !recordsStat.isDirectory()) throw new Error(`Invalid RSH trash operation ${entry.name}`);
      let manifest;
      try { manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")); }
      catch (error) { throw new Error(`Invalid RSH trash manifest ${entry.name}: ${error.message}`); }
      const validIds = Array.isArray(manifest.record_ids) && manifest.record_ids.length > 0
        && manifest.record_ids.every((id) => RECORD_ID.test(id)) && new Set(manifest.record_ids).size === manifest.record_ids.length;
      if (manifest.operation_id !== entry.name || !validIds || !manifest.record_ids.includes(manifest.target_id)
        || !Number.isSafeInteger(manifest.sequence) || manifest.sequence < 1 || typeof manifest.created_at !== "string"
        || typeof manifest.research_changed !== "boolean") {
        throw new Error(`Invalid RSH trash manifest ${entry.name}`);
      }
      const intentFile = path.join(directory, "intent.json");
      const intentStat = fs.lstatSync(intentFile, { throwIfNoEntry: false });
      if (!intentStat || intentStat.isSymbolicLink() || !intentStat.isFile()
        || fs.readFileSync(intentFile, "utf8") !== fs.readFileSync(manifestFile, "utf8")) {
        throw new Error(`Invalid RSH trash intent ${entry.name}`);
      }
      const researchBefore = path.join(directory, "research-before.md");
      const researchAfter = path.join(directory, "research-after.md");
      const researchStats = [researchBefore, researchAfter].map((file) => fs.lstatSync(file, { throwIfNoEntry: false }));
      if (manifest.research_changed) {
        if (researchStats.some((stat) => !stat || stat.isSymbolicLink() || !stat.isFile())) {
          throw new Error(`RSH trash operation ${entry.name} is missing valid RESEARCH.md snapshots`);
        }
      } else if (researchStats.some(Boolean)) {
        throw new Error(`RSH trash operation ${entry.name} has unexpected RESEARCH.md snapshots`);
      }
      const undoMarker = path.join(directory, ".undoing");
      const undoStat = fs.lstatSync(undoMarker, { throwIfNoEntry: false });
      if (undoStat && (undoStat.isSymbolicLink() || !undoStat.isFile() || fs.readFileSync(undoMarker, "utf8") !== "undo\n")) {
        throw new Error(`Invalid undo journal for trash operation ${entry.name}`);
      }
      const storedNames = fs.readdirSync(storedRecords, { withFileTypes: true }).map((stored) => {
        if (stored.isSymbolicLink() || !stored.isFile()) throw new Error(`Invalid RSH trash Record ${entry.name}/${stored.name}`);
        return stored.name;
      }).sort();
      const expectedNames = manifest.record_ids.map((id) => `${id}.md`).sort();
      if (storedNames.length !== expectedNames.length || storedNames.some((name, index) => name !== expectedNames[index])) {
        throw new Error(`RSH trash operation ${entry.name} Records do not match its manifest`);
      }
      return { directory, manifest, undoing: Boolean(undoStat) };
    })
    .sort((left, right) => left.manifest.sequence - right.manifest.sequence
      || left.manifest.operation_id.localeCompare(right.manifest.operation_id));
}

function sameFileContents(left, right) {
  return fs.readFileSync(left).equals(fs.readFileSync(right));
}

function pendingOperations(trashDir) {
  if (!fs.existsSync(trashDir)) return [];
  const trashStat = fs.lstatSync(trashDir);
  if (trashStat.isSymbolicLink() || !trashStat.isDirectory()) throw new Error("Invalid RSH trash directory");
  return fs.readdirSync(trashDir, { withFileTypes: true }).filter((entry) => entry.name.startsWith(".pending-")).map((entry) => {
    if (!PENDING_OPERATION.test(entry.name) || entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(`Invalid pending RSH trash operation ${entry.name}`);
    }
    return path.join(trashDir, entry.name);
  }).sort();
}

function recoverPendingDeletes(root, trashDir) {
  const liveRecords = workspacePaths(root).records;
  for (const pending of pendingOperations(trashDir)) {
    const operationId = PENDING_OPERATION.exec(path.basename(pending))[1];
    const storedRecords = path.join(pending, "records");
    const recordsStat = fs.lstatSync(storedRecords, { throwIfNoEntry: false });
    if (!recordsStat || recordsStat.isSymbolicLink() || !recordsStat.isDirectory()) throw new Error(`Invalid pending delete journal ${path.basename(pending)}`);
    const storedEntries = fs.readdirSync(storedRecords, { withFileTypes: true });
    const intentFile = path.join(pending, "intent.json");
    const intentStat = fs.lstatSync(intentFile, { throwIfNoEntry: false });
    if (!intentStat && storedEntries.length === 0 && fs.readdirSync(pending).every((name) => name === "records")) {
      fs.rmSync(pending, { recursive: true });
      continue;
    }
    if (!intentStat || intentStat.isSymbolicLink() || !intentStat.isFile()) throw new Error(`Pending delete ${operationId} has no valid intent manifest`);
    let intent;
    try { intent = JSON.parse(fs.readFileSync(intentFile, "utf8")); } catch { throw new Error(`Pending delete ${operationId} has invalid intent manifest`); }
    if (intent.operation_id !== operationId || !Array.isArray(intent.record_ids) || !intent.record_ids.every((id) => RECORD_ID.test(id))
      || new Set(intent.record_ids).size !== intent.record_ids.length || !intent.record_ids.includes(intent.target_id)
      || !Number.isSafeInteger(intent.sequence) || intent.sequence < 1 || typeof intent.research_changed !== "boolean") {
      throw new Error(`Pending delete ${operationId} has invalid intent manifest`);
    }
    for (const entry of storedEntries) {
      const id = entry.name.endsWith(".md") ? entry.name.slice(0, -3) : "";
      if (entry.isSymbolicLink() || !entry.isFile() || !RECORD_ID.test(id) || !intent.record_ids.includes(id)) throw new Error(`Invalid pending delete Record ${entry.name}`);
      const source = path.join(storedRecords, entry.name);
      const destination = path.join(liveRecords, entry.name);
      if (fs.existsSync(destination)) {
        const stat = fs.lstatSync(destination);
        if (stat.isSymbolicLink() || !stat.isFile() || !sameFileContents(source, destination)) throw new Error(`Cannot recover pending delete because Record ${id} conflicts`);
        fs.rmSync(source);
      } else fs.renameSync(source, destination);
    }
    const before = path.join(pending, "research-before.md");
    const after = path.join(pending, "research-after.md");
    const temporary = `${workspacePaths(root).research}.delete-${operationId}`;
    const beforeStat = fs.lstatSync(before, { throwIfNoEntry: false });
    const afterStat = fs.lstatSync(after, { throwIfNoEntry: false });
    if (afterStat && !beforeStat) throw new Error(`Invalid pending delete RESEARCH journal ${path.basename(pending)}`);
    for (const [file, stat] of [[before, beforeStat], [after, afterStat]]) if (stat && (stat.isSymbolicLink() || !stat.isFile())) {
      throw new Error(`Invalid pending delete RESEARCH journal ${path.basename(file)}`);
    }
    if (beforeStat) {
      const research = workspacePaths(root).research;
      if (afterStat && sameFileContents(research, after)) fs.copyFileSync(before, research);
      else if (!sameFileContents(research, before)) throw new Error("Cannot recover pending delete because RESEARCH.md conflicts");
    }
    const temporaryStat = fs.lstatSync(temporary, { throwIfNoEntry: false });
    if (temporaryStat) {
      if (temporaryStat.isSymbolicLink() || !temporaryStat.isFile() || !afterStat || !sameFileContents(temporary, after)) {
        throw new Error("Cannot recover pending delete because its temporary RESEARCH.md conflicts");
      }
      fs.rmSync(temporary);
    }
    fs.rmSync(pending, { recursive: true });
  }
}

function createOperationId() {
  return `${Date.now().toString(36).padStart(9, "0")}-${process.pid.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function moveIntoTrash(filesById, ids, trashDir, targetId, researchChange) {
  fs.mkdirSync(trashDir, { recursive: true });
  const ignore = path.join(trashDir, ".gitignore");
  const ignoreStat = fs.lstatSync(ignore, { throwIfNoEntry: false });
  if (!ignoreStat) fs.writeFileSync(ignore, "*\n!.gitignore\n", { flag: "wx" });
  else if (ignoreStat.isSymbolicLink() || !ignoreStat.isFile() || fs.readFileSync(ignore, "utf8") !== "*\n!.gitignore\n") {
    throw new Error("Invalid RSH trash .gitignore");
  }
  const existingOperations = operationDirectories(trashDir);
  const sequence = (existingOperations.at(-1)?.manifest.sequence ?? 0) + 1;
  const operationId = createOperationId();
  const pending = path.join(trashDir, `.pending-${operationId}`);
  const recordsDir = path.join(pending, "records");
  fs.mkdirSync(recordsDir, { recursive: true });
  const moved = [];
  let researchCommitted = false;
  const temporaryResearch = researchChange ? `${researchChange.file}.delete-${operationId}` : null;
  const manifest = { operation_id: operationId, sequence, target_id: targetId, record_ids: ids,
    research_changed: Boolean(researchChange), created_at: new Date().toISOString() };
  try {
    fs.writeFileSync(path.join(pending, "intent.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    for (const id of ids) {
      const source = filesById.get(id);
      const destination = path.join(recordsDir, `${id}.md`);
      fs.renameSync(source, destination);
      moved.push({ source, destination });
    }
    if (researchChange) {
      fs.writeFileSync(path.join(pending, "research-before.md"), researchChange.before, { flag: "wx" });
      fs.writeFileSync(path.join(pending, "research-after.md"), researchChange.after, { flag: "wx" });
      fs.writeFileSync(temporaryResearch, researchChange.after, { flag: "wx" });
      fs.renameSync(temporaryResearch, researchChange.file);
      researchCommitted = true;
    }
    fs.copyFileSync(path.join(pending, "intent.json"), path.join(pending, "manifest.json"), fs.constants.COPYFILE_EXCL);
    fs.renameSync(pending, path.join(trashDir, operationId));
  } catch (error) {
    if (researchCommitted) fs.copyFileSync(path.join(pending, "research-before.md"), researchChange.file);
    if (temporaryResearch) fs.rmSync(temporaryResearch, { force: true });
    for (const item of [...moved].reverse()) {
      if (fs.existsSync(item.destination)) fs.renameSync(item.destination, item.source);
    }
    fs.rmSync(pending, { recursive: true, force: true });
    throw error;
  }
  const operations = [...existingOperations, { directory: path.join(trashDir, operationId), manifest: { operation_id: operationId, sequence } }];
  const warnings = [];
  for (const old of operations.slice(0, Math.max(0, operations.length - 3))) {
    try { fs.rmSync(old.directory, { recursive: true }); }
    catch (error) { warnings.push(`Delete committed, but old trash operation ${path.basename(old.directory)} could not be pruned: ${error.message}`); }
  }
  return { operationId, warnings };
}

function latestOperation(root) {
  const trashDir = path.join(workspacePaths(root).rsh, "trash");
  const operations = operationDirectories(trashDir);
  return { trashDir, operation: operations.at(-1) ?? null };
}

function completeUndo(root, operation, { begin = false } = {}) {
  const ids = [...operation.manifest.record_ids].sort();
  const recordsDir = workspacePaths(root).records;
  const marker = path.join(operation.directory, ".undoing");
  const sources = ids.map((id) => path.join(operation.directory, "records", `${id}.md`));
  const destinations = ids.map((id) => path.join(recordsDir, `${id}.md`));
  for (const [index, id] of ids.entries()) {
    const stat = fs.lstatSync(sources[index], { throwIfNoEntry: false });
    if (!stat || stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Trash operation is missing or has an invalid Record ${id}`);
    const destinationStat = fs.lstatSync(destinations[index], { throwIfNoEntry: false });
    if (destinationStat && (destinationStat.isSymbolicLink() || !destinationStat.isFile()
      || !sameFileContents(sources[index], destinations[index]) || begin)) {
      throw new Error(`Cannot undo delete because Record ${id} already exists`);
    }
  }
  const researchFile = workspacePaths(root).research;
  const researchBefore = path.join(operation.directory, "research-before.md");
  const researchAfter = path.join(operation.directory, "research-after.md");
  if (operation.manifest.research_changed) {
    for (const file of [researchBefore, researchAfter]) {
      const stat = fs.lstatSync(file, { throwIfNoEntry: false });
      if (!stat || stat.isSymbolicLink() || !stat.isFile()) throw new Error("Trash operation is missing its RESEARCH.md snapshot");
    }
    const matchesAfter = sameFileContents(researchFile, researchAfter);
    const matchesBefore = sameFileContents(researchFile, researchBefore);
    if ((!matchesAfter && !matchesBefore) || (begin && !matchesAfter)) {
      throw new Error("Cannot undo delete because RESEARCH.md changed after the delete operation");
    }
  }
  if (begin) fs.writeFileSync(marker, "undo\n", { flag: "wx" });
  for (const [index] of ids.entries()) if (!fs.existsSync(destinations[index])) {
    fs.copyFileSync(sources[index], destinations[index], fs.constants.COPYFILE_EXCL);
  }
  if (operation.manifest.research_changed && !sameFileContents(researchFile, researchBefore)) {
    const temporary = `${researchFile}.undo-${operation.manifest.operation_id}`;
    const temporaryStat = fs.lstatSync(temporary, { throwIfNoEntry: false });
    if (temporaryStat) {
      if (temporaryStat.isSymbolicLink() || !temporaryStat.isFile() || !sameFileContents(temporary, researchBefore)) {
        throw new Error("Cannot recover undo because its temporary RESEARCH.md conflicts");
      }
    } else fs.copyFileSync(researchBefore, temporary, fs.constants.COPYFILE_EXCL);
    fs.renameSync(temporary, researchFile);
  }
  fs.rmSync(operation.directory, { recursive: true });
  return { dry_run: false, operation_id: operation.manifest.operation_id, restored_ids: ids };
}

function recoverInterrupted(root) {
  const trashDir = path.join(workspacePaths(root).rsh, "trash");
  recoverPendingDeletes(root, trashDir);
  const completed = [];
  for (const operation of operationDirectories(trashDir).filter((candidate) => candidate.undoing)) {
    completed.push(completeUndo(root, operation));
  }
  return completed;
}

function assertNoInterrupted(root) {
  const trashDir = path.join(workspacePaths(root).rsh, "trash");
  const pending = pendingOperations(trashDir);
  if (pending.length) throw new Error("Interrupted delete requires a non-dry-run command to recover");
  if (operationDirectories(trashDir).some((operation) => operation.undoing)) {
    throw new Error("Interrupted undo requires a non-dry-run command to recover");
  }
}

export function listTrashedRecordIds(root) {
  root = path.resolve(root);
  assertWorkspaceLayout(root);
  const trashDir = path.join(workspacePaths(root).rsh, "trash");
  return new Set(operationDirectories(trashDir).flatMap(({ manifest }) => manifest.record_ids));
}

export function inspectTrash(root) {
  root = path.resolve(root);
  assertWorkspaceLayout(root);
  assertNoInterrupted(root);
  const operations = operationDirectories(workspacePaths(root).trash);
  return {
    operations: operations.length,
    record_ids: [...new Set(operations.flatMap(({ manifest }) => manifest.record_ids))].sort()
  };
}

export function deleteRecord(root, id, { dryRun = false } = {}) {
  root = path.resolve(root);
  if (!RECORD_ID.test(id ?? "")) throw new Error("record ID is invalid");
  assertWorkspaceLayout(root);

  const run = () => {
    if (dryRun) assertNoInterrupted(root);
    else recoverInterrupted(root);
    const records = readRecords(root);
    if (!records.some(({ record }) => record.id === id)) throw new Error(`Record ${id} does not exist`);
    const researchFile = workspacePaths(root).research;
    const research = fs.readFileSync(researchFile, "utf8");
    const frontier = parseFrontier(research);
    const { recordIds: closure, removedObjects } = deletionClosure(records, id, frontier);
    const replayed = replayFrontier(records, new Set(closure), removedObjects, frontier);
    const updatedResearch = replaceOpenSection(research, replayed);
    const frontierChange = updatedResearch === research ? null : {
      removed_ids: [...removedObjects].sort(),
      before: frontierProjection(frontier),
      after: frontierProjection(replayed)
    };
    if (dryRun) return { target_id: id, dry_run: true, would_delete_ids: closure,
      ...(frontierChange ? { frontier_change: frontierChange } : {}) };
    const filesById = new Map(records.map(({ record, file }) => [record.id, file]));
    commitFileBatch([sequenceSnapshot(root, knownObjectIds(root, records))]);
    const trashDir = path.join(workspacePaths(root).rsh, "trash");
    const researchChange = updatedResearch === research ? null : { file: researchFile, before: research, after: updatedResearch };
    const { operationId, warnings } = moveIntoTrash(filesById, closure, trashDir, id, researchChange);
    return { target_id: id, dry_run: false, deleted_ids: closure, operation_id: operationId, undo_available: true,
      ...(frontierChange ? { frontier_change: frontierChange } : {}),
      ...(warnings.length ? { warnings } : {}) };
  };

  return dryRun ? run() : withWorkspaceWriteLock(root, run);
}

export function undoDelete(root, { dryRun = false } = {}) {
  root = path.resolve(root);
  assertWorkspaceLayout(root);

  const run = () => {
    if (dryRun) assertNoInterrupted(root);
    else {
      const recovered = recoverInterrupted(root);
      if (recovered.length) return recovered.at(-1);
    }
    const { operation } = latestOperation(root);
    if (!operation) throw new Error("No deleted Record operation is available to undo");
    const ids = [...operation.manifest.record_ids].sort();
    if (dryRun) {
      return { dry_run: true, operation_id: operation.manifest.operation_id, would_restore_ids: ids };
    }
    return completeUndo(root, operation, { begin: true });
  };

  return dryRun ? run() : withWorkspaceWriteLock(root, run);
}
