import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { writeJsonAtomic, readJson } from "./fs.js";
import { buildGraph } from "./graph.js";

const STOP = new Set(["the","a","an","and","or","of","to","in","for","on","with","is","are","be","this","that","as","by","from","at","it","we","our"]);

export function tokenize(text = "") {
  return String(text)
    .toLowerCase()
    .normalize("NFKD")
    .split(/[^\p{L}\p{N}_+^-]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length > 1 && !STOP.has(item));
}

function documentText(node) {
  const sections = node.sections ? Object.values(node.sections).join("\n") : "";
  return [node.title, node.claim, node.summary, node.statement, node.proof, node.kind, node.state, ...(node.route?.targets ?? []), ...(node.route?.mechanisms ?? []), ...(node.route?.assumptions ?? []), ...(node.traits ?? []), sections]
    .filter(Boolean)
    .join("\n");
}

export function buildIndex(store, options = {}) {
  const graph = buildGraph(store);
  const docs = [];
  const df = new Map();
  for (const [id, node] of graph.nodes) {
    const text = documentText(node);
    const tokens = tokenize(text);
    const tf = {};
    for (const token of tokens) tf[token] = (tf[token] ?? 0) + 1;
    for (const token of new Set(tokens)) df.set(token, (df.get(token) ?? 0) + 1);
    docs.push({ id, layer: node.layer, kind: node.kind, title: node.title ?? id, state: node.state ?? node.verification?.state ?? null, text, length: tokens.length, tf });
  }
  const avgdl = docs.length ? docs.reduce((sum, item) => sum + item.length, 0) / docs.length : 0;
  const index = {
    schema: "rsh.index.v1",
    built_at: new Date().toISOString(),
    documents: docs,
    document_frequency: Object.fromEntries(df),
    average_document_length: avgdl,
    edges: graph.edges
  };
  writeJsonAtomic(store.paths.index, index);
  const command = options.embeddingCommand ?? store.workspace.retrieval?.embedding_command;
  if (command) buildEmbeddings(store, docs, command);
  store.event("INDEX_REBUILT", { documents: docs.length, embeddings: Boolean(command) });
  return index;
}

function buildEmbeddings(store, docs, command) {
  const result = spawnSync(command, [], {
    cwd: store.root,
    shell: true,
    encoding: "utf8",
    input: JSON.stringify({ texts: docs.map((item) => item.text), ids: docs.map((item) => item.id) }),
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(`Embedding command failed: ${result.stderr || result.stdout}`);
  const parsed = JSON.parse(result.stdout);
  if (!Array.isArray(parsed.vectors) || parsed.vectors.length !== docs.length) throw new Error("Embedding command must return {vectors:[...]} with one vector per document");
  writeJsonAtomic(store.paths.embeddings, { schema: "rsh.embeddings.v1", ids: docs.map((item) => item.id), vectors: parsed.vectors, built_at: new Date().toISOString() });
}

export function loadIndex(store) {
  if (!fs.existsSync(store.paths.index)) return buildIndex(store);
  return readJson(store.paths.index);
}

function cosine(a, b) {
  let dot = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

export function searchIndex(store, query, options = {}) {
  const index = loadIndex(store);
  const tokens = tokenize(query);
  const n = index.documents.length || 1;
  const k1 = 1.2;
  const b = 0.75;
  const scored = index.documents.map((doc) => {
    let score = 0;
    for (const token of tokens) {
      const tf = doc.tf[token] ?? 0;
      if (!tf) continue;
      const df = index.document_frequency[token] ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc.length / (index.average_document_length || 1))));
    }
    return { ...doc, lexical_score: score };
  });
  let embeddingScores = new Map();
  if (options.queryVector && fs.existsSync(store.paths.embeddings)) {
    const embeddings = readJson(store.paths.embeddings);
    embeddingScores = new Map(embeddings.ids.map((id, i) => [id, cosine(options.queryVector, embeddings.vectors[i])]));
  }
  return scored
    .map((item) => ({ ...item, semantic_score: embeddingScores.get(item.id) ?? 0, score: item.lexical_score + (embeddingScores.get(item.id) ?? 0) * 0.35 }))
    .filter((item) => item.score > 0 || tokens.length === 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, options.limit ?? store.workspace.retrieval?.max_results ?? 20);
}
