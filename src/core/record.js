import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import * as fsCore from "./fs.js";
import { assertWorkspaceLayout, workspacePaths } from "./paths.js";
import { withWorkspaceWriteLock } from "./write-lock.js";
import { createFrontierId, isFrontierId, parseFrontier, replaceOpenSection } from "./frontier.js";
import { formatGeneratedId, ITEM_ID_PATTERN, nextGeneratedOrdinal, RECORD_ID_PATTERN } from "./ids.js";
import { createIdAllocator } from "./sequence.js";

const ID = RECORD_ID_PATTERN;
const OBJECT_ID = ITEM_ID_PATTERN;
const PREDICATE = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/;
const KINDS = new Set(["result", "dead_end", "experience"]);
const STATES = new Set(["unchecked", "checked", "withdrawn"]);
const OUTCOMES = new Set(["resolved", "exhausted", "abandoned", "superseded"]);
const INPUT_FIELDS = new Set(["kind", "state", "scope", "retry_if", "relations", "assertion", "frontier"]);
const STORED_FIELDS = new Set([...INPUT_FIELDS, "id", "created_at"]);
const ACTION_FIELDS = Object.freeze({
  open: new Set(["action", "kind", "text", "parent"]),
  close: new Set(["action", "id", "outcome"]),
  revise: new Set(["action", "id", "text", "parent"]),
  reopen: new Set(["action", "id", "parent"])
});
const STORED_ACTION_FIELDS = new Set(["action", "id", "outcome", "before", "after"]);
const SNAPSHOT_FIELDS = new Set(["kind", "text", "parent"]);
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const ILLEGAL_BODY_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const ILLEGAL_BODY_CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function validateBody(body, { allowIllegalControls = false } = {}) {
  if (typeof body !== "string" || !body.trim()) throw new Error("record body must contain non-empty Markdown text");
  const match = ILLEGAL_BODY_CONTROL.exec(body);
  if (match && !allowIllegalControls) throw new Error(`record body contains illegal control character U+${match[0].codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
}
function sanitizeBodyControls(body) {
  let count = 0;
  const sanitized = body.replace(ILLEGAL_BODY_CONTROLS, (character) => {
    count += 1;
    return `\\u${character.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
  });
  return { body: sanitized, count };
}
function bodyReceipt(body) {
  return {
    body_sha256: crypto.createHash("sha256").update(body, "utf8").digest("hex"),
    body_preview: body.trim().replace(/\s+/g, " ").slice(0, 160)
  };
}

function plain(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function rejectUnknown(value, allowed, label) {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label} contains unknown field ${key}`);
}
function stringArray(value, label) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) throw new Error(`${label} must be an array of non-empty strings`);
}
function validatePredicate(value, label) {
  if (typeof value !== "string" || !PREDICATE.test(value)) throw new Error(`${label} must use lowercase namespace:predicate_name format`);
}
function validateRelations(value) {
  if (!Array.isArray(value)) throw new Error("record.relations must be an array");
  const seen = new Set();
  value.forEach((relation, index) => {
    const label = `record.relations[${index}]`;
    if (!plain(relation)) throw new Error(`${label} must be an object`);
    rejectUnknown(relation, new Set(["type", "target"]), label);
    validatePredicate(relation.type, `${label}.type`);
    if (typeof relation.target !== "string" || !OBJECT_ID.test(relation.target)) throw new Error(`${label}.target must be a Q-, D-, or R- ID`);
    if (relation.type === "rsh:supersedes" && !ID.test(relation.target)) throw new Error("rsh:supersedes must target an R- object");
    const key = `${relation.type}\0${relation.target}`;
    if (seen.has(key)) throw new Error(`record.relations contains duplicate relation ${relation.type} -> ${relation.target}`);
    seen.add(key);
  });
}
function validateAssertion(value) {
  if (!plain(value)) throw new Error("record.assertion must be a single object");
  rejectUnknown(value, new Set(["subject", "predicate", "object"]), "record.assertion");
  if (!OBJECT_ID.test(value.subject ?? "")) throw new Error("record.assertion.subject must be a Q-, D-, or R- ID");
  validatePredicate(value.predicate, "record.assertion.predicate");
  if (!OBJECT_ID.test(value.object ?? "")) throw new Error("record.assertion.object must be a Q-, D-, or R- ID");
}
function snapshot(node) { return { kind: node.kind, text: node.text, parent: node.parent ?? "" }; }
function validateSnapshot(value, label) {
  if (!plain(value)) throw new Error(`${label} must be an object`);
  rejectUnknown(value, SNAPSHOT_FIELDS, label);
  if ((value.kind !== "question" && value.kind !== "direction") || typeof value.text !== "string" || !value.text.trim() || typeof value.parent !== "string" || (value.parent && !isFrontierId(value.parent))) throw new Error(`${label} is not a valid frontier snapshot`);
  if (/[\r\n]/.test(value.text)) throw new Error(`${label}.text must stay on one line`);
}
function validateStoredAction(value, label) {
  if (!plain(value)) throw new Error(`${label} must be an object`);
  rejectUnknown(value, STORED_ACTION_FIELDS, label);
  if (!ACTION_FIELDS[value.action] || !isFrontierId(value.id)) throw new Error(`${label} is invalid`);
  if (value.outcome !== undefined && !OUTCOMES.has(value.outcome)) throw new Error(`${label}.outcome is invalid`);
  if (value.before !== undefined) validateSnapshot(value.before, `${label}.before`);
  if (value.after !== undefined) validateSnapshot(value.after, `${label}.after`);
  const expectedKind = value.id[0] === "Q" ? "question" : "direction";
  for (const [name, valueSnapshot] of [["before", value.before], ["after", value.after]]) {
    if (valueSnapshot && valueSnapshot.kind !== expectedKind) throw new Error(`${label}.${name}.kind contradicts ${value.id}`);
  }
  if (value.action === "open" && (!value.after || value.before || value.outcome)) throw new Error(`${label} has invalid open snapshots`);
  if (value.action === "close" && (!value.before || value.after || !OUTCOMES.has(value.outcome))) throw new Error(`${label} has invalid close snapshots`);
  if ((value.action === "revise" || value.action === "reopen") && (!value.before || !value.after || value.outcome)) throw new Error(`${label} has invalid snapshots`);
}
function validateInputAction(action, label) {
  if (!plain(action) || !ACTION_FIELDS[action.action]) throw new Error(`${label} must be a valid frontier action`);
  rejectUnknown(action, ACTION_FIELDS[action.action], label);
  if (action.action === "open") {
    if (action.kind !== "question" && action.kind !== "direction") throw new Error(`${label}.kind must be question or direction`);
    if (typeof action.text !== "string" || !action.text.trim()) throw new Error(`${label}.text must be non-empty`);
  } else if (!isFrontierId(action.id)) throw new Error(`${label}.id is invalid`);
  if (action.action === "close" && !OUTCOMES.has(action.outcome)) throw new Error(`${label}.outcome is invalid`);
  if (action.action === "revise" && !Object.hasOwn(action, "text") && !Object.hasOwn(action, "parent")) throw new Error(`${label} requires text or parent`);
  if (Object.hasOwn(action, "text") && (typeof action.text !== "string" || !action.text.trim())) throw new Error(`${label}.text must be non-empty`);
  if (Object.hasOwn(action, "text") && /[\r\n]/.test(action.text)) throw new Error(`${label}.text must stay on one line`);
  if (Object.hasOwn(action, "parent") && action.parent !== "" && !isFrontierId(action.parent)) throw new Error(`${label}.parent is invalid`);
}

export function validateRecord(record, { input = false } = {}) {
  if (!plain(record)) throw new Error("record frontmatter must be an object");
  rejectUnknown(record, input ? INPUT_FIELDS : STORED_FIELDS, "record");
  if (!KINDS.has(record.kind)) throw new Error("record.kind must be result, dead_end, or experience");
  if (record.state === undefined && input) record.state = "unchecked";
  if (!STATES.has(record.state)) throw new Error("record.state is invalid");
  if (record.retry_if === undefined && input) record.retry_if = [];
  stringArray(record.retry_if, "record.retry_if");
  if (record.relations === undefined && input) record.relations = [];
  validateRelations(record.relations);
  if (record.assertion !== undefined) validateAssertion(record.assertion);
  if (record.assertion !== undefined && record.kind !== "result") throw new Error("record.assertion is only allowed on result records");
  if (record.scope !== undefined && typeof record.scope !== "string") throw new Error("record.scope must be a string");
  if (record.kind === "dead_end" && (typeof record.scope !== "string" || !record.scope.trim())) throw new Error("dead_end records require non-empty scope");
  if (record.frontier === undefined && input) record.frontier = [];
  if (!Array.isArray(record.frontier)) throw new Error("record.frontier must be an array");
  if (input) record.frontier.forEach((action, index) => validateInputAction(action, `record.frontier[${index}]`));
  else {
    if (!ID.test(record.id ?? "")) throw new Error("record.id is invalid");
    if (typeof record.created_at !== "string" || !ISO_TIMESTAMP.test(record.created_at) || Number.isNaN(Date.parse(record.created_at))) throw new Error("record.created_at must be an ISO timestamp");
    record.frontier.forEach((action, index) => validateStoredAction(action, `record.frontier[${index}]`));
  }
  return record;
}

function parseRecordInternal(text, options = {}) {
  if (typeof text !== "string" || !text.startsWith("+++")) throw new Error("record must begin with +++ TOML frontmatter");
  const firstEnd = text.indexOf("\n");
  if (firstEnd < 0 || text.slice(0, firstEnd).replace(/\r$/, "") !== "+++") throw new Error("record opening delimiter must be on its own line");
  const closing = /^\+\+\+[ \t]*\r?$/gm; closing.lastIndex = firstEnd + 1;
  const match = closing.exec(text);
  if (!match) throw new Error("record is missing closing +++ delimiter");
  let metadata;
  try { metadata = parseToml(text.slice(firstEnd + 1, match.index)); } catch (error) { throw new Error(`Invalid record TOML: ${error.message}`); }
  const after = text.indexOf("\n", match.index);
  const body = after < 0 ? "" : text.slice(after + 1);
  validateBody(body, { allowIllegalControls: options.allowIllegalBodyControls === true });
  validateRecord(metadata, options);
  return { ...metadata, body };
}
export function parseRecord(text, options = {}) {
  return parseRecordInternal(text, { input: options.input === true });
}
export function serializeRecord(record) {
  if (!plain(record)) throw new Error("record must be an object");
  const { body = "", ...metadata } = record;
  validateBody(body);
  validateRecord(metadata);
  return `+++\n${stringifyToml(metadata).trimEnd()}\n+++\n${body}`;
}
export function serializeCheckpointDocument(input) {
  if (!plain(input)) throw new Error("checkpoint input must be an object");
  const { body = "", ...metadata } = input;
  validateBody(body);
  validateRecord(metadata, { input: true });
  return `+++\n${stringifyToml(metadata).trimEnd()}\n+++\n${body}`;
}
function locations(root) {
  const paths = workspacePaths(path.resolve(root));
  return { paths, records: paths.records ?? path.join(paths.rsh, "records"), research: paths.research ?? path.join(paths.root, "RESEARCH.md") };
}
function readRecordFile(file, options = {}) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Invalid RSH record file ${path.basename(file)}`);
  return parseRecordInternal(fs.readFileSync(file, "utf8"), options);
}
export function listRecords(root, options = {}) {
  assertWorkspaceLayout(root);
  const { records } = locations(root);
  return fs.readdirSync(records).map((name) => {
    if (!/^R-(?:[0-9a-z]{3}|[0-9a-z]{5})\.md$/.test(name)) throw new Error(`Invalid RSH record filename ${name}`);
    const record = readRecordFile(path.join(records, name), options);
    if (`${record.id}.md` !== name) throw new Error(`Record filename ${name} does not match stored ID ${record.id}`);
    return record;
  }).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
}
export function getRecord(root, id) {
  if (!ID.test(id ?? "")) throw new Error("record ID is invalid");
  assertWorkspaceLayout(root);
  const file = path.join(locations(root).records, `${id}.md`);
  return fs.existsSync(file) ? readRecordFile(file) : null;
}
function historicalFrontier(records) {
  const ids = new Set();
  for (const record of records) for (const action of record.frontier) ids.add(action.id);
  return ids;
}
function latestClosedSnapshot(records, id) {
  let found = null;
  for (const record of records) for (const action of record.frontier) if (action.id === id) {
    if (action.action === "close") found = action.before;
    else if (action.action === "reopen" || action.action === "open") found = null;
  }
  return found;
}
function setParent(nodes, id, parent) {
  if (parent === id) throw new Error(`Frontier entry ${id} cannot parent itself`);
  if (parent != null && !nodes.some((node) => node.id === parent)) throw new Error(`Frontier parent ${parent} is not open`);
  for (let cursor = parent; cursor != null;) {
    if (cursor === id) throw new Error(`Moving ${id} below ${parent} would create a cycle`);
    cursor = nodes.find((node) => node.id === cursor)?.parent ?? null;
  }
}
function applyActions(rawActions, initialNodes, records, knownFrontier, allocateFrontierId = (kind) => createFrontierId(kind, knownFrontier)) {
  const nodes = initialNodes.map(({ id, kind, text, parent }) => ({ id, kind, text, parent }));
  const persisted = [];
  for (let index = 0; index < rawActions.length; index += 1) {
    const action = rawActions[index];
    if (action.action === "open") {
      const parent = action.parent || null; setParent(nodes, "__new__", parent);
      const id = allocateFrontierId(action.kind);
      knownFrontier.add(id);
      const node = { id, kind: action.kind, text: action.text, parent };
      nodes.push(node); persisted.push({ action: "open", id, after: snapshot(node) }); continue;
    }
    const position = nodes.findIndex((node) => node.id === action.id);
    if (action.action === "reopen") {
      if (position >= 0) throw new Error(`Frontier entry ${action.id} is already open`);
      const old = latestClosedSnapshot(records, action.id);
      if (!old) throw new Error(`No closed snapshot exists for ${action.id}`);
      const node = { id: action.id, kind: old.kind, text: old.text, parent: Object.hasOwn(action, "parent") ? (action.parent || null) : (old.parent || null) };
      setParent(nodes, node.id, node.parent); nodes.push(node); persisted.push({ action: "reopen", id: node.id, before: old, after: snapshot(node) }); continue;
    }
    if (position < 0) throw new Error(`Frontier entry ${action.id} is not open`);
    const oldNode = nodes[position];
    if (action.action === "revise") {
      const node = { ...oldNode, text: Object.hasOwn(action, "text") ? action.text : oldNode.text, parent: Object.hasOwn(action, "parent") ? (action.parent || null) : oldNode.parent };
      setParent(nodes, node.id, node.parent); nodes[position] = node; persisted.push({ action: "revise", id: node.id, before: snapshot(oldNode), after: snapshot(node) }); continue;
    }
    const children = nodes.filter((node) => node.parent === action.id);
    if (children.length) {
      const future = rawActions.slice(index + 1);
      const handled = children.every((child) => future.some((next) => next.id === child.id && (next.action === "close" || (next.action === "revise" && Object.hasOwn(next, "parent") && next.parent !== action.id))));
      if (!handled) throw new Error(`Cannot close ${action.id} while it has open children`);
    }
    nodes.splice(position, 1); persisted.push({ action: "close", id: oldNode.id, outcome: action.outcome, before: snapshot(oldNode) });
  }
  for (const node of nodes) if (node.parent != null && !nodes.some((candidate) => candidate.id === node.parent)) throw new Error(`Frontier entry ${node.id} has closed parent ${node.parent}`);
  return { nodes, persisted };
}
function readInput(fileOrText, isText) {
  if (isText) return fileOrText;
  if (typeof fileOrText !== "string" || !fileOrText) throw new Error("checkpoint requires a record file path or text");
  return fs.readFileSync(fileOrText, "utf8");
}
export function createRecordId(used = new Set()) {
  return formatGeneratedId("R", nextGeneratedOrdinal(used));
}
export function checkpoint(root, fileOrText, { isText = false } = {}) {
  root = path.resolve(root); const source = readInput(fileOrText, isText);
  assertWorkspaceLayout(root);
  return withWorkspaceWriteLock(root, () => {
    const { records: recordsDir, research: researchPath } = locations(root);
    const records = listRecords(root); const input = parseRecord(source, { input: true });
    const body = input.body; delete input.body;
    const research = fs.readFileSync(researchPath, "utf8"); const current = parseFrontier(research);
    const knownFrontier = historicalFrontier(records); for (const node of current) knownFrontier.add(node.id);
    const knownRecords = new Set(records.map((record) => record.id));
    const knownObjects = new Set([...knownFrontier, ...knownRecords]);
    const allocator = createIdAllocator(root, knownObjects);
    for (const relation of input.relations) {
      if (relation.type === "rsh:supersedes") throw new Error("rsh:supersedes may only be created by replaceRecord");
      if (!knownObjects.has(relation.target)) throw new Error(`record relation ${relation.type} references unknown object ${relation.target}`);
      if (relation.type === "rsh:about" && !isFrontierId(relation.target)) throw new Error("rsh:about must target a Q- or D- object");
      if ((relation.type === "rsh:depends_on" || relation.type === "rsh:derived_from") && !ID.test(relation.target)) throw new Error(`${relation.type} must target an R- object`);
    }
    if (input.assertion) {
      if (!knownObjects.has(input.assertion.subject)) throw new Error(`record assertion references unknown subject ${input.assertion.subject}`);
      if (!knownObjects.has(input.assertion.object)) throw new Error(`record assertion references unknown object ${input.assertion.object}`);
    }
    const { nodes, persisted } = applyActions(input.frontier, current, records, knownFrontier,
      (kind) => allocator.allocate(kind === "question" ? "Q" : "D"));
    const relationKeys = new Set(input.relations.map((relation) => `${relation.type}\0${relation.target}`));
    for (const action of persisted) {
      if (action.action !== "open") continue;
      const key = `rsh:about\0${action.id}`;
      if (relationKeys.has(key)) continue;
      input.relations.push({ type: "rsh:about", target: action.id });
      relationKeys.add(key);
    }
    const id = allocator.allocate("R");
    const latestCreatedAt = records.reduce((latest, record) => Math.max(latest, Date.parse(record.created_at)), 0);
    const createdAt = new Date(Math.max(Date.now(), latestCreatedAt + 1)).toISOString();
    const record = { ...input, id, created_at: createdAt, frontier: persisted, body };
    const recordPath = path.join(recordsDir, `${id}.md`); const updatedResearch = replaceOpenSection(research, nodes);
    if (typeof fsCore.commitFileBatch !== "function") throw new Error("fs.commitFileBatch is unavailable");
    fsCore.commitFileBatch([
      { target: recordPath, contents: serializeRecord(record) },
      { target: researchPath, contents: updatedResearch },
      { target: allocator.file, contents: allocator.contents() }
    ]);
    return { id: record.id, kind: record.kind, state: record.state, frontier_actions: persisted, ...bodyReceipt(body) };
  });
}
export function replaceRecord(root, id, fileOrText, { isText = false } = {}) {
  root = path.resolve(root); const source = readInput(fileOrText, isText);
  assertWorkspaceLayout(root);
  return withWorkspaceWriteLock(root, () => {
    const { records: recordsDir, research: researchPath } = locations(root);
    if (!ID.test(id ?? "")) throw new Error("record ID is invalid");
    const records = listRecords(root, { allowIllegalBodyControls: true });
    if (!records.some((record) => record.id === id)) throw new Error(`Record ${id} does not exist`);
    const input = parseRecord(source, { input: true }); const body = input.body; delete input.body;
    if (input.state === "withdrawn") throw new Error("replacement successor cannot start withdrawn");
    const additionalPredecessors = input.relations
      .filter((relation) => relation.type === "rsh:supersedes")
      .map((relation) => relation.target);
    if (additionalPredecessors.includes(id)) throw new Error("replacement relations must not repeat the primary predecessor");
    const replacedIds = [id, ...additionalPredecessors];
    const predecessors = replacedIds.map((replacedId) => {
      const record = records.find((candidate) => candidate.id === replacedId);
      if (!record) throw new Error(`Record ${replacedId} does not exist`);
      if (records.some((candidate) => candidate.relations.some((relation) => relation.type === "rsh:supersedes" && relation.target === replacedId))) {
        throw new Error(`Record ${replacedId} already has a successor`);
      }
      return record;
    });
    const research = fs.readFileSync(researchPath, "utf8"); const current = parseFrontier(research);
    const knownFrontier = historicalFrontier(records); for (const node of current) knownFrontier.add(node.id);
    const knownRecords = new Set(records.map((record) => record.id)); const knownObjects = new Set([...knownFrontier, ...knownRecords]);
    const allocator = createIdAllocator(root, knownObjects);
    for (const relation of input.relations) {
      if (!knownObjects.has(relation.target)) throw new Error(`record relation ${relation.type} references unknown object ${relation.target}`);
      if (relation.type === "rsh:about" && !isFrontierId(relation.target)) throw new Error("rsh:about must target a Q- or D- object");
      if ((relation.type === "rsh:depends_on" || relation.type === "rsh:derived_from") && !ID.test(relation.target)) throw new Error(`${relation.type} must target an R- object`);
    }
    if (input.assertion) {
      if (!knownObjects.has(input.assertion.subject)) throw new Error(`record assertion references unknown subject ${input.assertion.subject}`);
      if (!knownObjects.has(input.assertion.object)) throw new Error(`record assertion references unknown object ${input.assertion.object}`);
    }
    const { nodes, persisted } = applyActions(input.frontier, current, records, knownFrontier,
      (kind) => allocator.allocate(kind === "question" ? "Q" : "D"));
    const relationKeys = new Set(input.relations.map((relation) => `${relation.type}\0${relation.target}`));
    for (const action of persisted) if (action.action === "open") {
      const key = `rsh:about\0${action.id}`;
      if (!relationKeys.has(key)) { input.relations.push({ type: "rsh:about", target: action.id }); relationKeys.add(key); }
    }
    for (const predecessor of predecessors) {
      for (const relation of predecessor.relations.filter((item) => item.type === "rsh:about")) {
        const key = `rsh:about\0${relation.target}`;
        if (!relationKeys.has(key)) { input.relations.push({ ...relation }); relationKeys.add(key); }
      }
    }
    input.relations = [
      ...input.relations.filter((relation) => relation.type !== "rsh:supersedes"),
      ...replacedIds.map((target) => ({ type: "rsh:supersedes", target }))
    ];
    const newId = allocator.allocate("R");
    const latestCreatedAt = records.reduce((latest, record) => Math.max(latest, Date.parse(record.created_at)), 0);
    const replacement = { ...input, id: newId, created_at: new Date(Math.max(Date.now(), latestCreatedAt + 1)).toISOString(), frontier: persisted, body };
    let sanitizedControlCount = 0;
    for (const predecessor of predecessors) {
      predecessor.state = "withdrawn";
      const sanitized = sanitizeBodyControls(predecessor.body);
      predecessor.body = sanitized.body;
      sanitizedControlCount += sanitized.count;
    }
    const updatedResearch = replaceOpenSection(research, nodes);
    if (typeof fsCore.commitFileBatch !== "function") throw new Error("fs.commitFileBatch is unavailable");
    fsCore.commitFileBatch([
      { target: path.join(recordsDir, `${newId}.md`), contents: serializeRecord(replacement) },
      ...predecessors.map((predecessor) => ({
        target: path.join(recordsDir, `${predecessor.id}.md`), contents: serializeRecord(predecessor)
      })),
      { target: researchPath, contents: updatedResearch },
      { target: allocator.file, contents: allocator.contents() }
    ]);
    return {
      id: replacement.id, kind: replacement.kind, state: replacement.state,
      replaced_id: id, replaced_ids: replacedIds,
      predecessor_controls_sanitized: sanitizedControlCount,
      frontier_actions: persisted, ...bodyReceipt(body)
    };
  });
}
export function markRecord(root, id, state) {
  root = path.resolve(root);
  if (!STATES.has(state)) throw new Error("record.state is invalid");
  assertWorkspaceLayout(root);
  return withWorkspaceWriteLock(root, () => {
    const file = path.join(locations(root).records, `${id}.md`);
    if (!ID.test(id ?? "") || !fs.existsSync(file)) throw new Error(`Record ${id} does not exist`);
    if (state !== "withdrawn" && listRecords(root).some((candidate) => candidate.relations
      .some((relation) => relation.type === "rsh:supersedes" && relation.target === id))) {
      throw new Error(`Record ${id} has been superseded and must remain withdrawn`);
    }
    const record = readRecordFile(file); record.state = state;
    if (typeof fsCore.commitFileBatch !== "function") throw new Error("fs.commitFileBatch is unavailable");
    fsCore.commitFileBatch([{ target: file, contents: serializeRecord(record) }]); return { id: record.id, state: record.state };
  });
}
export const mark = markRecord;
export const parse = parseRecord;
export const serialize = serializeRecord;
export const list = listRecords;
export const get = getRecord;
