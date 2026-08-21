import fs from "node:fs";
import { traceFile, appendTrace } from "./utils.js";

export const jupyterImporter = {
  name: "jupyter",
  detect(source) {
    return source.endsWith(".ipynb") && fs.existsSync(source);
  },
  import(store, source) {
    const notebook = JSON.parse(fs.readFileSync(source, "utf8"));
    const target = traceFile(store, "jupyter", source);
    let count = 0;
    for (let index = 0; index < (notebook.cells ?? []).length; index += 1) {
      const cell = notebook.cells[index];
      appendTrace(target, {
        adapter: "jupyter",
        source,
        cell_index: index,
        cell_type: cell.cell_type,
        source_text: Array.isArray(cell.source) ? cell.source.join("") : String(cell.source ?? ""),
        outputs: cell.outputs ?? [],
        metadata: cell.metadata ?? {}
      });
      count += 1;
    }
    store.event("IMPORT_COMPLETED", { adapter: "jupyter", source, traces: count });
    return { traces: count, file: target };
  }
};
