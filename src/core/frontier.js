import { FRONTIER_ID_PATTERN, formatGeneratedId, nextGeneratedOrdinal } from "./ids.js";

const ENTRY = /^( *)(- )\[([QD]-(?:[0-9a-z]{3}|[0-9a-z]{5}))\] (.*)$/;

export function isFrontierId(value) {
  return typeof value === "string" && FRONTIER_ID_PATTERN.test(value);
}

export function createFrontierId(kind = "Q", used = new Set()) {
  const prefix = kind === "question" ? "Q" : kind === "direction" ? "D" : kind;
  if (prefix !== "Q" && prefix !== "D") throw new Error("frontier kind must be question or direction");
  return formatGeneratedId(prefix, nextGeneratedOrdinal(used));
}

function openBounds(markdown) {
  if (typeof markdown !== "string") throw new Error("RESEARCH.md must be text");
  const headings = [...markdown.matchAll(/^## Open[ \t]*\r?$/gm)];
  if (headings.length !== 1) throw new Error(`RESEARCH.md must contain exactly one ## Open section (found ${headings.length})`);
  const heading = headings[0];
  const headingEnd = markdown.indexOf("\n", heading.index);
  const bodyStart = headingEnd < 0 ? markdown.length : headingEnd + 1;
  const next = /^## (?!Open(?:[ \t]*$))/gm;
  next.lastIndex = bodyStart;
  const match = next.exec(markdown);
  return { bodyStart, bodyEnd: match?.index ?? markdown.length };
}

export function parseFrontier(markdown) {
  const { bodyStart, bodyEnd } = openBounds(markdown);
  const body = markdown.slice(bodyStart, bodyEnd);
  const nodes = [];
  const ids = new Set();
  const stack = [];
  let lineNumber = markdown.slice(0, bodyStart).split(/\r?\n/).length;
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) { lineNumber += 1; continue; }
    const match = ENTRY.exec(line);
    if (!match) throw new Error(`Invalid Open frontier entry at line ${lineNumber}`);
    const spaces = match[1].length;
    if (spaces % 2) throw new Error(`Invalid frontier indentation at line ${lineNumber}: use exactly two spaces per depth`);
    const depth = spaces / 2;
    if (depth > stack.length) throw new Error(`Frontier depth jumps at line ${lineNumber}`);
    const id = match[3];
    const text = match[4];
    if (!text.trim()) throw new Error(`Frontier entry ${id} has empty text`);
    if (ids.has(id)) throw new Error(`Duplicate frontier ID ${id}`);
    ids.add(id);
    stack.length = depth;
    const parent = depth ? stack[depth - 1] : null;
    const node = { id, kind: id[0] === "Q" ? "question" : "direction", text, parent, depth };
    nodes.push(node);
    stack[depth] = id;
    lineNumber += 1;
  }
  return nodes;
}

export function serializeFrontier(nodes, newline = "\n") {
  if (!Array.isArray(nodes)) throw new Error("frontier must be an array");
  const byId = new Map();
  for (const node of nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node)) throw new Error("frontier entries must be objects");
    if (!isFrontierId(node.id)) throw new Error(`Invalid frontier ID ${node.id ?? "missing"}`);
    if ((node.kind === "question" ? "Q" : node.kind === "direction" ? "D" : null) !== node.id[0]) throw new Error(`Frontier kind does not match ID ${node.id}`);
    if (typeof node.text !== "string" || !node.text.trim()) throw new Error(`Frontier entry ${node.id} has empty text`);
    if (/[\r\n]/.test(node.text)) throw new Error(`Frontier entry ${node.id} text must stay on one line`);
    if (byId.has(node.id)) throw new Error(`Duplicate frontier ID ${node.id}`);
    if (node.parent !== null && node.parent !== undefined && !isFrontierId(node.parent)) throw new Error(`Frontier entry ${node.id} has invalid parent ${node.parent}`);
    byId.set(node.id, { ...node, parent: node.parent ?? null });
  }
  for (const node of byId.values()) if (node.parent && !byId.has(node.parent)) throw new Error(`Frontier entry ${node.id} has missing parent ${node.parent}`);
  const children = new Map([[null, []]]);
  for (const node of byId.values()) {
    if (!children.has(node.parent)) children.set(node.parent, []);
    children.get(node.parent).push(node);
  }
  const rendered = [];
  const visiting = new Set();
  const visited = new Set();
  const visit = (node, depth) => {
    if (visiting.has(node.id)) throw new Error(`Frontier contains a parent cycle at ${node.id}`);
    if (visited.has(node.id)) return;
    visiting.add(node.id);
    rendered.push(`${"  ".repeat(depth)}- [${node.id}] ${node.text}`);
    for (const child of children.get(node.id) ?? []) visit(child, depth + 1);
    visiting.delete(node.id); visited.add(node.id);
  };
  for (const root of children.get(null)) visit(root, 0);
  if (visited.size !== byId.size) throw new Error("Frontier contains a parent cycle");
  return rendered.join(newline);
}

export function replaceOpenSection(markdown, nodes) {
  const { bodyStart, bodyEnd } = openBounds(markdown);
  const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
  const rendered = serializeFrontier(nodes, newline);
  const suffix = markdown.slice(bodyEnd);
  const body = rendered ? `${rendered}${newline}${suffix && !suffix.startsWith(newline) ? newline : ""}` : (suffix ? newline : "");
  return `${markdown.slice(0, bodyStart)}${body}${suffix}`;
}

export const parseOpenFrontier = parseFrontier;
export const serializeOpenFrontier = serializeFrontier;
export const updateOpenSection = replaceOpenSection;
