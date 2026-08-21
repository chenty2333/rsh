import { execFileSync } from "node:child_process";
import { traceFile, appendTrace } from "./utils.js";

export const gitImporter = {
  name: "git",
  detect() { return true; },
  import(store, source = store.root, options = {}) {
    const format = "%H%x1f%aI%x1f%an%x1f%s%x1e";
    const raw = execFileSync("git", ["log", `--max-count=${options.limit ?? 500}`, `--format=${format}`], { cwd: source, encoding: "utf8" });
    const target = traceFile(store, "git", source);
    let count = 0;
    for (const item of raw.split("\x1e").filter(Boolean)) {
      const [sha, at, author, subject] = item.trim().split("\x1f");
      appendTrace(target, { adapter: "git", source, sha, at, author, subject });
      count += 1;
    }
    store.event("IMPORT_COMPLETED", { adapter: "git", source, traces: count });
    return { traces: count, file: target };
  }
};
