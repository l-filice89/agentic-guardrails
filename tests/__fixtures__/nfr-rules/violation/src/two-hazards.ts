// TWO hazards of one rule in one function: ordinal discrimination
// (`both#fetch-0` / `both#fetch-1`) must reach the persisted oracle.
export async function both(a: string, b: string): Promise<number> {
  const first = await fetch(a);
  const second = await fetch(b, { method: "POST" });
  return first.status + second.status;
}
