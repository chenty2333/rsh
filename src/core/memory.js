import fs from "node:fs";
import path from "node:path";
import { writeText } from "./fs.js";
import { assertWorkspaceLayout } from "./paths.js";
import { MEMORY_ID, formatMemoryId, memoryOrdinal, parseMemoryDocument, serializeMemoryDocument } from "./model.js";
import { parseManifest } from "./workspace.js";

const MEMORY_FILE = /^R-[0-9a-z]{5}\.md$/;

function pathsFor(root) {
  const paths = assertWorkspaceLayout(root);
  parseManifest(fs.readFileSync(paths.manifest, "utf8"));
  return paths;
}

export { parseMemoryDocument };

export function listMemories(root) {
  const paths = pathsFor(root);
  const memories = [];
  for (const name of fs.readdirSync(paths.records).sort()) {
    if (!MEMORY_FILE.test(name)) throw new Error(`invalid memory filename ${name}`);
    const file = path.join(paths.records, name);
    if (!fs.statSync(file).isFile()) throw new Error(`invalid memory entry ${name}`);
    const memory = parseMemoryDocument(fs.readFileSync(file, "utf8"), { stored: true });
    if (`${memory.id}.md` !== name) throw new Error(`memory filename ${name} does not match id ${memory.id}`);
    memories.push(memory);
  }
  return memories;
}

export function readMemory(root, id) {
  if (!MEMORY_ID.test(id ?? "")) throw new Error("memory ID must be R- followed by 5 lowercase base36 characters");
  const paths = pathsFor(root);
  const file = path.join(paths.records, `${id}.md`);
  if (!fs.existsSync(file)) return null;
  const memory = parseMemoryDocument(fs.readFileSync(file, "utf8"), { stored: true });
  if (memory.id !== id) throw new Error(`memory filename ${id}.md does not match id ${memory.id}`);
  return memory;
}

export function rememberMemory(root, input) {
  const paths = pathsFor(root);
  const memories = listMemories(root);
  const highest = memories.reduce((maximum, memory) => Math.max(maximum, memoryOrdinal(memory.id)), -1);
  const memory = serializeMemoryDocument({ id: formatMemoryId(highest + 1), card: input?.card, body: input?.body });
  writeText(path.join(paths.records, `${memory.id}.md`), memory.document);
  return memory;
}

export function correctMemory(root, id, input) {
  const previous = readMemory(root, id);
  if (!previous) throw new Error(`memory ${id} does not exist`);
  const paths = pathsFor(root);
  const memory = serializeMemoryDocument({ id, card: input?.card, body: input?.body });
  writeText(path.join(paths.records, `${id}.md`), memory.document);
  return memory;
}
