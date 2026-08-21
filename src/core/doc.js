import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./fs.js";

const DELIMITER = "---";

export function serializeDocument(metadata, sections = {}) {
  const body = Object.entries(sections)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(([name, value]) => `## ${name}\n\n${String(value).trim()}\n`)
    .join("\n");
  return `${DELIMITER}\n${JSON.stringify(metadata, null, 2)}\n${DELIMITER}\n\n# ${metadata.title ?? metadata.id}\n\n${body}`;
}

export function parseDocument(text, file = "<memory>") {
  if (!text.startsWith(`${DELIMITER}\n`)) throw new Error(`Missing RSH frontmatter in ${file}`);
  const end = text.indexOf(`\n${DELIMITER}\n`, DELIMITER.length + 1);
  if (end < 0) throw new Error(`Unclosed RSH frontmatter in ${file}`);
  const rawMetadata = text.slice(DELIMITER.length + 1, end);
  let metadata;
  try {
    metadata = JSON.parse(rawMetadata);
  } catch (error) {
    throw new Error(`Invalid RSH JSON frontmatter in ${file}: ${error.message}`);
  }
  const body = text.slice(end + DELIMITER.length + 2).trim();
  const sections = {};
  const pattern = /^##\s+(.+)$/gm;
  const matches = [...body.matchAll(pattern)];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index + matches[i][0].length;
    const finish = i + 1 < matches.length ? matches[i + 1].index : body.length;
    sections[matches[i][1].trim()] = body.slice(start, finish).trim();
  }
  return { metadata, body, sections };
}

export function readDocument(file) {
  return parseDocument(fs.readFileSync(file, "utf8"), file);
}

export function writeDocumentAtomic(file, metadata, sections) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, serializeDocument(metadata, sections), "utf8");
  fs.renameSync(tmp, file);
}
