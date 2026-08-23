import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { semanticDiff } from "../src/core/diff.js";
import { serializeDocument } from "../src/core/doc.js";

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function write(root, relative, contents) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, "utf8");
}

function finding(id, state, factId = undefined) {
  return serializeDocument({ schema: "rsh.finding.v1", id, kind: "proof_attempt", title: id, state, trust: "finding", ...(factId ? { fact_id: factId } : {}) }, { Statement: `Statement ${id}`, Proof: "Proof" });
}

function fact(factId) {
  return serializeDocument({
    schema: "rsh.fact.v1",
    fact_id: factId,
    problem_id: "p",
    kind: "lemma",
    verification: { state: "accepted", method: "human_review", authority: "reviewer" },
    evidence_grade: "formal",
    resolution: "proved"
  }, { Statement: `Statement ${factId}`, Proof: "Proof" });
}

function commit(root, message) {
  git(root, ["add", "."]);
  git(root, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", message]);
  return git(root, ["rev-parse", "HEAD"]);
}

test("semantic diff reads RSH state from refs by object id and reports research transitions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsh-semantic-diff-"));
  git(root, ["init", "-q"]);
  write(root, "README.md", "empty RSH snapshot\n");
  const empty = commit(root, "empty snapshot");

  write(root, ".rsh/findings/F1.md", finding("F1", "unverified"));
  write(root, ".rsh/facts/FACT-A.md", fact("FACT-A"));
  const first = commit(root, "initial research state");

  fs.renameSync(path.join(root, ".rsh/findings/F1.md"), path.join(root, ".rsh/findings/renamed.md"));
  write(root, ".rsh/findings/renamed.md", finding("F1", "supported", "FACT-B"));
  write(root, ".rsh/facts/FACT-B.md", fact("FACT-B"));
  const edge = { schema: "rsh.edge.v1", from: "FACT-B", type: "DEPENDS_ON", to: "FACT-A", at: "2026-01-01T00:00:00.000Z" };
  const explorationDependency = { schema: "rsh.edge.v1", from: "F1", type: "DEPENDS_ON", to: "FACT-A", at: "2026-01-01T00:00:00.000Z" };
  const produced = { schema: "rsh.edge.v1", from: "F1", type: "PRODUCED", to: "FACT-B", at: "2026-01-01T00:00:00.000Z" };
  const revocation = { fact_id: "FACT-A", root_fact_id: "FACT-A", at: "2026-01-01T00:00:00.000Z", reason: "counterexample", authority: "reviewer" };
  write(root, ".rsh/graph/edges.jsonl", `${JSON.stringify(edge)}\n${JSON.stringify(edge)}\n${JSON.stringify(explorationDependency)}\n${JSON.stringify(produced)}\n`);
  write(root, ".rsh/revocations.jsonl", `${JSON.stringify(revocation)}\n${JSON.stringify(revocation)}\n`);
  const second = commit(root, "promotion dependency and revocation");

  // A dirty worktree must not affect an explicit ref-to-ref comparison.
  write(root, ".rsh/findings/renamed.md", finding("F1", "challenged", "FACT-B"));
  const result = semanticDiff(root, first, second);

  assert.equal(result.snapshots.from.kind, "git");
  assert.equal(result.snapshots.to.kind, "git");
  assert.equal(result.findings.added.length, 0, "renames are matched by RSH object id, not pathname");
  assert.equal(result.findings.removed.length, 0);
  assert.equal(result.findings.changed.length, 1);
  assert.equal(result.findings.changed[0].after.state, "supported");
  assert.deepEqual(Object.keys(result.findings.changed[0].changes), ["fact_id", "state"]);
  assert.deepEqual(result.facts.added.map((item) => item.fact_id), ["FACT-B"]);
  assert.equal(result.facts.changed[0].fact_id, "FACT-A");
  assert.deepEqual(result.facts.changed[0].changes.truth_status, { before: "active", after: "revoked" });
  assert.deepEqual(result.promotions.added, [{ finding_id: "F1", fact_id: "FACT-B" }]);
  assert.deepEqual(result.dependencies.added, [{ from: "FACT-B", type: "DEPENDS_ON", to: "FACT-A" }]);
  assert.deepEqual(result.revocations.added, [revocation], "duplicate JSONL receipts are deduplicated");
  assert.deepEqual(result.summary, {
    findings: { added: 0, removed: 0, changed: 1 },
    facts: { added: 1, removed: 0, changed: 1 },
    promotions: { added: 1, removed: 0, changed: 0 },
    revocations: { added: 1, removed: 0, changed: 0 },
    dependencies: { added: 1, removed: 0, changed: 0 },
    file_changes: 5
  });

  const noChange = semanticDiff(root, second, second);
  assert.deepEqual(noChange.summary, {
    findings: { added: 0, removed: 0, changed: 0 },
    facts: { added: 0, removed: 0, changed: 0 },
    promotions: { added: 0, removed: 0, changed: 0 },
    revocations: { added: 0, removed: 0, changed: 0 },
    dependencies: { added: 0, removed: 0, changed: 0 },
    file_changes: 0
  });

  const fromEmpty = semanticDiff(root, empty, first);
  assert.deepEqual(fromEmpty.findings.added.map((item) => item.id), ["F1"], "a ref without .rsh is an empty RSH snapshot");
});

test("omitting FROM compares HEAD to the worktree and bad refs fail clearly", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rsh-semantic-worktree-"));
  git(root, ["init", "-q"]);
  write(root, ".rsh/findings/F1.md", finding("F1", "open"));
  commit(root, "initial state");
  write(root, ".rsh/findings/F1.md", finding("F1", "challenged"));
  write(root, ".rsh/cache/index.json", "{}\n");
  write(root, ".rsh/locks/write.lock/holder.json", "{}\n");

  const worktree = semanticDiff(root);
  assert.equal(worktree.range, "HEAD..WORKTREE");
  assert.deepEqual(worktree.snapshots.to, { kind: "worktree", ref: null });
  assert.equal(worktree.findings.changed[0].after.state, "challenged");
  assert.deepEqual(worktree.file_changes.map((item) => item.file), [".rsh/findings/F1.md"]);
  assert.throws(() => semanticDiff(root, "does-not-exist", "HEAD"), /Unable to read RSH snapshot for Git ref/);

  const unborn = fs.mkdtempSync(path.join(os.tmpdir(), "rsh-semantic-unborn-"));
  git(unborn, ["init", "-q"]);
  assert.throws(() => semanticDiff(unborn), /HEAD may be unborn/);
});
