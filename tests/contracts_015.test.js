import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { formatMemoryId, MEMORY_ID_SPACE, tokenEstimate } from "../src/core/model.js";
import { idFrom, memory, projectRoot, runCli, workspace, write } from "./helpers.js";

function frontmatter(source) {
  return parseToml(source.slice(4, source.indexOf("\n+++\n", 4)));
}

test("0.1.5 initializes the complete three-part state", () => {
  const root = workspace("layout");
  assert.deepEqual(fs.readdirSync(path.join(root, ".rsh")).sort(), ["manifest.toml", "records"]);
  assert.deepEqual(fs.readdirSync(path.join(root, ".rsh", "records")), []);
  assert.equal(fs.readFileSync(path.join(root, ".rsh", "manifest.toml"), "utf8"), 'format = "rsh/0.1.5"\n');
  assert.equal(fs.readFileSync(path.join(root, "RSH.md"), "utf8"), fs.readFileSync(path.join(root, "INTENT.md"), "utf8"));
});

test("five-character base36 IDs advance from the greatest stored ID", () => {
  assert.equal(formatMemoryId(0), "R-00000");
  assert.equal(formatMemoryId(35), "R-0000z");
  assert.equal(formatMemoryId(36), "R-00010");
  assert.equal(formatMemoryId(MEMORY_ID_SPACE - 1), "R-zzzzz");
  assert.throws(() => formatMemoryId(MEMORY_ID_SPACE), /five-digit base36/);

  const root = workspace("ids");
  const ids = [];
  for (let index = 0; index < 38; index += 1) {
    const file = write(root, `memory-${index}.md`, memory({ title: `Conclusion ${index}` }));
    ids.push(idFrom(runCli(root, ["remember", file])));
  }
  assert.deepEqual(ids.slice(0, 2), ["R-00000", "R-00001"]);
  assert.deepEqual(ids.slice(34), ["R-0000y", "R-0000z", "R-00010", "R-00011"]);
});

test("Memory input is exactly the five semantic fields for every kind", () => {
  const root = workspace("schema");
  const kinds = ["finding", "decision", "question", "dead_end", "hazard"];
  for (const [index, kind] of kinds.entries()) {
    const id = idFrom(runCli(root, ["remember", write(root, `${kind}.md`, memory({ kind, title: `${kind} conclusion` }))]));
    assert.equal(id, formatMemoryId(index));
    const stored = fs.readFileSync(path.join(root, ".rsh", "records", `${id}.md`), "utf8");
    assert.deepEqual(Object.keys(frontmatter(stored)).sort(), ["id", "kind", "scope", "summary", "title"]);
  }

  for (const [name, extra] of [
    ["identity", { id: "R-00009" }],
    ["tag", { topics: ["proof"] }],
    ["kind-detail", { trigger: "an old special field" }]
  ]) {
    const result = runCli(root, ["remember", write(root, `invalid-${name}.md`, memory(extra))], { success: false });
    assert.notEqual(result.status, 0);
  }
});

test("correct replaces one Memory in place under the same ID", () => {
  const root = workspace("correct");
  const id = idFrom(runCli(root, ["remember", write(root, "old.md", memory({ title: "Old conclusion", body: "# Old\n\nOld evidence.\n" }))]));
  const result = runCli(root, ["correct", id, write(root, "new.md", memory({ kind: "decision", title: "Correct conclusion", body: "# New\n\nReplacement evidence.\n" }))]);
  assert.equal(idFrom(result), id);
  assert.deepEqual(fs.readdirSync(path.join(root, ".rsh", "records")), [`${id}.md`]);
  const read = runCli(root, ["read", id]).stdout;
  assert.match(read, /Correct conclusion/);
  assert.match(read, /Replacement evidence/);
  assert.doesNotMatch(read, /Old evidence/);
  assert.notEqual(runCli(root, ["correct", "R-00001", write(root, "missing.md", memory())], { success: false }).status, 0);
});

test("Intent remains verbatim, bounded, and replace-only", () => {
  const original = "# Exact Intent\n\nPreserve every byte, including the final newline.\n";
  const root = workspace("intent", original);
  assert.equal(fs.readFileSync(path.join(root, "RSH.md"), "utf8"), original);

  const replacement = "# Replacement\n\nUse the new explicit endpoint.\n";
  runCli(root, ["intent", "replace", write(root, "replacement.md", replacement)]);
  assert.equal(fs.readFileSync(path.join(root, "RSH.md"), "utf8"), replacement);
  assert.notEqual(runCli(root, ["intent", "show"], { success: false }).status, 0);
  assert.notEqual(runCli(root, ["intent", "replace", write(root, "too-large.md", `# Large\n\n${"界".repeat(801)}`)], { success: false }).status, 0);
  assert.notEqual(runCli(root, ["intent", "replace", write(root, "bad.md", "not an H1\n")], { success: false }).status, 0);
});

test("workspace discovery chooses the nearest ancestor", () => {
  const outer = workspace("outer", "# Outer Intent\n\nOuter result.\n");
  const inner = path.join(outer, "nested", "inner");
  fs.mkdirSync(inner, { recursive: true });
  runCli(inner, ["init", write(inner, "intent.md", "# Inner Intent\n\nInner result.\n")]);
  const deep = path.join(inner, "a", "b");
  fs.mkdirSync(deep, { recursive: true });
  const brief = runCli(deep, ["brief"]).stdout;
  assert.match(brief, /^# Inner Intent/m);
  assert.doesNotMatch(brief, /Outer Intent/);
});

test("Brief uses Intent relevance, contains one Intent, and never exposes bodies", () => {
  const root = workspace("brief", "# Intent\n\nProve the stable Frobenius decoder lattice theorem.\n");
  const kinds = ["finding", "finding", "finding", "finding", "finding", "dead_end", "hazard"];
  for (const [index, kind] of kinds.entries()) {
    runCli(root, ["remember", write(root, `relevant-${index}.md`, memory({
      kind,
      title: `Frobenius decoder lemma ${index}`,
      summary: `The stable lattice conclusion holds in case ${index}.`,
      scope: `decoder theorem case ${index}`,
      body: `# Private evidence\n\nBODY-MUST-STAY-PRIVATE-${index}\n`
    }))]);
  }
  runCli(root, ["remember", write(root, "unrelated.md", memory({
    title: "Browser color palette",
    summary: "A visual theme uses amber accents.",
    scope: "unrelated user interface",
    body: "# Private\n\nUNRELATED-BODY\n"
  }))]);

  const output = runCli(root, ["brief"]).stdout;
  assert.equal((output.match(/^# Intent$/gm) ?? []).length, 1);
  assert.equal((output.match(/^- \*\*R-[0-9a-z]{5}\*\*/gm) ?? []).length, 5);
  assert.equal(output.includes("BODY-MUST-STAY-PRIVATE"), false);
  assert.equal(output.includes("UNRELATED-BODY"), false);
  assert.equal(output.includes("Browser color palette"), false);
  assert.ok(output.indexOf("[hazard]") < output.indexOf("[dead_end]"));
  assert.ok(Buffer.byteLength(output, "utf8") <= 8192);
  assert.ok(tokenEstimate(output) <= 1600);
  assert.equal(runCli(root, ["brief"]).stdout, output);
});

test("Brief without a matching Memory is still useful and bounded", () => {
  const root = workspace("empty-brief", "# Singular Intent\n\nProve a quasar inequality.\n");
  runCli(root, ["remember", write(root, "other.md", memory({ title: "Kernel syscall", summary: "An ABI row is complete.", scope: "native x86" }))]);
  const output = runCli(root, ["brief"]).stdout;
  assert.equal((output.match(/^# Singular Intent$/gm) ?? []).length, 1);
  assert.doesNotMatch(output, /Kernel syscall/);
  assert.match(output, /RSH boundary/);
  assert.ok(tokenEstimate(output) <= 1600);
});

test("search returns at most five cards and read is the only full-body path", () => {
  const root = workspace("search");
  const ids = [];
  for (let index = 0; index < 7; index += 1) {
    ids.push(idFrom(runCli(root, ["remember", write(root, `search-${index}.md`, memory({
      title: `Spectral certificate ${index}`,
      summary: `The spectral certificate closes case ${index}.`,
      body: `# Evidence\n\nSEARCH-PRIVATE-${index}\n`
    }))])));
  }
  const results = JSON.parse(runCli(root, ["search", "spectral certificate"]).stdout);
  assert.equal(results.length, 5);
  assert.deepEqual(Object.keys(results[0]).sort(), ["id", "kind", "scope", "summary", "title"]);
  assert.equal(JSON.stringify(results).includes("SEARCH-PRIVATE"), false);
  assert.match(runCli(root, ["read", ids[0]]).stdout, /SEARCH-PRIVATE-0/);
  assert.notEqual(runCli(root, ["search", ""], { success: false }).status, 0);
});

test("public source and guidance contain none of the retired machinery", () => {
  const entries = ["src", "hooks", "skills", "docs", "README.md"];
  const files = entries.flatMap((entry) => {
    const target = path.join(projectRoot, entry);
    if (fs.statSync(target).isFile()) return [target];
    const visit = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((item) =>
      item.isDirectory() ? visit(path.join(directory, item.name)) : [path.join(directory, item.name)]);
    return visit(target);
  });
  const forbidden = ["focus", "doctor", "predecessor", "created_at", "noop", "replay", "sha256", "createhash"];
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8").toLowerCase();
    for (const term of forbidden) {
      assert.equal(source.includes(term), false, `${path.relative(projectRoot, file)} contains ${term}`);
    }
  }
});

test("the CLI rejects flags and non-memory lifecycle commands", () => {
  const root = workspace("surface");
  const help = runCli(root, ["help"]).stdout;
  assert.deepEqual(
    [...help.matchAll(/^  rsh ([^\s]+)/gm)].map((match) => match[1]),
    ["init", "brief", "search", "read", "intent", "remember", "correct", "mcp", "help", "version"]
  );
  assert.notEqual(runCli(root, ["brief", "--task", "anything"], { success: false }).status, 0);
  assert.notEqual(runCli(root, ["search", "memory", "--limit", "2"], { success: false }).status, 0);
  for (const command of ["status", "agenda", "resume", "checkpoint", "focus", "doctor", "review", "delete", "upgrade"]) {
    assert.notEqual(runCli(root, [command], { success: false }).status, 0);
  }
});
