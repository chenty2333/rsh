import fs from "node:fs";
import { createRequire } from "node:module";
import { initializeWorkspace, replaceIntent } from "./core/workspace.js";
import { requireWorkspace } from "./core/paths.js";
import { parseMemoryDocument, rememberMemory, correctMemory, readMemory } from "./core/memory.js";
import { buildBrief, searchMemories } from "./core/query.js";
import { runMcp } from "./core/mcp.js";

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json");
const COMMANDS = new Set(["init", "brief", "search", "read", "intent", "remember", "correct", "mcp", "help", "version"]);
const MEMORY_ID = /^R-[0-9a-z]{5}$/;

function usage() {
  return `RSH ${VERSION}

Usage:
  rsh init INTENT.md
  rsh brief
  rsh search QUERY
  rsh read MEMORY_ID
  rsh intent replace INTENT.md
  rsh remember MEMORY.md
  rsh correct MEMORY_ID MEMORY.md
  rsh mcp
  rsh help
  rsh version

Use - instead of an input filename to read from standard input.`;
}

function sourceText(file) {
  return file === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(file, "utf8");
}

function writeOutput(value) {
  const output = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
}

function exact(command, values, count) {
  if (values.length !== count) {
    throw new Error(`${command} requires exactly ${count} argument${count === 1 ? "" : "s"}`);
  }
}

function validateId(id) {
  if (!MEMORY_ID.test(id ?? "")) {
    throw new Error("Memory ID must be R- followed by 5 lowercase base36 characters");
  }
}

export async function main(argv) {
  const [command, ...args] = argv;
  if (!command) {
    writeOutput(usage());
    return;
  }
  if (!COMMANDS.has(command)) throw new Error(`Unknown command ${command}. Run \`rsh help\`.`);
  if (args.some((argument) => argument.startsWith("--"))) throw new Error("RSH commands do not accept flags");

  if (command === "help") {
    exact(command, args, 0);
    writeOutput(usage());
    return;
  }
  if (command === "version") {
    exact(command, args, 0);
    writeOutput(VERSION);
    return;
  }
  if (command === "init") {
    exact(command, args, 1);
    initializeWorkspace(process.cwd(), sourceText(args[0]));
    writeOutput(`Initialized RSH ${VERSION}.`);
    return;
  }

  const root = requireWorkspace(process.cwd());
  if (command === "brief") {
    exact(command, args, 0);
    writeOutput(buildBrief(root));
    return;
  }
  if (command === "search") {
    exact(command, args, 1);
    writeOutput(searchMemories(root, args[0]));
    return;
  }
  if (command === "read") {
    exact(command, args, 1);
    validateId(args[0]);
    const memory = readMemory(root, args[0]);
    if (!memory) throw new Error(`Memory ${args[0]} does not exist`);
    writeOutput(memory.document);
    return;
  }
  if (command === "intent") {
    if (args[0] !== "replace") throw new Error("intent requires replace");
    exact("intent replace", args, 2);
    replaceIntent(root, sourceText(args[1]));
    writeOutput("Intent replaced.");
    return;
  }
  if (command === "remember") {
    exact(command, args, 1);
    const memory = rememberMemory(root, parseMemoryDocument(sourceText(args[0])));
    writeOutput({ id: memory.id });
    return;
  }
  if (command === "correct") {
    exact(command, args, 2);
    validateId(args[0]);
    const memory = correctMemory(root, args[0], parseMemoryDocument(sourceText(args[1])));
    writeOutput({ id: memory.id });
    return;
  }
  if (command === "mcp") {
    exact(command, args, 0);
    await runMcp({ root });
  }
}
