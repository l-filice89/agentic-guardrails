// Fixed-arity Promise.all: the fan-out is bounded by construction.
export async function pair(a: () => Promise<number>, b: () => Promise<number>): Promise<number[]> {
  return Promise.all([a(), b()]);
}
