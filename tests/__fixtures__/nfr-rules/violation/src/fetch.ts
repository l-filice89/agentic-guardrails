// fetch with a literal options bag lacking `signal`: uncancellable call.
export async function post(url: string): Promise<number> {
  const res = await fetch(url, { method: "POST" });
  return res.status;
}
