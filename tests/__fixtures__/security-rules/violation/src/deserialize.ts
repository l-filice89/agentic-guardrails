import { unserialize } from "node-serialize";

// node-serialize unserialize is a known RCE vector on untrusted payloads.
export function load(payload: string): unknown {
  return unserialize(payload);
}
