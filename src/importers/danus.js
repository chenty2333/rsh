import fs from "node:fs";
import path from "node:path";
import { SCHEMAS } from "../core/constants.js";
import { sha256, shortHash } from "../core/canonical.js";
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

function factAwarenessId(externalId) {
  return "danus-fact-" + shortHash(String(externalId), 20);
}

function canImportLlmAuditAsTruth(store) {
  const policy = store.workspace.truth_policy ?? {};
  return policy.allow_llm_audit_as_truth === true;
}

function normalizeFact(file, revoked = false, revocation = null) {
  const raw = fs.readFileSync(file, "utf8");
  const parsed = simpleYamlFrontmatter(raw);
  const metadata = parsed.metadata;
  const externalId = String(metadata.fact_id ?? path.basename(file, ".md"));
  return { file, raw, metadata, sections: markdownSections(parsed.body), externalId, revoked, revocation };
}

function sourceVerification(revoked) {
  return {
    state: revoked ? "revoked" : "accepted",
    method: "llm_audit",
    authority: "Danus verifier (LLM audit)"
  };
}

function pendingDetail(item, idMap) {
  const predecessors = Array.isArray(item.metadata.predecessors) ? item.metadata.predecessors.map(String) : [];
  return {
    external_fact_id: item.externalId,
    source: item.file,
    reason: "missing_predecessors",
    missing_predecessors: predecessors.filter((id) => !idMap.has(id)),
    predecessors
  };
}

export const danusImporter = {
  name: "danus",
  detect(source) {
    return fs.existsSync(path.join(source, "global_memory")) || fs.existsSync(path.join(source, "fact_graph"));
  },
  import(store, source, options = {}) {
    const findings = [];
    const facts = [];
    const idMap = new Map();
    const factMap = new Map();
    const globalDir = path.join(source, "global_memory");
    if (fs.existsSync(globalDir)) {
      const statusFile = path.join(globalDir, "_status.jsonl");
      const latestStatus = new Map();
      if (fs.existsSync(statusFile)) {
        for (const receipt of readJsonl(statusFile)) {
          if (receipt?.id) latestStatus.set(String(receipt.id), receipt);
        }
      }
      for (const file of filesUnder(globalDir, ".jsonl")) {
        if (path.basename(file) === "_status.jsonl") continue;
        for (const original of readJsonl(file)) {
          const status = original?.id ? latestStatus.get(String(original.id)) : null;
          const entry = status
            ? { ...original, status: status.status, fact_id: status.fact_id || original.fact_id }
            : original;
          const kind = KIND_MAP[entry.kind] ?? "obstacle";
          const externalId = entry.id ?? shortHash(`${path.relative(source, file)}:${JSON.stringify(original)}`, 20);
          const id = "danus-" + externalId;
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
            provenance: {
              adapter: "danus",
              source: file,
              source_relative_path: path.relative(source, file).split(path.sep).join("/"),
              external_id: entry.id ?? null,
              external_kind: entry.kind ?? null,
              status_receipt: status
            },
            created_at: entry.timestamp_utc ?? new Date().toISOString(),
            updated_at: entry.timestamp_utc ?? new Date().toISOString()
          };
          store.writeFinding(record, { Claim: entry.claim ?? "", Evidence: entry.evidence ?? "", Notes: JSON.stringify({ original, effective: entry }, null, 2) });
          findings.push(id);
        }
      }
    }

    const factRoot = path.join(source, "fact_graph");
    const factDir = path.join(factRoot, "facts");
    const revokedDir = path.join(factRoot, "_revoked");
    const revocationLog = path.join(factRoot, "revocation_log.jsonl");
    const revocations = fs.existsSync(revocationLog) ? readJsonl(revocationLog) : [];
    const revocationsById = new Map(revocations.filter((item) => item?.fact_id).map((item) => [String(item.fact_id), item]));
    const parsedFacts = [
      ...filesUnder(factDir, ".md").map((file) => normalizeFact(file)),
      ...filesUnder(revokedDir, ".md").map((file) => normalizeFact(file, true))
    ].map((item) => ({ ...item, revoked: item.revoked || revocationsById.has(item.externalId), revocation: item.revocation ?? revocationsById.get(item.externalId) ?? null }));
    const pending = [];

    if (parsedFacts.length) {
      const candidates = new Map();
      for (const item of parsedFacts) {
        const existing = candidates.get(item.externalId);
        if (!existing || item.revoked) candidates.set(item.externalId, item);
      }
      const candidateIds = new Set(candidates.keys());
      const unresolved = [...candidates.values()];
      let progressed = true;
      const permitTruth = canImportLlmAuditAsTruth(store);
      while (unresolved.length && progressed) {
        progressed = false;
        for (let i = unresolved.length - 1; i >= 0; i -= 1) {
          const item = unresolved[i];
          const externalPredecessors = Array.isArray(item.metadata.predecessors) ? item.metadata.predecessors.map(String) : [];
          const missingPredecessors = externalPredecessors.filter((id) => !idMap.has(id));
          if (missingPredecessors.some((id) => candidateIds.has(id))) continue;
          if (missingPredecessors.length && !options.allowMissingPredecessors && !item.revoked) continue;

          const mappedPredecessors = externalPredecessors.map((id) => idMap.get(id)).filter(Boolean);
          const unresolvedTruthPredecessors = externalPredecessors.filter((id) => !factMap.has(id));
          const provenance = {
            adapter: "danus",
            source: item.file,
            source_relative_path: path.relative(source, item.file).split(path.sep).join("/"),
            source_sha256: sha256(item.raw),
            external_fact_id: item.externalId,
            external_predecessors: externalPredecessors,
            unresolved_predecessors: missingPredecessors,
            source_verification: sourceVerification(item.revoked),
            revocation: item.revocation,
            frontmatter: item.metadata
          };
          const statement = item.sections.statement ?? "";
          const proof = item.sections.proof ?? "";
          const intuition = item.sections.intuition ?? "";
          const glossary = item.metadata.glossary_introduces ?? {};
          const invalidTruthSource = !statement.trim()
            ? "missing_statement"
            : !proof.trim()
              ? "missing_proof"
              : !glossary || typeof glossary !== "object" || Array.isArray(glossary)
                ? "invalid_glossary"
                : null;
          const title = (statement || "Imported Danus fact " + item.externalId).split(/\r?\n/)[0].slice(0, 120);
          const mayWriteTruth = permitTruth && !item.revoked && unresolvedTruthPredecessors.length === 0 && !invalidTruthSource;
          let targetId;

          if (mayWriteTruth) {
            const factId = computeFactId({
              problem_id: item.metadata.problem_id ?? "danus-import",
              predecessors: mappedPredecessors,
              glossary,
              statement,
              proof
            });
            const record = {
              schema: SCHEMAS.fact,
              fact_id: factId,
              problem_id: item.metadata.problem_id ?? "danus-import",
              kind: "lemma",
              title,
              author: item.metadata.author ?? "danus",
              predecessors: mappedPredecessors,
              glossary,
              verification: { state: "accepted", method: "llm_audit", authority: "Danus verifier (LLM audit)", at: new Date().toISOString() },
              evidence_grade: "llm_audited",
              resolution: "proved",
              provenance,
              external_refs: item.metadata.external_refs ?? [],
              created_at: new Date().toISOString()
            };
            store.writeFact(record, { Statement: statement, Proof: proof, Intuition: intuition });
            facts.push(factId);
            factMap.set(item.externalId, factId);
            targetId = factId;
          } else {
            const findingId = factAwarenessId(item.externalId);
            const record = {
              schema: SCHEMAS.finding,
              id: findingId,
              kind: "proof_attempt",
              title,
              state: item.revoked ? "refuted" : "supported",
              trust: "finding",
              verifiable: true,
              author: item.metadata.author ?? "danus",
              problem_id: item.metadata.problem_id ?? "danus-import",
              predecessors: mappedPredecessors,
              evidence_refs: [],
              source_verification: sourceVerification(item.revoked),
              evidence_grade: "llm_audited",
              external_refs: item.metadata.external_refs ?? [],
              provenance: {
                ...provenance,
                truth_import: item.revoked
                  ? "blocked_by_revocation"
                  : unresolvedTruthPredecessors.length
                    ? "blocked_by_nontruth_predecessor"
                    : invalidTruthSource
                      ? `blocked_by_${invalidTruthSource}`
                      : "blocked_by_truth_policy"
              },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            };
            store.writeFinding(record, { Statement: statement, Proof: proof, Intuition: intuition, "Danus frontmatter": JSON.stringify(item.metadata, null, 2) });
            findings.push(findingId);
            targetId = findingId;
          }

          idMap.set(item.externalId, targetId);
          for (const predecessor of mappedPredecessors) {
            store.addEdge({ schema: SCHEMAS.edge, from: targetId, type: "DEPENDS_ON", to: predecessor, at: new Date().toISOString(), author: "danus-import" });
          }
          unresolved.splice(i, 1);
          progressed = true;
        }
      }
      pending.push(...unresolved.map((item) => pendingDetail(item, idMap)));
    }

    let traces = 0;
    if (options.traces) {
      const file = traceFile(store, "danus", source);
      for (const memory of filesUnder(source, ".jsonl").filter((item) => item.includes(path.sep + "local_memory" + path.sep))) {
        for (const entry of readJsonl(memory)) {
          appendTrace(file, { adapter: "danus", source: memory, record: entry });
          traces += 1;
        }
      }
    }
    store.event("IMPORT_COMPLETED", { adapter: "danus", source, findings: findings.length, facts: facts.length, traces, pending_facts: pending.length });
    return { findings, facts, traces, pending_facts: pending.length, pending };
  }
};
