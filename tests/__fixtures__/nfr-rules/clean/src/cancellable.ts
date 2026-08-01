// fetch with an explicit AbortSignal: cancellable external call.
export async function get(url: string, signal: AbortSignal): Promise<number> {
  const res = await fetch(url, { signal });
  return res.status;
}
