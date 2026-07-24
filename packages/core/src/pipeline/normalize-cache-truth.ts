/**
 * Shared test helper (unit + integration suites — not part of the public
 * core surface).
 *
 * BYTE-DETERMINISM CARVE-OUT (1.7): `manifest.cache` is the ONLY field
 * allowed to differ between a cold and a warm run (hit/miss counters are
 * runtime truth by design) — byte comparisons normalize it out before
 * asserting identity. Everything else must be byte-identical.
 */
export function normalizeCacheTruth(artifactJson: string): string {
  const parsed = JSON.parse(artifactJson) as { manifest: { cache?: unknown } };
  delete parsed.manifest.cache;
  return JSON.stringify(parsed, null, 2);
}
