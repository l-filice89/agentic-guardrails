import { describe, expect, it } from "vitest";

import { CORE_CONTRACTS_LINK, CORE_PACKAGE } from "./index.js";

describe("@agentic-guardrails/core", () => {
  it("exports the package sentinel", () => {
    expect(CORE_PACKAGE).toBe("@agentic-guardrails/core");
  });

  it("re-exposes the contracts sentinel, proving the topological build", () => {
    expect(CORE_CONTRACTS_LINK).toBe("@agentic-guardrails/contracts");
  });
});
