import test from "node:test";
import assert from "node:assert/strict";
import { checkpoint, getRecord, replaceRecord } from "../src/core/record.js";
import { findRecords, formatFindMarkdown, getItem, resumeResearch } from "../src/core/query.js";
import { inputDocument, Q1, relation, setOpen, tempWorkspace } from "./helpers.js";

const base = (relations) => ({ kind: "result", relations, retry_if: [], frontier: [] });

function add(root, title, relations = []) {
  return checkpoint(root, inputDocument(base([relation("rsh:about", Q1), ...relations]), `# ${title}\n\nshared replacement evidence\n`), { isText: true });
}

function replace(root, id, title) {
  return replaceRecord(root, id, inputDocument(base([relation("rsh:about", Q1)]), `# ${title}\n\nshared replacement evidence\n`), { isText: true });
}

function seed(root) {
  setOpen(root, [`- ${Q1} replacement query`]);
  const old = add(root, "Old");
  const middle = replace(root, old.id, "Middle");
  const latest = replace(root, middle.id, "Latest");
  return { old, middle, latest };
}

test("get shows both directions and a multi-level replacement chain while preserving backlinks", () => {
  const root = tempWorkspace("query-replacement-get");
  const { old, middle, latest } = seed(root);
  const unrelated = add(root, "Unrelated");
  const detail = getItem(root, middle.id);
  assert.match(detail, /## Replacement chain/);
  assert.match(detail, new RegExp(`Supersedes: ${old.id}`));
  assert.match(detail, new RegExp(`Superseded by: ${latest.id}`));
  assert.ok(detail.includes(`${old.id} → ${middle.id} → ${latest.id}`));
  assert.match(getItem(root, old.id), new RegExp(`Superseded by: ${middle.id}`));
  assert.match(getItem(root, latest.id), new RegExp(`Supersedes: ${middle.id}`));
  assert.match(getItem(root, old.id), new RegExp(`## RSH backlinks[\\s\\S]*${middle.id}`));
  assert.doesNotMatch(getItem(root, unrelated.id), /## Replacement chain/);
});

test("find demotes deprecated records by default and annotates superseded hits", () => {
  const root = tempWorkspace("query-replacement-find");
  const { old, middle, latest } = seed(root);
  const hits = findRecords(root, "shared replacement evidence");
  assert.equal(hits[0].id, latest.id);
  assert.ok(hits.findIndex((item) => item.id === old.id) > hits.findIndex((item) => item.id === latest.id));
  assert.deepEqual(findRecords(root, "shared replacement evidence", { limit: 1 }).map((item) => item.id), [latest.id]);
  assert.deepEqual(new Set(findRecords(root, "shared replacement evidence", { state: "withdrawn" }).map((item) => item.id)), new Set([old.id, middle.id]));
  assert.match(formatFindMarkdown(hits), new RegExp(`${old.id}[\\s\\S]*superseded by ${middle.id}`));
});

test("resume reserves its default limit for active records and --all labels predecessors", () => {
  const root = tempWorkspace("query-replacement-resume");
  const { old, middle, latest } = seed(root);
  const active = [add(root, "Active one"), add(root, "Active two")];
  const normal = resumeResearch(root);
  for (const record of [latest, ...active]) assert.match(normal, new RegExp(`^- \\*\\*${record.id}`, "m"));
  for (const record of [old, middle]) assert.doesNotMatch(normal, new RegExp(`^- \\*\\*${record.id}`, "m"));
  const all = resumeResearch(root, { all: true });
  assert.match(all, new RegExp(`${old.id}[^\\n]*WITHDRAWN[^\\n]*superseded by ${middle.id}`));
  assert.match(all, new RegExp(`${middle.id}[^\\n]*WITHDRAWN[^\\n]*superseded by ${latest.id}`));
});

test("replacement inherits predecessor about relations for resume grouping", () => {
  const root = tempWorkspace("query-replacement-inherit-about");
  setOpen(root, [`- ${Q1} inherited topic`]);
  const old = add(root, "Old topic");
  const latest = replaceRecord(root, old.id, inputDocument(base([]), "# Corrected topic\n\nclean\n"), { isText: true });
  assert.ok(getRecord(root, latest.id).relations.some((item) => item.type === "rsh:about" && item.target === Q1));
  const resumed = resumeResearch(root);
  assert.match(resumed, new RegExp(latest.id));
  assert.doesNotMatch(resumed, new RegExp(`^- \\*\\*${old.id}`, "m"));
});

test("get renders every path through a merged replacement", () => {
  const root = tempWorkspace("query-replacement-merge");
  setOpen(root, [`- ${Q1} merged topic`]);
  const first = add(root, "First fragment");
  const second = add(root, "Second fragment");
  const merged = replaceRecord(root, first.id, inputDocument(base([
    { type: "rsh:supersedes", target: second.id }
  ]), "# Complete result\n\nwhole argument\n"), { isText: true });
  const detail = getItem(root, merged.id);
  assert.match(detail, new RegExp(`Supersedes: ${first.id}, ${second.id}`));
  assert.match(detail, new RegExp(`${first.id} → ${merged.id}`));
  assert.match(detail, new RegExp(`${second.id} → ${merged.id}`));
});
