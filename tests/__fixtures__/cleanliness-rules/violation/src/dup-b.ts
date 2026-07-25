// Identifiers/literals renamed, structure identical: duplicate-code material.
export function beta(): number {
  const z = 9;
  const y = z + 8;
  const w = y + 7;
  const v = [z, y, w].map((q) => q + 6);
  return v.length + z;
}
