import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

export const MEMORY_ID = /^R-[0-9a-z]{5}$/;
export const MEMORY_ID_WIDTH = 5;
export const MEMORY_ID_SPACE = 36 ** MEMORY_ID_WIDTH;
export const MEMORY_KINDS = new Set(["finding", "decision", "question", "dead_end", "hazard"]);

const CARD_FIELDS = new Set(["kind", "title", "summary", "scope"]);

export function utf8Bytes(value) {
  return Buffer.byteLength(value, "utf8");
}

export function tokenEstimate(value) {
  let ascii = 0;
  let nonAscii = 0;
  for (const character of value) {
    if (character.codePointAt(0) <= 0x7f) ascii += 1;
    else nonAscii += 1;
  }
  return Math.ceil(ascii / 4 + nonAscii);
}

function plain(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value, label, byteLimit) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be non-empty text`);
  if (utf8Bytes(value) > byteLimit) throw new Error(`${label} exceeds ${byteLimit} UTF-8 bytes`);
  return value;
}

export function memoryOrdinal(id) {
  if (!MEMORY_ID.test(id ?? "")) return null;
  return Number.parseInt(id.slice(2), 36);
}

export function formatMemoryId(ordinal) {
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= MEMORY_ID_SPACE) {
    throw new Error("No five-digit base36 Memory IDs remain");
  }
  return `R-${ordinal.toString(36).padStart(MEMORY_ID_WIDTH, "0")}`;
}

export function normalizeCard(input) {
  if (!plain(input)) throw new Error("memory card must be an object");
  for (const key of Object.keys(input)) {
    if (!CARD_FIELDS.has(key)) throw new Error(`memory may not contain ${key}`);
  }
  for (const key of CARD_FIELDS) {
    if (!Object.hasOwn(input, key)) throw new Error(`memory requires ${key}`);
  }
  if (!MEMORY_KINDS.has(input.kind)) {
    throw new Error("memory kind must be finding, decision, question, dead_end, or hazard");
  }
  return {
    kind: input.kind,
    title: requiredText(input.title, "title", 96),
    summary: requiredText(input.summary, "summary", 320),
    scope: requiredText(input.scope, "scope", 160)
  };
}

export function validateIntent(value) {
  if (typeof value !== "string") throw new Error("Intent must be text");
  const firstLine = value.split(/\r?\n/, 1)[0];
  const heading = firstLine.match(/^#[ \t]+(.+?)[ \t]*$/)?.[1]?.trim();
  if (!heading) throw new Error("RSH.md requires a non-empty H1 Intent");
  if (utf8Bytes(value) > 4096 || tokenEstimate(value) > 800) {
    throw new Error("Intent exceeds 4096 bytes or 800 estimated tokens");
  }
  return value;
}

export function parseMemoryDocument(source, { stored = false } = {}) {
  if (typeof source !== "string" || !source.startsWith("+++\n")) {
    throw new Error("memory must begin with +++ TOML frontmatter");
  }
  const end = source.indexOf("\n+++\n", 4);
  if (end < 0) throw new Error("memory is missing closing frontmatter delimiter");

  let metadata;
  try {
    metadata = parseToml(source.slice(4, end));
  } catch (error) {
    throw new Error(`invalid memory TOML: ${error.message}`);
  }
  if (!plain(metadata)) throw new Error("memory frontmatter must be an object");

  const { id, ...cardInput } = metadata;
  if (stored) {
    if (!MEMORY_ID.test(id ?? "")) throw new Error("memory.id is invalid");
  } else if (id !== undefined) {
    throw new Error("new memory documents must not set id");
  }

  const card = normalizeCard(cardInput);
  const body = source.slice(end + 5);
  if (!body.trim()) throw new Error("memory body must contain non-empty Markdown");
  return stored ? { id, card, body, document: source } : { card, body };
}

export function serializeMemoryDocument({ id, card, body }) {
  if (!MEMORY_ID.test(id ?? "")) throw new Error("memory.id is invalid");
  if (typeof body !== "string" || !body.trim()) throw new Error("memory body must contain non-empty Markdown");
  const normalized = normalizeCard(card);
  const document = `+++\n${stringifyToml({ id, ...normalized }).trimEnd()}\n+++\n${body}`;
  return { id, card: normalized, body, document };
}
