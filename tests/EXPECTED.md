# Expected Test Findings

Each fixture maps to the commands that should catch it. Use this as a checklist when verifying command output.

---

## `dirty-frontend.tsx`

Commands that should flag this file: `/cleanup`, `/sweep`, `/review`

| # | Location | Violation | Severity |
|---|----------|-----------|----------|
| 1 | Line 5 | `axios` imported but never used | Dead code |
| 2 | Line 8 | `items: any[]` — no concrete type | Type safety |
| 3 | Line 12 | `useState<any>(null)` — untyped state | Type safety |
| 4 | Line 14 | `console.log(...)` — stray debug log | Observability |
| 5 | Line 17 | `id as any` — unsafe cast | Type safety |
| 6 | Line 22 | `width: '1200px'` — hardcoded desktop width, not mobile-first | UI standards |
| 7 | Line 25 | `<button>` missing `aria-label` | Accessibility |
| 8 | Line 29 | `items.map(...)` missing `key` prop | Framework health |
| 9 | Line 31 | `<li onClick>` missing `role` and keyboard handler | Accessibility |

---

## `dirty-backend.ts`

Commands that should flag this file: `/cleanup`, `/sweep`, `/review`, `/security-scan`

| # | Location | Violation | Severity |
|---|----------|-----------|----------|
| 1 | Line 9 | No auth or ownership check before fetching by `:id` | IDOR / Security — Critical |
| 2 | Line 10 | Trusts client-controlled `req.params.id` without validation | Tenant isolation |
| 3 | Line 12 | `console.log` without structured logger or correlation ID | Observability |
| 4 | Lines 15-17 | String-interpolated SQL query — SQL injection | Security — Critical |
| 5 | Line 19 | `console.log(JSON.stringify(user))` — logs sensitive data | Security — High |
| 6 | Line 27 | `tenantId` sourced from `req.body` without server-side auth | Tenant isolation — Critical |

---

## `dirty-security.ts`

Commands that should flag this file: `/security-scan`

| # | Location | Violation | Severity |
|---|----------|-----------|----------|
| 1 | Lines 6-8 | Hardcoded `API_KEY`, `DB_PASSWORD`, `JWT_SECRET` | Critical |
| 2 | Line 12 | Auth token and API key exposed in URL query string | High |
| 3 | Line 18 | No RBAC check before data access | High |
| 4 | Line 19 | `req.query.id` used in SQL without sanitization — SQL injection | Critical |
| 5 | Line 24 | MD5 used for password hashing — cryptographically broken | High |
