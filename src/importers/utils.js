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
  const opening = text.match(/^---\r?\n/);
  if (!opening) return { metadata: {}, body: text };
  const start = opening[0].length;
  const closing = /\r?\n---(?:\r?\n|$)/g;
  closing.lastIndex = start;
  const match = closing.exec(text);
  if (!match) return { metadata: {}, body: text };
  const raw = text.slice(start, match.index);
  const metadata = {};
  let activeKey = null;

  const unquote = (value) => value.replace(/^['"]|['"]$/g, "");
  const parseFlowArray = (value) => {
    const trimmed = value.trim();
    if (trimmed === "[]") return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
    return trimmed.slice(1, -1).split(",").map((item) => unquote(item.trim())).filter(Boolean);
  };

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const top = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (top) {
      activeKey = top[1];
      let value = top[2].trim();
      if (!value) metadata[activeKey] = activeKey === "glossary_introduces" ? {} : [];
      else {
        const flow = parseFlowArray(value);
        if (flow) metadata[activeKey] = flow;
        else {
          try { metadata[activeKey] = JSON.parse(value); }
          catch { metadata[activeKey] = unquote(value); }
        }
      }
      continue;
    }
    const item = line.match(/^\s*-\s*(.+)$/);
    if (item && activeKey) {
      if (!Array.isArray(metadata[activeKey])) metadata[activeKey] = [];
      metadata[activeKey].push(item[1].trim().replace(/^['"]|['"]$/g, ""));
      continue;
    }
    const mapping = line.match(/^\s{2}([^:]+):\s*(.*)$/);
    if (mapping && activeKey) {
      if (!metadata[activeKey] || Array.isArray(metadata[activeKey])) metadata[activeKey] = {};
      metadata[activeKey][mapping[1].trim()] = unquote(mapping[2].trim());
    }
  }
  return { metadata, body: text.slice(match.index + match[0].length).trim() };
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
