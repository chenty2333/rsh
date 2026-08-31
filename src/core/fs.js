import fs from "node:fs";
import path from "node:path";

export function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

export function writeText(target, contents) {
  if (typeof contents !== "string") throw new Error("file contents must be text");
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, contents, "utf8");
}
