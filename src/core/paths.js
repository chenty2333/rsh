import fs from "node:fs";
import path from "node:path";

export function findWorkspace(start = process.cwd()) {
  let current = path.resolve(start);
  if (fs.existsSync(current) && fs.statSync(current).isFile()) current = path.dirname(current);
  while (true) {
    if (fs.existsSync(path.join(current, ".rsh", "manifest.toml"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export const findWorkspaceRoot = findWorkspace;

export function requireWorkspace(start = process.cwd()) {
  const root = findWorkspace(start);
  if (!root) throw new Error("No RSH workspace found. Run `rsh init` first.");
  assertWorkspaceLayout(root);
  return root;
}

export function workspacePaths(root) {
  const resolved = path.resolve(root);
  const state = path.join(resolved, ".rsh");
  return {
    root: resolved,
    intent: path.join(resolved, "RSH.md"),
    state,
    records: path.join(state, "records"),
    manifest: path.join(state, "manifest.toml")
  };
}

export function assertWorkspaceLayout(root) {
  const paths = workspacePaths(root);
  if (!fs.existsSync(paths.intent) || !fs.statSync(paths.intent).isFile()) throw new Error("Invalid RSH workspace: missing RSH.md");
  if (!fs.existsSync(paths.manifest) || !fs.statSync(paths.manifest).isFile()) throw new Error("Invalid RSH workspace: missing manifest.toml");
  if (!fs.existsSync(paths.records) || !fs.statSync(paths.records).isDirectory()) throw new Error("Invalid RSH workspace: missing records directory");
  return paths;
}
