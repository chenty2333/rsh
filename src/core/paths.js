import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function findGitRoot(start = process.cwd()) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: start,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

export function findWorkspaceRoot(start = process.cwd()) {
  let current = path.resolve(start);
  while (true) {
    if (fs.lstatSync(path.join(current, ".rsh"), { throwIfNoEntry: false })) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function requireWorkspace(start = process.cwd()) {
  const root = findWorkspaceRoot(start);
  if (!root) throw new Error("No RSH workspace found. Run `rsh init` first.");
  return root;
}

export function workspacePaths(root) {
  const rsh = path.join(root, ".rsh");
  return {
    root,
    research: path.join(root, "RESEARCH.md"),
    rsh,
    records: path.join(rsh, "records"),
    locks: path.join(rsh, "locks")
  };
}

function requireManagedPath(file, kind, label) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat || stat.isSymbolicLink() || (kind === "file" ? !stat.isFile() : !stat.isDirectory())) {
    throw new Error(`Invalid RSH workspace: ${label} must be a real ${kind}`);
  }
}

export function assertWorkspaceLayout(root) {
  const paths = workspacePaths(path.resolve(root));
  requireManagedPath(paths.rsh, "directory", ".rsh");
  requireManagedPath(paths.research, "file", "RESEARCH.md");
  requireManagedPath(paths.records, "directory", ".rsh/records");
  requireManagedPath(paths.locks, "directory", ".rsh/locks");
  return paths;
}
