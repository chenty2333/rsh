import fs from "node:fs";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { GENERATED_ID_SPACE, RECORD_ID_PATTERN, formatGeneratedId, nextGeneratedOrdinal } from "./ids.js";
import { workspacePaths } from "./paths.js";

function retainedTrashIds(root) {
  const trash = workspacePaths(root).trash;
  const trashStat = fs.lstatSync(trash, { throwIfNoEntry: false });
  if (!trashStat) return [];
  if (trashStat.isSymbolicLink() || !trashStat.isDirectory()) throw new Error(".rsh/trash must be a real directory");
  const ids = [];
  for (const operation of fs.readdirSync(trash, { withFileTypes: true })) {
    if (operation.name === ".gitignore") {
      if (operation.isSymbolicLink() || !operation.isFile()
        || fs.readFileSync(path.join(trash, operation.name), "utf8") !== "*\n!.gitignore\n") {
        throw new Error("Invalid .rsh/trash .gitignore");
      }
      continue;
    }
    if (operation.isSymbolicLink() || !operation.isDirectory()) throw new Error(`Invalid .rsh/trash entry ${operation.name}`);
    if (operation.name.startsWith(".pending-")) {
      throw new Error(`Interrupted delete ${operation.name} requires rsh delete or rsh undo recovery`);
    }
    const undoMarker = path.join(trash, operation.name, ".undoing");
    const undoStat = fs.lstatSync(undoMarker, { throwIfNoEntry: false });
    if (undoStat) throw new Error(`Interrupted undo ${operation.name} requires rsh delete or rsh undo recovery`);
    const records = path.join(trash, operation.name, "records");
    const recordsStat = fs.lstatSync(records, { throwIfNoEntry: false });
    if (!recordsStat || recordsStat.isSymbolicLink() || !recordsStat.isDirectory()) {
      throw new Error(`Invalid .rsh/trash operation ${operation.name}: records directory is missing`);
    }
    for (const entry of fs.readdirSync(records, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || !entry.isFile() || !entry.name.endsWith(".md")) {
        throw new Error(`Invalid .rsh/trash Record entry ${operation.name}/${entry.name}`);
      }
      const id = entry.name.slice(0, -3);
      if (!RECORD_ID_PATTERN.test(id)) throw new Error(`Invalid .rsh/trash Record entry ${operation.name}/${entry.name}`);
      ids.push(id);
    }
  }
  return ids;
}

function parseSequenceFile(file) {
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) return null;
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(".rsh/sequence.toml must be a real file");
  let value;
  try { value = parseToml(fs.readFileSync(file, "utf8")); }
  catch (error) { throw new Error(`Invalid .rsh/sequence.toml: ${error.message}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 1 || !Number.isInteger(value.next)
    || value.next < 0 || value.next > GENERATED_ID_SPACE) {
    throw new Error(".rsh/sequence.toml must contain exactly one integer next in the five-digit ID range");
  }
  return value.next;
}

export function inspectSequence(root, knownIds = []) {
  const file = workspacePaths(root).sequence;
  const floor = nextGeneratedOrdinal([...knownIds, ...retainedTrashIds(root)]);
  const stored = parseSequenceFile(file);
  if (stored !== null && stored < floor) throw new Error(`.rsh/sequence.toml next ${stored} is behind existing generated IDs (${floor} required)`);
  return { file, exists: stored !== null, next: stored ?? floor, floor };
}

export function createIdAllocator(root, knownIds = []) {
  const inspected = inspectSequence(root, knownIds);
  let next = inspected.next;
  return {
    allocate(prefix) {
      if (next >= GENERATED_ID_SPACE) throw new Error("No five-digit base36 IDs remain");
      const id = formatGeneratedId(prefix, next);
      next += 1;
      return id;
    },
    get next() { return next; },
    get file() { return inspected.file; },
    contents() { return `${stringifyToml({ next }).trimEnd()}\n`; }
  };
}

export function sequenceSnapshot(root, knownIds = []) {
  const allocator = createIdAllocator(root, knownIds);
  return { target: allocator.file, contents: allocator.contents() };
}
