// JSON.parse is the safe deserialization path for untrusted payloads.
export function load(payload: string): unknown {
  return JSON.parse(payload);
}
