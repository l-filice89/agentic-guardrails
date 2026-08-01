// Original occurrence of the duplicated body (file-sort order).
export function alpha(): number {
  const a = 1;
  const b = a + 2;
  const c = b + 3;
  const d = [a, b, c].map((x) => x + 1);
  return d.length + a;
}
