# Axiom #5 — Security Rules (regex/AST tier)

The deterministic security rule set (`rulesetVersion: 5`, Story 1.12). All
four rules run inside the single registered axiom-5 analyzer; findings carry
`axiom: "5"`, `tier: "deterministic"`, `confidence: 1`, and per-rule
`source: "regex"` or `source: "ast"`.

**Every axiom defaults to blocking** (the config plane's `EFFECTIVE_DEFAULTS`
— `blocking`, `maxFindings: 0`). Axiom 5's distinction is that FR-32 names it
as the gate-critical axiom and its rule set is error-dense, so the severity
doctrine is load-bearing: `error` is reserved for patterns with **no
legitimate spelling in application code** (pinned token formats, the eval
family, node-serialize); everything judgment-shaped (generic secret names,
dynamic SQL/exec arguments, `v8.deserialize`) is `warning` — a false positive
in an error-tier rule gates legitimate code, and only errors count toward the
gate. Epic 3's LLM tier is where confidence on the heuristics can rise.

**Two source tiers.** The `hardcoded-secret` rule scans the RAW TEXT of
**every changed file** (`source: "regex"`) — deliberately not the AST, and
deliberately not restricted to the analyzable-TypeScript subset the AST rules
see: a changed `.env`, `.json`, `.yaml`, `.md`, `Dockerfile`, or `.d.ts` is
scanned exactly like a `.ts` file (the pipeline hands the analyzer the raw
pre-filter change list as `allChangedFiles`). Secrets in comments, strings in
malformed files, and non-code lines are caught, and a parse quirk can never
hide a leaked credential. Files are read as UTF-8 and non-UTF-8/binary bytes
are tolerated (the patterns run over whatever decodes). Two declared
coverage-loss cases: a read failure (shared with the AST pass — one entry per
file, never doubled) and a file over the **1 MiB size cap** (a multi-megabyte
artifact is not source; the skip is a typed degradation, never silent). The
scan checks the phase-1 budget signal between files and declares the
remainder if aborted. The other three rules (`source: "ast"`) ride the shared
changed-files parse (one parse per run across axioms 3/4/5, TS-filtered) with
the 1.11 shadowing-immune machinery: import-binding SYMBOL resolution and
local-declaration checks for globals — a local `eval` wrapper, a DI
parameter, or an inner-scope shadow of an import never flags. Matched secret
values are NEVER echoed into finding messages (the review artifact must not
become a second copy of the secret).

**Parsed as data.** Target code is read and parsed, never executed or
dynamically required — pinned by a sentinel hazard test (a fixture whose
top-level code would write a file if executed is analyzed; the file must not
exist afterward).

| ruleId | Source | Severity | Rationale | Approximation | Fixture case |
|---|---|---|---|---|---|
| `security/hardcoded-secret` | regex | **error** for pinned token formats; **warning** for the generic shape | ERROR patterns are near-certain, documented token formats with no legitimate spelling: AWS access key ids (`AKIA`/`ASIA` + 16 uppercase/digits — `ASIA` is the STS temporary form), GitHub classic tokens (`gh[pousr]_` + 36+ alnum) and fine-grained PATs (`github_pat_` + 22+ `[A-Za-z0-9_]`), Slack tokens (`xox[baprse]-…`, incl. `xoxe` refresh tokens), OpenAI keys (`sk-`/`sk-proj-` + 20+ chars, left-boundary-anchored so prose "sk-" never fires), Anthropic keys (`sk-ant-` + 20+ chars — matched under its OWN pattern name; the OpenAI pattern excludes `sk-ant-`), and private-key PEM headers (`-----BEGIN … PRIVATE KEY-----`). These fire EVERYWHERE — including `.test.`/`__fixtures__` paths (a real AWS key in a test file is still a leak) — EXCEPT for **vendor-published sample credentials** (AWS's `AKIAIOSFODNN7EXAMPLE`/`ASIAIOSFODNN7EXAMPLE`, GitHub's documented sample classic PAT): published on the vendors' own doc pages, therefore non-secrets, and exactly what appears in docs and tests. The WARNING pattern — a ≥16-char quoted literal assigned (`=`/`:`) **or compared** (`===`/`==`/`!==`/`!=` — the hardcoded-credential backdoor spelling) to a secret-named identifier/property — is a name-based heuristic, so it warns. The name must END in a secret word-part (`apiKey`, `DB_PASSWORD`, `authToken`): `tokenizerConfig`, `secretaryName`, `passwordHintText`, `maxTokensLabel` do not match. The scan runs over the whole file text (not line by line), so a prettier-wrapped `const apiKey =\n  "…"` still matches, and per-delimiter value classes keep an apostrophe or backtick inside a quoted value from severing the ≥16 floor. Exemptions (WARNING tier only): values referencing `process.env` or `import.meta.env`, obvious placeholders (`changeme`/`example`/`dummy`/`todo`/`test` anchored at the value START, `your-`/`your_`, `<…>`, leading `xxx`), and test paths — basename-anchored `.test.`/`.spec.` plus `__fixtures__`/`__tests__` path segments. Anchor: the line the match starts on. Discriminator: pattern name + ordinal (line-free). | Pattern-based only: NO entropy scanning (nondeterministic noise profile) and no third-party pattern database — the pinned list above is the whole surface. A base64-encoded or novel-format credential is invisible. Files over 1 MiB are skipped (declared). The env-reference exemption keys on SUBSTRING presence, so an env-prefix + hardcoded-suffix template (`` `${process.env.PREFIX}-hardcodedtail` ``) stays exempt — stated, not fixed. | `tests/__fixtures__/security-rules/violation/src/secrets.ts` |
| `security/injection-sink` | ast | warning | A call whose callee member name is `query`/`execute` — or an imported `child_process` `exec`/`execSync` (symbol-resolved binding; renamed/namespace/default forms) — whose argument is a template literal WITH interpolation or a `+` concatenation containing a string operand feeds a dynamically built string into an execution sink. Static strings never flag, including constant-foldable concatenation: a `+` tree whose operands are ALL syntactic strings (`"SELECT * " + "FROM users"`) folds to a fixed value and stays silent. Warning by doctrine: the structural tier cannot prove taint — the argument MIGHT be attacker-influenced. Anchor: the call line. Discriminator: enclosing symbol + member + ordinal. | The `query`/`execute` tier matches by MEMBER NAME (the receiver is unknowable statically) — an ORM's safe `query` wrapper with interpolated input still warns; conversely a sink named anything else is invisible. No data-flow: a variable holding a concatenated string passed as the argument is not seen (Epic 3's taint tier). | `tests/__fixtures__/security-rules/violation/src/injection.ts` |
| `security/dangerous-api` | ast | error | The eval family has no legitimate idiom in application code, so it is near-certain error material: `eval(...)` **including the indirect spellings** `(0, eval)(code)` and `(eval)(code)` (parenthesized and comma-sequence callees are unwrapped before the binding check); the `Function` constructor in every form — `new Function(...)`, the bare call `Function(...)` (spec-identical), and `new globalThis.Function(...)` / `window.` / `self.` — when its **BODY** is a syntactically visible or dynamically built string (only the LAST argument is the body: `new Function("x", bodyVar)`'s `"x"` is a PARAMETER NAME and never flags); `setTimeout`/`setInterval` with a string or concatenated first argument (implied eval); and the `vm` module's `runIn*`/`compileFunction` members plus `new vm.Script(...)` (symbol-resolved import binding — it compiles strings to code exactly like `runIn*`). All callees are BINDING-checked: a locally declared `eval`, a shadowed import, or a DI parameter never flags. Anchor: the call line. Discriminator: enclosing symbol + api name + ordinal. | `new Function(bodyVar)` / `Function(bodyVar)` — a body that is not syntactically a string — is not statically provable and stays out (error tier must be near-certain). `require("vm")` bindings and re-assigned module objects are not tracked (the 1.11 import-binding ceiling). | `tests/__fixtures__/security-rules/violation/src/dangerous.ts` |
| `security/unsafe-deserialization` | ast | **error** for `unserialize`; **warning** for `v8.deserialize` | `unserialize` from a `node-serialize`-family import (pinned: `node-serialize`, `serialize-to-js`) executes embedded functions in the payload — a known RCE vector with no safe use on untrusted input, hence error. `v8.deserialize` is legitimate for trusted IPC payloads but hazardous on untrusted input — a stated approximation, hence warning. Both symbol-resolved: an `unserialize` imported from an unrelated module never flags. Discriminator: enclosing symbol + api + ordinal. | The module list is pinned — no CVE/vulnerability-database lookups (zero egress, licensing is a product decision). Custom deserializers and `Function`-constructing parsers are invisible. | `tests/__fixtures__/security-rules/violation/src/deserialize.ts` |

## Ceilings

Known, deliberate limits — each trades missed findings for zero false
positives on a rule set that gates:

- **No entropy scanning.** High-entropy-string detection has a
  nondeterministic noise profile; the secret rule is pattern-based only,
  with the pattern list pinned above.
- **No taint/data-flow analysis.** A concatenated string stored in a
  variable before reaching a sink is invisible — Epic 3's tier.
- **No network or dependency CVE lookups.** Zero egress; the deserialization
  module list is pinned.
- **No auto-redaction or fixing.** Findings report; humans rotate.
- **Import bindings only** for `child_process`/`vm`/`v8`/node-serialize:
  `require()` bindings, re-assigned module objects, and namespace
  destructuring escape tracking.
- **1 MiB secret-scan cap.** Larger changed files are skipped with a typed
  degradation.
- **Substring-keyed env exemption.** `${process.env.X}`-containing values are
  exempt whole, including env-prefix + hardcoded-suffix templates.
- **Changed files only.** A secret already committed in an unchanged file is
  out of scope for this review (scope is the diff, not the repo).

## Finding identity (ordinal churn scope)

Discriminators are line-free (`symbol#base-N` for AST rules,
`pattern-name-N` for regex matches, ordinals over candidates in source
order), so findingIds survive LINE shifts. They do NOT survive edits to the
candidate list itself: inserting or removing a candidate EARLIER in the same
sequence shifts every later ordinal, and those findingIds churn. That is the
honest stability contract (same as axioms 3/4).

## Scope

Rules fire only for **changed files** (the reviewed change set): raw text of
EVERY changed file for the regex rule, the shared parse-only changed-files
pass (TypeScript sources) for the AST rules — no import graph.

Machine oracle:
`tests/__fixtures__/security-rules/violation/expected-findings.json`
(byte-compared in `tests/integration/security-rules.e2e.test.ts`), plus a
clean fixture asserting zero findings. Because the violation fixture carries
error findings under the default blocking posture, the oracle run **exits 1**
(FR-32) — the opposite posture to axiom 4's all-warnings exit 0, asserted
explicitly, with the `advisory`/`off` rows verifying the 1.6 bypass
machinery. All fixture credentials are obviously-fake tails on documented
shapes (never a vendor's published sample, which the allowlist would exempt
and make the oracle vacuous) — the repo never contains a string a scanner or
human could mistake for a live secret.
