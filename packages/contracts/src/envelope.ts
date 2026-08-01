import { z } from "zod";

/**
 * ADR-001 LLM contract envelope: every LLM interaction crosses a
 * Zod-validated `<axiom>.in` / `<axiom>.out` pair. Defined here (contracts
 * is the only shared surface); first consumed by the `llm` package in
 * Epic 2. `core` never sees an SDK — only these validated shapes.
 */
export function axiomEnvelope<In extends z.ZodType, Out extends z.ZodType>(
  axiom: string,
  inSchema: In,
  outSchema: Out,
) {
  return {
    axiom,
    in: { channel: `${axiom}.in`, schema: inSchema },
    out: { channel: `${axiom}.out`, schema: outSchema },
  } as const;
}

export type AxiomEnvelope<
  In extends z.ZodType = z.ZodType,
  Out extends z.ZodType = z.ZodType,
> = ReturnType<typeof axiomEnvelope<In, Out>>;
