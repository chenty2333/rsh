import crypto from "node:crypto";

export function normalizeWhitespace(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

export function stableSortObject(value) {
  if (Array.isArray(value)) return value.map(stableSortObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableSortObject(value[key])])
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(stableSortObject(value));
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function shortHash(value, length = 16) {
  return sha256(value).slice(0, length);
}

export function slug(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "record";
}
