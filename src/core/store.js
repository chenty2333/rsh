import fs from "node:fs";
import path from "node:path";
import { appendJsonl, listFiles, readJson, readJsonl, writeJsonAtomic } from "./fs.js";
import { readDocument, writeDocumentAtomic } from "./doc.js";
import { requireWorkspace, workspacePaths } from "./paths.js";
import { validateEdge, validateEvidence, validateFact, validateFinding } from "./schema.js";

export class Store {
  constructor(root = requireWorkspace()) {
    this.root = root;
    this.paths = workspacePaths(root);
    this.workspace = readJson(this.paths.workspace);
  }

  findingPath(id) {
    return path.join(this.paths.findings, `${id}.md`);
  }

  factPath(id) {
    return path.join(this.paths.facts, `${id}.md`);
  }

  evidencePath(id) {
    return path.join(this.paths.evidence, `${id}.json`);
  }

  hasFinding(id) {
    return fs.existsSync(this.findingPath(id));
  }

  hasFact(id) {
    return fs.existsSync(this.factPath(id));
  }

  writeFinding(record, sections = {}, options = {}) {
    validateFinding(record);
    const file = this.findingPath(record.id);
    if (fs.existsSync(file) && !options.replace) throw new Error(`Finding ${record.id} already exists`);
    writeDocumentAtomic(file, record, sections);
    this.event("FINDING_WRITTEN", { id: record.id, kind: record.kind, state: record.state });
    this.invalidateIndex();
    return file;
  }

  readFinding(id) {
    const file = this.findingPath(id);
    if (!fs.existsSync(file)) return null;
    return { ...readDocument(file), file };
  }

  listFindings() {
    return listFiles(this.paths.findings, (file) => file.endsWith(".md")).map((file) => ({ ...readDocument(file), file }));
  }

  writeFact(record, sections, options = {}) {
    validateFact(record);
    const file = this.factPath(record.fact_id);
    if (fs.existsSync(file) && !options.replace) throw new Error(`Fact ${record.fact_id} already exists`);
    writeDocumentAtomic(file, record, sections);
    this.event("FACT_WRITTEN", { fact_id: record.fact_id, kind: record.kind });
    this.invalidateIndex();
    return file;
  }

  readFact(id) {
    const file = this.factPath(id);
    if (!fs.existsSync(file)) return null;
    return { ...readDocument(file), file };
  }

  listFacts(options = {}) {
    const revoked = new Set(this.revocations().map((item) => item.fact_id));
    return listFiles(this.paths.facts, (file) => file.endsWith(".md"))
      .map((file) => ({ ...readDocument(file), file }))
      .filter((doc) => options.includeRevoked || !revoked.has(doc.metadata.fact_id));
  }

  writeEvidence(record, options = {}) {
    validateEvidence(record);
    const file = this.evidencePath(record.id);
    if (fs.existsSync(file) && !options.replace) throw new Error(`Evidence ${record.id} already exists`);
    writeJsonAtomic(file, record);
    this.event("EVIDENCE_WRITTEN", { id: record.id, kind: record.kind });
    this.invalidateIndex();
    return file;
  }

  readEvidence(id) {
    const file = this.evidencePath(id);
    return fs.existsSync(file) ? readJson(file) : null;
  }

  listEvidence() {
    return listFiles(this.paths.evidence, (file) => file.endsWith(".json")).map(readJson);
  }

  addEdge(edge) {
    validateEdge(edge);
    const key = `${edge.from}\t${edge.type}\t${edge.to}`;
    const exists = this.edges().some((item) => `${item.from}\t${item.type}\t${item.to}` === key);
    if (!exists) appendJsonl(this.paths.edges, edge);
    this.invalidateIndex();
    return !exists;
  }

  edges() {
    return readJsonl(this.paths.edges);
  }

  verification(record) {
    appendJsonl(this.paths.verifications, record);
    this.event("VERIFICATION_RECORDED", { finding_id: record.finding_id, verdict: record.verdict, method: record.method });
  }

  verifications() {
    return readJsonl(this.paths.verifications);
  }

  revoke(record) {
    appendJsonl(this.paths.revocations, record);
    this.event("FACT_REVOKED", { fact_id: record.fact_id, root_fact_id: record.root_fact_id });
    this.invalidateIndex();
  }

  revocations() {
    return readJsonl(this.paths.revocations);
  }

  event(type, payload = {}) {
    appendJsonl(this.paths.events, { at: new Date().toISOString(), type, ...payload });
  }

  events() {
    return readJsonl(this.paths.events);
  }

  get(id) {
    return this.readFinding(id) ?? this.readFact(id) ?? this.readEvidence(id);
  }

  invalidateIndex() {
    try {
      fs.rmSync(this.paths.index, { force: true });
    } catch {}
  }
}
