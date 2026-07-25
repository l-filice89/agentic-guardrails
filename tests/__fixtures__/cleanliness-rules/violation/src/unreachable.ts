// Statements after the return can never execute: unreachable-code material.
export function compute(): number {
  const x = 1;
  return x;
  const dead = x + 1;
  void dead;
}
