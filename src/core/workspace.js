import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { SCHEMAS } from "./constants.js";
import { ensureDir, safeRead, writeJsonAtomic } from "./fs.js";
import { findGitRoot, workspacePaths } from "./paths.js";
import { shortHash } from "./canonical.js";

function git(args, cwd, options = {}) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"]
  }).trim();
}

export function ensureGitRepository(root) {
  const gitRoot = findGitRoot(root);
  if (gitRoot) return gitRoot;
  git(["init"], root);
  return root;
}

function appendUniqueBlock(file, marker, content) {
  const existing = safeRead(file, "");
  if (existing.includes(marker)) return false;
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(file, `${prefix}\n${marker}\n${content.trim()}\n`, "utf8");
  return true;
}

export function initializeWorkspace(root, options = {}) {
  root = path.resolve(root);
  ensureDir(root);
  const gitRoot = ensureGitRepository(root);
  if (path.resolve(gitRoot) !== root && !options.allowNested) root = gitRoot;
  const paths = workspacePaths(root);
  for (const dir of [paths.rsh, paths.findings, paths.facts, paths.graph, paths.evidence, paths.traces, paths.cache, paths.examples]) ensureDir(dir);

  if (!fs.existsSync(paths.workspace) || options.force) {
    const name = options.name ?? path.basename(root);
    writeJsonAtomic(paths.workspace, {
      schema: SCHEMAS.workspace,
      workspace_id: `ws-${shortHash(`${root}:${Date.now()}`, 12)}`,
      name,
      created_at: new Date().toISOString(),
      format_version: 1,
      truth_policy: {
        accepted_methods: ["human_review", "reproduced", "formal", "imported_verified"],
        allow_llm_audit_as_truth: false
      },
      compiler: {
        mode: "agent_ir",
        command: null,
        heuristic_fallback: true
      },
      retrieval: {
        graph_hops: 1,
        max_results: 20,
        embedding_command: null
      }
    });
  }

  const ignoreMarker = "# rsh generated caches";
  appendUniqueBlock(path.join(root, ".gitignore"), ignoreMarker, ".rsh/cache/\n.rsh/tmp/\n.rsh/locks/");
  installSkills(root, options);
  appendUniqueBlock(
    path.join(root, "AGENTS.md"),
    "<!-- rsh-agent-instructions -->",
    "Before substantial research, read `.agents/skills/rsh/SKILL.md` and run `rsh orient` / `rsh check`. Treat `.rsh/findings` as awareness and `.rsh/facts` as the workspace truth graph."
  );
  appendUniqueBlock(
    path.join(root, "CLAUDE.md"),
    "<!-- rsh-claude-instructions -->",
    "Use `.claude/skills/rsh/SKILL.md`. Preflight serious research routes with RSH and propose findings after meaningful state changes. Never silently promote a finding to a fact."
  );
  const mcpFile = path.join(root, ".mcp.json");
  if (!fs.existsSync(mcpFile) || options.force) {
    writeJsonAtomic(mcpFile, {
      mcpServers: {
        rsh: {
          command: "rsh",
          args: ["mcp", "--role", "agent"],
          cwd: "."
        }
      }
    });
  }
  if (!fs.existsSync(paths.edges)) fs.writeFileSync(paths.edges, "", "utf8");
  for (const file of [paths.events, paths.verifications, paths.revocations]) if (!fs.existsSync(file)) fs.writeFileSync(file, "", "utf8");
  return { root, paths };
}

function installSkills(root, options = {}) {
  const skill = `---\nname: rsh\ndescription: Use RSH as the persistent research-state repository and preflight analyzer.\n---\n\n# RSH workflow\n\n1. Before substantial research, run \`rsh orient <goal>\`.\n2. Compile a proposed route into typed IR and run \`rsh check --ir <file>\` before spending significant effort.\n3. If the route is BLOCKED, do not repeat it unchanged. Inspect the counterexample scope and recorded escape conditions.\n4. After a theorem, counterexample, barrier, meaningful dead end, or open gap is found, propose a finding with \`rsh record\` or the MCP tool.\n5. Findings are awareness, not truth. Only the configured verification workflow may create facts.\n6. Cite object IDs and evidence references in downstream work.\n7. Never infer that a failed child branch revokes preserved ancestor facts.\n`;
  for (const target of [path.join(root, ".agents", "skills", "rsh", "SKILL.md"), path.join(root, ".claude", "skills", "rsh", "SKILL.md")]) {
    ensureDir(path.dirname(target));
    if (!fs.existsSync(target) || options.force) fs.writeFileSync(target, skill, "utf8");
  }
}

export function environmentIdentity() {
  return {
    user: process.env.USER ?? process.env.USERNAME ?? os.userInfo().username,
    hostname: os.hostname()
  };
}
