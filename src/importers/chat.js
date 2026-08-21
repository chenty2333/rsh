import fs from "node:fs";
import { readJsonl } from "../core/fs.js";
import { traceFile, appendTrace } from "./utils.js";

function messages(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.messages)) return data.messages;
  if (Array.isArray(data.conversation)) return data.conversation;
  return [data];
}

export const chatImporter = {
  name: "chat",
  detect(source) {
    return fs.existsSync(source) && /\.(json|jsonl)$/i.test(source);
  },
  import(store, source) {
    const records = source.endsWith(".jsonl") ? readJsonl(source) : messages(JSON.parse(fs.readFileSync(source, "utf8")));
    const target = traceFile(store, "chat", source);
    let count = 0;
    for (const record of records) {
      appendTrace(target, {
        adapter: "chat",
        source,
        role: record.role ?? record.author?.role ?? record.sender ?? "unknown",
        content: record.content ?? record.text ?? record.message ?? record,
        original: record
      });
      count += 1;
    }
    store.event("IMPORT_COMPLETED", { adapter: "chat", source, traces: count });
    return { traces: count, file: target };
  }
};
