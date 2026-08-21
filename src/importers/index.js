import { danusImporter } from "./danus.js";
import { jupyterImporter } from "./jupyter.js";
import { chatImporter } from "./chat.js";
import { gitImporter } from "./git.js";

const importers = new Map([danusImporter, jupyterImporter, chatImporter, gitImporter].map((item) => [item.name, item]));

export function listImporters() {
  return [...importers.keys()].sort();
}

export function runImporter(name, store, source, options = {}) {
  const importer = importers.get(name);
  if (!importer) throw new Error(`Unknown importer ${name}. Available: ${listImporters().join(", ")}`);
  if (!importer.detect(source, options)) throw new Error(`Source does not look like a ${name} input: ${source}`);
  return importer.import(store, source, options);
}

export function registerImporter(importer) {
  if (!importer?.name || typeof importer.import !== "function") throw new Error("Importer must define name and import()");
  importers.set(importer.name, importer);
}
