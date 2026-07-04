import { describe, expect, it } from "vitest";

import { CONTRACTS_PACKAGE } from "./index.js";

describe("@agentic-guardrails/contracts", () => {
  it("exports the package sentinel", () => {
    expect(CONTRACTS_PACKAGE).toBe("@agentic-guardrails/contracts");
  });
});
