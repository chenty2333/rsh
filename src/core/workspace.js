import fs from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import { ensureDir, writeText } from "./fs.js";
import { assertWorkspaceLayout, workspacePaths } from "./paths.js";
import { validateIntent } from "./model.js";

export const MANIFEST = 'format = "rsh/0.1.5"\n';

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseManifest(source) {
  let manifest;
  try {
    manifest = parseToml(source);
  } catch (error) {
    throw new Error(`invalid manifest: ${error.message}`);
  }
  if (!plain(manifest) || Object.keys(manifest).length !== 1 || manifest.format !== "rsh/0.1.5") {
    throw new Error('manifest must be exactly format = "rsh/0.1.5"');
  }
  return manifest;
}

export function showIntent(root) {
  const paths = assertWorkspaceLayout(root);
  parseManifest(fs.readFileSync(paths.manifest, "utf8"));
  return validateIntent(fs.readFileSync(paths.intent, "utf8"));
}

export function replaceIntent(root, value) {
  const paths = assertWorkspaceLayout(root);
  parseManifest(fs.readFileSync(paths.manifest, "utf8"));
  const intent = validateIntent(value);
  writeText(paths.intent, intent);
  return intent;
}

export function initializeWorkspace(root, value) {
  const intent = validateIntent(value);
  const paths = workspacePaths(path.resolve(root));
  if (!fs.existsSync(paths.root) || !fs.statSync(paths.root).isDirectory()) {
    throw new Error("workspace root must be an existing directory");
  }
  if (fs.existsSync(paths.intent) || fs.existsSync(paths.state)) {
    throw new Error(`Cannot initialize RSH: ${paths.root} already contains RSH state`);
  }
  ensureDir(paths.records);
  writeText(paths.intent, intent);
  writeText(paths.manifest, MANIFEST);
  return paths.root;
}
