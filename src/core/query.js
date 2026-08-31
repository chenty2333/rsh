import { listMemories } from "./memory.js";
import { memoryOrdinal, tokenEstimate, utf8Bytes } from "./model.js";
import { showIntent } from "./workspace.js";

export const BRIEF_MAX_BYTES = 8192;
export const BRIEF_MAX_TOKENS = 1600;
export const BRIEF_MAX_CARDS = 5;

const WORD_SEGMENTER = new Intl.Segmenter(undefined, { granularity: "word" });
const FIELDS = [
  ["title", 4],
  ["summary", 3],
  ["scope", 2],
  ["body", 0.25]
];
const KIND_BOOST = { hazard: 0.25, dead_end: 0.15 };
const BOUNDARY = [
  "## RSH boundary",
  "",
  "RSH is durable memory, not task state. Do not call `rsh brief` or record progress. Use `rsh search` and `rsh read` only for an exact missing conclusion."
].join("\n");

function words(value) {
  return [...WORD_SEGMENTER.segment(String(value).toLowerCase())]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment);
}

function fieldValue(memory, field) {
  return field === "body" ? memory.body : memory.card[field];
}

function bm25(memories, query) {
  const terms = [...new Set(words(query))];
  if (!terms.length) return new Map(memories.map((memory) => [memory.id, 0]));

  const documents = memories.map((memory) => ({
    memory,
    fields: Object.fromEntries(FIELDS.map(([field]) => [field, words(fieldValue(memory, field))]))
  }));
  const averageLengths = Object.fromEntries(FIELDS.map(([field]) => [
    field,
    documents.reduce((sum, document) => sum + document.fields[field].length, 0) / Math.max(documents.length, 1)
  ]));
  const k1 = 1.2;
  const b = 0.75;
  const scores = new Map();

  for (const document of documents) {
    let score = 0;
    for (const term of terms) {
      for (const [field, weight] of FIELDS) {
        const tokens = document.fields[field];
        const frequency = tokens.reduce((count, token) => count + Number(token === term), 0);
        if (!frequency) continue;
        const documentFrequency = documents.reduce(
          (count, candidate) => count + Number(candidate.fields[field].includes(term)),
          0
        );
        const inverseFrequency = Math.log(
          1 + (documents.length - documentFrequency + 0.5) / (documentFrequency + 0.5)
        );
        const lengthRatio = tokens.length / Math.max(averageLengths[field], 1);
        score += weight * inverseFrequency * (frequency * (k1 + 1))
          / (frequency + k1 * (1 - b + b * lengthRatio));
      }
    }
    scores.set(document.memory.id, score);
  }
  return scores;
}

function ranked(memories, query, { boostKinds = false } = {}) {
  const scores = bm25(memories, query);
  return memories
    .map((memory) => ({
      memory,
      lexicalScore: scores.get(memory.id) ?? 0,
      score: (scores.get(memory.id) ?? 0) + (boostKinds ? KIND_BOOST[memory.card.kind] ?? 0 : 0)
    }))
    .filter(({ lexicalScore }) => lexicalScore > 0)
    .sort((left, right) => right.score - left.score
      || memoryOrdinal(right.memory.id) - memoryOrdinal(left.memory.id));
}

function card(memory) {
  return {
    id: memory.id,
    kind: memory.card.kind,
    title: memory.card.title,
    summary: memory.card.summary,
    scope: memory.card.scope
  };
}

function renderCard(memory) {
  return [
    `- **${memory.id}** [${memory.card.kind}] ${memory.card.title}`,
    `  - ${memory.card.summary}`,
    `  - Scope: ${memory.card.scope}`
  ].join("\n");
}

function joinSections(sections) {
  return `${sections.map((section) => section.trimEnd()).join("\n\n")}\n`;
}

function withinBriefBudget(markdown) {
  return utf8Bytes(markdown) <= BRIEF_MAX_BYTES && tokenEstimate(markdown) <= BRIEF_MAX_TOKENS;
}

export function searchMemories(root, query) {
  if (typeof query !== "string" || !query.trim()) throw new Error("search query must be non-empty text");
  return ranked(listMemories(root), query)
    .slice(0, BRIEF_MAX_CARDS)
    .map(({ memory }) => card(memory));
}

export function buildBrief(root) {
  const intent = showIntent(root);
  const base = joinSections([intent, BOUNDARY]);
  if (!withinBriefBudget(base)) throw new Error("Intent leaves no room for the Brief boundary");

  const selected = [];
  for (const { memory } of ranked(listMemories(root), intent, { boostKinds: true })) {
    if (selected.length >= BRIEF_MAX_CARDS) break;
    const cards = [...selected, memory].map(renderCard).join("\n");
    const proposed = joinSections([intent, `## Durable memories\n\n${cards}`, BOUNDARY]);
    if (withinBriefBudget(proposed)) selected.push(memory);
  }

  if (!selected.length) return base;
  return joinSections([
    intent,
    `## Durable memories\n\n${selected.map(renderCard).join("\n")}`,
    BOUNDARY
  ]);
}
