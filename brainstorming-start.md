### The Core Philosophy
The current AI engineering landscape is broken: agents routinely violate core software engineering principles like DRY, strict data validation, and deterministic runtime boundaries. This tool changes that by "Shifting Left" engineering verification—introducing strict software contracts and automated guardrails to move validation away from prompt-heavy velocity to deterministic architectural control.

### Current State
Right now, the project exists as a highly curated collection of Markdown-driven commands for local CLI agents (like Claude Code), executing passes like `/cleanup`, `/sweep`, `/security-scan`, and `/review`. It enforces strict type safety, structured logging, tenant isolation, and accessibility.

### Target Project Blueprint
We want to evolve this repository from a prompt-only configuration layer into a programmatic, pluggable Node.js/TypeScript runtime engine. We have drafted the following baseline directory structure to guide the decoupling:

agentic-guardrails/
├── bin/cli.js                # Executable for CI/CD pipelines and local terminal use
├── core/                     # Deterministic evaluation engine (TypeScript Core)
│   ├── ast/                  # TypeScript Compiler API scans for structural rules
│   └── agents/               # Orchestration logic for task-specific micro-agents
├── plugins/                  # Ecosystem connectors (Claude Code, Cursor, GitHub Actions)
└── skills/                   # Universal engineering guidelines and baseline prompt specs

### The Architectural Goal
Using this structure as a baseline, we need to design the orchestration engine within `core/agents/` that coordinates dedicated, task-specific micro-agents, backed by deterministic static analysis from `core/ast/`.

### Your Analytical Tasks

1. **Micro-Agent Specialization & Topology:** Instead of a monolithic prompt reviewing a codebase, define the specialized micro-agent roles required for a `/review` or `/cleanup` pipeline (e.g., an AST/Linter Agent, a Security/Isolation Agent, a DRY/Refactoring Agent, and an Architectural Synthesis Agent). How do they divide labor based on our directory layout?
2. **Deterministic Handoffs & State Matrix:** When Agent A passes state to Agent B, how do we guarantee type-safety contracts across the execution loop? Design a structural schema or state machine representation that prevents prompt drift between agent transitions.
3. **The "Shift-Left" Hybrid Verification Layer:** Identify exactly how the code in `core/ast/` (e.g., native TypeScript Compiler API, regex secret scanning, static analysis AST parsing) should run *before* injecting context into the LLM micro-agents to optimize latency, cost, and accuracy.
4. **OSS Extensibility Matrix:** How should we structure the core framework so external enterprise developers can write and plug in their own custom "Engineering Standards" or micro-agents via npm modules?

Provide a highly pragmatic, deeply technical architectural breakdown, focusing on decoupling the runtime execution from any specific LLM vendor. Let's build a world-class system.