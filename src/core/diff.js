import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { canonicalJson, sha256 } from "./canonical.js";
import { parseDocument } from "./doc.js";

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function gitError(action, ref, error) {
  const detail = error.stderr?.toString().trim() || error.message;
  throw new Error(`${action} ${JSON.stringify(ref)}: ${detail}`);
}

function classify(file) {
  if (file.startsWith(".rsh/findings/")) return "exploration";
  if (file.startsWith(".rsh/facts/")) return "truth";
  if (file.startsWith(".rsh/evidence/")) return "evidence";
  if (file.startsWith(".rsh/traces/")) return "trace";
  if (file === ".rsh/graph/edges.jsonl") return "relations";
  if (file === ".rsh/revocations.jsonl") return "revocation";
  return "other";
}

function resolveCommit(root, ref) {
  try {
    const commit = git(["rev-parse", "--verify", "-q", "--end-of-options", `${ref}^{commit}`], root).trim();
    if (!commit) throw new Error("no commit");
    return commit;
  } catch {
    throw new Error(`Unable to read RSH snapshot for Git ref ${JSON.stringify(ref)}: ref does not resolve to a commit (HEAD may be unborn)`);
  }
}

function gitFiles(root, ref, commit) {
  let raw;
  try {
    raw = git(["ls-tree", "-r", "-z", "--format=%(objectname)%x09%(path)", commit, "--", ".rsh"], root);
  } catch (error) {
    gitError("Unable to list RSH snapshot for Git ref", ref, error);
  }
  const files = new Map();
  for (const entry of raw.split("\0")) {
    if (!entry) continue;
    const tab = entry.indexOf("\t");
    if (tab < 1) continue;
    const objectId = entry.slice(0, tab);
    const file = entry.slice(tab + 1);
    let contents;
    try {
      contents = git(["cat-file", "-p", objectId], root);
    } catch (error) {
      gitError(`Unable to read ${file} from Git ref`, ref, error);
    }
    files.set(file, { contents, object_id: objectId });
  }
  return { descriptor: { kind: "git", ref, commit }, files };
}

function worktreeFiles(root) {
  const rsh = path.join(root, ".rsh");
  const files = new Map();
  if (!fs.existsSync(rsh)) return { descriptor: { kind: "worktree", ref: null }, files };
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) {
        const file = path.relative(root, full).split(path.sep).join("/");
        if ([".rsh/cache/", ".rsh/tmp/", ".rsh/locks/"].some((prefix) => file.startsWith(prefix))) continue;
        files.set(file, { contents: fs.readFileSync(full, "utf8"), object_id: null });
      }
    }
  };
  visit(rsh);
  return { descriptor: { kind: "worktree", ref: null }, files };
}

function parseJson(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in RSH snapshot ${label}: ${error.message}`);
  }
}

function parseJsonl(text, label) {
  const records = [];
  const seen = new Set();
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const record = parseJson(line, `${label}:${index + 1}`);
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new Error(`Invalid JSONL record in RSH snapshot ${label}:${index + 1}: expected an object`);
    }
    const key = canonicalJson(record);
    if (!seen.has(key)) {
      seen.add(key);
      records.push(record);
    }
  }
  return records;
}

function objectId(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid RSH object id in snapshot ${label}`);
  return value;
}

function readSnapshot(root, ref, worktree = false) {
  const source = worktree ? worktreeFiles(root) : (() => {
    const commit = resolveCommit(root, ref);
    return gitFiles(root, ref, commit);
  })();
  const findings = new Map();
  const facts = new Map();
  const edges = [];
  const revocations = [];

  for (const [file, sourceFile] of source.files) {
    if (file.startsWith(".rsh/findings/") && file.endsWith(".md")) {
      let document;
      try {
        document = parseDocument(sourceFile.contents, file);
      } catch (error) {
        throw new Error(`Unable to parse RSH snapshot ${file}: ${error.message}`);
      }
      if (!document.metadata || typeof document.metadata !== "object" || Array.isArray(document.metadata)) {
        throw new Error(`Invalid RSH document metadata in snapshot ${file}: expected an object`);
      }
      const id = objectId(document.metadata.id, file);
      if (findings.has(id)) throw new Error(`Duplicate finding object id ${JSON.stringify(id)} in RSH snapshot`);
      findings.set(id, { id, metadata: document.metadata, sections: document.sections, body: document.body });
    } else if (file.startsWith(".rsh/facts/") && file.endsWith(".md")) {
      let document;
      try {
        document = parseDocument(sourceFile.contents, file);
      } catch (error) {
        throw new Error(`Unable to parse RSH snapshot ${file}: ${error.message}`);
      }
      if (!document.metadata || typeof document.metadata !== "object" || Array.isArray(document.metadata)) {
        throw new Error(`Invalid RSH document metadata in snapshot ${file}: expected an object`);
      }
      const factId = objectId(document.metadata.fact_id, file);
      if (facts.has(factId)) throw new Error(`Duplicate fact object id ${JSON.stringify(factId)} in RSH snapshot`);
      facts.set(factId, { fact_id: factId, metadata: document.metadata, sections: document.sections, body: document.body });
    } else if (file === ".rsh/graph/edges.jsonl") {
      edges.push(...parseJsonl(sourceFile.contents, file));
    } else if (file === ".rsh/revocations.jsonl") {
      revocations.push(...parseJsonl(sourceFile.contents, file));
    }
  }

  const effectiveRevocations = new Map();
  for (const record of revocations) effectiveRevocations.set(objectId(record.fact_id, ".rsh/revocations.jsonl"), record);
  for (const [factId, fact] of facts) fact.truth_status = effectiveRevocations.has(factId) ? "revoked" : "active";

  const dependencyMap = new Map();
  const promotionMap = new Map();
  for (const edge of edges) {
    if (edge?.type === "DEPENDS_ON" && facts.has(edge.from) && facts.has(edge.to)) {
      dependencyMap.set(`${edge.from}\u0000${edge.to}`, { from: edge.from, type: "DEPENDS_ON", to: edge.to });
    }
    if (edge?.type === "PRODUCED" && findings.has(edge.from) && facts.has(edge.to)) {
      promotionMap.set(`${edge.from}\u0000${edge.to}`, { finding_id: edge.from, fact_id: edge.to });
    }
  }
  for (const finding of findings.values()) {
    if (typeof finding.metadata.fact_id === "string" && facts.has(finding.metadata.fact_id)) {
      promotionMap.set(`${finding.id}\u0000${finding.metadata.fact_id}`, { finding_id: finding.id, fact_id: finding.metadata.fact_id });
    }
  }
  for (const fact of facts.values()) {
    const findingId = fact.metadata.provenance?.finding_id;
    if (typeof findingId === "string" && findings.has(findingId)) {
      promotionMap.set(`${findingId}\u0000${fact.fact_id}`, { finding_id: findingId, fact_id: fact.fact_id });
    }
  }

  return { ...source, findings, facts, dependencies: dependencyMap, promotions: promotionMap, revocations: effectiveRevocations };
}

function sorted(values, compare = (a, b) => canonicalJson(a).localeCompare(canonicalJson(b))) {
  return [...values].sort(compare);
}

function publicFinding(finding) {
  const metadata = finding.metadata;
  return {
    id: finding.id,
    kind: metadata.kind ?? null,
    title: metadata.title ?? null,
    state: metadata.state ?? null,
    trust: metadata.trust ?? null,
    verifiable: metadata.verifiable ?? null,
    problem_id: metadata.problem_id ?? null,
    predecessors: metadata.predecessors ?? [],
    evidence_refs: metadata.evidence_refs ?? [],
    route: metadata.route ?? null,
    failure: metadata.failure ?? null,
    outcome: metadata.outcome ?? null,
    traits: metadata.traits ?? [],
    preserves: metadata.preserves ?? [],
    glossary: metadata.glossary ?? {},
    external_refs: metadata.external_refs ?? [],
    fact_id: metadata.fact_id ?? null,
    provenance: metadata.provenance ?? null,
    sections: finding.sections,
    metadata
  };
}

function publicFact(fact) {
  const metadata = fact.metadata;
  return {
    fact_id: fact.fact_id,
    truth_status: fact.truth_status,
    kind: metadata.kind ?? null,
    title: metadata.title ?? null,
    problem_id: metadata.problem_id ?? null,
    predecessors: metadata.predecessors ?? [],
    glossary: metadata.glossary ?? {},
    verification: metadata.verification ?? null,
    evidence_grade: metadata.evidence_grade ?? null,
    resolution: metadata.resolution ?? null,
    external_refs: metadata.external_refs ?? [],
    provenance: metadata.provenance ?? null,
    sections: fact.sections,
    metadata
  };
}

function changedFields(before, after, keys) {
  const changes = {};
  for (const key of [...keys].sort()) {
    if (canonicalJson(before[key]) !== canonicalJson(after[key])) changes[key] = { before: before[key], after: after[key] };
  }
  return changes;
}

function diffObjects(before, after, render, idKey, fields) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const [id, value] of after) {
    if (!before.has(id)) added.push(render(value));
    else {
      const oldValue = render(before.get(id));
      const newValue = render(value);
      const changes = changedFields(oldValue, newValue, fields);
      if (Object.keys(changes).length) changed.push({ [idKey]: id, changes, before: oldValue, after: newValue });
    }
  }
  for (const [id, value] of before) if (!after.has(id)) removed.push(render(value));
  const byId = (a, b) => String(a[idKey]).localeCompare(String(b[idKey]));
  return { added: added.sort(byId), removed: removed.sort(byId), changed: changed.sort(byId) };
}

function diffSet(before, after) {
  const added = [];
  const removed = [];
  for (const [key, value] of after) if (!before.has(key)) added.push(value);
  for (const [key, value] of before) if (!after.has(key)) removed.push(value);
  return { added: sorted(added), removed: sorted(removed) };
}

function diffRevocations(before, after) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const [factId, receipt] of after) {
    if (!before.has(factId)) added.push(receipt);
    else if (canonicalJson(before.get(factId)) !== canonicalJson(receipt)) changed.push({ fact_id: factId, before: before.get(factId), after: receipt });
  }
  for (const [factId, receipt] of before) if (!after.has(factId)) removed.push(receipt);
  const byFactId = (a, b) => String(a.fact_id).localeCompare(String(b.fact_id));
  return { added: added.sort(byFactId), removed: removed.sort(byFactId), changed: changed.sort(byFactId) };
}

function fileChanges(before, after) {
  const changes = [];
  const paths = new Set([...before.files.keys(), ...after.files.keys()]);
  for (const file of [...paths].sort()) {
    const left = before.files.get(file);
    const right = after.files.get(file);
    if (!left) changes.push({ status: "A", file, layer: classify(file) });
    else if (!right) changes.push({ status: "D", file, layer: classify(file) });
    else if (sha256(left.contents) !== sha256(right.contents)) changes.push({ status: "M", file, layer: classify(file) });
  }
  return changes;
}

function semanticSummary(result) {
  const counts = (diff) => ({ added: diff.added.length, removed: diff.removed.length, changed: diff.changed?.length ?? 0 });
  return {
    findings: counts(result.findings),
    facts: counts(result.facts),
    promotions: counts(result.promotions),
    revocations: counts(result.revocations),
    dependencies: counts(result.dependencies),
    file_changes: result.file_changes.length
  };
}

/**
 * Compare RSH state snapshots without constructing a Store or changing Git state.
 * With no FROM, preserve the CLI's historic HEAD-to-worktree comparison. With a
 * FROM, TO defaults to HEAD; both endpoints are immutable Git commit snapshots.
 */
export function semanticDiff(root, from, to = "HEAD") {
  const before = from ? readSnapshot(root, from) : readSnapshot(root, "HEAD");
  const after = from ? readSnapshot(root, to) : readSnapshot(root, null, true);
  const findings = diffObjects(before.findings, after.findings, publicFinding, "id", [
    "kind", "title", "state", "trust", "verifiable", "problem_id", "predecessors", "evidence_refs", "route",
    "failure", "outcome", "traits", "preserves", "glossary", "external_refs", "fact_id", "provenance", "sections"
  ]);
  const facts = diffObjects(before.facts, after.facts, publicFact, "fact_id", [
    "truth_status", "kind", "title", "problem_id", "predecessors", "glossary", "verification",
    "evidence_grade", "resolution", "external_refs", "provenance", "sections"
  ]);
  const promotions = diffSet(before.promotions, after.promotions);
  const dependencies = diffSet(before.dependencies, after.dependencies);
  const revocations = diffRevocations(before.revocations, after.revocations);
  const result = {
    range: from ? `${from}..${to}` : "HEAD..WORKTREE",
    snapshots: { from: before.descriptor, to: after.descriptor },
    findings,
    facts,
    promotions,
    revocations,
    dependencies,
    file_changes: fileChanges(before, after)
  };
  result.summary = semanticSummary(result);
  // Retain a shallow alias for filename-oriented callers of the old API.
  result.changes = result.file_changes;
  return result;
}
