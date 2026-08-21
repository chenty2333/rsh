import fs from "node:fs";
import path from "node:path";
import { appendJsonl, ensureDir, listFiles } from "../core/fs.js";
import { shortHash } from "../core/canonical.js";

export function traceFile(store, adapter, source) {
  const id = `${adapter}-${shortHash(`${source}:${Date.now()}`, 12)}.jsonl`;
  return path.join(store.paths.traces, id);
}

export function appendTrace(file, record) {
  appendJsonl(file, { at: new Date().toISOString(), ...record });
}

export function simpleYamlFrontmatter(text) {
  if (!text.startsWith("---\n")) return { metadata: {}, body: text };
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) return { metadata: {}, body: text };
  const raw = text.slice(4, end);
  const metadata = {};
  let activeKey = null;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const top = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (top) {
      activeKey = top[1];
      let value = top[2].trim();
      if (!value) metadata[activeKey] = [];
      else {
        try { metadata[activeKey] = JSON.parse(value); }
        catch { metadata[activeKey] = value.replace(/^['"]|['"]$/g, ""); }
      }
      continue;
    }
    const item = line.match(/^\s*-\s*(.+)$/);
    if (item && activeKey) {
      if (!Array.isArray(metadata[activeKey])) metadata[activeKey] = [];
      metadata[activeKey].push(item[1].trim().replace(/^['"]|['"]$/g, ""));
    }
  }
  return { metadata, body: text.slice(end + 5).trim() };
}

export function markdownSections(body) {
  const sections = {};
  const matches = [...body.matchAll(/^##\s+(.+)$/gm)];
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].index + matches[i][0].length;
    const finish = i + 1 < matches.length ? matches[i + 1].index : body.length;
    sections[matches[i][1].trim().toLowerCase()] = body.slice(start, finish).trim();
  }
  return sections;
}

export function filesUnder(dir, extension) {
  return listFiles(dir, (file) => !extension || file.endsWith(extension));
}
