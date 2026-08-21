import { compilePlan } from "./domain/compiler.js";
import { analyzePlan, commitProposal } from "./domain/analyzer.js";
import { researchGraph } from "./data/gabidulin.js";
import { renderResearchGraph } from "./ui/graph.js";

const presets = {
  blocked: `Use a polynomial-size adaptive slice family to make the exterior kernel constant-dimensional for every actual right-coprime ordinary Gabidulin hard pencil when m=n^2. There exists at least one good slice for each pencil.`,
  fork: `Use a polynomial-size adaptive slice family to make the exterior kernel constant-dimensional for every actual right-coprime ordinary Gabidulin hard pencil when m=n^2. Assume evaluation-space exterior expansion that explicitly excludes subfield-trapped determinant images.`,
  semilinear: `Recover all candidates for an actual ordinary Gabidulin hard pencil with polynomial extension degree by reducing marked-factor right divisibility to a single width-one semilinear eigenproblem.`,
  spectrum: `Infer a thin near-heavy spectrum from a small final list, then use random slicing to recover all candidates.`
};

const state = {
  planText: localStorage.getItem("routecheck.plan") || presets.blocked,
  assumptions: "",
  exclusions: "",
  compiled: null,
  analysis: null,
  selectedNode: null,
  tab: "preflight"
};

const app = document.querySelector("#app");

function runPreflight() {
  state.compiled = compilePlan(state.planText, {
    title: "Poly-m Gabidulin slice route",
    assumptions: state.assumptions,
    exclusions: state.exclusions
  });
  state.analysis = analyzePlan(state.compiled, researchGraph);
  localStorage.setItem("routecheck.plan", state.planText);
  render();
}

function render() {
  app.innerHTML = `
    <header class="app-header">
      <div class="brand"><div class="brand-mark">R</div><div><h1>RouteCheck</h1><p>Research static analysis</p></div></div>
      <div class="header-meta"><span class="privacy-pill">Private workspace</span><span class="version">v0.1 clean-room MVP</span></div>
    </header>
    <nav class="tabs" aria-label="Workspace views">
      ${tabButton("preflight", "Preflight")}
      ${tabButton("graph", "Research graph")}
      ${tabButton("commit", "Commit proposal")}
    </nav>
    <main>${renderTab()}</main>
    <footer><span>RouteCheck compares the logic of a research plan against prior attempts and barriers.</span><span>Private alpha.</span></footer>
    ${state.selectedNode ? renderDrawer(state.selectedNode) : ""}`;

  bindEvents();
  if (state.tab === "graph") {
    renderResearchGraph(document.querySelector("#graph-canvas"), researchGraph, (node) => {
      state.selectedNode = node;
      render();
    });
  }
}

function tabButton(id, label) {
  return `<button class="tab ${state.tab === id ? "active" : ""}" data-tab="${id}">${label}</button>`;
}

function renderTab() {
  if (state.tab === "graph") return `<section class="graph-page"><div id="graph-canvas" class="graph-card"></div></section>`;
  if (state.tab === "commit") return renderCommit();
  return renderPreflight();
}

function renderPreflight() {
  const result = state.analysis;
  return `
    <section class="preflight-grid">
      <article class="panel plan-panel">
        <div class="panel-heading"><div><span class="eyebrow">Compile a route</span><h2>What are you about to try?</h2></div><span class="step">01</span></div>
        <label for="plan">Research plan</label>
        <textarea id="plan" rows="10" spellcheck="false">${escapeHtml(state.planText)}</textarea>
        <div class="field-row">
          <div><label for="assumptions">Additional assumptions</label><input id="assumptions" value="${escapeHtml(state.assumptions)}" placeholder="comma-separated tags" /></div>
          <div><label for="exclusions">Explicit exclusions</label><input id="exclusions" value="${escapeHtml(state.exclusions)}" placeholder="e.g. subfield-trapped-determinant-image" /></div>
        </div>
        <div class="preset-row"><span>Benchmarks</span>${Object.keys(presets).map((id) => `<button class="preset" data-preset="${id}">${presetLabel(id)}</button>`).join("")}</div>
        <button id="run-preflight" class="primary">Run preflight <span>⌘↵</span></button>
        ${state.compiled ? renderCompiler(state.compiled) : `<div class="empty-note">The compiler will extract targets, mechanisms, assumptions, exclusions, quantifiers, and parameter regimes.</div>`}
      </article>
      <article class="panel result-panel">
        <div class="panel-heading"><div><span class="eyebrow">Static analysis</span><h2>Collision report</h2></div><span class="step">02</span></div>
        ${result ? renderResult(result) : `<div class="hero-empty"><h3>No route compiled yet</h3><p>Run preflight to compare this plan against prior attempts, barriers, and counterexamples.</p></div>`}
      </article>
    </section>`;
}

function renderCompiler(plan) {
  return `<div class="compiler-card"><div class="compiler-title"><strong>Compiled route</strong><span>${plan.quantifiers.scope}</span></div>${chipGroup("Targets", plan.targets)}${chipGroup("Mechanisms", plan.mechanisms)}${chipGroup("Assumptions", plan.assumptions)}${chipGroup("Exclusions", plan.exclusions, "escape")}</div>`;
}

function chipGroup(label, values, className = "") {
  return `<div class="chip-group"><span>${label}</span><div>${values.length ? values.map((value) => `<b class="chip ${className}">${value}</b>`).join("") : `<i>none detected</i>`}</div></div>`;
}

function renderResult(result) {
  const meta = {
    BLOCKED: ["Blocked", "A prior no-go applies under the route's operative assumptions.", "danger"],
    CLEAR_WITH_FRONTIER: ["Clear with frontier", "The plan explicitly bypasses the known obstruction; the new proof obligation is isolated below.", "success"],
    CAUTION: ["Caution", "Related failed routes exist, but no recorded result currently subsumes this plan.", "warning"],
    CLEAR: ["Clear", "No material collision was detected in the current workspace.", "success"]
  }[result.status];
  return `
    <div class="status-card ${meta[2]}"><div><span>PRE-FLIGHT STATUS</span><h3>${meta[0]}</h3><p>${meta[1]}</p></div></div>
    <div class="metric-row"><div><strong>${result.findings.length}</strong><span>related routes</span></div><div><strong>${result.blockers.length}</strong><span>hard blockers</span></div><div><strong>${result.preservedClaims.length}</strong><span>preserved claims</span></div></div>
    <div class="finding-list">${result.findings.length ? result.findings.map(renderFinding).join("") : `<div class="empty-note">No related attempts found.</div>`}</div>
    ${result.escapeConditions.length ? `<div class="escape-box"><span>Minimum recorded escape condition</span>${result.escapeConditions.map((item) => `<strong>${item}</strong>`).join("")}</div>` : ""}
    ${result.preservedClaims.length ? `<div class="preserved"><span>Not rolled back by this failure</span>${result.preservedClaims.map((node) => `<button class="node-link" data-node="${node.id}">${node.id} · ${node.title}</button>`).join("")}</div>` : ""}`;
}

function renderFinding(finding) {
  const labels = {
    EXACT_DUPLICATE: "Exact replay",
    DOMINATED_DEADEND: "Dominated dead end",
    COUNTEREXAMPLE_APPLIES: "Counterexample applies",
    PARTIAL_COLLISION: "Partial collision",
    GENUINE_FORK: "Genuine fork"
  };
  return `<article class="finding ${finding.severity}">
    <div class="finding-top"><span class="finding-label">${labels[finding.type]}</span><span>${Math.round(finding.similarity * 100)}% route match</span></div>
    <h4>${finding.attempt.id} · ${finding.attempt.title}</h4>
    <p>${finding.summary}</p>
    ${finding.counterexample ? `<button class="evidence-link node-link" data-node="${finding.counterexample.id}">Evidence: ${finding.counterexample.id} · ${finding.counterexample.title}</button>` : ""}
    ${finding.frontier ? `<div class="frontier"><span>New frontier</span>${finding.frontier}</div>` : ""}
  </article>`;
}

function renderCommit() {
  if (!state.analysis || !state.compiled) return `<section class="commit-page"><div class="panel hero-empty"><h3>No analysis to commit</h3><p>Run a preflight first.</p></div></section>`;
  const proposal = commitProposal(state.compiled, state.analysis);
  return `<section class="commit-page"><article class="panel"><div class="panel-heading"><div><span class="eyebrow">Research-state commit</span><h2>Proposed structured commit</h2></div><button id="download-commit" class="secondary">Download JSON</button></div><pre>${escapeHtml(JSON.stringify(proposal, null, 2))}</pre></article></section>`;
}

function renderDrawer(node) {
  return `<div class="drawer-backdrop" id="drawer-backdrop"><aside class="drawer" role="dialog" aria-modal="true"><button id="close-drawer" class="drawer-close">×</button><span class="node-type">${node.type}</span><h2>${node.id} · ${node.title}</h2><span class="node-status">${node.status}</span><p>${node.summary ?? ""}</p></aside></div>`;
}

function bindEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { state.tab = button.dataset.tab; render(); }));
  document.querySelector("#run-preflight")?.addEventListener("click", () => {
    state.planText = document.querySelector("#plan").value;
    state.assumptions = document.querySelector("#assumptions").value;
    state.exclusions = document.querySelector("#exclusions").value;
    runPreflight();
  });
  document.querySelectorAll("[data-preset]").forEach((button) => button.addEventListener("click", () => {
    state.planText = presets[button.dataset.preset];
    state.assumptions = "";
    state.exclusions = "";
    runPreflight();
  }));
  document.querySelectorAll("[data-node]").forEach((button) => button.addEventListener("click", () => {
    state.selectedNode = researchGraph.nodes.find((node) => node.id === button.dataset.node);
    render();
  }));
  document.querySelector("#close-drawer")?.addEventListener("click", () => { state.selectedNode = null; render(); });
  document.querySelector("#download-commit")?.addEventListener("click", downloadCommit);
}

function downloadCommit() {
  const payload = JSON.stringify(commitProposal(state.compiled, state.analysis), null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "routecheck-commit.json";
  link.click();
  URL.revokeObjectURL(url);
}

function presetLabel(id) {
  return ({ blocked: "Blocked slice", fork: "Genuine fork", semilinear: "Semilinear", spectrum: "Near-heavy" })[id];
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

runPreflight();
