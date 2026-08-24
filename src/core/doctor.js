import fs from "node:fs";
import path from "node:path";
import { workspacePaths } from "./paths.js";
import { checkRipgrep, generatedSkillFiles } from "./workspace.js";
import { parseFrontier } from "./frontier.js";
import { parseRecord } from "./record.js";
import { ITEM_ID_PATTERN } from "./ids.js";
import { inspectSequence } from "./sequence.js";
import { inspectTrash } from "./delete.js";

const ITEM_ID = ITEM_ID_PATTERN;
const RELATION_TYPE = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/;

function isDirectory(file) {
  try { const stat = fs.lstatSync(file); return !stat.isSymbolicLink() && stat.isDirectory(); } catch { return false; }
}

function isFile(file) {
  try { const stat = fs.lstatSync(file); return !stat.isSymbolicLink() && stat.isFile(); } catch { return false; }
}

function readRecords(paths) {
  const records = [];
  for (const name of fs.readdirSync(paths.records).sort()) {
    const file = path.join(paths.records, name);
    if (!isFile(file) || !name.endsWith(".md")) throw new Error(`unexpected entry in records directory: ${name}`);
    const record = parseRecord(fs.readFileSync(file, "utf8"));
    if (name !== `${record.id}.md`) throw new Error(`record filename ${name} does not match id ${record.id}`);
    records.push(record);
  }
  records.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id));
  return records;
}

function validateRecordShape(record) {
  if (!ITEM_ID.test(record.id ?? "")) throw new Error(`${record.id ?? "record"}.id is invalid`);
  if (typeof record.body !== "string" || !record.body.trim()) throw new Error(`${record.id} has an empty Markdown body`);
  if (Object.hasOwn(record, "about") || Object.hasOwn(record, "depends_on")) throw new Error(`${record.id} uses legacy about/depends_on fields`);
  if (!Array.isArray(record.relations)) throw new Error(`${record.id}.relations must be an array`);
  const seen = new Set();
  for (const relation of record.relations) {
    if (!relation || typeof relation !== "object" || Array.isArray(relation)) throw new Error(`${record.id} has an invalid relation`);
    if (!RELATION_TYPE.test(relation.type ?? "")) throw new Error(`${record.id} has invalid relation type ${relation.type ?? ""}`);
    if (!ITEM_ID.test(relation.target ?? "")) throw new Error(`${record.id} has invalid relation target ${relation.target ?? ""}`);
    const key = `${relation.type}\0${relation.target}`;
    if (seen.has(key)) throw new Error(`${record.id} has duplicate relation ${relation.type} -> ${relation.target}`);
    seen.add(key);
  }
  if (record.assertion !== undefined) {
    const assertion = record.assertion;
    if (record.kind !== "result") throw new Error(`${record.id}.assertion is only valid on result records`);
    if (!assertion || typeof assertion !== "object" || Array.isArray(assertion)
      || !ITEM_ID.test(assertion.subject ?? "") || !ITEM_ID.test(assertion.object ?? "")
      || !RELATION_TYPE.test(assertion.predicate ?? "")) throw new Error(`${record.id}.assertion is invalid`);
  }
}

function sameSnapshot(left, right) {
  return Boolean(left && right)
    && left.kind === right.kind
    && left.text === right.text
    && (left.parent || "") === (right.parent || "");
}

function validateHistory(records, current) {
  const states = new Map();
  for (const record of records) for (const action of record.frontier) {
    const previous = states.get(action.id);
    if (action.action === "open") {
      if (previous) throw new Error(`${action.id} is opened more than once`);
      states.set(action.id, { open: true, snapshot: action.after });
    } else if (action.action === "close") {
      if (!previous || !previous.open || !sameSnapshot(previous.snapshot, action.before)) throw new Error(`${action.id} close snapshot contradicts prior history`);
      states.set(action.id, { open: false, snapshot: action.before });
    } else if (action.action === "revise") {
      if (!previous || !previous.open || !sameSnapshot(previous.snapshot, action.before)) throw new Error(`${action.id} revise snapshot contradicts prior history`);
      states.set(action.id, { open: true, snapshot: action.after });
    } else {
      if (!previous || previous.open || !sameSnapshot(previous.snapshot, action.before)) throw new Error(`${action.id} reopen has no matching closed snapshot`);
      states.set(action.id, { open: true, snapshot: action.after });
    }
  }
  const currentById = new Map(current.map((node) => [node.id, { kind: node.kind, text: node.text, parent: node.parent || "" }]));
  for (const [id, state] of states) {
    const node = currentById.get(id);
    if (state.open && !sameSnapshot(state.snapshot, node)) throw new Error(`${id} history does not match its current Open entry`);
    if (!state.open && node) throw new Error(`${id} is closed in history but still appears in Open`);
  }
}

function validateReplacements(records) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const predecessorsBySuccessor = new Map();
  const successorByPredecessor = new Map();
  for (const record of records) {
    const targets = record.relations
      .filter((relation) => relation.type === "rsh:supersedes")
      .map((relation) => relation.target);
    if (!targets.length) continue;
    for (const target of targets) {
      if (target === record.id) throw new Error(`${record.id} cannot supersede itself`);
      const predecessor = byId.get(target);
      if (!predecessor) throw new Error(`${record.id} rsh:supersedes references missing record ${target}`);
      if (successorByPredecessor.has(target)) {
        throw new Error(`${target} has multiple direct successors: ${successorByPredecessor.get(target)} and ${record.id}`);
      }
      if (predecessor.state !== "withdrawn") throw new Error(`${target} has a successor but is not withdrawn`);
      if (Date.parse(record.created_at) <= Date.parse(predecessor.created_at)) {
        throw new Error(`${record.id} must be newer than the Record it supersedes (${target})`);
      }
      successorByPredecessor.set(target, record.id);
    }
    predecessorsBySuccessor.set(record.id, targets);
  }
  const complete = new Set();
  const visit = (id, active = new Set()) => {
    if (active.has(id)) throw new Error(`replacement chain containing ${id} has a cycle`);
    if (complete.has(id)) return;
    const nextActive = new Set(active).add(id);
    for (const predecessor of predecessorsBySuccessor.get(id) ?? []) visit(predecessor, nextActive);
    complete.add(id);
  };
  for (const start of predecessorsBySuccessor.keys()) {
    visit(start);
  }
}

/** Audit a workspace without changing it. */
export function doctor(root) {
  root = path.resolve(root);
  const paths = workspacePaths(root);
  const checks = [];
  const add = (name, ok, detail = "", severity = "error") => checks.push({ name, ok, detail, severity });

  try { checkRipgrep(); add("ripgrep", true, "rg is available"); }
  catch (error) { add("ripgrep", false, error.message); }

  add("RSH directory", isDirectory(paths.rsh), ".rsh");
  try {
    if (!isDirectory(paths.rsh)) throw new Error(".rsh is missing");
    const unexpected = fs.readdirSync(paths.rsh).filter((name) => !["locks", "records", "sequence.toml", "trash"].includes(name));
    if (unexpected.length) throw new Error(`unexpected legacy or unmanaged entries: ${unexpected.sort().join(", ")}`);
    add("RSH directory entries", true, "managed entries only");
  } catch (error) { add("RSH directory entries", false, error.message); }

  let frontier = [];
  try {
    if (!isFile(paths.research)) throw new Error("RESEARCH.md must be a real file");
    frontier = parseFrontier(fs.readFileSync(paths.research, "utf8"));
    add("RESEARCH Open frontier", true, `${frontier.length} open entries`);
  } catch (error) { add("RESEARCH Open frontier", false, error.message); }

  add("records directory", isDirectory(paths.records), ".rsh/records");
  add("locks directory", isDirectory(paths.locks), ".rsh/locks");
  if (fs.existsSync(paths.trash)) {
    try {
      if (!isDirectory(paths.trash)) throw new Error(".rsh/trash must be a real directory");
      const trash = inspectTrash(root);
      add("trash directory", true, `${trash.operations} recoverable delete operation(s)`);
    } catch (error) { add("trash directory", false, error.message); }
  } else add("trash directory", false, ".rsh/trash will be created on the next delete", "warning");

  let records = [];
  let recordsValid = false;
  try {
    if (!isDirectory(paths.records)) throw new Error(".rsh/records is missing");
    records = readRecords(paths);
    for (const record of records) validateRecordShape(record);
    recordsValid = true;
    add("record files", true, `${records.length} valid records`);
  } catch (error) { add("record files", false, error.message); }

  try {
    if (!recordsValid) throw new Error("record validation failed; references were not checked");
    const frontierIds = new Set(frontier.map((node) => node.id));
    const recordIds = new Set(records.map((record) => record.id));
    for (const record of records) for (const action of record.frontier) frontierIds.add(action.id);
    for (const record of records) {
      for (const relation of record.relations) {
        if (relation.type === "rsh:about") {
          if (!/^[QD]-/.test(relation.target)) throw new Error(`${record.id} rsh:about target must be Q/D`);
          if (!frontierIds.has(relation.target)) throw new Error(`${record.id} rsh:about references missing frontier ${relation.target}`);
        } else if (relation.type === "rsh:depends_on" || relation.type === "rsh:derived_from" || relation.type === "rsh:supersedes") {
          if (!/^R-/.test(relation.target)) throw new Error(`${record.id} ${relation.type} target must be R`);
          if (!recordIds.has(relation.target)) throw new Error(`${record.id} ${relation.type} references missing record ${relation.target}`);
        } else if (/^R-/.test(relation.target) ? !recordIds.has(relation.target) : !frontierIds.has(relation.target)) {
          throw new Error(`${record.id} ${relation.type} references missing item ${relation.target}`);
        }
      }
      if (record.assertion) {
        for (const [field, id] of [["subject", record.assertion.subject], ["object", record.assertion.object]]) {
          if (/^R-/.test(id) ? !recordIds.has(id) : !frontierIds.has(id)) throw new Error(`${record.id}.assertion.${field} references missing item ${id}`);
        }
      }
      for (const action of record.frontier) {
        for (const snapshot of [action.before, action.after].filter(Boolean)) {
          if (snapshot.parent && !frontierIds.has(snapshot.parent)) throw new Error(`${record.id} snapshot references missing parent ${snapshot.parent}`);
        }
      }
    }
    validateReplacements(records);
    validateHistory(records, frontier);
    add("record references", true, "relations, assertions, replacement chains, and frontier snapshots resolve");
  } catch (error) { add("record references", false, error.message); }

  try {
    const ids = new Set(records.map((record) => record.id));
    for (const node of frontier) ids.add(node.id);
    for (const record of records) for (const action of record.frontier) ids.add(action.id);
    const sequence = inspectSequence(root, ids);
    if (sequence.exists) add("ID sequence", true, `next = ${sequence.next}`);
    else add("ID sequence", false, "legacy workspace; sequence.toml will be created on the next write", "warning");
  } catch (error) { add("ID sequence", false, error.message); }

  for (const { target, contents } of generatedSkillFiles(root)) {
    const relative = path.relative(root, target).split(path.sep).join("/");
    const valid = isFile(target) && fs.readFileSync(target, "utf8") === contents;
    add(`${relative} generated skill`, valid, valid ? relative : `${relative} is missing or does not match the generated contract`);
  }

  const warnings = checks.filter((check) => !check.ok && check.severity === "warning");
  const errors = checks.filter((check) => !check.ok && check.severity === "error");
  return { ok: errors.length === 0, checks, warnings, errors };
}

export function formatDoctorMarkdown(report) {
  const lines = [report.ok ? "# RSH doctor: healthy" : "# RSH doctor: problems found", ""];
  for (const check of report.checks) {
    const marker = check.ok ? "✓" : check.severity === "warning" ? "!" : "✗";
    lines.push(`- ${marker} **${check.name}**${check.detail ? ` — ${check.detail}` : ""}`);
  }
  lines.push("", `${report.errors.length} error(s), ${report.warnings.length} warning(s)`);
  return `${lines.join("\n")}\n`;
}
