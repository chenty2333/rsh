import fs from "node:fs";
import { createRequire } from "node:module";
import { initializeWorkspace } from "./core/workspace.js";
import { requireWorkspace } from "./core/paths.js";
import { resumeResearch, findRecords, getItem, statusWorkspace, formatStatusMarkdown, formatFindMarkdown } from "./core/query.js";
import { checkpoint, markRecord } from "./core/record.js";
import { doctor, formatDoctorMarkdown } from "./core/doctor.js";
import { runMcp } from "./core/mcp.js";

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json");

const COMMANDS = new Set(["init", "resume", "find", "checkpoint", "get", "mark", "status", "doctor", "mcp", "help", "version"]);
const BOOLEAN_FLAGS = new Set(["all", "regex", "help", "version"]);
const VALUE_FLAGS = new Set(["kind", "state", "limit"]);
const GLOBAL_FLAGS = new Set(["help", "version"]);
const FLAGS = {
  init: new Set(), resume: new Set(["all"]),
  find: new Set(["regex", "kind", "state", "limit"]),
  checkpoint: new Set(), get: new Set(), mark: new Set(), status: new Set(),
  doctor: new Set(), mcp: new Set(), help: new Set(), version: new Set()
};
const POSITIONALS = { init: 0, resume: 0, checkpoint: 1, get: 1, mark: 2, status: 0, doctor: 0, mcp: 0, help: 0, version: 0 };
const KINDS = new Set(["result", "dead_end", "experience"]);
const STATES = new Set(["unchecked", "checked", "withdrawn"]);
const ITEM_ID = /^[QDR]-[0-9a-z]{3}$/;
const RECORD_ID = /^R-[0-9a-z]{3}$/;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  let positionalOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!positionalOnly && token === "--") { positionalOnly = true; continue; }
    if (positionalOnly || !token.startsWith("--")) { positional.push(token); continue; }
    const option = token.slice(2);
    const separator = option.indexOf("=");
    const name = separator < 0 ? option : option.slice(0, separator);
    const inline = separator < 0 ? undefined : option.slice(separator + 1);
    if (BOOLEAN_FLAGS.has(name)) {
      if (inline !== undefined) throw new Error(`Flag --${name} does not take a value`);
      flags[name] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) throw new Error(`Unknown flag --${name}`);
    const value = inline === undefined ? argv[index + 1] : inline;
    if (!value || (inline === undefined && value.startsWith("--"))) throw new Error(`Flag --${name} requires a value`);
    flags[name] = value;
    if (inline === undefined) index += 1;
  }
  return { positional, flags };
}

function validate(command, positional, flags) {
  for (const name of Object.keys(flags)) {
    if (!GLOBAL_FLAGS.has(name) && !FLAGS[command].has(name)) throw new Error(`Unknown flag --${name} for command ${command}`);
  }
  if (flags.help || flags.version) return;
  const expected = POSITIONALS[command];
  if (command === "find") {
    if (positional.length !== 1) throw new Error("Command find requires exactly 1 positional argument");
  } else if (positional.length !== expected) {
    throw new Error(`Command ${command} requires exactly ${expected} positional argument${expected === 1 ? "" : "s"}`);
  }
  if (flags.kind && !KINDS.has(flags.kind)) throw new Error("Flag --kind must be result, dead_end, or experience");
  if (flags.state && !STATES.has(flags.state)) throw new Error("Flag --state must be unchecked, checked, or withdrawn");
  if (flags.limit && !/^[1-9]\d*$/.test(flags.limit)) throw new Error("Flag --limit must be a positive integer");
  if (command === "get" && !ITEM_ID.test(positional[0])) throw new Error("ID must be Q-, D-, or R- followed by exactly 3 lowercase base36 characters");
  if (command === "mark" && !RECORD_ID.test(positional[0])) throw new Error("Record ID must be R- followed by exactly 3 lowercase base36 characters");
  if (command === "mark" && !STATES.has(positional[1])) throw new Error("Mark state must be unchecked, checked, or withdrawn");
}

function help() {
  return `RSH ${VERSION}

Usage:
  rsh init
  rsh resume [--all]
  rsh find QUERY [--regex] [--kind result|dead_end|experience]
                 [--state unchecked|checked|withdrawn] [--limit N]
  rsh checkpoint FILE.md       (use - to read stdin)
  rsh get ID                    (Q-abc, D-4z1, or R-a9z)
  rsh mark RECORD_ID unchecked|checked|withdrawn  (for example R-a9z)
  rsh status
  rsh doctor
  rsh mcp
  rsh help
  rsh version`;
}

function formatValue(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((item) => `- ${formatValue(item).replaceAll("\n", "\n  ")}`).join("\n");
  if (typeof value === "object") {
    return Object.entries(value).map(([key, item]) => {
      if (item && typeof item === "object") return `## ${key.replaceAll("_", " ")}\n\n${formatValue(item)}`;
      return `- ${key.replaceAll("_", " ")}: ${item ?? ""}`;
    }).join("\n");
  }
  return String(value);
}

function print(value, formatter = formatValue) {
  const output = formatter(value);
  if (output) console.log(output);
}

export async function main(argv) {
  const { positional, flags } = parseArgs(argv);
  const command = positional.shift();
  if (!command) {
    for (const name of Object.keys(flags)) if (!GLOBAL_FLAGS.has(name)) throw new Error(`Unknown flag --${name}`);
    console.log(flags.version ? VERSION : help());
    return;
  }
  if (!COMMANDS.has(command)) throw new Error(`Unknown command ${command}. Run \`rsh help\`.`);
  validate(command, positional, flags);
  if (flags.version || command === "version") { console.log(VERSION); return; }
  if (flags.help || command === "help") { console.log(help()); return; }

  if (command === "init") {
    const result = initializeWorkspace(process.cwd());
    console.log(`Initialized RSH workspace at ${result.root}`);
    return;
  }

  const root = requireWorkspace();
  if (command === "resume") { print(resumeResearch(root, { all: Boolean(flags.all) })); return; }
  if (command === "find") {
    print(findRecords(root, positional[0] ?? "", {
      regex: Boolean(flags.regex), kind: flags.kind,
      state: flags.state, limit: flags.limit ? Number(flags.limit) : undefined
    }), formatFindMarkdown);
    return;
  }
  if (command === "checkpoint") {
    const fromStdin = positional[0] === "-";
    const input = fromStdin ? fs.readFileSync(0, "utf8") : positional[0];
    print(checkpoint(root, input, { isText: fromStdin }));
    return;
  }
  if (command === "get") { print(getItem(root, positional[0])); return; }
  if (command === "mark") { print(markRecord(root, positional[0], positional[1])); return; }
  if (command === "status") { print(statusWorkspace(root), formatStatusMarkdown); return; }
  if (command === "doctor") {
    const report = doctor(root);
    print(report, formatDoctorMarkdown);
    if (!report.ok) process.exitCode = 1;
    return;
  }
  if (command === "mcp") await runMcp({ root });
}
