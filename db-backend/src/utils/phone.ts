export function normalizePhone(input: string): string {
  return String(input || "").replace(/\D/g, "");
}

export function phonesMatch(stored: string, query: string): boolean {
  const left = normalizePhone(stored);
  const right = normalizePhone(query);
  if (!left || !right) return false;
  return left === right || left.endsWith(right) || right.endsWith(left);
}

export function clip(text: string, max: number): string {
  const value = (text || "").trim();
  if (value.length <= max) return value;
  if (max <= 1) return value.slice(0, max);
  return `${value.slice(0, max - 1)}…`;
}
