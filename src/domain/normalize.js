export function normalizeText(value = "") {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function overlap(left = [], right = []) {
  const rightSet = new Set(right);
  return left.filter((item) => rightSet.has(item));
}

export function difference(left = [], right = []) {
  const rightSet = new Set(right);
  return left.filter((item) => !rightSet.has(item));
}

export function isSubset(left = [], right = []) {
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

export function jaccard(left = [], right = []) {
  const a = new Set(left);
  const b = new Set(right);
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 0;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  return intersection / union.size;
}
