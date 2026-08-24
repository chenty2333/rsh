import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { commitFileBatch, ensureDir } from "./fs.js";
import { workspacePaths } from "./paths.js";

const RESEARCH_TEMPLATE = `# Research

## Context

Describe the current research problem here.

## Open
`;

const LOCKS_IGNORE = `*
!.gitignore
`;

const SKILLS = {
  "rsh-resume": {
    description: "Resume work from the durable state in an RSH workspace.",
    body: `# Resume RSH research

1. Run \`rsh resume\` at the start of a research turn.
2. Use \`rsh find\` and \`rsh get\` only when relevant records need expansion.
3. Continue from the open frontier in \`RESEARCH.md\`; \`rsh:about\` relations group records with frontier items.
4. Treat an \`rsh:supersedes\` chain as Record replacement history. Prefer the latest active successor; expand superseded or withdrawn versions only when their history matters.
`
  },
  "rsh-checkpoint": {
    description: "Checkpoint meaningful research progress in an RSH workspace.",
    body: `# Checkpoint RSH research

1. Create a checkpoint only for a reusable result, an excluded path, a new question, or a frontier change.
2. Store one main conclusion per result record. Its Markdown should normally cover Conclusion, Argument/Evidence, Scope (including assumptions, limits, and exceptions), and optionally Reuse.
3. Put structured links in \`[[relations]]\` entries such as \`type = "rsh:about"\` and \`target = "Q-abc"\`; cite record IDs in the body where they are actually used. A frontier \`open\` action automatically adds \`rsh:about\` from this Record to each generated Q/D item.
4. When a result's main conclusion is itself a relation, it may include one projection: \`[assertion]\`, with \`subject = "R-b2c"\`, \`predicate = "math:generalizes"\`, and \`object = "R-c3d"\`. The body remains authoritative.
5. Dead ends should preserve the attempted goal, failure mechanism, evidence, scope, and \`retry_if\`; experiences should preserve the observation, applicable context, reusable method, and misuse boundary.
6. Every record needs a non-empty Markdown body. With MCP, call \`rsh_checkpoint\` using structured \`kind\` and \`body\` fields plus optional \`relations\`, \`assertion\`, and \`frontier\`; with the CLI, run \`rsh checkpoint FILE.md\`. RSH rejects illegal C0 control characters while preserving tabs and line breaks.
7. For batch creation through MCP, call the structured tool once per Record. Split batches only at semantic boundaries: never divide one theorem, proof, argument, or other independently readable conclusion because of line, size, or chunk boundaries. Never generate or execute JavaScript or shell command strings containing Markdown or LaTeX; language-level escaping can silently corrupt backslashes. After every write, compare the returned \`body_sha256\` and \`body_preview\` with the intended content before continuing.
8. Correct an existing Record with \`rsh_replace\` (or \`rsh replace RECORD_ID FILE.md\`). Replacement atomically creates the successor, inherits \`rsh:about\`, adds its reserved \`rsh:supersedes\` relation, and withdraws the old Record. To merge split Records, include \`rsh:supersedes\` relations for additional predecessors in the replacement input; all are withdrawn atomically. If a predecessor contains prohibited controls, replacement renders them as visible \`\\uXXXX\` tokens and reports \`predecessor_controls_sanitized\`. Do not add \`rsh:supersedes\` to an ordinary checkpoint.
9. Do not save ordinary step-by-step reasoning.
`
  }
};

function skillDocument(name, definition) {
  return `---\nname: ${name}\ndescription: ${definition.description}\n---\n\n${definition.body}`;
}

export function checkRipgrep() {
  try {
    execFileSync("rg", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    throw new Error("RSH requires ripgrep (`rg`). Install ripgrep and ensure `rg` is available on PATH, then run `rsh init` again.");
  }
}

function assertEmptyWorkspace(paths) {
  if (fs.lstatSync(paths.research, { throwIfNoEntry: false })) {
    throw new Error(`RESEARCH.md already exists at ${paths.root}; refusing to overwrite existing research state.`);
  }
  const rsh = fs.lstatSync(paths.rsh, { throwIfNoEntry: false });
  if (!rsh) return;
  if (rsh.isSymbolicLink() || !rsh.isDirectory() || fs.readdirSync(paths.rsh).length > 0) {
    throw new Error(`Cannot initialize RSH: ${paths.rsh} already exists and is not an empty directory.`);
  }
}

export function generatedSkillFiles(root) {
  const files = [];
  for (const parent of [".agents", ".claude"]) {
    for (const [name, definition] of Object.entries(SKILLS)) {
      files.push({ target: path.join(root, parent, "skills", name, "SKILL.md"), contents: skillDocument(name, definition) });
    }
  }
  return files;
}

function assertSafeSkillTargets(files, root) {
  for (const { target, contents } of files) {
    let current = path.dirname(target);
    while (current !== root) {
      const stat = fs.lstatSync(current, { throwIfNoEntry: false });
      if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) throw new Error(`Cannot initialize RSH through unsafe skill path ${current}`);
      current = path.dirname(current);
    }
    const stat = fs.lstatSync(target, { throwIfNoEntry: false });
    if (stat && (stat.isSymbolicLink() || !stat.isFile())) throw new Error(`Cannot initialize RSH through unsafe skill file ${target}`);
    if (stat && fs.readFileSync(target, "utf8") !== contents) throw new Error(`Cannot initialize RSH: ${target} already exists with incompatible content; refusing to overwrite it.`);
  }
}

function ensureTrackedDirectory(directory, root, created) {
  if (directory === root) return;
  ensureTrackedDirectory(path.dirname(directory), root, created);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory);
    created.push(directory);
  }
}

export function initializeWorkspace(root) {
  checkRipgrep();
  root = path.resolve(root);
  const paths = workspacePaths(root);
  assertEmptyWorkspace(paths);
  ensureDir(root);
  const skills = generatedSkillFiles(root);
  assertSafeSkillTargets(skills, root);
  const created = [];
  try {
    ensureTrackedDirectory(paths.records, root, created);
    ensureTrackedDirectory(paths.locks, root, created);
    for (const skill of skills) ensureTrackedDirectory(path.dirname(skill.target), root, created);
    commitFileBatch([
      { target: paths.research, contents: RESEARCH_TEMPLATE },
      { target: path.join(paths.locks, ".gitignore"), contents: LOCKS_IGNORE },
      ...skills.filter(({ target }) => !fs.existsSync(target))
    ]);
  } catch (error) {
    for (const directory of [...created].reverse()) {
      try { if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory); } catch {}
    }
    throw error;
  }
  return { root, paths };
}
