export const GENERATED_ID_WIDTH = 5;
export const GENERATED_ID_SPACE = 36 ** GENERATED_ID_WIDTH;
export const ITEM_ID_PATTERN = /^[QDR]-(?:[0-9a-z]{3}|[0-9a-z]{5})$/;
export const RECORD_ID_PATTERN = /^R-(?:[0-9a-z]{3}|[0-9a-z]{5})$/;
export const FRONTIER_ID_PATTERN = /^[QD]-(?:[0-9a-z]{3}|[0-9a-z]{5})$/;
export const GENERATED_ITEM_ID_PATTERN = /^[QDR]-[0-9a-z]{5}$/;

export function isItemId(value) {
  return typeof value === "string" && ITEM_ID_PATTERN.test(value);
}

export function isRecordId(value) {
  return typeof value === "string" && RECORD_ID_PATTERN.test(value);
}

export function hasExactIdReference(text, id) {
  if (typeof text !== "string" || !isItemId(id)) return false;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`, "m").test(text);
}

export function generatedOrdinal(id) {
  return GENERATED_ITEM_ID_PATTERN.test(id ?? "") ? Number.parseInt(id.slice(2), 36) : null;
}

export function nextGeneratedOrdinal(ids = []) {
  let next = 0;
  for (const id of ids) {
    const ordinal = generatedOrdinal(id);
    if (ordinal !== null) next = Math.max(next, ordinal + 1);
  }
  return next;
}

export function formatGeneratedId(prefix, ordinal) {
  if (!/^[QDR]$/.test(prefix ?? "")) throw new Error("ID prefix must be Q, D, or R");
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= GENERATED_ID_SPACE) {
    throw new Error("No five-digit base36 IDs remain");
  }
  return `${prefix}-${ordinal.toString(36).padStart(GENERATED_ID_WIDTH, "0")}`;
}
