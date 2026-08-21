import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { initializeWorkspace } from "../src/core/workspace.js";
import { Store } from "../src/core/store.js";

export const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
export const cli = path.join(projectRoot, "bin", "rsh.js");

export function tempWorkspace(name = "test") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `rsh-${name}-`));
  execFileSync("git", ["init", "-q"], { cwd: root });
  initializeWorkspace(root, { name });
  return { root, store: new Store(root) };
}

export function runCli(root, args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    input: options.input,
    env: { ...process.env, ...options.env }
  });
  if (options.expectSuccess !== false && result.status !== 0) {
    throw new Error(`CLI failed (${result.status}): rsh ${args.join(" ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}
