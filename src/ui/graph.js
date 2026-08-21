const colors = {
  problem: "#7dd3fc",
  theorem: "#86efac",
  attempt: "#fbbf24",
  counterexample: "#fb7185",
  barrier: "#c084fc",
  "open-gap": "#67e8f9"
};

function withLayout(nodes) {
  const columns = [110, 300, 500, 700];
  return nodes.map((node, index) => {
    if (node.position) return node;
    const col = index % columns.length;
    const row = Math.floor(index / columns.length);
    return { ...node, position: [columns[col], 80 + row * 145] };
  });
}

export function renderResearchGraph(container, graph, onSelect) {
  const width = 820;
  const nodes = withLayout(graph.nodes);
  const height = Math.max(620, 180 + Math.ceil(nodes.length / 4) * 145);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  const edgeMarkup = graph.edges
    .map(([from, to, label]) => {
      const a = nodeById.get(from);
      const b = nodeById.get(to);
      if (!a || !b) return "";
      const [x1, y1] = a.position;
      const [x2, y2] = b.position;
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      return `<g class="graph-edge"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" /><text x="${mx}" y="${my - 6}">${label}</text></g>`;
    })
    .join("");

  const nodeMarkup = nodes
    .map((node) => {
      const [x, y] = node.position;
      const fill = colors[node.type] ?? "#94a3b8";
      return `<g class="graph-node" data-node-id="${node.id}" transform="translate(${x}, ${y})" tabindex="0" role="button" aria-label="Open ${node.title}"><rect x="-76" y="-27" width="152" height="54" rx="14" fill="${fill}" /><text class="node-id" x="0" y="-6">${node.id}</text><text class="node-title" x="0" y="12">${escapeXml(shorten(node.title, 24))}</text></g>`;
    })
    .join("");

  container.innerHTML = `<div class="graph-toolbar"><div><strong>Gabidulin benchmark graph</strong><span>${graph.nodes.length} nodes · ${graph.edges.length} edges</span></div></div><div class="graph-scroll"><svg class="research-graph" viewBox="0 0 ${width} ${height}" aria-label="Research route graph">${edgeMarkup}${nodeMarkup}</svg></div>`;

  container.querySelectorAll(".graph-node").forEach((element) => {
    const select = () => onSelect(nodeById.get(element.dataset.nodeId));
    element.addEventListener("click", select);
    element.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") select();
    });
  });
}

function shorten(value, max) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function escapeXml(value) {
  return value.replace(/[<>&'\"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[char]);
}
