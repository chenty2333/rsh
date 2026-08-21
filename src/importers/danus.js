import fs from "node:fs";
import path from "node:path";
import { SCHEMAS } from "../core/constants.js";
import { computeFactId } from "../core/facts.js";
import { readJsonl } from "../core/fs.js";
import { simpleYamlFrontmatter, markdownSections, filesUnder, traceFile, appendTrace } from "./utils.js";

const KIND_MAP = {
  conclusion: "proof_attempt",
  example: "experiment",
  counterexample: "counterexample",
  proof_attempt: "proof_attempt",
  plan: "plan",
  dead_end: "dead_end",
  direction: "direction",
  obstacle: "obstacle",
  master_guidance: "guidance",
  verification: "obstacle",
  elaboration: "elaboration"
};

export const danusImporter = {
  name: "danus",
  detect(source) {
    return fs.existsSync(path.join(source, "global_memory")) || fs.existsSync(path.join(source, "fact_graph"));
  },
  import(store, source, options = {}) {
    const findings = [];
    const facts = [];
    const idMap = new Map();
    const globalDir = path.join(source, "global_memory");
    if (fs.existsSync(globalDir)) {
      for (const file of filesUnder(globalDir, ".jsonl")) {
        for (const entry of readJsonl(file)) {
          const kind = KIND_MAP[entry.kind] ?? "obstacle";
          const id = `danus-${entry.id ?? Math.random().toString(16).slice(2)}`;
          const record = {
            schema: SCHEMAS.finding,
            id,
            kind,
            title: String(entry.claim ?? entry.kind ?? id).slice(0, 120),
            state: entry.status === "refuted" ? "refuted" : entry.status === "verified" ? "supported" : entry.verifiable ? "unverified" : "open",
            trust: "finding",
            verifiable: Boolean(entry.verifiable),
            author: entry.author ?? "danus",
            problem_id: entry.links?.problem_id ?? "danus-import",
            route: entry.route ?? null,
            predecessors: entry.links?.predecessors ?? [],
            evidence_refs: [],
            provenance: { adapter: "danus", source: file, external_id: entry.id ?? null },
            created_at: entry.timestamp_utc ?? new Date().toISOString(),
            updated_at: entry.timestamp_utc ?? new Date().toISOString()
          };
          store.writeFinding(record, { Claim: entry.claim ?? "", Evidence: entry.evidence ?? "", Notes: JSON.stringify(entry, null, 2) });
          findings.push(id);
        }
      }
    }

    const factDir = path.join(source, "fact_graph", "facts");
    const parsedFacts = [];
    let pending = [];
    if (fs.existsSync(factDir)) {
      for (const file of filesUnder(factDir, ".md")) {
        const parsed = simpleYamlFrontmatter(fs.readFileSync(file, "utf8"));
        const sections = markdownSections(parsed.body);
        parsedFacts.push({ file, metadata: parsed.metadata, sections });
      }
      pending = [...parsedFacts];
      let progressed = true;
      while (pending.length && progressed) {
        progressed = false;
        for (let i = pending.length - 1; i >= 0; i -= 1) {
          const item = pending[i];
          const externalPredecessors = Array.isArray(item.metadata.predecessors) ? item.metadata.predecessors.map(String) : [];
          const mapped = externalPredecessors.map((id) => idMap.get(id)).filter(Boolean);
          if (mapped.length !== externalPredecessors.length && !options.allowMissingPredecessors) continue;
          const externalId = String(item.metadata.fact_id ?? path.basename(item.file, ".md"));
          const factId = computeFactId({
            problem_id: item.metadata.problem_id ?? "danus-import",
            predecessors: mapped,
            glossary: item.metadata.glossary_introduces ?? {},
            statement: item.sections.statement ?? "",
            proof: item.sections.proof ?? ""
          });
          idMap.set(externalId, factId);
          const record = {
            schema: SCHEMAS.fact,
            fact_id: factId,
            problem_id: item.metadata.problem_id ?? "danus-import",
            kind: "lemma",
            title: (item.sections.statement ?? `Imported Danus fact ${factId}`).split(/\r?\n/)[0].slice(0, 120),
            author: item.metadata.author ?? "danus",
            predecessors: mapped,
            glossary: item.metadata.glossary_introduces ?? {},
            verification: { state: "accepted", method: "imported_verified", authority: "Danus verifier", at: new Date().toISOString() },
            evidence_grade: "independently_reviewed",
            resolution: "proved",
            provenance: { adapter: "danus", source: item.file, external_fact_id: item.metadata.fact_id ?? null, unresolved_predecessors: externalPredecessors.filter((id) => !idMap.get(id)) },
            external_refs: item.metadata.external_refs ?? [],
            created_at: new Date().toISOString()
          };
          store.writeFact(record, { Statement: item.sections.statement ?? "", Proof: item.sections.proof ?? "", Intuition: item.sections.intuition ?? "" });
          for (const predecessor of mapped) store.addEdge({ schema: SCHEMAS.edge, from: factId, type: "DEPENDS_ON", to: predecessor, at: new Date().toISOString(), author: "danus-import" });
          facts.push(factId);
          pending.splice(i, 1);
          progressed = true;
        }
      }
    }

    let traces = 0;
    if (options.traces) {
      const file = traceFile(store, "danus", source);
      for (const memory of filesUnder(source, ".jsonl").filter((item) => item.includes(`${path.sep}local_memory${path.sep}`))) {
        for (const entry of readJsonl(memory)) {
          appendTrace(file, { adapter: "danus", source: memory, record: entry });
          traces += 1;
        }
      }
    }
    store.event("IMPORT_COMPLETED", { adapter: "danus", source, findings: findings.length, facts: facts.length, traces });
    return { findings, facts, traces, pending_facts: pending.length };
  }
};
