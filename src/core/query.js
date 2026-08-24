import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { assertWorkspaceLayout, workspacePaths } from "./paths.js";
import { isFrontierId, parseFrontier } from "./frontier.js";
import { parseRecord } from "./record.js";
import { RECORD_ID_PATTERN, hasExactIdReference } from "./ids.js";

const RECORD_ID = RECORD_ID_PATTERN;
const KINDS = new Set(["result", "dead_end", "experience"]);
const STATES = new Set(["unchecked", "checked", "withdrawn"]);

function locations(root) {
  const resolved = path.resolve(root);
  return { root: resolved, ...workspacePaths(resolved) };
}

function assertItemId(id) {
  if (!isFrontierId(id) && !RECORD_ID.test(id ?? "")) {
    throw new Error("ID must be a Q-, D-, or R- ID with 3 legacy or 5 current lowercase base36 characters");
  }
  return id;
}

function titleOf(body, fallback) {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

function recordEntries(root, { strict = true, warnings = [], checkLayout = true } = {}) {
  const paths = locations(root);
  if (checkLayout) assertWorkspaceLayout(root);
  else {
    const stat = fs.lstatSync(paths.records, { throwIfNoEntry: false });
    if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
      warnings.push({ code: "invalid_records_directory", file: ".rsh/records", message: "records path must be a real directory" });
      return [];
    }
  }
  const entries = [];
  for (const name of fs.readdirSync(paths.records).filter((entry) => entry.endsWith(".md")).sort()) {
    const file = path.join(paths.records, name);
    try {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("record path must be a real file");
      const raw = fs.readFileSync(file, "utf8");
      const parsed = parseRecord(raw);
      if (name !== `${parsed.id}.md`) throw new Error(`record filename ${name} does not match id ${parsed.id}`);
      const { body, ...metadata } = parsed;
      entries.push({
        id: metadata.id,
        metadata,
        body,
        raw,
        title: titleOf(body, metadata.id),
        file,
        relativePath: path.relative(paths.root, file).split(path.sep).join("/"),
        time: Date.parse(metadata.created_at)
      });
    } catch (error) {
      if (strict) throw error;
      warnings.push({ code: "invalid_record", file: `.rsh/records/${name}`, message: error.message });
    }
  }
  return entries.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
}

function latestFirst(records) {
  return [...records].sort((a, b) => b.time - a.time || b.id.localeCompare(a.id));
}

function validateFindOptions({ kind, state, limit }) {
  if (kind !== undefined && !KINDS.has(kind)) throw new Error("kind must be result, dead_end, or experience");
  if (state !== undefined && !STATES.has(state)) throw new Error("state must be unchecked, checked, or withdrawn");
  if (limit !== undefined && (!Number.isInteger(limit) || limit <= 0)) throw new Error("limit must be a positive integer");
}

function rgMatches(root, query, regex) {
  const args = ["--json", "--smart-case", "--hidden", "--no-ignore"];
  if (!regex) args.push("--fixed-strings");
  args.push("--", query, "RESEARCH.md", ".rsh/records");
  let output;
  try {
    output = execFileSync("rg", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024
    });
  } catch (error) {
    if (error.status === 1) output = error.stdout ?? "";
    else throw new Error(`rg search failed: ${String(error.stderr || error.message).trim()}`);
  }
  const matches = new Map();
  for (const line of output.split(/\r?\n/)) {
    if (!line) continue;
    const event = JSON.parse(line);
    if (event.type !== "match") continue;
    const file = event.data.path.text;
    if (!matches.has(file)) matches.set(file, { snippet: event.data.lines.text.trim(), frontierIds: new Set() });
    if (file === "RESEARCH.md") {
      for (const match of event.data.lines.text.matchAll(/\[([QD]-(?:[0-9a-z]{3}|[0-9a-z]{5}))\]/g)) matches.get(file).frontierIds.add(match[1]);
    }
  }
  return matches;
}

export function findRecords(root, query = "", options = {}) {
  validateFindOptions(options);
  const { regex = false, kind, state, limit = Infinity } = options;
  if (typeof query !== "string") throw new Error("query must be text");
  if (!query) throw new Error("find requires a query");
  const itemIdQuery = isFrontierId(query) || RECORD_ID.test(query);
  const paths = locations(root);
  assertWorkspaceLayout(root);
  const matches = rgMatches(paths.root, query, regex);
  const records = new Map(recordEntries(root).map((record) => [record.relativePath, record]));
  const replacement = replacementIndex([...records.values()]);
  const results = [];

  for (const [file, match] of matches) {
    if (file === "RESEARCH.md") {
      if (itemIdQuery || kind || state) continue;
      const research = fs.readFileSync(paths.research, "utf8");
      for (const node of parseFrontier(research)) {
        const line = `${"  ".repeat(node.depth)}- [${node.id}] ${node.text}`;
        if (!match.frontierIds.has(node.id)) continue;
        results.push({ id: node.id, source: "frontier", kind: node.kind, state: "open", title: node.text, snippet: line.trim(), _time: Number.POSITIVE_INFINITY });
      }
      continue;
    }
    const record = records.get(file);
    if (!record) continue;
    if (kind && record.metadata.kind !== kind) continue;
    if (state && record.metadata.state !== state) continue;
    if (itemIdQuery && !referencesId(record, query) && !bodyReferencesId(record.body, query)) continue;
    results.push({
      id: record.id,
      source: "record",
      kind: record.metadata.kind,
      state: record.metadata.state,
      title: record.title,
      snippet: match.snippet,
      withdrawn: record.metadata.state === "withdrawn",
      supersededBy: replacement.successors.get(record.id) ?? [],
      _priority: state === undefined && isDeprecated(record, replacement) ? 1 : 0,
      _time: record.time
    });
  }
  return results.sort((a, b) => (a._priority ?? 0) - (b._priority ?? 0) || b._time - a._time || b.id.localeCompare(a.id)).slice(0, limit).map(({ _time, _priority, ...result }) => result);
}

function recordSummary(record, allRecords, replacement = replacementIndex(allRecords)) {
  const metadata = record.metadata;
  const flags = [];
  if (metadata.state === "unchecked") flags.push("**UNCHECKED**");
  if (metadata.state === "withdrawn") flags.push("**WITHDRAWN**");
  const supersededBy = replacement.successors.get(record.id) ?? [];
  if (supersededBy.length) flags.push(`superseded by ${supersededBy.join(", ")}`);
  const withdrawn = relationTargets(record, "rsh:depends_on").filter((id) => allRecords.some((item) => item.id === id && item.metadata.state === "withdrawn"));
  if (withdrawn.length) flags.push(`depends on withdrawn ${withdrawn.join(", ")}`);
  const lines = [`- **${record.id}** [${metadata.kind}/${metadata.state}] ${record.title}${flags.length ? ` — ${flags.join("; ")}` : ""}`];
  if (metadata.scope) lines.push(`  - Scope: ${metadata.scope}`);
  if (metadata.retry_if.length) lines.push(`  - Retry if: ${metadata.retry_if.join("; ")}`);
  return lines.join("\n");
}

export function resumeResearch(root, { all = false } = {}) {
  const paths = locations(root);
  assertWorkspaceLayout(root);
  const research = fs.readFileSync(paths.research, "utf8");
  const frontier = parseFrontier(research);
  const records = recordEntries(root);
  const replacement = replacementIndex(records);
  const groups = [];
  for (const node of frontier) {
    const related = latestFirst(records.filter((record) => hasRelation(record, "rsh:about", node.id)));
    if (!related.length) continue;
    const current = related.filter((record) => !isDeprecated(record, replacement));
    const visible = all ? related : current.slice(0, 3);
    const lines = [`### ${node.id} — ${node.text}`, "", ...visible.map((record) => recordSummary(record, records, replacement))];
    if (!all && related.length > visible.length) {
      lines.push("", `${related.length - visible.length} more record(s): \`rsh find ${node.id}\``);
    }
    groups.push(lines.join("\n"));
  }
  const source = research.trimEnd();
  return groups.length ? `${source}\n\n## RSH record summaries\n\n${groups.join("\n\n")}\n` : `${source}\n`;
}

function formatRelated(records) {
  if (!records.length) return "_None._";
  return latestFirst(records).map((record) => `- **${record.id}** [${record.metadata.kind}/${record.metadata.state}] ${record.title}`).join("\n");
}

function relationsOf(record) {
  return Array.isArray(record.metadata.relations) ? record.metadata.relations : [];
}

function relationTargets(record, type) {
  return relationsOf(record).filter((relation) => relation.type === type).map((relation) => relation.target);
}

function hasRelation(record, type, target) {
  return relationsOf(record).some((relation) => relation.type === type && relation.target === target);
}

function replacementIndex(records) {
  const ids = new Set(records.map((record) => record.id));
  const predecessors = new Map();
  const successors = new Map();
  for (const record of records) {
    const targets = relationTargets(record, "rsh:supersedes").filter((id) => ids.has(id));
    if (targets.length) predecessors.set(record.id, targets);
    for (const target of targets) successors.set(target, [...(successors.get(target) ?? []), record.id]);
  }
  return { predecessors, successors };
}

function isDeprecated(record, replacement) {
  return record.metadata.state === "withdrawn" || replacement.successors.has(record.id);
}

function replacementPaths(id, replacement) {
  const component = new Set();
  const pending = [id];
  while (pending.length) {
    const current = pending.pop();
    if (component.has(current)) continue;
    component.add(current);
    pending.push(...(replacement.predecessors.get(current) ?? []), ...(replacement.successors.get(current) ?? []));
  }
  const roots = [...component].filter((item) => !(replacement.predecessors.get(item) ?? []).some((previous) => component.has(previous)));
  const paths = [];
  const walk = (current, path, seen) => {
    const next = (replacement.successors.get(current) ?? []).filter((item) => component.has(item) && !seen.has(item));
    if (!next.length) { paths.push(path); return; }
    for (const successor of next) walk(successor, [...path, successor], new Set(seen).add(successor));
  };
  for (const root of roots.length ? roots : [id]) walk(root, [root], new Set([root]));
  return paths;
}

function referencesId(record, id) {
  return relationsOf(record).some((relation) => relation.target === id)
    || record.metadata.assertion?.subject === id
    || record.metadata.assertion?.object === id;
}

function bodyReferencesId(body, id) {
  return hasExactIdReference(body, id);
}

function latestClose(records, id) {
  let found = null;
  for (const record of records) {
    for (const action of record.metadata.frontier) {
      if (action.id === id && action.action === "close") found = { snapshot: action.before, record };
    }
  }
  return found;
}

export function getItem(root, id) {
  assertItemId(id);
  const paths = locations(root);
  assertWorkspaceLayout(root);
  const records = recordEntries(root);
  if (RECORD_ID.test(id)) {
    const record = records.find((item) => item.id === id);
    if (!record) throw new Error(`Record ${id} does not exist`);
    const backlinks = records.filter((item) => item.id !== id && referencesId(item, id));
    const replacement = replacementIndex(records);
    const supersedes = replacement.predecessors.get(id) ?? [];
    const supersededBy = replacement.successors.get(id) ?? [];
    const replacementSection = supersedes.length || supersededBy.length
      ? `\n\n## Replacement chain\n\n${[
        `- Supersedes: ${supersedes.length ? supersedes.join(", ") : "_None._"}`,
        `- Superseded by: ${supersededBy.length ? supersededBy.join(", ") : "_None._"}`,
        `- Chain: ${replacementPaths(id, replacement).map((path) => path.join(" → ")).join("; ")}`
      ].join("\n")}`
      : "";
    const dependencies = relationTargets(record, "rsh:depends_on").map((dependency) => ({ id: dependency, record: records.find((item) => item.id === dependency) }));
    const reminders = dependencies.length
      ? dependencies.map(({ id: dependency, record: item }) => item
        ? `- ${item.id}: ${item.metadata.state}${item.metadata.state === "withdrawn" ? " — **WITHDRAWN**" : ""}`
        : `- ${dependency}: **MISSING**`).join("\n")
      : "_None._";
    return `${record.raw.trimEnd()}${replacementSection}\n\n## RSH backlinks\n\n${formatRelated(backlinks)}\n\n## Dependency reminders\n\n${reminders}\n`;
  }

  const current = parseFrontier(fs.readFileSync(paths.research, "utf8")).find((node) => node.id === id);
  const closed = latestClose(records, id);
  if (!current && !closed) throw new Error(`Frontier item ${id} does not exist`);
  const snapshot = current ?? closed.snapshot;
  const parent = snapshot.parent || "root";
  const state = current ? "open" : `closed in ${closed.record.id}`;
  const related = records.filter((record) => hasRelation(record, "rsh:about", id));
  return `# ${id} — ${snapshot.text}\n\n- Kind: ${snapshot.kind}\n- State: ${state}\n- Parent: ${parent}\n\n## Related records\n\n${formatRelated(related)}\n`;
}

function historicalFrontierIds(records, current) {
  const ids = new Set(current.map((node) => node.id));
  for (const record of records) for (const action of record.metadata.frontier) ids.add(action.id);
  return ids;
}

export function statusWorkspace(root) {
  const paths = locations(root);
  const warnings = [];
  let frontier = [];
  try {
    const stat = fs.lstatSync(paths.research);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("RESEARCH.md must be a real file");
    frontier = parseFrontier(fs.readFileSync(paths.research, "utf8"));
  }
  catch (error) { warnings.push({ code: "invalid_frontier", file: "RESEARCH.md", message: error.message }); }
  const records = recordEntries(root, { strict: false, warnings, checkLayout: false });
  const recordIds = new Set(records.map((record) => record.id));
  const frontierIds = historicalFrontierIds(records, frontier);
  for (const record of records) {
    for (const id of relationTargets(record, "rsh:about")) if (!frontierIds.has(id)) warnings.push({ code: "dangling_about", file: record.relativePath, message: `${record.id} references missing frontier ${id}` });
    for (const id of relationTargets(record, "rsh:depends_on")) if (!recordIds.has(id)) warnings.push({ code: "dangling_dependency", file: record.relativePath, message: `${record.id} depends on missing record ${id}` });
  }
  const byKind = {};
  const byState = {};
  for (const record of records) {
    byKind[record.metadata.kind] = (byKind[record.metadata.kind] ?? 0) + 1;
    byState[record.metadata.state] = (byState[record.metadata.state] ?? 0) + 1;
  }
  return {
    frontier: {
      open: frontier.length,
      questions: frontier.filter((node) => node.kind === "question").length,
      directions: frontier.filter((node) => node.kind === "direction").length
    },
    records: { total: records.length, by_kind: byKind, by_state: byState },
    warnings
  };
}

export function formatStatusMarkdown(status) {
  const kinds = Object.entries(status.records.by_kind).sort().map(([name, count]) => `- ${name}: ${count}`).join("\n") || "- none";
  const states = Object.entries(status.records.by_state).sort().map(([name, count]) => `- ${name}: ${count}`).join("\n") || "- none";
  const warnings = status.warnings.map((warning) => `- **${warning.code}** ${warning.file}: ${warning.message}`).join("\n") || "- none";
  return `# Research status\n\nOpen frontier: ${status.frontier.open} (${status.frontier.questions} questions, ${status.frontier.directions} directions)\n\n## Records by kind\n\n${kinds}\n\n## Records by state\n\n${states}\n\n## Warnings\n\n${warnings}`;
}

export function formatFindMarkdown(results) {
  if (!results.length) return "No matches.";
  return results.map((item) => `- **${item.id}** [${item.kind}/${item.state}] ${item.title}${item.withdrawn ? " — **WITHDRAWN**" : ""}${item.supersededBy?.length ? ` — superseded by ${item.supersededBy.join(", ")}` : ""}\n  ${item.snippet}`).join("\n");
}
